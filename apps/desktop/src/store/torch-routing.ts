import { setModelAssignment } from '@/hermes'

// Per-model protocol routing for the branded client's built-in gateway.
//
// The built-in address (TORCH_INFERENCE_BASE, baked into the client) is treated
// as the gateway *domain root* (a self-hosted new-api). new-api speaks several
// native wire protocols under one host + one token, so the client picks the
// protocol that matches the chosen model instead of flattening everything to
// OpenAI:
//
//   claude* / anthropic*  → Anthropic Messages  (POST {root}/v1/messages)
//   gpt* / o[1-9]* / codex / chatgpt → OpenAI Responses (POST {root}/v1/responses)
//   everything else (gemini, grok, deepseek, …) → OpenAI Chat Completions
//
// Each protocol is wired through a named custom provider (custom:torch-*) whose
// api_mode the Hermes runtime honors verbatim — bare `custom` would silently
// downgrade codex_responses on a non-OpenAI host.

export interface TorchRoute {
  provider: string
  base_url: string
  api_mode: string
}

/** Normalize the built-in address to the gateway domain root (drop trailing /v1). */
export function torchApiRoot(apiBaseUrl: string): string {
  return (apiBaseUrl || '')
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '')
}

/** OpenAI-format model catalog endpoint ({root}/v1/models). */
export function torchModelsUrl(apiBaseUrl: string): string {
  return `${torchApiRoot(apiBaseUrl)}/v1/models`
}

/** Map a model id to the matching gateway protocol + base_url. */
export function routeTorchModel(modelId: string, apiBaseUrl: string): TorchRoute {
  const root = torchApiRoot(apiBaseUrl)
  const id = (modelId || '').trim().toLowerCase()
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id

  if (bare.startsWith('claude') || id.startsWith('anthropic')) {
    return { provider: 'custom:torch-claude', base_url: root, api_mode: 'anthropic_messages' }
  }
  if (/^(gpt|o[1-9]|codex|chatgpt)/.test(bare)) {
    return { provider: 'custom:torch-responses', base_url: `${root}/v1`, api_mode: 'codex_responses' }
  }
  return { provider: 'custom:torch-openai', base_url: `${root}/v1`, api_mode: 'chat_completions' }
}

/** Point Hermes' main slot at the built-in gateway, routed for this model. */
export async function applyTorchModelAssignment(
  model: string,
  apiBaseUrl: string,
  key: string
): Promise<void> {
  const route = routeTorchModel(model, apiBaseUrl)

  await setModelAssignment({
    scope: 'main',
    provider: route.provider,
    model,
    base_url: route.base_url,
    api_key: key,
    api_mode: route.api_mode
  })
}
