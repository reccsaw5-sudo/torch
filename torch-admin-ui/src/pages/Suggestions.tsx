import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, type SuggestionRow, type SuggestionUpsert } from '@/lib/api'

const EMPTY: SuggestionUpsert = { title: '', subtitle: '', prompt: '', sort_order: 0, enabled: 1 }

export default function Suggestions() {
  const [rows, setRows] = useState<SuggestionRow[]>([])
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SuggestionUpsert>(EMPTY)

  async function load() {
    try {
      setErr('')
      const { data } = await api.listSuggestions()
      setRows(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openNew() {
    setDraft(EMPTY)
    setOpen(true)
  }

  function openEdit(r: SuggestionRow) {
    setDraft({ id: r.id, title: r.title, subtitle: r.subtitle, prompt: r.prompt, sort_order: r.sort_order, enabled: r.enabled })
    setOpen(true)
  }

  async function save() {
    try {
      await api.upsertSuggestion(draft)
      setOpen(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(id: number) {
    if (!window.confirm('确定删除该任务卡片？')) return
    try {
      await api.deleteSuggestion(id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">首页任务卡片</h2>
          <p className="text-sm text-muted-foreground">客户端首页「选一个任务，快速开始」的卡片。点击卡片会把提示词填入输入框。</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> 新增卡片
        </Button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead>副标题</TableHead>
            <TableHead>排序</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.title}</TableCell>
              <TableCell className="max-w-[260px] truncate">{r.subtitle}</TableCell>
              <TableCell>{r.sort_order}</TableCell>
              <TableCell>{r.enabled ? <Badge>启用</Badge> : <Badge variant="muted">停用</Badge>}</TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => void remove(r.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                暂无卡片
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>任务卡片</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>标题</Label>
              <Input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>副标题</Label>
              <Input value={draft.subtitle} onChange={e => setDraft({ ...draft, subtitle: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>提示词（点击卡片填入输入框）</Label>
              <Textarea value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>排序（小的在前）</Label>
              <Input
                type="number"
                value={String(draft.sort_order)}
                onChange={e => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled === 1}
                onChange={e => setDraft({ ...draft, enabled: e.target.checked ? 1 : 0 })}
              />
              启用
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void save()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
