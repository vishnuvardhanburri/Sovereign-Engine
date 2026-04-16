import { appEnv } from '@/lib/env'

interface OpenRouterChatResponse<T> {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: {
    message?: string
  }
}

async function requestStructuredOutput<T>(input: {
  system: string
  prompt: string
  schemaName: string
  schema: Record<string, unknown>
  fallback: T
}): Promise<T> {
  const apiKey = appEnv.openRouterApiKey()
  if (!apiKey) {
    return input.fallback
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: appEnv.openRouterModel(),
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenRouter request failed: ${body}`)
  }

  const payload = (await response.json()) as OpenRouterChatResponse<T>
  const content = payload.choices?.[0]?.message?.content

  if (!content) {
    return input.fallback
  }

  return JSON.parse(content) as T
}

export async function generateIntroLine(input: {
  company?: string | null
  role?: string | null
  offer?: string | null
  pain?: string | null
}) {
  const fallback = {
    intro: `Noticed ${input.company || 'your team'} is likely balancing growth goals with a crowded outbound market.`,
  }

  const result = await requestStructuredOutput({
    system:
      'Write one plain-text first line for a cold outbound email. Keep it human, specific, and under 20 words.',
    prompt: JSON.stringify(input),
    schemaName: 'intro_line',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intro: { type: 'string' },
      },
      required: ['intro'],
    },
    fallback,
  })

  return result.intro.trim()
}

export async function classifyReplyWithAi(text: string) {
  const fallback = { classification: 'not_interested' }

  const result = await requestStructuredOutput({
    system:
      'Classify the sales reply as interested, not_interested, or ooo. Respond only with the schema.',
    prompt: text,
    schemaName: 'reply_classification',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        classification: {
          type: 'string',
          enum: ['interested', 'not_interested', 'ooo'],
        },
      },
      required: ['classification'],
    },
    fallback,
  })

  return result.classification as 'interested' | 'not_interested' | 'ooo'
}

export async function generateSubjectIdeas(input: {
  offer: string
  company?: string | null
  angle: 'pattern' | 'pain' | 'authority'
}) {
  const fallback = {
    subjects: [
      `${input.company || 'Your team'} + ${input.offer}`,
      `Quick thought on ${input.offer}`,
      `Worth pressure-testing?`,
    ],
  }

  const result = await requestStructuredOutput({
    system:
      'Generate three short outbound subject lines. Keep them plain text, under 7 words, and avoid spammy wording.',
    prompt: JSON.stringify(input),
    schemaName: 'subject_ideas',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subjects: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'string' },
        },
      },
      required: ['subjects'],
    },
    fallback,
  })

  return result.subjects.map((item) => item.trim()).filter(Boolean)
}
