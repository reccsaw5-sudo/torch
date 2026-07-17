import { Codecs, persistentAtom } from '@/lib/persisted'

// 怀旧模式 (QQ 2007 / Windows XP retro shell). When on we set data-retro="true"
// on <html> so styles/retro.css repaints the chrome, and RetroFrame mounts the
// mascot rail + bottom taskbar. Toggling also swaps the active skin to qq2007
// and restores the previous skin on exit (handled by the ThemeSwitcher, which
// owns setTheme). Persisted so the mode survives restarts.
const RETRO_KEY = 'torch.desktop.retro-mode'
const PREV_THEME_KEY = 'torch.desktop.retro-prev-theme'

export const $retroMode = persistentAtom<boolean>(RETRO_KEY, false, Codecs.bool)

// The skin that was active before entering 怀旧模式, restored on exit.
export const $retroPrevTheme = persistentAtom<string>(PREV_THEME_KEY, '', Codecs.text)

function applyRetroAttr(on: boolean): void {
  if (typeof document === 'undefined') {
    return
  }

  if (on) {
    document.documentElement.setAttribute('data-retro', 'true')
  } else {
    document.documentElement.removeAttribute('data-retro')
  }
}

// Fires immediately with the persisted value (nanostores), so the attribute is
// applied on boot before the shell renders.
$retroMode.subscribe(applyRetroAttr)
