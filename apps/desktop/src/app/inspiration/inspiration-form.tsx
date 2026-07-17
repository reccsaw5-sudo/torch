import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { INSPIRATION_CATEGORIES, type InspirationCard, type InspirationCategory } from '@/lib/inspiration-templates'
import { type InspirationDraft } from '@/store/custom-inspiration'

const EMPTY: InspirationDraft = { emoji: '💡', title: '', category: '办公提效', desc: '', prompt: '' }

const labelClass = 'flex flex-col gap-1 text-xs font-medium text-muted-foreground'

interface InspirationFormDialogProps {
  open: boolean
  /** Non-null when editing an existing custom card; null when creating. */
  card: InspirationCard | null
  onOpenChange: (open: boolean) => void
  onSave: (draft: InspirationDraft, id?: string) => void
}

// Create / edit dialog for a user's own local inspiration card.
export function InspirationFormDialog({ open, card, onOpenChange, onSave }: InspirationFormDialogProps) {
  const [draft, setDraft] = useState<InspirationDraft>(EMPTY)

  useEffect(() => {
    if (!open) {
      return
    }

    setDraft(
      card
        ? { emoji: card.emoji, title: card.title, category: card.category, desc: card.desc, prompt: card.prompt }
        : EMPTY
    )
  }, [open, card])

  const canSave = Boolean(draft.title.trim() && draft.prompt.trim())

  const submit = () => {
    if (!canSave) {
      return
    }

    onSave(draft, card?.id)
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{card ? '编辑灵感' : '新建灵感'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <label className={labelClass}>
              图标
              <Input
                className="w-14 text-center text-lg"
                maxLength={2}
                onChange={e => setDraft({ ...draft, emoji: e.target.value })}
                value={draft.emoji}
              />
            </label>
            <label className={`${labelClass} flex-1`}>
              标题
              <Input
                onChange={e => setDraft({ ...draft, title: e.target.value })}
                placeholder="例如:帮我写周报"
                value={draft.title}
              />
            </label>
          </div>

          <label className={labelClass}>
            分类
            <Select
              onValueChange={v => setDraft({ ...draft, category: v as InspirationCategory })}
              value={draft.category}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSPIRATION_CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className={labelClass}>
            描述
            <Input
              onChange={e => setDraft({ ...draft, desc: e.target.value })}
              placeholder="一句话说明这个灵感的用途"
              value={draft.desc}
            />
          </label>

          <label className={labelClass}>
            提示词(点击后预填到输入框,可再编辑)
            <Textarea
              className="min-h-24"
              onChange={e => setDraft({ ...draft, prompt: e.target.value })}
              placeholder="例如:请根据我提供的本周工作内容,帮我写一份条理清晰的周报。我先把内容发给你:"
              value={draft.prompt}
            />
          </label>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="text">
            取消
          </Button>
          <Button disabled={!canSave} onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
