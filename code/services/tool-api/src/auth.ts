import { z } from 'zod'

const ApiKeyConfigSchema = z.record(z.string(), z.number().int().positive())

/**
 * TOOL_API_KEYS_JSON format:
 * {"api_key_value_1":1,"api_key_value_2":2}
 *
 * Key is the API key, value is clientId.
 */
export function resolveClientIdFromRequest(req: { headers: Record<string, any> }): number | null {
  const header =
    (req.headers['x-api-key'] as string | undefined) ??
    (req.headers['authorization'] as string | undefined)

  const apiKey = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : header?.trim()
  if (!apiKey) return null

  const raw = process.env.TOOL_API_KEYS_JSON
  if (!raw) return null

  try {
    const parsed = ApiKeyConfigSchema.parse(JSON.parse(raw))
    return parsed[apiKey] ?? null
  } catch {
    return null
  }
}

