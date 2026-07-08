import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type ModelRow, type ModelUpsert } from '@/lib/api'

const EMPTY: ModelUpsert = {
  model: '',
  upstream_base_url: '',
  upstream_model: '',
  upstream_api_key: '',
  price: 1,
  enabled: true
}

export default function Models() {
  const [rows, setRows] = useState<ModelRow[]>([])
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ModelUpsert>(EMPTY)

  async function load() {
    try {
      setErr('')
      const { data } = await api.listModels()
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

  function openEdit(r: ModelRow) {
    setDraft({
      model: r.model,
      upstream_base_url: r.upstream_base_url,
      upstream_model: r.upstream_model ?? '',
      upstream_api_key: '',
      price: r.price,
      enabled: r.enabled === 1
    })
    setOpen(true)
  }

  async function save() {
    try {
      await api.upsertModel(draft)
      setOpen(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(id: number) {
    if (!window.confirm('确定删除该模型？')) return
    try {
      await api.deleteModel(id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">模型目录</h2>
          <p className="text-sm text-muted-foreground">配置上游地址、密钥与每次调用的积分单价。填 mock 可用内置假模型测试。</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> 新增模型
        </Button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模型名</TableHead>
            <TableHead>上游地址</TableHead>
            <TableHead>上游模型</TableHead>
            <TableHead>单价</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.model}</TableCell>
              <TableCell className="max-w-[220px] truncate">{r.upstream_base_url}</TableCell>
              <TableCell>{r.upstream_model}</TableCell>
              <TableCell>{r.price}</TableCell>
              <TableCell>
                {r.enabled ? <Badge>启用</Badge> : <Badge variant="muted">停用</Badge>}
              </TableCell>
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
                暂无模型
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>模型配置</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="模型名（对客户端暴露）">
              <Input value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} placeholder="gpt-4o / torch-mock" />
            </Field>
            <Field label="上游地址（填 mock 用内置假模型）">
              <Input
                value={draft.upstream_base_url}
                onChange={e => setDraft({ ...draft, upstream_base_url: e.target.value })}
                placeholder="https://api.openai.com/v1 或 mock"
              />
            </Field>
            <Field label="上游模型名（留空同模型名）">
              <Input value={draft.upstream_model ?? ''} onChange={e => setDraft({ ...draft, upstream_model: e.target.value })} />
            </Field>
            <Field label="上游 API Key（留空不改）">
              <Input type="password" value={draft.upstream_api_key ?? ''} onChange={e => setDraft({ ...draft, upstream_api_key: e.target.value })} />
            </Field>
            <Field label="每次调用积分单价">
              <Input
                type="number"
                value={String(draft.price)}
                onChange={e => setDraft({ ...draft, price: Number(e.target.value) || 0 })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
