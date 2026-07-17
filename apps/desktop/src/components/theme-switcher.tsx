import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { triggerHaptic } from '@/lib/haptics'
import { Check, Monitor, Moon, Sun } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $retroMode, $retroPrevTheme } from '@/store/retro-mode'
import { type ThemeMode, useTheme } from '@/themes/context'

const MODE_OPTIONS = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '系统', icon: Monitor }
] as const satisfies readonly { id: ThemeMode; label: string; icon: typeof Sun }[]

// Quick theme switcher: a popover with the light/dark/system toggle and the
// installed skin list. Reuses the existing theme system (useTheme) — the same
// state Settings → Appearance drives, so a change here shows everywhere and
// persists per profile. Placed in the sidebar header for one-click access.
export function ThemeSwitcher({ className }: { className?: string }) {
  const { themeName, mode, availableThemes, setTheme, setMode } = useTheme()
  const retro = useStore($retroMode)

  // 怀旧模式 pairs the qq2007 skin with the retro chrome (RetroFrame + retro.css).
  // Entering remembers the current skin; leaving restores it.
  const toggleRetro = (next: boolean) => {
    triggerHaptic('crisp')

    if (next) {
      $retroPrevTheme.set(themeName === 'qq2007' ? 'nous' : themeName)
      $retroMode.set(true)
      setTheme('qq2007')
    } else {
      $retroMode.set(false)
      setTheme($retroPrevTheme.get() || 'nous')
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="切换主题"
          className={cn('shrink-0 [-webkit-app-region:no-drag]', className)}
          size="icon-xs"
          title="切换主题"
          variant="ghost"
        >
          <Codicon name="color-mode" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="px-0.5 text-[0.6875rem] font-medium text-muted-foreground">外观</span>
            <SegmentedControl
              className="w-full"
              onChange={id => {
                triggerHaptic('crisp')
                setMode(id)
              }}
              options={MODE_OPTIONS}
              value={mode}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="px-0.5 text-[0.6875rem] font-medium text-muted-foreground">主题皮肤</span>
            <div className="grid grid-cols-2 gap-1.5">
              {availableThemes.map(theme => {
                const active = theme.name === themeName

                return (
                  <button
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition',
                      active
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-(--ui-stroke-tertiary) text-foreground hover:bg-(--ui-control-hover-background)'
                    )}
                    key={theme.name}
                    onClick={() => {
                      triggerHaptic('crisp')
                      setTheme(theme.name)
                    }}
                    title={theme.description}
                    type="button"
                  >
                    <span className="truncate">{theme.label}</span>
                    {active ? <Check className="size-3.5 shrink-0" /> : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-md border border-(--ui-stroke-tertiary) px-2 py-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Codicon className="text-sm" name="history" />
              怀旧模式 · QQ2007
            </span>
            <Switch checked={retro} onCheckedChange={toggleRetro} size="xs" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
