import { z } from 'zod'

export type CommandAction =
  | 'create_campaign'
  | 'pause_campaign'
  | 'adjust_send_rate'
  | 'get_status'

export type CommandIntent = 'outbound' | 'risk_mitigation' | 'reporting'

export const CommandFilterSchema = z.object({
  titleContains: z.string().trim().min(1).optional(),
  companyContains: z.string().trim().min(1).optional(),
  emailDomainIn: z.array(z.string().trim().min(1)).optional(),
  timezoneIn: z.array(z.string().trim().min(1)).optional(),
  verificationStatusIn: z.array(z.string().trim().min(1)).optional(),
  statusIn: z.array(z.string().trim().min(1)).optional(),
  sourceIn: z.array(z.string().trim().min(1)).optional(),
  limit: z.number().int().min(1).max(50_000).optional(),
})

export type CommandFilters = z.infer<typeof CommandFilterSchema>

export const ParsedCommandSchema = z.object({
  raw: z.string(),
  action: z.enum(['create_campaign', 'pause_campaign', 'adjust_send_rate', 'get_status']),
  intent: z.enum(['outbound', 'risk_mitigation', 'reporting']),
  audience: z
    .object({
      label: z.string().trim().min(1).optional(),
      filters: CommandFilterSchema.optional(),
    })
    .optional(),
  params: z
    .object({
      campaignId: z.number().int().positive().optional(),
      campaignName: z.string().trim().min(1).optional(),
      sequenceId: z.number().int().positive().optional(),
      campaignNameNew: z.string().trim().min(1).optional(),
      dailyTarget: z.number().int().min(1).max(5000).optional(),
      sendRateMode: z.enum(['reduce_20pct', 'increase_10pct', 'set']).optional(),
      dailyLimit: z.number().int().min(1).max(50_000).optional(),
      domainId: z.number().int().positive().optional(),
    })
    .optional(),
})

export type ParsedCommand = z.infer<typeof ParsedCommandSchema>

function normalize(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function parseKeyValueFilters(text: string): CommandFilters {
  // Simple, deterministic parser. Examples:
  // "title:CTO company:Acme tz:America/New_York domain:gmail.com,example.com limit:500"
  const filters: CommandFilters = {}

  const kv = (key: string): string[] => {
    const re = new RegExp(String.raw`(?:^|\s)${key}\s*:\s*([^\s]+)`, 'i')
    const m = text.match(re)
    if (!m?.[1]) return []
    return m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  const title = kv('title')[0]
  if (title) filters.titleContains = title.replaceAll('_', ' ')

  const company = kv('company')[0]
  if (company) filters.companyContains = company.replaceAll('_', ' ')

  const tz = kv('tz')
  if (tz.length) filters.timezoneIn = tz

  const domains = kv('domain')
  if (domains.length) filters.emailDomainIn = domains

  const sources = kv('source')
  if (sources.length) filters.sourceIn = sources

  const limitRaw = kv('limit')[0]
  if (limitRaw) {
    const n = Number.parseInt(limitRaw, 10)
    if (Number.isFinite(n) && n > 0) filters.limit = Math.min(50_000, n)
  }

  // Safe defaults for outbound.
  if (!filters.statusIn) filters.statusIn = ['active']
  if (!filters.verificationStatusIn) filters.verificationStatusIn = ['valid', 'pending', 'unknown', 'catch_all']

  return CommandFilterSchema.parse(filters)
}

export function parseCommand(rawInput: string): { ok: true; command: ParsedCommand } | { ok: false; error: string } {
  const raw = normalize(String(rawInput ?? ''))
  if (!raw) return { ok: false, error: 'Command is empty' }

  const lower = raw.toLowerCase()

  // Action detection
  let action: CommandAction = 'get_status'
  let intent: CommandIntent = 'reporting'

  if (/(create|start|launch|run)\s+(a\s+)?campaign/.test(lower) || /\bsend\b/.test(lower)) {
    action = 'create_campaign'
    intent = 'outbound'
  } else if (/\bpause\b/.test(lower) && /\bcampaign\b/.test(lower)) {
    action = 'pause_campaign'
    intent = 'risk_mitigation'
  } else if (/(adjust|reduce|increase|set)\s+send\s+rate/.test(lower) || /\bsend\s+rate\b/.test(lower)) {
    action = 'adjust_send_rate'
    intent = 'risk_mitigation'
  } else if (/(status|health|risk|summary)/.test(lower)) {
    action = 'get_status'
    intent = 'reporting'
  }

  const params: Record<string, unknown> = {}
  const audience: { label?: string; filters?: CommandFilters } = {}

  // campaignId parsing
  const idMatch = raw.match(/\bcampaign\s+#?(\d+)\b/i)
  if (idMatch?.[1]) params.campaignId = Number.parseInt(idMatch[1], 10)

  // sequenceId parsing
  const seqMatch = raw.match(/\b(?:sequence|seq)\s*(?:[:#]?\s*)?(\d+)\b/i)
  if (seqMatch?.[1]) params.sequenceId = Number.parseInt(seqMatch[1], 10)

  // dailyTarget parsing: "daily:200" or "perday:200"
  const dailyMatch = raw.match(/\b(daily|perday)\s*:\s*(\d+)\b/i)
  if (dailyMatch?.[2]) params.dailyTarget = Number.parseInt(dailyMatch[2], 10)

  // send rate parsing: "reduce 20%" or "set send rate 500"
  if (action === 'adjust_send_rate') {
    if (/\breduce\b/.test(lower)) params.sendRateMode = 'reduce_20pct'
    if (/\bincrease\b/.test(lower)) params.sendRateMode = 'increase_10pct'
    const setMatch = raw.match(/\bset\b.*\b(\d{1,6})\b/)
    if (setMatch?.[1]) {
      params.sendRateMode = 'set'
      params.dailyLimit = Number.parseInt(setMatch[1], 10)
    }
    const domainIdMatch = raw.match(/\bdomain\s+#?(\d+)\b/i)
    if (domainIdMatch?.[1]) params.domainId = Number.parseInt(domainIdMatch[1], 10)
  }

  if (action === 'create_campaign') {
    // campaign name: quoted string or after "campaign"
    const quoted = raw.match(/"([^"]{3,80})"/)
    if (quoted?.[1]) {
      params.campaignNameNew = quoted[1].trim()
    } else {
      params.campaignNameNew = 'AI Campaign'
    }

    // Basic audience label inference
    const forMatch = raw.match(/\bfor\s+([a-z0-9 _-]{3,60})/i)
    if (forMatch?.[1]) audience.label = forMatch[1].trim()

    // Filters: key:value syntax is supported as an explicit, non-LLM escape hatch.
    audience.filters = parseKeyValueFilters(raw)
  }

  const parsed: ParsedCommand = {
    raw,
    action,
    intent,
    ...(Object.keys(audience).length ? { audience } : {}),
    ...(Object.keys(params).length ? { params: params as any } : {}),
  }

  try {
    return { ok: true, command: ParsedCommandSchema.parse(parsed) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
