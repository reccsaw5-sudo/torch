import { useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type BuildFile, type BuildRun } from '@/lib/api'

const PLATFORMS: { id: string; label: string }[] = [
  { id: 'mac-arm64', label: 'macOS(Apple 芯片)' },
  { id: 'mac-x64', label: 'macOS(Intel)' },
  { id: 'win-x64', label: 'Windows 64 位' },
  { id: 'win-ia32', label: 'Windows 32 位' },
  { id: 'linux-x64', label: 'Linux(AppImage/deb/rpm)' }
]

function runBadge(run: BuildRun) {
  if (run.status !== 'completed') return <Badge variant="secondary">{run.status}</Badge>
  if (run.conclusion === 'success') return <Badge>成功</Badge>
  return (
    <Badge className="text-destructive" variant="outline">
      {run.conclusion ?? '失败'}
    </Badge>
  )
}

export default function ClientBuild() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string[]>(PLATFORMS.map(p => p.id))
  const [runs, setRuns] = useState<BuildRun[]>([])
  const [files, setFiles] = useState<BuildFile[]>([])
  const [dlNote, setDlNote] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const timer = useRef<number | null>(null)

  const val = (k: string) => form[k] ?? ''
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))
  const toggle = (id: string) =>
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  async function loadConfig() {
    try {
      setErr('')
      setForm(await api.getBuildConfig())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function refresh() {
    try {
      const s = await api.getBuildStatus()
      setRuns(s.configured ? s.runs : [])
    } catch {
      // 状态查询失败不打断页面(可能 token 未配)
    }
    try {
      const d = await api.getBuildDownloads()
      setFiles(d.files ?? [])
      setDlNote(d.configured ? d.note ?? '' : '未配置 COS 域名')
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadConfig()
    void refresh()
    timer.current = window.setInterval(() => void refresh(), 12000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [])

  async function saveConfig() {
    try {
      setErr('')
      setMsg('')
      setForm(await api.setBuildConfig(form))
      setMsg('配置已保存。Token 显示 *** 表示已保存,留空/*** 不会覆盖。')
      void refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function startBuild() {
    try {
      setErr('')
      setMsg('')
      if (picked.length === 0) {
        setErr('请至少勾选一个平台')
        return
      }
      const r = await api.triggerBuild(picked)
      setMsg(`已触发打包:${r.platforms.join(', ')}。构建约需 10-20 分钟,完成后下方出现下载链接。`)
      window.setTimeout(() => void refresh(), 4000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">客户端构建</h2>
        <p className="text-sm text-muted-foreground">
          一键触发 GitHub Actions 在线打包桌面客户端,安装包直传腾讯 COS,下方显示下载链接。COS 密钥配在
          GitHub 仓库 Secrets(COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION)。
        </p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-foreground">{msg}</p>}

      <section className="max-w-2xl space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">打包配置</h3>
        <div className="grid gap-1.5">
          <Label>GitHub 仓库(owner/repo)</Label>
          <Input onChange={e => set('github_repo', e.target.value)} placeholder="reccsaw5-sudo/torch" value={val('github_repo')} />
        </div>
        <div className="grid gap-1.5">
          <Label>GitHub Token(需 actions:write 权限,用于远程触发打包)</Label>
          <Input
            onChange={e => set('github_token', e.target.value)}
            placeholder="已保存则显示 ***,留空不覆盖"
            type="password"
            value={val('github_token')}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>运行分支(在你仓库的哪个分支上跑工作流)</Label>
          <Input onChange={e => set('github_ref', e.target.value)} placeholder="main" value={val('github_ref')} />
        </div>
        <div className="grid gap-1.5">
          <Label>COS 公开访问域名(读取安装包清单用)</Label>
          <Input
            onChange={e => set('cos_base_url', e.target.value)}
            placeholder="https://your-bucket.cos.ap-hongkong.myqcloud.com 或你的 CDN 域名"
            value={val('cos_base_url')}
          />
        </div>
        <Button onClick={() => void saveConfig()}>保存配置</Button>
      </section>

      <section className="max-w-2xl space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">选择平台并开始构建</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORMS.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input checked={picked.includes(p.id)} onChange={() => toggle(p.id)} type="checkbox" />
              {p.label}
            </label>
          ))}
        </div>
        <Button onClick={() => void startBuild()}>开始构建</Button>
        <p className="text-xs text-muted-foreground">
          未签名安装包:用户首次打开需在系统里放行(mac 右键→打开,Windows 选"仍要运行")。
        </p>
      </section>

      <section className="max-w-2xl space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">下载链接(最新一次成功构建)</h3>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dlNote || '暂无安装包。构建完成后会自动出现。'}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {files.map(f => (
              <li key={f.name} className="flex items-center gap-2">
                <span className="text-muted-foreground">[{f.platform || '?'}]</span>
                <a className="text-primary underline" href={f.url} rel="noreferrer" target="_blank">
                  {f.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="max-w-2xl space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-medium">最近构建</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无记录(配置好仓库和 Token 后显示)。</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {runs.map(r => (
              <li key={r.id} className="flex items-center gap-2">
                {runBadge(r)}
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                <a className="text-primary underline" href={r.html_url} rel="noreferrer" target="_blank">
                  查看运行
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
