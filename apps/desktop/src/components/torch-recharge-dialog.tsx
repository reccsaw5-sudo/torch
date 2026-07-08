import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CheckCircle2, Loader2, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  type BillingConfig,
  createRechargeOrder,
  fetchBillingConfig,
  fetchOrderStatus,
  type RechargeOrder,
  type RechargePackage
} from '@/store/torch-billing'
import { refreshTorchCredits } from '@/store/torch-login'

const PROVIDER_LABEL: Record<string, string> = { wechat: '微信支付', alipay: '支付宝' }
const POLL_MS = 2500

const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`

type Phase = 'loading' | 'select' | 'creating' | 'qr' | 'paid' | 'error'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TorchRechargeDialog({ open, onOpenChange }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [config, setConfig] = useState<BillingConfig | null>(null)
  const [provider, setProvider] = useState<string>('')
  const [order, setOrder] = useState<RechargeOrder | null>(null)
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Load config whenever the dialog opens; fully reset when it closes.
  useEffect(() => {
    if (!open) {
      stopPolling()
      setPhase('loading')
      setConfig(null)
      setOrder(null)
      setError('')

      return
    }

    let alive = true
    setPhase('loading')
    fetchBillingConfig()
      .then(cfg => {
        if (!alive) {
          return
        }

        setConfig(cfg)
        setProvider(cfg.providers[0] ?? '')
        setPhase('select')
      })
      .catch(e => {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
        }
      })

    return () => {
      alive = false
    }
  }, [open, stopPolling])

  useEffect(() => stopPolling, [stopPolling])

  async function buy(pkg: RechargePackage) {
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
              setPhase('paid')
            } else if (status.status === 'failed') {
              stopPolling()
              setError('支付失败或已取消，请重试。')
              setPhase('error')
            }
          })
          .catch(() => {
            // Transient poll error — keep trying until the dialog closes.
          })
      }, POLL_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle icon={Zap}>充值积分</DialogTitle>
          <DialogDescription>选择套餐，使用微信或支付宝扫码支付，到账后积分自动更新。</DialogDescription>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 加载中…
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              关闭
            </Button>
          </div>
        )}

        {phase === 'select' && config && !config.enabled && (
          <p className="py-6 text-center text-sm text-muted-foreground">支付暂未开通，请联系管理员。</p>
        )}

        {phase === 'select' && config?.enabled && (
          <div className="space-y-3">
            {config.providers.length > 1 && (
              <div className="flex gap-1.5">
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
            <div className="grid gap-2">
              {config.packages.map(pkg => (
                <button
                  className="flex items-center justify-between rounded-md border border-(--ui-stroke-tertiary) px-3 py-2 text-left transition-colors hover:bg-(--chrome-action-hover)"
                  key={pkg.id}
                  onClick={() => void buy(pkg)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[0.8125rem] font-medium">{pkg.title}</div>
                    <div className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                      <Zap className="size-3 text-primary" /> {pkg.credits} 积分
                    </div>
                  </div>
                  <span className="text-[0.9375rem] font-semibold text-primary">{yuan(pkg.amount_fen)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'creating' && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在生成支付二维码…
          </div>
        )}

        {phase === 'qr' && order && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="rounded-lg border border-(--ui-stroke-tertiary) bg-white p-3">
              <img alt="支付二维码" className="size-44" src={order.qr_image} />
            </div>
            <div className="text-center">
              <div className="text-sm">
                {PROVIDER_LABEL[order.provider] ?? order.provider}扫码支付{' '}
                <span className="font-semibold text-primary">{yuan(order.amount_fen)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-center gap-1 text-[0.6875rem] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> 等待支付到账（{order.credits} 积分）…
              </div>
            </div>
          </div>
        )}

        {phase === 'paid' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className={cn('size-10', 'text-emerald-500')} />
            <p className="text-sm font-medium">支付成功，积分已到账！</p>
            <Button onClick={() => onOpenChange(false)}>完成</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
