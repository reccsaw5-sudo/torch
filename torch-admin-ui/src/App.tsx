import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, clearToken, getToken, setToken } from '@/lib/api'
import Brand from '@/pages/Brand'
import ClientBuild from '@/pages/ClientBuild'
import Models from '@/pages/Models'
import Payments from '@/pages/Payments'
import Skills from '@/pages/Skills'
import Suggestions from '@/pages/Suggestions'
import Users from '@/pages/Users'
import WechatLogin from '@/pages/WechatLogin'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [token, setTokenInput] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!getToken()) {
      setAuthed(false)
      return
    }
    api
      .verifyToken()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
  }, [])

  async function login() {
    setErr('')
    setToken(token.trim())
    try {
      await api.verifyToken()
      setAuthed(true)
    } catch (e) {
      clearToken()
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  function logout() {
    clearToken()
    setTokenInput('')
    setAuthed(false)
  }

  if (authed === null) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中…</div>
  }

  if (!authed) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Torch 管理后台</CardTitle>
            <CardDescription>输入管理员令牌登录（默认 dev-admin，生产改 TORCH_ADMIN_TOKEN）。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-1.5">
              <Label>管理员令牌</Label>
              <Input
                type="password"
                value={token}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void login()
                }}
                placeholder="X-Admin-Token"
              />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button className="w-full" onClick={() => void login()}>
              登录
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-xl font-bold">Torch 管理后台</h1>
          <p className="text-sm text-muted-foreground">模型 · 用户积分 · 支付充值 · 首页卡片 · 技能市场 · 品牌配置 · 客户端构建</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="h-4 w-4" /> 退出
        </Button>
      </header>

      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">模型</TabsTrigger>
          <TabsTrigger value="users">用户/积分</TabsTrigger>
          <TabsTrigger value="payments">支付充值</TabsTrigger>
          <TabsTrigger value="wechat">微信登录</TabsTrigger>
          <TabsTrigger value="suggestions">首页卡片</TabsTrigger>
          <TabsTrigger value="skills">技能市场</TabsTrigger>
          <TabsTrigger value="brand">品牌</TabsTrigger>
          <TabsTrigger value="build">客户端构建</TabsTrigger>
        </TabsList>
        <TabsContent value="models">
          <Models />
        </TabsContent>
        <TabsContent value="users">
          <Users />
        </TabsContent>
        <TabsContent value="payments">
          <Payments />
        </TabsContent>
        <TabsContent value="wechat">
          <WechatLogin />
        </TabsContent>
        <TabsContent value="suggestions">
          <Suggestions />
        </TabsContent>
        <TabsContent value="skills">
          <Skills />
        </TabsContent>
        <TabsContent value="brand">
          <Brand />
        </TabsContent>
        <TabsContent value="build">
          <ClientBuild />
        </TabsContent>
      </Tabs>
    </div>
  )
}
