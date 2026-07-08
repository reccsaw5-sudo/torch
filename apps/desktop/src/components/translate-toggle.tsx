import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Globe, Loader2 } from '@/lib/icons'
import { $translateOn, $translating, setTranslateOn } from '@/lib/torch-translate'

/** Header toggle for on-demand Chinese translation of English catalog text
 *  (skills / toolsets / MCP / hub). Flipping it on translates the visible
 *  strings via the metering proxy and caches them locally. */
export function TranslateToggle() {
  const { t } = useI18n()
  const on = useStore($translateOn)
  const busy = useStore($translating)

  const label = busy ? t.skills.translating : on ? t.skills.showOriginal : t.skills.translate

  return (
    <Button
      disabled={busy}
      onClick={() => setTranslateOn(!on)}
      size="sm"
      title={label}
      variant={on ? 'textStrong' : 'text'}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Globe className="size-3" />}
      {label}
    </Button>
  )
}
