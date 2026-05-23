import { appEnv } from '@/lib/env'
import { extractJsonObject } from '@/lib/ai/openrouter'

export type GeminiSource = 'gemini' | 'fallback'

export interface GeminiJsonResult<T> {
  source: GeminiSource
  data: T
  error?: string
  model?: string
}

export interface TryGeminiJsonInput<T> {
  task: string
  system: string
  user: string
  fallback: T
  apiKey?: string
  model?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstGeminiText(payload: Record<string, unknown> | null): string {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
  const first = candidates[0] as Record<string, unknown> | undefined
  const content = isRecord(first?.content) ? first.content : null
  const parts = Array.isArray(content?.parts) ? content.parts : []

  return parts
    .map((part) => (isRecord(part) ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

export async function tryGeminiJson<T>(input: TryGeminiJsonInput<T>): Promise<GeminiJsonResult<T>> {
  const apiKey = String(input.apiKey ?? appEnv.geminiApiKey()).trim()
  const model = String(input.model ?? appEnv.geminiModel()).trim()

  if (!apiKey) {
    return {
      source: 'fallback',
      data: input.fallback,
      error: 'gemini_not_configured',
      model,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 8_000)

  try {
    const response = await (input.fetchImpl ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: input.system }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: input.user }],
            },
          ],
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      return {
        source: 'fallback',
        data: input.fallback,
        error: `gemini_http_${response.status}`,
        model,
      }
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const parsed = extractJsonObject(firstGeminiText(payload))

    if (!isRecord(parsed)) {
      return {
        source: 'fallback',
        data: input.fallback,
        error: 'gemini_invalid_json',
        model,
      }
    }

    return {
      source: 'gemini',
      data: parsed as T,
      model,
    }
  } catch (error) {
    return {
      source: 'fallback',
      data: input.fallback,
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'gemini_timeout'
          : 'gemini_request_failed',
      model,
    }
  } finally {
    clearTimeout(timeout)
  }
}
