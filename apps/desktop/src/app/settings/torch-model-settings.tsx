import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getAuxiliaryModels, saveHermesConfig, setModelAssignment } from '@/hermes'
import type { AuxiliaryModelsResponse } from '@/hermes'
import { useI18n } from '@/i18n'
import { Cpu, RefreshCw } from '@/lib/icons'
import { notifyError } from '@/store/notifications'
import {
  $torchModels,
  $torchModelsLoaded,
  applyTorchModel,
  loadTorchModels,
  readSelectedTorchModel
} from '@/store/torch-models'

import { setHermesConfigCache, useHermesConfigRecord } from '../hooks/use-config-record'

import { CONTROL_TEXT } from './constants'
import { getNested, setNested } from './helpers'
import { ListRow, SectionHeading } from './primitives'

// Hermes' reasoning levels (VALID_REASONING_EFFORTS); `none` = thinking off.
const EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const effortLabelKey = (v: string) => (v === 'xhigh' ? 'max' : v) as 'high' | 'low' | 'max' | 'medium' | 'minimal'

// Follow-the-main-model sentinel for the per-task selects.
const MAIN = '__main__'

// Side-LLM tasks that can pin their own model. Labels are Torch-local (the
// stock Hermes i18n keys carry provider-universe framing we don't want here).
const AUX_TASKS: readonly { key: string; label: string; hint: string }[] = [
  { key: 'vision', label: '视觉', hint: '图片分析' },
  { key: 'web_extract', label: '网页提取', hint: '页面总结' },
  { key: 'compression', label: '压缩', hint: '上下文压缩' },
  { key: 'skills_hub', label: '技能中心', hint: '技能搜索' },
  { key: 'approval', label: '审批', hint: '智能自动批准' },
  { key: 'mcp', label: 'MCP', hint: 'MCP 工具路由' },
  { key: 'title_generation', label: '标题生成', hint: '会话标题' },
  { key: 'curator', label: '技能维护', hint: '后台技能整理' }
]

// Keep the active value selectable even if it isn't in the current catalog.
const withActive = (models: readonly string[], active: string): readonly string[] =>
  active && !models.includes(active) ? [active, ...models] : models

interface TorchModelSettingsProps {
  /** Notified after the main model is applied, so live UI stores can sync. */
  onMainModelChanged?: (provider: string, model: string) => void
}

// Torch-native replacement for the stock Hermes model settings page. It only
// surfaces the metering-proxy catalog (`GET /v1/models`) plus the reasoning
// default and per-task auxiliary models — no upstream provider universe or MoA
// presets, which don't apply to a client locked to the Torch proxy (and made
// the page slow by materializing ~40 providers).
export function TorchModelSettings({ onMainModelChanged }: TorchModelSettingsProps) {
  const { t } = useI18n()
  const m = t.settings.model
  const models = useStore($torchModels)
  const loaded = useStore($torchModelsLoaded)
  const { data: config } = useHermesConfigRecord()
  const [selected, setSelected] = useState('')
  const [auxiliary, setAuxiliary] = useState<AuxiliaryModelsResponse | null>(null)
  const [applying, setApplying] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadAux = useCallback(async () => {
    try {
      setAuxiliary(await getAuxiliaryModels())
    } catch {
      // Non-fatal: the aux section just stays on "follow main".
    }
  }, [])

  useEffect(() => {
    void loadTorchModels()
    void loadAux()
    setSelected(readSelectedTorchModel())
  }, [loadAux])

  // Default the visible selection to the saved model, else the first catalog
  // entry, once the list lands.
  useEffect(() => {
    if (!selected && models.length) {
      setSelected(readSelectedTorchModel() || models[0])
    }
  }, [models, selected])

  const rawEffort = String(getNested(config ?? {}, 'agent.reasoning_effort') ?? '')
  const effortValue = rawEffort === 'false' || rawEffort === 'disabled' ? 'none' : rawEffort || 'medium'

  const writeEffort = async (value: string) => {
    if (!config) {
      return
    }

    const prev = config
    const next = setNested(config, 'agent.reasoning_effort', value)
    setHermesConfigCache(next)

    try {
      await saveHermesConfig(next)
    } catch (err) {
      setHermesConfigCache(prev)
      notifyError(err, m.defaultsFailed)
    }
  }

  const applyModel = async (model: string) => {
    setSelected(model)
    setApplying(true)

    try {
      await applyTorchModel(model)
      onMainModelChanged?.('custom', model)
    } catch (err) {
      notifyError(err, m.defaultsFailed)
    } finally {
      setApplying(false)
    }
  }

  const refresh = async () => {
    setRefreshing(true)

    try {
      await loadTorchModels()
    } finally {
      setRefreshing(false)
    }
  }

  // Pin an auxiliary task to a Torch model, or `MAIN` to follow the main model.
  // provider='custom' resolves to the main custom endpoint (the proxy), so only
  // the model id needs to change; 'auto' clears the pin.
  const assignAux = async (task: string, value: string) => {
    setApplying(true)

    try {
      if (value === MAIN) {
        await setModelAssignment({ scope: 'auxiliary', task, provider: 'auto', model: '' })
      } else {
        await setModelAssignment({ scope: 'auxiliary', task, provider: 'custom', model: value })
      }

      await loadAux()
    } catch (err) {
      notifyError(err, m.defaultsFailed)
    } finally {
      setApplying(false)
    }
  }

  const resetAllAux = async () => {
    setApplying(true)

    try {
      await setModelAssignment({ scope: 'auxiliary', task: '__reset__', provider: 'auto', model: '' })
      await loadAux()
    } catch (err) {
      notifyError(err, m.defaultsFailed)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="grid gap-6">
      <section>
        <p className="mb-3 text-xs text-muted-foreground">
          应用于新会话。可在输入框的模型选择器中临时切换当前对话。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Select disabled={applying || !models.length} onValueChange={value => void applyModel(value)} value={selected}>
            <SelectTrigger className={CONTROL_TEXT}>
              <SelectValue placeholder={loaded ? '暂无可用模型' : '加载中…'} />
            </SelectTrigger>
            <SelectContent>
              {models.map(id => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button disabled={refreshing} onClick={() => void refresh()} size="sm" variant="text">
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            刷新模型
          </Button>
        </div>

        {loaded && models.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">未获取到模型,请确认已登录且后台「模型目录」已启用模型。</p>
        )}

        {config && (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-xs">
              {m.reasoning}
              <Select onValueChange={value => void writeEffort(value)} value={effortValue}>
                <SelectTrigger className={CONTROL_TEXT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EFFORT_VALUES.map(value => (
                    <SelectItem key={value} value={value}>
                      {value === 'none' ? m.reasoningOff : t.shell.modelOptions[effortLabelKey(value)]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <SectionHeading icon={Cpu} title="辅助模型" />
          <Button disabled={applying} onClick={() => void resetAllAux()} size="sm" variant="textStrong">
            全部使用主模型
          </Button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          子任务默认使用主模型。你可以为任意子任务从模型目录中指定专用模型。
        </p>

        <div className="grid gap-1">
          {AUX_TASKS.map(task => {
            const current = auxiliary?.tasks.find(entry => entry.task === task.key)
            const isAuto = !current || !current.provider || current.provider === 'auto'
            const value = isAuto ? MAIN : current.model || MAIN

            return (
              <ListRow
                action={
                  <Select
                    disabled={applying || !models.length}
                    onValueChange={next => void assignAux(task.key, next)}
                    value={value}
                  >
                    <SelectTrigger className={CONTROL_TEXT}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MAIN}>使用主模型</SelectItem>
                      {withActive(models, isAuto ? '' : current?.model || '').map(id => (
                        <SelectItem key={id} value={id}>
                          {id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
                description={task.hint}
                key={task.key}
                title={task.label}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
