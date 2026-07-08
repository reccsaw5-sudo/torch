import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, type OrderRow, type PackageRow, type PackageUpsert } from '@/lib/api'

const EMPTY_PKG: PackageUpsert = { title: '', amount_fen: 0, credits: 0, sort_order: 0, enabled: 1 }

const yuan = (fen: number) => (fen / 100).toFixed(2)
const fromYuan = (v: string) => Math.round((Number(v) || 0) * 100)
const ts = (n: number | null) => (n ? new Date(n * 1000).toLocaleString() : '—')

function Check({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export default function Payments() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [pkgs, setPkgs] = useState<PackageRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PackageUpsert>(EMPTY_PKG)

  const val = (k: string) => form[k] ?? ''
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const flag = (k: string) => val(k) === '1'

  async function load() {
    try {
      setErr('')
      const [cfg, p, o] = await Promise.all([api.getPayment(), api.listPackages(), api.listOrders()])
      setForm(cfg)
      setPkgs(p.data)
      setOrders(o.data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function saveConfig() {
    try {
      setErr('')
      setMsg('')
      setForm(await api.setPayment(form))
      setMsg('支付配置已保存。密钥字段显示 *** 表示后端已保存，留空/*** 不会覆盖已存密钥。')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function openNew() {
    setDraft(EMPTY_PKG)
    setOpen(true)
  }

  function openEdit(r: PackageRow) {
    setDraft({ id: r.id, title: r.title, amount_fen: r.amount_fen, credits: r.credits, sort_order: r.sort_order, enabled: r.enabled })
    setOpen(true)
  }

  async function savePkg() {
    try {
      await api.upsertPackage(draft)
      setOpen(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function removePkg(id: number) {
    if (!window.confirm('确定删除该充值套餐？')) return
    try {
      await api.deletePackage(id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">支付 / 充值</h2>
        <p className="text-sm text-muted-foreground">
          配置微信支付 / 支付宝渠道、充值套餐（价格与到账积分），并查看订单。支付成功后服务端 webhook 自动为用户加积分。
        </p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      {/* ── Provider config ─────────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-6">
          <Check label="启用支付总开关" on={flag('enabled')} onChange={v => set('enabled', v ? '1' : '0')} />
          <div className="grid gap-1.5">
            <Label>币种</Label>
            <Input className="w-28" value={val('currency')} onChange={e => set('currency', e.target.value)} />
          </div>
          <div className="grid flex-1 gap-1.5">
            <Label>通知回调公网地址（notify_base，需公网 HTTPS）</Label>
            <Input
              value={val('notify_base')}
              placeholder="https://pay.your-domain.com（留空则用服务端 PUBLIC_BASE）"
              onChange={e => set('notify_base', e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* WeChat */}
          <div className="space-y-3 rounded-md border p-3">
            <Check label="启用微信支付（Native 扫码）" on={flag('wechat_enabled')} onChange={v => set('wechat_enabled', v ? '1' : '0')} />
            <Field label="AppID" v={val('wechat_appid')} on={v => set('wechat_appid', v)} />
            <Field label="商户号 mchid" v={val('wechat_mchid')} on={v => set('wechat_mchid', v)} />
            <Field label="证书序列号 cert_serial_no" v={val('wechat_cert_serial_no')} on={v => set('wechat_cert_serial_no', v)} />
            <Field label="APIv3 密钥（密钥）" v={val('wechat_api_v3_key')} on={v => set('wechat_api_v3_key', v)} secret />
            <div className="grid gap-1.5">
              <Label>商户私钥 PEM（密钥）</Label>
              <Textarea
                className="font-mono text-xs"
                rows={4}
                value={val('wechat_private_key')}
                placeholder="-----BEGIN PRIVATE KEY-----（已保存则显示 ***，留空不覆盖）"
                onChange={e => set('wechat_private_key', e.target.value)}
              />
            </div>
          </div>

          {/* Alipay */}
          <div className="space-y-3 rounded-md border p-3">
            <Check label="启用支付宝（当面付）" on={flag('alipay_enabled')} onChange={v => set('alipay_enabled', v ? '1' : '0')} />
            <Field label="AppID" v={val('alipay_appid')} on={v => set('alipay_appid', v)} />
            <div className="grid gap-1.5">
              <Label>应用私钥 PEM（密钥）</Label>
              <Textarea
                className="font-mono text-xs"
                rows={4}
                value={val('alipay_app_private_key')}
                placeholder="-----BEGIN PRIVATE KEY-----（已保存则显示 ***，留空不覆盖）"
                onChange={e => set('alipay_app_private_key', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>支付宝公钥 PEM</Label>
              <Textarea
                className="font-mono text-xs"
                rows={4}
                value={val('alipay_public_key')}
                placeholder="-----BEGIN PUBLIC KEY-----"
                onChange={e => set('alipay_public_key', e.target.value)}
              />
            </div>
            <Check label="沙箱环境" on={flag('alipay_sandbox')} onChange={v => set('alipay_sandbox', v ? '1' : '0')} />
          </div>
        </div>

        <Button onClick={() => void saveConfig()}>保存支付配置</Button>
      </section>

      {/* ── Packages ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">充值套餐</h3>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> 新增套餐
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>价格（元）</TableHead>
              <TableHead>到账积分</TableHead>
              <TableHead>排序</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pkgs.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell>¥{yuan(r.amount_fen)}</TableCell>
                <TableCell>{r.credits}</TableCell>
                <TableCell>{r.sort_order}</TableCell>
                <TableCell>{r.enabled ? <Badge>启用</Badge> : <Badge variant="muted">停用</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => void removePkg(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {pkgs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  暂无套餐
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {/* ── Orders ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">最近订单</h3>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> 刷新
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>订单号</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead>金额</TableHead>
              <TableHead>积分</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>支付时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map(o => (
              <TableRow key={o.id}>
                <TableCell className="max-w-[160px] truncate font-mono text-xs">{o.out_trade_no}</TableCell>
                <TableCell className="max-w-[160px] truncate">{o.email}</TableCell>
                <TableCell>{o.provider === 'wechat' ? '微信' : '支付宝'}</TableCell>
                <TableCell>¥{yuan(o.amount_fen)}</TableCell>
                <TableCell>{o.credits}</TableCell>
                <TableCell>
                  {o.status === 'paid' ? (
                    <Badge>已支付</Badge>
                  ) : o.status === 'failed' ? (
                    <Badge variant="muted">失败</Badge>
                  ) : (
                    <Badge variant="muted">待支付</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{ts(o.paid_at)}</TableCell>
              </TableRow>
            ))}
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  暂无订单
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>充值套餐</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>名称</Label>
              <Input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>价格（元）</Label>
              <Input
                type="number"
                value={yuan(draft.amount_fen)}
                onChange={e => setDraft({ ...draft, amount_fen: fromYuan(e.target.value) })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>到账积分</Label>
              <Input
                type="number"
                value={String(draft.credits)}
                onChange={e => setDraft({ ...draft, credits: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>排序（小的在前）</Label>
              <Input
                type="number"
                value={String(draft.sort_order)}
                onChange={e => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })}
              />
            </div>
            <Check label="启用" on={draft.enabled === 1} onChange={v => setDraft({ ...draft, enabled: v ? 1 : 0 })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void savePkg()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, v, on, secret }: { label: string; v: string; on: (v: string) => void; secret?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type={secret ? 'password' : 'text'}
        value={v}
        placeholder={secret ? '已保存则显示 ***，留空不覆盖' : ''}
        onChange={e => on(e.target.value)}
      />
    </div>
  )
}
