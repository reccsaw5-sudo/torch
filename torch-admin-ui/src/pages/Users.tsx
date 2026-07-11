import { useEffect, useState } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type UserRow } from '@/lib/api'

export default function Users() {
  const [rows, setRows] = useState<UserRow[]>([])
  const [err, setErr] = useState('')

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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">用户</h2>
        <p className="text-sm text-muted-foreground">已注册/登录的用户（自带 Key 模式，无积分）。</p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>用户名</TableHead>
            <TableHead>邮箱</TableHead>
            <TableHead>注册时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id}>
              <TableCell>{r.id}</TableCell>
              <TableCell className="font-medium">{r.username}</TableCell>
              <TableCell>{r.email}</TableCell>
              <TableCell>{r.created_at ? new Date(r.created_at * 1000).toLocaleString() : '—'}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                暂无用户（客户端登录后自动出现）
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
