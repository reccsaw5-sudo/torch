import type { SessionInfo } from '@/hermes'

export type SessionDateBucket = 'older' | 'previous7' | 'previous30' | 'today' | 'yesterday'

const DAY_MS = 86_400_000

// Codex-style recents grouping: bucket a session by how many *calendar* days
// ago it was last active (local time), so "Yesterday" flips at midnight rather
// than on a rolling 24h window.
export function sessionDateBucket(session: SessionInfo, now: number = Date.now()): SessionDateBucket {
  const seconds = session.last_active || session.started_at || 0

  if (!seconds) {
    return 'older'
  }

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  const startOfThen = new Date(seconds * 1000)
  startOfThen.setHours(0, 0, 0, 0)

  const dayDiff = Math.round((startOfToday.getTime() - startOfThen.getTime()) / DAY_MS)

  if (dayDiff <= 0) {
    return 'today'
  }

  if (dayDiff === 1) {
    return 'yesterday'
  }

  if (dayDiff <= 7) {
    return 'previous7'
  }

  if (dayDiff <= 30) {
    return 'previous30'
  }

  return 'older'
}
