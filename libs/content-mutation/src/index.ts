import crypto from 'crypto'

export type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: any[]): Promise<any>
  scard(key: string): Promise<number>
  sadd(key: string, ...members: string[]): Promise<number>
  srandmember(key: string): Promise<string | null>
  expire(key: string, seconds: number): Promise<number>
}

export type ContentMutationInput = {
  clientId: number
  campaignId?: number | null
  sequenceStep?: number | null
  queueJobId?: number | null
  recipientEmail?: string
  subject: string
  text?: string
  html?: string
  ctaText?: string
}

export type ContentMutationResult = {
  subject: string
  text?: string
  html?: string
  mutated: boolean
  source: 'disabled' | 'pool' | 'fallback'
  poolKey?: string
  variantHash?: string
  safetyWarnings?: string[]
}

type ProtectedSegment = {
  token: string
  value: string
}

type ProtectedBody = {
  text: string
  segments: ProtectedSegment[]
  urls: string[]
  unsubscribeFragments: string[]
}

function envBool(name: string, fallback: boolean) {
  const raw = process.env[name]
  if (raw == null) return fallback
  return ['1', 'true', 'yes', 'y', 'on'].includes(raw.trim().toLowerCase())
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function hash(input: string, len = 24) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, len)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeWhitespace(input: string) {
  return input.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function extractUrls(input: string) {
  return Array.from(new Set(input.match(/https?:\/\/[^\s"'<>)]*/gi) ?? []))
}

function extractUnsubscribeFragments(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /unsubscribe|opt[- ]?out|manage preferences/i.test(line))
}

function protectBody(input: string): ProtectedBody {
  let text = input
  const segments: ProtectedSegment[] = []

  const addSegment = (value: string) => {
    const token = `[[XAVIRA_IMMUTABLE_${segments.length}]]`
    segments.push({ token, value })
    text = text.split(value).join(token)
  }

  for (const url of extractUrls(input)) addSegment(url)
  for (const line of extractUnsubscribeFragments(input)) {
    if (line && !segments.some((segment) => segment.value === line)) addSegment(line)
  }

  return {
    text,
    segments,
    urls: extractUrls(input),
    unsubscribeFragments: extractUnsubscribeFragments(input),
  }
}

function restoreBody(input: string, segments: ProtectedSegment[]) {
  let output = input
  for (const segment of segments) {
    output = output.split(segment.token).join(segment.value)
  }
  return output
}

function validateImmutableSegments(base: string, candidate: string) {
  const warnings: string[] = []
  const baseUrls = extractUrls(base)
  const candidateUrls = extractUrls(candidate)
  for (const url of baseUrls) {
    if (!candidateUrls.includes(url)) warnings.push('missing_url')
  }
  if (candidateUrls.some((url) => !baseUrls.includes(url))) warnings.push('new_url_detected')

  const baseUnsub = extractUnsubscribeFragments(base)
  for (const fragment of baseUnsub) {
    if (!candidate.includes(fragment)) warnings.push('unsubscribe_fragment_changed')
  }
  return warnings
}

function promptForVariation(input: {
  protectedBody: string
  subject: string
  ctaText?: string
}) {
  const ctaRule = input.ctaText
    ? `The exact call-to-action is: "${input.ctaText}". Keep that CTA meaning and wording unchanged.`
    : 'Keep the final call-to-action unchanged in meaning and do not add new claims.'

  return [
    'You rewrite compliant B2B outreach copy for clarity and relevance.',
    'Rules:',
    '- Use only the local text below. Do not invent customer names, numbers, guarantees, or claims.',
    '- Preserve every [[XAVIRA_IMMUTABLE_N]] placeholder exactly.',
    '- Preserve all links and unsubscribe/preference text by leaving placeholders untouched.',
    '- Keep the same CTA and same offer.',
    '- Vary sentence structure, greeting style, and wording naturally.',
    '- Return only the rewritten body. No markdown fences. No explanations.',
    ctaRule,
    '',
    `Subject context: ${input.subject}`,
    '',
    'Body:',
    input.protectedBody,
  ].join('\n')
}

function deterministicMicroEdit(body: string, seed: string) {
  const protectedBody = protectBody(body)
  const variants = [
    { from: /^Hi\b/i, to: 'Hello' },
    { from: /^Hello\b/i, to: 'Hi' },
    { from: /\bquick note\b/gi, to: 'brief note' },
    { from: /\bhelp\b/gi, to: 'support' },
    { from: /\bshow\b/gi, to: 'share' },
    { from: /\bimprove\b/gi, to: 'strengthen' },
  ]
  let output = protectedBody.text
  const pick = parseInt(hash(seed, 8), 16)
  for (let i = 0; i < variants.length; i++) {
    if ((pick + i) % 3 === 0) output = output.replace(variants[i]!.from, variants[i]!.to)
  }
  return normalizeWhitespace(restoreBody(output, protectedBody.segments))
}

export class LocalTransformerClient {
  private readonly endpoint: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(input?: { endpoint?: string; model?: string; timeoutMs?: number }) {
    this.endpoint = input?.endpoint ?? process.env.CONTENT_MUTATION_ENDPOINT ?? 'http://127.0.0.1:11434/api/generate'
    this.model = input?.model ?? process.env.CONTENT_MUTATION_MODEL ?? 'llama3:8b'
    this.timeoutMs = input?.timeoutMs ?? envInt('CONTENT_MUTATION_TIMEOUT_MS', 12_000)
  }

  async generate(prompt: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const openAiCompatible = /\/v1\/chat\/completions\/?$/i.test(this.endpoint)
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          openAiCompatible
            ? {
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: Number(process.env.CONTENT_MUTATION_TEMPERATURE ?? 0.72),
                top_p: Number(process.env.CONTENT_MUTATION_TOP_P ?? 0.9),
              }
            : {
                model: this.model,
                prompt,
                stream: false,
                options: {
                  temperature: Number(process.env.CONTENT_MUTATION_TEMPERATURE ?? 0.72),
                  top_p: Number(process.env.CONTENT_MUTATION_TOP_P ?? 0.9),
                },
              }
        ),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`local_llm_http_${res.status}`)
      const json = (await res.json()) as {
        response?: string
        text?: string
        output?: string
        choices?: Array<{ message?: { content?: string }; text?: string }>
      }
      return String(json.response ?? json.text ?? json.output ?? json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '').trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

export class ContentMutationService {
  private readonly redis: RedisLike
  private readonly llm: LocalTransformerClient
  private readonly enabled: boolean
  private readonly region: string
  private readonly poolSize: number
  private readonly poolTtlSec: number
  private readonly fillPerLock: number
  private readonly lockTtlSec: number

  constructor(input: {
    redis: RedisLike
    llm?: LocalTransformerClient
    region?: string
    enabled?: boolean
    poolSize?: number
    poolTtlSec?: number
    fillPerLock?: number
  }) {
    this.redis = input.redis
    this.llm = input.llm ?? new LocalTransformerClient()
    this.enabled = input.enabled ?? envBool('CONTENT_MUTATION_ENABLED', false)
    this.region = input.region ?? process.env.XV_REGION ?? 'local'
    this.poolSize = input.poolSize ?? envInt('CONTENT_MUTATION_POOL_SIZE', 500)
    this.poolTtlSec = input.poolTtlSec ?? envInt('CONTENT_MUTATION_POOL_TTL_SEC', 60 * 60 * 24)
    this.fillPerLock = input.fillPerLock ?? envInt('CONTENT_MUTATION_FILL_PER_LOCK', this.poolSize)
    this.lockTtlSec = envInt('CONTENT_MUTATION_LOCK_TTL_SEC', 10 * 60)
  }

  poolKey(input: ContentMutationInput) {
    const body = input.text || input.html || ''
    const scope = [
      input.clientId,
      input.campaignId ?? 'global',
      input.sequenceStep ?? 0,
      hash(`${input.subject}\n${body}`, 16),
    ].join(':')
    return `xv:${this.region}:content_mutation:pool:${scope}`
  }

  async mutateForSend(input: ContentMutationInput): Promise<ContentMutationResult> {
    const body = input.text || input.html || ''
    if (!this.enabled || !body.trim()) {
      return { subject: input.subject, text: input.text, html: input.html, mutated: false, source: 'disabled' }
    }

    const poolKey = this.poolKey(input)
    void this.ensurePool(input).catch(() => {})

    const pooled = await this.redis.srandmember(poolKey).catch(() => null)
    const seed = `${input.queueJobId ?? ''}:${input.recipientEmail ?? ''}:${Date.now()}`
    const baseVariant = this.parsePoolMember(pooled) ?? body
    const jittered = deterministicMicroEdit(baseVariant, seed)
    const warnings = validateImmutableSegments(body, jittered)

    if (warnings.length) {
      return {
        subject: input.subject,
        text: input.text ? deterministicMicroEdit(body, seed) : input.text,
        html: input.html,
        mutated: Boolean(input.text),
        source: 'fallback',
        poolKey,
        variantHash: hash(body),
        safetyWarnings: warnings,
      }
    }

    return {
      subject: input.subject,
      text: input.text ? jittered : input.text,
      html: input.html && !input.text ? jittered : input.html,
      mutated: true,
      source: pooled ? 'pool' : 'fallback',
      poolKey,
      variantHash: hash(jittered),
    }
  }

  async ensurePool(input: ContentMutationInput): Promise<void> {
    if (!this.enabled) return
    const poolKey = this.poolKey(input)
    const current = await this.redis.scard(poolKey).catch(() => 0)
    if (current >= this.poolSize) return

    const lockKey = `${poolKey}:lock`
    const lock = await this.redis.set(lockKey, '1', 'EX', this.lockTtlSec, 'NX').catch(() => null)
    if (!lock) return

    const target = Math.min(this.poolSize - current, this.fillPerLock)
    await this.fillPool(input, poolKey, target)
  }

  private async fillPool(input: ContentMutationInput, poolKey: string, target: number) {
    const body = input.text || input.html || ''
    const protectedBody = protectBody(body)
    const prompt = promptForVariation({
      protectedBody: protectedBody.text,
      subject: input.subject,
      ctaText: input.ctaText,
    })

    const candidates: string[] = []
    for (let i = 0; i < target; i++) {
      try {
        const raw = await this.llm.generate(`${prompt}\n\nVariation number: ${i + 1}`)
        const restored = normalizeWhitespace(restoreBody(raw, protectedBody.segments))
        const warnings = validateImmutableSegments(body, restored)
        if (!warnings.length && restored && restored !== body) candidates.push(restored)
      } catch {
        candidates.push(deterministicMicroEdit(body, `${poolKey}:${i}`))
        await sleep(5)
      }
    }

    const unique = Array.from(new Set(candidates)).slice(0, target)
    if (!unique.length) return

    await this.redis.sadd(
      poolKey,
      ...unique.map((candidate) =>
        JSON.stringify({
          body: candidate,
          hash: hash(candidate),
          createdAt: new Date().toISOString(),
          source: 'local_transformer',
        })
      )
    )
    await this.redis.expire(poolKey, this.poolTtlSec)
  }

  private parsePoolMember(raw: string | null): string | null {
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as { body?: unknown }
      const body = typeof parsed.body === 'string' ? parsed.body : ''
      return body.trim() ? body : null
    } catch {
      return null
    }
  }
}
