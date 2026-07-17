import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type Expert, EXPERT_CATEGORIES, type ExpertCategory } from '@/lib/expert-templates'
import { type ExpertDraft } from '@/store/custom-experts'

const EMPTY: ExpertDraft = { name: '', emoji: '🤖', category: '办公协同', intro: '', opener: '', persona: '' }

const labelClass = 'flex flex-col gap-1 text-xs font-medium text-muted-foreground'

interface ExpertFormDialogProps {
  open: boolean
  /** Non-null when editing an existing custom expert; null when creating. */
  expert: Expert | null
  onOpenChange: (open: boolean) => void
  onSave: (draft: ExpertDraft, id?: string) => void
}

// Create / edit dialog for a user's own local expert.
export function ExpertFormDialog({ open, expert, onOpenChange, onSave }: ExpertFormDialogProps) {
  const [draft, setDraft] = useState<ExpertDraft>(EMPTY)

  useEffect(() => {
    if (!open) {
      return
    }

    setDraft(
      expert
        ? {
            name: expert.name,
            emoji: expert.emoji,
            category: expert.category,
            intro: expert.intro,
            opener: expert.opener,
            persona: expert.persona ?? ''
          }
        : EMPTY
    )
  }, [open, expert])

  const canSave = Boolean(draft.name.trim() && draft.opener.trim())

  const submit = () => {
    if (!canSave) {
      return
    }

    onSave(draft, expert?.id)
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{expert ? '编辑专家' : '新建专家'}</DialogTitle>
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
              名称
              <Input
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder="例如:合同审查专家"
                value={draft.name}
              />
            </label>
          </div>

          <label className={labelClass}>
            分类
            <Select
              onValueChange={v => setDraft({ ...draft, category: v as ExpertCategory })}
              value={draft.category}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPERT_CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className={labelClass}>
            简介
            <Input
              onChange={e => setDraft({ ...draft, intro: e.target.value })}
              placeholder="一句话描述这个专家能帮你做什么"
              value={draft.intro}
            />
          </label>

          <label className={labelClass}>
            开场白(点击后预填到输入框,可再编辑)
            <Textarea
              className="min-h-20"
              onChange={e => setDraft({ ...draft, opener: e.target.value })}
              placeholder="例如:请帮我审查这份合同的风险条款,我把内容发给你:"
              value={draft.opener}
            />
          </label>

          <label className={labelClass}>
            人设(可选,留空自动生成技能级人设)
            <Textarea
              className="min-h-20"
              onChange={e => setDraft({ ...draft, persona: e.target.value })}
              placeholder="填写后作为本次对话常驻的系统提示,精确控制这个专家的身份与工作方式"
              value={draft.persona}
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
