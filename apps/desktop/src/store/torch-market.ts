import { atom } from 'nanostores'

import { TORCH_SERVER } from './torch-brand'

export interface TorchSuggestion {
  id: number
  title: string
  subtitle: string
  prompt: string
}

export interface TorchSkill {
  id: number
  slug: string
  name: string
  description: string
  category: string
}

export const $torchSuggestions = atom<TorchSuggestion[]>([])
export const $torchSkills = atom<TorchSkill[]>([])
export const $torchMarketOpen = atom<boolean>(false)

export async function loadTorchSuggestions() {
  try {
    const res = await fetch(`${TORCH_SERVER}/suggestions`)
    const data = (await res.json()) as { data?: TorchSuggestion[] }
    $torchSuggestions.set(data.data ?? [])
  } catch {
    // Leave whatever we had; the home just shows no cards.
  }
}

export async function loadTorchSkills() {
  try {
    const res = await fetch(`${TORCH_SERVER}/skills`)
    const data = (await res.json()) as { data?: TorchSkill[] }
    $torchSkills.set(data.data ?? [])
  } catch {
    // Leave whatever we had.
  }
}

export async function fetchSkillContent(slug: string): Promise<string> {
  const res = await fetch(`${TORCH_SERVER}/skills/${encodeURIComponent(slug)}`)
  if (!res.ok) {
    throw new Error(`skill ${slug} unavailable`)
  }
  const data = (await res.json()) as { content?: string }
  return data.content ?? ''
}

export const openTorchMarket = () => $torchMarketOpen.set(true)
export const closeTorchMarket = () => $torchMarketOpen.set(false)
