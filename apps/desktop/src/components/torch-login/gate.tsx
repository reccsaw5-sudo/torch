import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { CheckCircle2, Loader2, MessageCircle, RefreshCw } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $torchBrand } from '@/store/torch-brand'
import {
  $torchLogin,
  completeWechatLogin,
  createWechatLoginSession,
  fetchWechatLoginConfig,
  loginTorch,
  pollWechatLogin,
  registerTorch,
  restoreTorchSession,
  type WechatLoginSession
} from '@/store/torch-login'

interface TorchLoginGateProps {
  enabled: boolean
  onCompleted?: () => void
}

type Tab = 'account' | 'wechat'

const WECHAT_POLL_MS = 2000

// Full-screen sign-in gate shown until the client has a brand session. Two
// paths: WeChat scan-to-login (primary when configured on the brand server)
// and self-hosted email + password. Both resolve into the same Torch session.
export function TorchLoginGate({ enabled, onCompleted }: TorchLoginGateProps) {
  const { session, status, error } = useStore($torchLogin)
  const brand = useStore($torchBrand)
  const [tab, setTab] = useState<Tab>('account')
  const [wechatEnabled, setWechatEnabled] = useState<boolean | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const restoredRef = useRef(false)
  const tabTouchedRef = useRef(false)

  useEffect(() => {
    if (enabled && !restoredRef.current) {
      restoredRef.current = true
      void restoreTorchSession(onCompleted)
    }
  }, [enabled, onCompleted])

  // Discover whether the brand server offers WeChat login; if so, make it the
  // default tab (unless the user already picked one).
  useEffect(() => {
    let alive = true

    void fetchWechatLoginConfig().then(cfg => {
      if (!alive) {
        return
      }

      setWechatEnabled(cfg.enabled)

      if (cfg.enabled && !tabTouchedRef.current) {
        setTab('wechat')
      }
    })

    return () => {
      alive = false
    }
  }, [])

  if (!enabled || session) {
    return null
  }

  const accent = brand.primaryColor || '#2563eb'
  const brandName = brand.displayName || 'Torch'
  const busy = status === 'submitting' || status === 'configuring'
  const configuring = status === 'configuring'
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy

  const onSubmit = () => {
    if (!canSubmit) {
      return
    }

    const fn = mode === 'login' ? loginTorch : registerTorch

    void fn(email.trim(), password, onCompleted)
  }

  const selectTab = (next: Tab) => {
    tabTouchedRef.current = true
    setTab(next)
    $torchLogin.set({ ...$torchLogin.get(), error: null })
  }

  return (
    <div className="fixed inset-0 z-[9999] flex overflow-hidden bg-white text-neutral-900">
      <FlowBackground accent={accent} />

      <div className="relative z-10 flex w-full">
        <section className="hidden flex-col justify-between p-14 lg:flex lg:w-1/2">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9 rounded-xl" />
            <span className="text-base font-semibold tracking-tight">{brandName}</span>
          </div>

          <div className="max-w-md">
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
              多智能体 · 本地优先 · 桌面端
            </p>
            <h1 className="text-5xl font-bold leading-[1.1] tracking-tight text-neutral-900">
              让 AI 替你
              <br />
              把事情做完
            </h1>
            <p className="mt-6 text-base leading-relaxed text-neutral-500">
              创建智能体、调用工具、长期记忆，全部打包进一个干净的桌面应用。
            </p>
          </div>

          <p className="text-xs text-neutral-400">© {new Date().getFullYear()} {brandName}</p>
        </section>

        <section className="flex w-full items-center justify-center p-6 lg:w-1/2">
          <div className="relative w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-7 shadow-xl shadow-neutral-900/5">
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <BrandMark className="size-8 rounded-lg" />
              <span className="text-sm font-semibold">{brandName}</span>
            </div>

            <h2 className="text-xl font-semibold tracking-tight">欢迎回来</h2>
            <p className="mt-1 text-sm text-neutral-500">登录以开始使用 {brandName}</p>

            <div className="mt-6 flex gap-1 rounded-full bg-neutral-100 p-1">
              <button
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-medium transition-colors',
                  tab === 'wechat' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                )}
                onClick={() => selectTab('wechat')}
                type="button"
              >
                <MessageCircle className="size-4" /> 微信登录
              </button>
              <button
                className={cn(
                  'flex-1 rounded-full py-2 text-sm font-medium transition-colors',
                  tab === 'account' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
                )}
                onClick={() => selectTab('account')}
                type="button"
              >
                账号登录
              </button>
            </div>

            <div className="mt-6">
              {tab === 'wechat' ? (
                <WechatPanel accent={accent} enabled={wechatEnabled} onCompleted={onCompleted} />
              ) : (
                <div className="space-y-3">
                  <input
                    autoComplete="username"
                    className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400"
                    disabled={busy}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onSubmit()}
                    placeholder="邮箱"
                    type="email"
                    value={email}
                  />
                  <input
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400"
                    disabled={busy}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onSubmit()}
                    placeholder="密码"
                    type="password"
                    value={password}
                  />
                  <button
                    className="h-11 w-full rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
                    disabled={!canSubmit}
                    onClick={onSubmit}
                    style={{ background: accent }}
                    type="button"
                  >
                    {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
                  </button>

                  <p className="pt-1 text-center text-[0.8125rem] text-neutral-500">
                    {mode === 'login' ? '还没有账户？' : '已有账户？'}
                    <button
                      className="px-1 font-semibold text-neutral-900 hover:underline"
                      disabled={busy}
                      onClick={() => {
                        setMode(mode === 'login' ? 'register' : 'login')
                        $torchLogin.set({ ...$torchLogin.get(), error: null })
                      }}
                      type="button"
                    >
                      {mode === 'login' ? '去注册' : '去登录'}
                    </button>
                  </p>

                  {error && <p className="text-center text-[0.8125rem] text-red-600">{error}</p>}
                </div>
              )}
            </div>

            {configuring && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl bg-white/95">
                <CheckCircle2 className="size-11 text-emerald-500" />
                <p className="text-sm font-medium">登录成功，正在配置…</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function WechatPanel({
  accent,
  enabled,
  onCompleted
}: {
  accent: string
  enabled: boolean | null
  onCompleted?: () => void
}) {
  const [phase, setPhase] = useState<'checking' | 'disabled' | 'error' | 'loading' | 'ready'>('checking')
  const [ses, setSes] = useState<null | WechatLoginSession>(null)
  const [err, setErr] = useState('')
  const pollRef = useRef<null | ReturnType<typeof setInterval>>(null)

  const stop = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    setPhase('loading')
    setErr('')
    stop()

    try {
      const s = await createWechatLoginSession()

      setSes(s)
      setPhase('ready')
      pollRef.current = setInterval(() => {
        void pollWechatLogin(s.state).then(r => {
          if (r.status === 'done' && r.result) {
            stop()
            void completeWechatLogin(r.result, onCompleted)
          } else if (r.status === 'expired') {
            stop()
            setErr('二维码已过期，请刷新重试。')
            setPhase('error')
          }
        })
      }, WECHAT_POLL_MS)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }, [stop, onCompleted])

  useEffect(() => {
    if (enabled === null) {
      setPhase('checking')

      return
    }

    if (!enabled) {
      setPhase('disabled')

      return
    }

    void start()

    return stop
  }, [enabled, start, stop])

  if (phase === 'checking') {
    return (
      <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500">
        <Loader2 className="size-4 animate-spin" /> 检查微信登录…
      </div>
    )
  }

  if (phase === 'disabled') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="grid size-40 place-items-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50">
          <MessageCircle className="size-10 text-neutral-300" />
        </div>
        <p className="text-sm text-neutral-500">微信扫码登录即将开放，请先使用账号登录。</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-red-600">{err}</p>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          onClick={() => void start()}
          type="button"
        >
          <RefreshCw className="size-4" /> 刷新二维码
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="grid size-44 place-items-center rounded-2xl border border-neutral-200 bg-white p-2">
        {phase === 'loading' || !ses ? (
          <Loader2 className="size-6 animate-spin text-neutral-400" />
        ) : ses.qr_image ? (
          <img alt="订阅号二维码" className="size-full object-contain" src={ses.qr_image} />
        ) : (
          <MessageCircle className="size-10 text-neutral-300" />
        )}
      </div>

      {ses?.code && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-neutral-500">验证码</span>
          <span className="font-mono text-2xl font-bold tracking-[0.35em] text-neutral-900">{ses.code}</span>
        </div>
      )}

      <ol className="w-full max-w-[16rem] space-y-1 text-[0.8125rem] text-neutral-600">
        <li className="flex gap-1.5">
          <span className="font-semibold" style={{ color: accent }}>
            ①
          </span>
          微信「扫一扫」扫码关注公众号
        </li>
        <li className="flex gap-1.5">
          <span className="font-semibold" style={{ color: accent }}>
            ②
          </span>
          把上面的验证码发给公众号即可登录
        </li>
      </ol>

      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <span className="inline-block size-1.5 animate-pulse rounded-full" style={{ background: accent }} />
        等待验证中…
      </div>
    </div>
  )
}

function FlowBackground({ accent }: { accent: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -left-40 -top-40 size-[36rem] rounded-full opacity-20 blur-3xl"
        style={{ background: `radial-gradient(circle, ${accent}55, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-52 -right-40 size-[42rem] rounded-full opacity-20 blur-3xl"
        style={{ background: `radial-gradient(circle, ${accent}44, transparent 70%)` }}
      />
      <svg className="absolute -bottom-32 -left-16 size-[36rem] opacity-[0.08]" fill="none" viewBox="0 0 400 400">
        {Array.from({ length: 9 }).map((_, i) => (
          <circle cx="200" cy="200" key={i} r={20 + i * 22} stroke={accent} strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  )
}
