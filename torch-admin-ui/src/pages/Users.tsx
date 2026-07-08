import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type UserRow } from '@/lib/api'

export default function Users() {
  const [rows, setRows] = useState<UserRow[]>([])
  const [err, setErr] = useState('')
  const [amount, setAmount] = useState<Record<number, string>>({})

  async function load() {
    try {
      setErr('')
      const { data } = await api.listUsers()
      setRows(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function topup(userId: number) {
    const delta = Number(amount[userId])
    if (!delta) return
    try {
      await api.adjustCredits(userId, delta, 'admin_topup')
      setAmount({ ...amount, [userId]: '' })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">用户与积分</h2>
        <p className="text-sm text-muted-foreground">查看用户余额，手动充值/扣减（正数充值，负数扣减）。</p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>用户名</TableHead>
            <TableHead>邮箱</TableHead>
            <TableHead>余额</TableHead>
            <TableHead className="w-[260px]">充值/扣减</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id}>
              <TableCell>{r.id}</TableCell>
              <TableCell className="font-medium">{r.username}</TableCell>
              <TableCell>{r.email}</TableCell>
              <TableCell className="font-semibold">{r.balance}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="h-8 w-28"
                    placeholder="+500"
                    value={amount[r.id] ?? ''}
                    onChange={e => setAmount({ ...amount, [r.id]: e.target.value })}
                  />
                  <Button size="sm" onClick={() => void topup(r.id)}>
                    提交
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                暂无用户（客户端登录后自动出现）
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
