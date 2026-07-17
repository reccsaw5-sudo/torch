import { Codecs, persistentAtom } from '@/lib/persisted'

// Locally-saved "my experts" (favorites). Backend-less for now — a list of
// expert ids persisted to localStorage; the 我的专家 tab reads this.
const FAVORITES_KEY = 'torch.desktop.expert-favorites'

export const $favoriteExpertIds = persistentAtom<string[]>(FAVORITES_KEY, [], Codecs.stringArray)

export function toggleExpertFavorite(id: string): void {
  const current = $favoriteExpertIds.get()

  $favoriteExpertIds.set(current.includes(id) ? current.filter(x => x !== id) : [id, ...current])
}
