import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, type SkillRow, type SkillUpsert } from '@/lib/api'

const EMPTY: SkillUpsert = { slug: '', name: '', description: '', category: '', content: '', sort_order: 0, enabled: 1 }

export default function Skills() {
  const [rows, setRows] = useState<SkillRow[]>([])
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SkillUpsert>(EMPTY)

  async function load() {
    try {
      setErr('')
      const { data } = await api.listSkills()
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

  function openEdit(r: SkillRow) {
    setDraft({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      content: r.content,
      sort_order: r.sort_order,
      enabled: r.enabled
    })
    setOpen(true)
  }

  async function save() {
    try {
      await api.upsertSkill(draft)
      setOpen(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(id: number) {
    if (!window.confirm('确定删除该技能？')) return
    try {
      await api.deleteSkill(id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">技能市场</h2>
          <p className="text-sm text-muted-foreground">客户端「技能市场」展示的技能。内容为 SKILL.md 文本，用户可一键使用或安装。</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> 新增技能
        </Button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标识 slug</TableHead>
            <TableHead>名称</TableHead>
            <TableHead>分类</TableHead>
            <TableHead>排序</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.slug}</TableCell>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{r.category}</TableCell>
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
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                暂无技能
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>技能</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>标识 slug（英文唯一，如 weekly-report）</Label>
              <Input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>名称</Label>
              <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>简介</Label>
              <Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>分类</Label>
              <Input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>技能内容（SKILL.md）</Label>
              <Textarea
                className="min-h-[160px] font-mono"
                value={draft.content}
                onChange={e => setDraft({ ...draft, content: e.target.value })}
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
