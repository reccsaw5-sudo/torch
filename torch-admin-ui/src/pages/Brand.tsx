import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

const FIELDS: { key: string; label: string }[] = [
  { key: 'api_base_url', label: '内置推理地址（new-api 域名根，如 https://your-newapi.com，不要带 /v1；客户端按模型自动选协议、锁定只读、用户自带 Key）' },
  { key: 'app_name', label: '客户端内部名（英文/包名用）' },
  { key: 'app_display_name', label: '客户端显示名' },
  { key: 'app_version', label: '客户端版本号' },
  { key: 'bundle_id', label: 'Bundle ID（如 com.brand.app）' },
  { key: 'website_name', label: '官网站点名' },
  { key: 'website_url', label: '官网地址' },
  { key: 'download_url_mac', label: 'macOS 下载地址' },
  { key: 'download_url_win', label: 'Windows 下载地址' },
  { key: 'support_email', label: '客服邮箱' },
  { key: 'primary_color', label: '主色（如 #000000）' }
]

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function Brand() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [uploading, setUploading] = useState(false)

  async function load() {
    try {
      setErr('')
      setForm(await api.getBrand())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function onUploadLogo(file: File) {
    setUploading(true)
    setErr('')
    setMsg('')
    try {
      const b64 = await fileToBase64(file)
      setForm(await api.uploadLogo(file.type || 'image/png', b64))
      setMsg('Logo 已上传。客户端将自动显示新 logo。')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    try {
      setMsg('')
      setErr('')
      const patch: Record<string, string> = { app_icon_url: form.app_icon_url ?? '' }
      for (const f of FIELDS) patch[f.key] = form[f.key] ?? ''
      setForm(await api.setBrand(patch))
      setMsg('已保存。客户端与官网将读取到新品牌信息；打包时会据此盖名称/图标/版本。')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">品牌配置</h2>
        <p className="text-sm text-muted-foreground">客户端名称/图标/版本、官网站点名等均在此配置，客户端与官网、打包流水线统一读取。</p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      <div className="flex items-center gap-4 rounded-lg border p-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-white">
          {form.app_icon_url ? (
            <img src={form.app_icon_url} alt="logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">无</span>
          )}
        </div>
        <div className="grid flex-1 gap-1.5">
          <Label>客户端 Logo（上传图片）</Label>
          <Input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void onUploadLogo(file)
            }}
          />
          <Label className="mt-1">或直接填图片 URL</Label>
          <Input
            value={form.app_icon_url ?? ''}
            placeholder="https://.../logo.png"
            onChange={e => setForm({ ...form, app_icon_url: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">上传或填 URL 二选一；保存后客户端登录页/首页/关于页统一使用。</p>
        </div>
      </div>

      <div className="grid gap-3">
        {FIELDS.map(f => (
          <div key={f.key} className="grid gap-1.5">
            <Label>{f.label}</Label>
            <Input value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
          </div>
        ))}
      </div>

      <Button onClick={() => void save()}>保存品牌配置</Button>
    </div>
  )
}
