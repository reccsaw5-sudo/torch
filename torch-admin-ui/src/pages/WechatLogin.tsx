import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

const CALLBACK_URL = `${window.location.origin}/wechat/mp/callback`

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export default function WechatLogin() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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
      setMsg('微信订阅号登录配置已保存。Token 显示 *** 表示后端已保存，留空/*** 不会覆盖。')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function onPickQr(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    if (file.size > 1_500_000) {
      setErr('二维码图片过大（请小于 1.5MB）。')
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('wechat_mp_qr', String(reader.result))
    reader.onerror = () => setErr('读取图片失败，请重试。')
    reader.readAsDataURL(file)
  }

  const qr = val('wechat_mp_qr')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">微信订阅号登录</h2>
        <p className="text-sm text-muted-foreground">
          未认证订阅号即可用：用户扫码关注公众号后，把登录页显示的 6 位验证码发送给公众号即可登录。
          在订阅号后台开启「开发者模式（服务器配置）」并使用<strong>明文模式</strong>，把下方回调地址与 Token 填入即可。
        </p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      <section className="max-w-2xl space-y-4 rounded-lg border p-4">
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">订阅号「服务器配置」这样填：</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              服务器地址（URL）：<code className="break-all text-foreground">{CALLBACK_URL}</code>
            </li>
            <li>令牌（Token）：与下方 Token 一致</li>
            <li>消息加解密方式：<strong>明文模式</strong></li>
          </ul>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            checked={flag('wechat_mp_enabled')}
            onChange={e => set('wechat_mp_enabled', e.target.checked ? '1' : '0')}
            type="checkbox"
          />
          启用微信订阅号登录
        </label>

        <div className="grid gap-1.5">
          <Label>Token（令牌，与订阅号服务器配置一致）</Label>
          <div className="flex gap-2">
            <Input
              onChange={e => set('wechat_mp_token', e.target.value)}
              placeholder="已保存则显示 ***，留空不覆盖"
              type="password"
              value={val('wechat_mp_token')}
            />
            <Button onClick={() => set('wechat_mp_token', randomToken())} type="button" variant="outline">
              生成随机
            </Button>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>AppID（选填，仅作记录）</Label>
          <Input onChange={e => set('wechat_mp_appid', e.target.value)} placeholder="wx..." value={val('wechat_mp_appid')} />
        </div>

        <div className="grid gap-1.5">
          <Label>订阅号关注二维码（上传图片，前台登录页展示）</Label>
          <div className="flex items-start gap-4">
            <div className="grid size-40 place-items-center overflow-hidden rounded-lg border bg-muted/40">
              {qr ? (
                <img alt="订阅号二维码" className="size-full object-contain" src={qr} />
              ) : (
                <span className="px-2 text-center text-xs text-muted-foreground">未上传</span>
              )}
            </div>
            <div className="space-y-2">
              <input accept="image/*" className="hidden" onChange={onPickQr} ref={fileRef} type="file" />
              <Button onClick={() => fileRef.current?.click()} type="button" variant="outline">
                {qr ? '更换图片' : '上传图片'}
              </Button>
              {qr && (
                <Button onClick={() => set('wechat_mp_qr', '')} type="button" variant="ghost">
                  清除
                </Button>
              )}
              <p className="text-xs text-muted-foreground">在订阅号后台「账号详情」可下载带参数的公众号二维码，另存后上传即可。</p>
            </div>
          </div>
        </div>

        <Button onClick={() => void save()}>保存微信订阅号登录配置</Button>
      </section>
    </div>
  )
}
