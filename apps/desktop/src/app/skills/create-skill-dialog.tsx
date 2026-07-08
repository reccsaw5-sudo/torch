import { useRef, useState } from 'react'

import { CodeEditor } from '@/components/chat/code-editor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createSkill } from '@/hermes'
import { Loader2, Upload } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'

interface CreateSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/

const TEMPLATE = `---
name: my-skill
description: 一句话说明这个技能的用途。
---

# 技能说明

说明这个技能做什么、什么时候使用,以及具体步骤。
`

export function CreateSkillDialog({ open, onOpenChange, onCreated }: CreateSkillDialogProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [content, setContent] = useState(TEMPLATE)
  const [editorKey, setEditorKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const contentRef = useRef(TEMPLATE)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setName('')
    setCategory('')
    setContent(TEMPLATE)
    contentRef.current = TEMPLATE
    setEditorKey(key => key + 1)
    setError(null)
  }

  const nameValid = NAME_RE.test(name.trim())

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    event.target.value = ''

    if (!file) {
      return
    }

    const text = await file.text()

    setContent(text)
    contentRef.current = text
    setEditorKey(key => key + 1)

    if (!name.trim()) {
      setName(file.name.replace(/\.md$/i, '').toLowerCase())
    }
  }

  async function handleSubmit() {
    const trimmedName = name.trim()

    if (!NAME_RE.test(trimmedName)) {
      setError('名称只能包含小写字母、数字、.、-、_,且以字母或数字开头。')

      return
    }

    setBusy(true)
    setError(null)

    try {
      const result = await createSkill(trimmedName, contentRef.current, category)

      if (result.success === false) {
        setError(result.error || '创建失败')

        return
      }

      notify({ kind: 'success', message: `技能「${trimmedName}」已创建` })
      onCreated()
      onOpenChange(false)
      reset()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      setError(message)
      notifyError(err, '创建技能失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      onOpenChange={next => {
        onOpenChange(next)

        if (!next) {
          reset()
        }
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col rounded-3xl p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base">新建技能</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">名称</span>
              <Input
                className="h-9 rounded-xl text-sm"
                onChange={event => setName(event.target.value)}
                placeholder="my-skill"
                value={name}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">分类(可选)</span>
              <Input
                className="h-9 rounded-xl text-sm"
                onChange={event => setCategory(event.target.value)}
                placeholder="例如 productivity"
                value={category}
              />
            </label>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">SKILL.md 内容</span>
            <Button
              className="h-8 gap-1.5 rounded-lg"
              onClick={() => fileInputRef.current?.click()}
              size="sm"
              variant="ghost"
            >
              <Upload className="size-3.5" /> 从 .md 文件导入
            </Button>
            <input
              accept=".md,text/markdown"
              className="hidden"
              onChange={event => void handleImportFile(event)}
              ref={fileInputRef}
              type="file"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-(--ui-stroke-tertiary)">
            <CodeEditor
              disabled={busy}
              filePath="SKILL.md"
              initialValue={content}
              key={editorKey}
              onChange={value => {
                contentRef.current = value
              }}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
              size="sm"
              variant="ghost"
            >
              取消
            </Button>
            <Button
              className="rounded-xl"
              disabled={busy || !nameValid}
              onClick={() => void handleSubmit()}
              size="sm"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : '创建技能'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
