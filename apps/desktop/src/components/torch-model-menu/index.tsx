import { useStore } from '@nanostores/react'
import { useContext, useEffect, useState } from 'react'

import { ModelMenuCloseContext } from '@/app/shell/model-menu-panel'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  dropdownMenuRow,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { $currentModel } from '@/store/session'
import { $torchModels, $torchModelsLoaded, loadTorchModels } from '@/store/torch-models'

// Torch-native model dropdown: lists exactly the admin-published catalog from
// the metering proxy. Selecting a row routes the main model through the proxy.
export function TorchModelMenu({ onSelect }: { onSelect: (model: string) => void }) {
  const models = useStore($torchModels)
  const loaded = useStore($torchModelsLoaded)
  const current = useStore($currentModel)
  const close = useContext(ModelMenuCloseContext)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    void loadTorchModels()
  }, [])

  const refresh = async () => {
    if (refreshing) {
      return
    }
    setRefreshing(true)
    try {
      await loadTorchModels()
    } finally {
      setRefreshing(false)
    }
  }

  const pick = (model: string) => {
    onSelect(model)
    close()
  }

  return (
    <>
      <div className="max-h-[max(150px,30dvh)] overflow-y-auto py-1">
        {!loaded ? (
          <DropdownMenuGroup className="py-1">
            {Array.from({ length: 3 }, (_, i) => (
              <DropdownMenuItem className={dropdownMenuRow} disabled key={i} onSelect={e => e.preventDefault()}>
                <Skeleton className="h-4 w-full" />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : models.length === 0 ? (
          <DropdownMenuItem className={dropdownMenuRow} disabled>
            暂无可用模型
          </DropdownMenuItem>
        ) : (
          models.map(model => {
            const isCurrent = model === current
            return (
              <DropdownMenuItem
                className={dropdownMenuRow}
                key={model}
                onSelect={e => {
                  e.preventDefault()
                  pick(model)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{model}</span>
                {isCurrent ? <Codicon className="ml-auto text-foreground" name="check" size="0.75rem" /> : null}
              </DropdownMenuItem>
            )
          })
        )}
      </div>

      <DropdownMenuSeparator className="mx-0" />

      <DropdownMenuItem
        className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
        disabled={refreshing}
        onSelect={e => {
          e.preventDefault()
          void refresh()
        }}
      >
        <Codicon className={cn(refreshing && 'animate-spin')} name="sync" size="0.75rem" />
        刷新模型
      </DropdownMenuItem>
    </>
  )
}
