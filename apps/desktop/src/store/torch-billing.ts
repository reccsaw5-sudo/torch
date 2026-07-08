import { $torchLogin, torchServerBase } from './torch-login'

// Client-side wrapper for the torch-server recharge/payment endpoints. The
// billing API lives at the brand-server root (not the `/v1` inference base) and
// authenticates with the same inference key.

export interface RechargePackage {
  id: number
  title: string
  amount_fen: number
  credits: number
}

export interface BillingConfig {
  enabled: boolean
  providers: string[] // "wechat" | "alipay"
  currency: string
  packages: RechargePackage[]
}

export interface RechargeOrder {
  out_trade_no: string
  provider: string
  amount_fen: number
  credits: number
  qr_code_url: string
  qr_image: string // inline SVG data-URI
}

export interface OrderStatus {
  status: 'pending' | 'paid' | 'failed'
  credits: number
  balance: number
}

export interface MyOrder {
  out_trade_no: string
  provider: string
  amount_fen: number
  credits: number
  status: string
  created_at: number
  paid_at: number | null
}

function authHeaders(): Record<string, string> {
  const session = $torchLogin.get().session

  return session ? { Authorization: `Bearer ${session.apiKey}` } : {}
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: unknown }

    if (typeof data.detail === 'string') {
      return data.detail
    }
  } catch {
    // non-JSON error body
  }

  return `请求失败 (${res.status})`
}

export async function fetchBillingConfig(): Promise<BillingConfig> {
  const res = await fetch(`${torchServerBase()}/billing/config`, { headers: authHeaders() })

  if (!res.ok) {
    throw new Error(await readError(res))
  }

  return (await res.json()) as BillingConfig
}

export async function createRechargeOrder(packageId: number, provider: string): Promise<RechargeOrder> {
  const res = await fetch(`${torchServerBase()}/billing/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ package_id: packageId, provider })
  })

  if (!res.ok) {
    throw new Error(await readError(res))
  }

  return (await res.json()) as RechargeOrder
}

export async function fetchOrderStatus(outTradeNo: string): Promise<OrderStatus> {
  const res = await fetch(`${torchServerBase()}/billing/order/${encodeURIComponent(outTradeNo)}`, {
    headers: authHeaders()
  })

  if (!res.ok) {
    throw new Error(await readError(res))
  }

  return (await res.json()) as OrderStatus
}

export async function fetchMyOrders(): Promise<MyOrder[]> {
  const res = await fetch(`${torchServerBase()}/billing/orders`, { headers: authHeaders() })

  if (!res.ok) {
    throw new Error(await readError(res))
  }

  return ((await res.json()) as { data: MyOrder[] }).data
}
