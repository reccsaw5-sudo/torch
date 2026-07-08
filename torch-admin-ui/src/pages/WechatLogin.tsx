import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

export default function WechatLogin() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const val = (k: string) => form[k] ?? ''
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const flag = (k: string) => val(k) === '1'

  async function load() {
    try {
      setErr('')
      setForm(await api.getWechat())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    try {
      setErr('')
      setMsg('')
      setForm(await api.setWechat(form))
      setMsg('微信登录配置已保存。AppSecret 显示 *** 表示后端已保存，留空/*** 不会覆盖。')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">微信扫码登录</h2>
        <p className="text-sm text-muted-foreground">
          配置微信开放平台「网站应用」的 AppID / AppSecret 与授权回调域名。开启后，桌面端登录页会显示微信扫码登录。
        </p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      <section className="max-w-2xl space-y-4 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={flag('wechat_login_enabled')}
            onChange={e => set('wechat_login_enabled', e.target.checked ? '1' : '0')}
            type="checkbox"
          />
          启用微信扫码登录
        </label>

        <div className="grid gap-1.5">
          <Label>AppID</Label>
          <Input onChange={e => set('wechat_login_appid', e.target.value)} placeholder="wx..." value={val('wechat_login_appid')} />
        </div>

        <div className="grid gap-1.5">
          <Label>AppSecret（密钥）</Label>
          <Input
            onChange={e => set('wechat_login_secret', e.target.value)}
            placeholder="已保存则显示 ***，留空不覆盖"
            type="password"
            value={val('wechat_login_secret')}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>授权回调地址（redirect_uri，需公网 HTTPS，域名须在微信开放平台登记）</Label>
          <Input
            onChange={e => set('wechat_login_redirect', e.target.value)}
            placeholder="https://your-domain.com/auth/wechat/callback（留空则用服务端 PUBLIC_BASE）"
            value={val('wechat_login_redirect')}
          />
          <p className="text-xs text-muted-foreground">
            在微信开放平台「网站应用 · 授权回调域」填写该地址的域名（不含 https:// 与路径），例如 your-domain.com。
          </p>
        </div>

        <Button onClick={() => void save()}>保存微信登录配置</Button>
      </section>
    </div>
  )
}
