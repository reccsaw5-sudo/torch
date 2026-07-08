import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Loader2, Zap } from '@/lib/icons'
import {
  type BillingConfig,
  createRechargeOrder,
  fetchBillingConfig,
  fetchMyOrders,
  fetchOrderStatus,
  type MyOrder,
  type RechargeOrder,
  type RechargePackage
} from '@/store/torch-billing'
import { $torchLogin, refreshTorchCredits } from '@/store/torch-login'

import { PageSearchShell } from '../page-search-shell'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

interface BillingViewProps {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

type Phase = 'creating' | 'error' | 'loading' | 'paid' | 'qr' | 'select'

const PROVIDER_LABEL: Record<string, string> = { alipay: '支付宝', wechat: '微信支付' }
const POLL_MS = 2500

const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`

function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false })
}

function orderStatusLabel(status: string): string {
  return status === 'paid' ? '已支付' : status === 'failed' ? '已失败' : '待支付'
}

export function BillingView({ setStatusbarItemGroup: _setStatusbarItemGroup }: BillingViewProps) {
  const { session } = useStore($torchLogin)
  const [phase, setPhase] = useState<Phase>('loading')
  const [config, setConfig] = useState<BillingConfig | null>(null)
  const [provider, setProvider] = useState('')
  const [order, setOrder] = useState<RechargeOrder | null>(null)
  const [orders, setOrders] = useState<MyOrder[]>([])
  const [error, setError] = useState('')
  const pollRef = useRef<null | ReturnType<typeof setInterval>>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const loadOrders = useCallback(() => {
    void fetchMyOrders()
      .then(setOrders)
      .catch(() => undefined)
  }, [])

  const loadConfig = useCallback(() => {
    setPhase('loading')
    setError('')
    fetchBillingConfig()
      .then(cfg => {
        setConfig(cfg)
        setProvider(cfg.providers[0] ?? '')
        setPhase('select')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      })
  }, [])

  useEffect(() => {
    loadConfig()
    loadOrders()

    return stopPolling
  }, [loadConfig, loadOrders, stopPolling])

  const buy = useCallback(
    async (pkg: RechargePackage) => {
      if (!provider) {
        return
      }

      setPhase('creating')
      setError('')

      try {
        const created = await createRechargeOrder(pkg.id, provider)

        setOrder(created)
        setPhase('qr')
        stopPolling()
        pollRef.current = setInterval(() => {
          void fetchOrderStatus(created.out_trade_no)
            .then(status => {
              if (status.status === 'paid') {
                stopPolling()
                void refreshTorchCredits()
                loadOrders()
                setPhase('paid')
              } else if (status.status === 'failed') {
                stopPolling()
                setError('支付失败或已取消，请重试。')
                setPhase('error')
              }
            })
            .catch(() => undefined)
        }, POLL_MS)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      }
    },
    [provider, stopPolling, loadOrders]
  )

  const backToSelect = useCallback(() => {
    stopPolling()
    setOrder(null)
    setError('')
    setPhase('select')
  }, [stopPolling])

  return (
    <PageSearchShell onSearchChange={() => undefined} searchHidden searchPlaceholder="" searchValue="">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-5 overflow-y-auto px-4 py-5">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-(--ui-text-primary)">套餐充值</h1>
            <p className="text-xs text-muted-foreground">选择套餐，微信或支付宝扫码支付，到账后积分自动更新。</p>
          </div>
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary">
            <Zap className="size-4" /> {session?.credits ?? 0} 积分
          </div>
        </header>

        {phase === 'loading' && <PageLoader />}

        {phase === 'error' && (
          <div className="space-y-3 rounded-2xl border border-(--ui-stroke-tertiary) p-5 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={loadConfig} variant="outline">
              重试
            </Button>
          </div>
        )}

        {phase === 'select' && config && !config.enabled && (
          <div className="grid min-h-40 place-items-center rounded-2xl border border-(--ui-stroke-tertiary) text-sm text-muted-foreground">
            支付暂未开通，请联系管理员。
          </div>
        )}

        {phase === 'select' && config?.enabled && (
          <>
            {config.providers.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">支付方式</span>
                {config.providers.map(p => (
                  <Button
                    key={p}
                    onClick={() => setProvider(p)}
                    size="xs"
                    variant={p === provider ? 'default' : 'outline'}
                  >
                    {PROVIDER_LABEL[p] ?? p}
                  </Button>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {config.packages.map(pkg => (
                <button
                  className="group flex flex-col gap-3 rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)/25 p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                  key={pkg.id}
                  onClick={() => void buy(pkg)}
                >
                  <div className="truncate text-sm font-medium text-(--ui-text-primary)">{pkg.title}</div>
                  <div className="flex items-baseline gap-1">
                    <Zap className="size-4 text-primary" />
                    <span className="text-2xl font-bold text-(--ui-text-primary)">{pkg.credits}</span>
                    <span className="text-xs text-muted-foreground">积分</span>
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-lg font-semibold text-primary">{yuan(pkg.amount_fen)}</span>
                    <span className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground opacity-90 group-hover:opacity-100">
                      购买
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <OrderHistory orders={orders} />
          </>
        )}

        {phase === 'creating' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在生成支付二维码…
          </div>
        )}

        {phase === 'qr' && order && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="rounded-2xl border border-(--ui-stroke-tertiary) bg-white p-4">
              <img alt="支付二维码" className="size-52" src={order.qr_image} />
            </div>
            <div className="text-center">
              <div className="text-sm">
                {PROVIDER_LABEL[order.provider] ?? order.provider}扫码支付{' '}
                <span className="font-semibold text-primary">{yuan(order.amount_fen)}</span>
              </div>
              <div className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> 等待支付到账（{order.credits} 积分）…
              </div>
            </div>
            <Button onClick={backToSelect} size="sm" variant="ghost">
              返回选择套餐
            </Button>
          </div>
        )}

        {phase === 'paid' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <CheckCircle2 className="size-12 text-emerald-500" />
            <p className="text-sm font-medium">支付成功，积分已到账！</p>
            <Button onClick={backToSelect} size="sm">
              继续充值
            </Button>
          </div>
        )}
      </div>
    </PageSearchShell>
  )
}

function OrderHistory({ orders }: { orders: MyOrder[] }) {
  if (orders.length === 0) {
    return null
  }

  return (
    <section className="space-y-2 rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)/25 p-4">
      <h2 className="text-sm font-semibold text-(--ui-text-primary)">充值订单</h2>
      <div className="-mx-1 max-h-56 space-y-0.5 overflow-y-auto px-1">
        {orders.map(o => (
          <div
            className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-(--chrome-action-hover)"
            key={o.out_trade_no}
          >
            <div className="min-w-0">
              <span className="text-(--ui-text-primary)">
                {PROVIDER_LABEL[o.provider] ?? o.provider} {yuan(o.amount_fen)}
              </span>
              <span className="ml-2 text-[0.625rem] text-muted-foreground">{when(o.paid_at ?? o.created_at)}</span>
            </div>
            <span
              className={
                o.status === 'paid'
                  ? 'font-medium text-emerald-500'
                  : o.status === 'failed'
                    ? 'text-destructive'
                    : 'text-muted-foreground'
              }
            >
              {orderStatusLabel(o.status)} · {o.credits} 积分
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
