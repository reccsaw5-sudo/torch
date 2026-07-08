import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Loader2, Mail, Zap } from '@/lib/icons'
import { fetchMyOrders, type MyOrder } from '@/store/torch-billing'
import {
  $torchLogin,
  type AccountInfo,
  changeTorchPassword,
  changeTorchUsername,
  fetchAccountInfo
} from '@/store/torch-login'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PROVIDER_LABEL: Record<string, string> = { wechat: '微信', alipay: '支付宝' }
const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`
const when = (sec: number | null) => (sec ? new Date(sec * 1000).toLocaleString('zh-CN') : '—')

function ledgerLabel(reason: string): string {
  if (reason === 'signup_grant') {
    return '注册赠送'
  }

  if (reason.startsWith('recharge:')) {
    return '充值到账'
  }

  if (reason.startsWith('chat:')) {
    return '对话消耗'
  }

  if (reason === 'admin_adjust') {
    return '管理员调整'
  }

  return reason
}

function orderStatusLabel(status: string): string {
  if (status === 'paid') {
    return '已支付'
  }

  if (status === 'failed') {
    return '失败'
  }

  return '待支付'
}

export function TorchProfileDialog({ open, onOpenChange }: Props) {
  const { session } = useStore($torchLogin)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [orders, setOrders] = useState<MyOrder[]>([])

  const [nameDraft, setNameDraft] = useState('')
  const [nameBusy, setNameBusy] = useState(false)
  const [nameMsg, setNameMsg] = useState('')

  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }

    let alive = true
    setLoading(true)
    setError('')
    setNameMsg('')
    setPwMsg('')
    setPwErr('')
    setOldPw('')
    setNewPw('')
    setConfirmPw('')
    Promise.all([fetchAccountInfo(), fetchMyOrders().catch(() => [] as MyOrder[])])
      .then(([acc, ord]) => {
        if (!alive) {
          return
        }

        setInfo(acc)
        setNameDraft(acc.user.username)
        setOrders(ord)
        setLoading(false)
      })
      .catch(e => {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      })

    return () => {
      alive = false
    }
  }, [open])

  async function saveName() {
    const next = nameDraft.trim()

    if (!next || next === info?.user.username) {
      return
    }

    setNameBusy(true)
    setNameMsg('')

    try {
      await changeTorchUsername(next)
      setInfo(prev => (prev ? { ...prev, user: { ...prev.user, username: next } } : prev))
      setNameMsg('已更新用户名')
    } catch (e) {
      setNameMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setNameBusy(false)
    }
  }

  async function savePassword() {
    setPwErr('')
    setPwMsg('')

    if (newPw.length < 6) {
      setPwErr('新密码至少 6 位')

      return
    }

    if (newPw !== confirmPw) {
      setPwErr('两次输入的新密码不一致')

      return
    }

    setPwBusy(true)

    try {
      await changeTorchPassword(oldPw, newPw)
      setOldPw('')
      setNewPw('')
      setConfirmPw('')
      setPwMsg('密码已修改')
    } catch (e) {
      setPwErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPwBusy(false)
    }
  }

  const label = info?.user.username || session?.username || session?.email || '账户'
  const initial = label.slice(0, 1).toUpperCase()

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl rounded-3xl p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base">个人资料</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 加载中…
          </div>
        )}

        {!loading && error && <p className="py-4 text-sm text-destructive">{error}</p>}

        {!loading && !error && info && (
          <div className="space-y-4">
            {/* 概览卡片 */}
            <div className="flex items-center gap-4 rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)/40 p-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-lg font-semibold text-primary">
                {initial}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="truncate text-base font-semibold text-(--ui-text-primary)">{label}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="size-3.5" /> {info.user.email || '未设置邮箱'}
                </div>
              </div>
              <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary">
                <Zap className="size-4" /> {info.credits} 积分
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* 左列：用户名 + 修改密码 */}
              <div className="space-y-4">
                <Section title="用户名">
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-9 rounded-xl text-sm"
                      onChange={e => setNameDraft(e.target.value)}
                      value={nameDraft}
                    />
                    <Button
                      className="rounded-xl"
                      disabled={nameBusy || !nameDraft.trim() || nameDraft.trim() === info.user.username}
                      onClick={() => void saveName()}
                      size="sm"
                    >
                      {nameBusy ? <Loader2 className="size-3.5 animate-spin" /> : '保存'}
                    </Button>
                  </div>
                  {nameMsg && <p className="text-[0.6875rem] text-muted-foreground">{nameMsg}</p>}
                </Section>

                <Section title="修改密码">
                  <Input
                    className="h-9 rounded-xl text-sm"
                    onChange={e => setOldPw(e.target.value)}
                    placeholder="当前密码"
                    type="password"
                    value={oldPw}
                  />
                  <Input
                    className="h-9 rounded-xl text-sm"
                    onChange={e => setNewPw(e.target.value)}
                    placeholder="新密码（至少 6 位）"
                    type="password"
                    value={newPw}
                  />
                  <Input
                    className="h-9 rounded-xl text-sm"
                    onChange={e => setConfirmPw(e.target.value)}
                    placeholder="确认新密码"
                    type="password"
                    value={confirmPw}
                  />
                  {pwErr && <p className="text-[0.6875rem] text-destructive">{pwErr}</p>}
                  {pwMsg && <p className="text-[0.6875rem] text-muted-foreground">{pwMsg}</p>}
                  <Button
                    className="w-full rounded-xl"
                    disabled={pwBusy || !oldPw || !newPw}
                    onClick={() => void savePassword()}
                    size="sm"
                  >
                    {pwBusy ? <Loader2 className="size-3.5 animate-spin" /> : '修改密码'}
                  </Button>
                </Section>
              </div>

              {/* 右列：积分流水 + 充值订单 */}
              <div className="space-y-4">
                <Section title="积分流水">
                  {info.ledger.length === 0 ? (
                    <p className="text-[0.6875rem] text-muted-foreground">暂无记录</p>
                  ) : (
                    <div className="-mx-1 max-h-44 space-y-0.5 overflow-y-auto px-1">
                      {info.ledger.map((e, i) => (
                        <div
                          className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-(--chrome-action-hover)"
                          key={i}
                        >
                          <div className="min-w-0">
                            <span className="text-(--ui-text-primary)">{ledgerLabel(e.reason)}</span>
                            <span className="ml-2 text-[0.625rem] text-muted-foreground">{when(e.created_at)}</span>
                          </div>
                          <span className={e.delta >= 0 ? 'font-medium text-emerald-500' : 'text-muted-foreground'}>
                            {e.delta >= 0 ? `+${e.delta}` : e.delta}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="充值订单">
                  {orders.length === 0 ? (
                    <p className="text-[0.6875rem] text-muted-foreground">暂无订单</p>
                  ) : (
                    <div className="-mx-1 max-h-44 space-y-0.5 overflow-y-auto px-1">
                      {orders.map(o => (
                        <div
                          className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-(--chrome-action-hover)"
                          key={o.out_trade_no}
                        >
                          <div className="min-w-0">
                            <span className="text-(--ui-text-primary)">
                              {PROVIDER_LABEL[o.provider] ?? o.provider} {yuan(o.amount_fen)}
                            </span>
                            <span className="ml-2 text-[0.625rem] text-muted-foreground">
                              {when(o.paid_at ?? o.created_at)}
                            </span>
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
                            {orderStatusLabel(o.status)} · {o.credits}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-2xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary)/25 p-4">
      <h3 className="text-[0.8125rem] font-semibold text-(--ui-text-primary)">{title}</h3>
      {children}
    </section>
  )
}
