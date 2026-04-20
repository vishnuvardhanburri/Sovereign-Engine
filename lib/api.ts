import { z } from 'zod'

export interface Campaign {
  id: string
  name: string
  sequenceId: string
  sequenceName: string
  contactCount: number
  status: 'draft' | 'active' | 'paused' | 'completed'
  sent: number
  replies: number
  openRate: number
  bounceRate: number
  createdAt: Date
}

export interface Contact {
  id: string
  email: string
  name: string
  company: string
  status: 'active' | 'replied' | 'bounced' | 'unsubscribed'
  addedAt: Date
}

export interface SequenceStep {
  id: string
  day: number
  subject: string
  body: string
}

export interface Sequence {
  id: string
  name: string
  steps: SequenceStep[]
  createdAt: Date
  updatedAt: Date
}

export interface ReplyMessage {
  id: string
  from: string
  to: string
  subject: string
  body: string
  date: Date
  isIncoming: boolean
}

export interface Reply {
  id: string
  fromEmail: string
  fromName: string
  subject: string
  date: Date
  status: 'unread' | 'interested' | 'not_interested'
  campaignId: string
  contactId: string
  messages: ReplyMessage[]
}

export interface AnalyticsData {
  campaignName: string
  repliesCount: number
  replyRate: number
  bounceRate: number
  openRate: number
  sentCount: number
}

const campaignSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  sequence_id: z.union([z.string(), z.number()]).transform(String),
  sequence_name: z.string(),
  contact_count: z.coerce.number().nonnegative(),
  status: z.enum(['draft', 'active', 'paused', 'completed']),
  sent_count: z.coerce.number().nonnegative(),
  reply_count: z.coerce.number().nonnegative(),
  open_count: z.coerce.number().nonnegative(),
  bounce_count: z.coerce.number().nonnegative(),
  created_at: z.string(),
})

const contactSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  email: z.string().email(),
  name: z.string().nullable().optional().default(''),
  company: z.string().nullable().optional().default(''),
  status: z.enum(['active', 'replied', 'bounced', 'unsubscribed']),
  created_at: z.string(),
})

const sequenceSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  steps: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      day_delay: z.coerce.number().nonnegative(),
      subject: z.string(),
      body: z.string(),
    })
  ).default([]),
})

const replySchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  from_email: z.string().email(),
  from_name: z.string().nullable().optional().default(''),
  subject: z.string(),
  date: z.string(),
  status: z.enum(['unread', 'interested', 'not_interested']),
  campaign_id: z.union([z.string(), z.number()]).nullable().optional(),
  contact_id: z.union([z.string(), z.number()]).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `Request failed for ${url}`)
  }

  return (await response.json()) as T
}

function toCampaign(row: unknown): Campaign {
  const parsed = campaignSchema.parse(row)
  return {
    id: parsed.id,
    name: parsed.name,
    sequenceId: parsed.sequence_id,
    sequenceName: parsed.sequence_name,
    contactCount: parsed.contact_count,
    status: parsed.status,
    sent: parsed.sent_count,
    replies: parsed.reply_count,
    openRate: parsed.sent_count > 0 ? Math.round((parsed.open_count / parsed.sent_count) * 100) : 0,
    bounceRate: parsed.sent_count > 0 ? Number(((parsed.bounce_count / parsed.sent_count) * 100).toFixed(2)) : 0,
    createdAt: new Date(parsed.created_at),
  }
}

function toContact(row: unknown): Contact {
  const parsed = contactSchema.parse(row)
  return {
    id: parsed.id,
    email: parsed.email,
    name: parsed.name ?? '',
    company: parsed.company ?? '',
    status: parsed.status,
    addedAt: new Date(parsed.created_at),
  }
}

function toSequence(row: unknown): Sequence {
  const parsed = sequenceSchema.parse(row)
  return {
    id: parsed.id,
    name: parsed.name,
    steps: parsed.steps.map((step) => ({
      id: step.id,
      day: step.day_delay,
      subject: step.subject,
      body: step.body,
    })),
    createdAt: new Date(parsed.created_at),
    updatedAt: new Date(parsed.updated_at),
  }
}

function toReply(row: unknown): Reply {
  const parsed = replySchema.parse(row)
  const metadata = parsed.metadata ?? {}
  const rawMessages = Array.isArray((metadata as { messages?: unknown }).messages)
    ? ((metadata as { messages?: unknown[] }).messages as unknown[])
    : []

  const messages: ReplyMessage[] =
    rawMessages.length > 0
      ? rawMessages.map((message, index) => {
          const data = message as Record<string, unknown>
          return {
            id: String(data.id ?? `${parsed.id}-${index}`),
            from: String(data.from ?? parsed.from_email),
            to: String(data.to ?? ''),
            subject: String(data.subject ?? parsed.subject),
            body: String(data.body ?? ''),
            date: new Date(String(data.date ?? parsed.date)),
            isIncoming: data.isIncoming === false ? false : true,
          }
        })
      : [
          {
            id: `${parsed.id}-0`,
            from: parsed.from_email,
            to: '',
            subject: parsed.subject,
            body: '',
            date: new Date(parsed.date),
            isIncoming: true,
          },
        ]

  return {
    id: parsed.id,
    fromEmail: parsed.from_email,
    fromName: parsed.from_name || parsed.from_email,
    subject: parsed.subject,
    date: new Date(parsed.date),
    status: parsed.status,
    campaignId: String(parsed.campaign_id ?? ''),
    contactId: String(parsed.contact_id ?? ''),
    messages,
  }
}

type ActivityRow = { timestamp: string; [key: string]: unknown }

export const api = {
  campaigns: {
    async getAll(): Promise<Campaign[]> {
      const rows = await fetchJson<unknown[]>('/api/campaigns')
      return rows.map(toCampaign)
    },
    async getById(id: string): Promise<Campaign> {
      const row = await fetchJson<unknown>(`/api/campaigns/${id}`)
      return toCampaign(row)
    },
    async create(data: { name: string; sequenceId: string; sequenceName?: string }): Promise<Campaign> {
      const row = await fetchJson<unknown>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          sequenceId: Number(data.sequenceId),
        }),
      })
      return toCampaign({
        ...(row as Record<string, unknown>),
        sequence_name: data.sequenceName ?? '',
      })
    },
    async updateStatus(id: string, status: Campaign['status']): Promise<Campaign> {
      const row = await fetchJson<unknown>(`/api/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      return toCampaign(row)
    },
  },
  contacts: {
    async getAll(): Promise<Contact[]> {
      const response = await fetchJson<{ data?: unknown[] }>('/api/contacts?limit=100')
      return (response.data ?? []).map(toContact)
    },
    async bulkCreate(data: Array<{ email: string; name: string; company: string }>): Promise<Contact[]> {
      const rows = await fetchJson<unknown[]>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ contacts: data }),
      })
      return rows.map(toContact)
    },
    async delete(id: string): Promise<{ success: boolean }> {
      return fetchJson<{ success: boolean }>(`/api/contacts/${id}`, {
        method: 'DELETE',
      })
    },
  },
  sequences: {
    async getAll(): Promise<Sequence[]> {
      const rows = await fetchJson<unknown[]>('/api/sequences')
      return rows.map(toSequence)
    },
    async getById(id: string): Promise<Sequence> {
      const row = await fetchJson<unknown>(`/api/sequences/${id}`)
      return toSequence(row)
    },
    async create(data: { name: string; steps: SequenceStep[] }): Promise<Sequence> {
      const row = await fetchJson<unknown>('/api/sequences', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          steps: data.steps.map((step) => ({
            day: step.day,
            subject: step.subject,
            body: step.body,
          })),
        }),
      })
      return toSequence(row)
    },
    async update(id: string, data: { name: string; steps: SequenceStep[] }): Promise<Sequence> {
      const row = await fetchJson<unknown>(`/api/sequences/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: data.name,
          steps: data.steps.map((step) => ({
            day: step.day,
            subject: step.subject,
            body: step.body,
          })),
        }),
      })
      return toSequence(row)
    },
  },
  replies: {
    async getAll(): Promise<Reply[]> {
      const response = await fetchJson<{ data?: unknown[] }>('/api/replies?limit=100')
      return (response.data ?? []).map(toReply)
    },
    async getById(id: string): Promise<Reply> {
      const row = await fetchJson<unknown>(`/api/replies/${id}`)
      return toReply(row)
    },
    async updateStatus(
      id: string,
      status: 'unread' | 'interested' | 'not_interested'
    ): Promise<{ success: boolean }> {
      return fetchJson<{ success: boolean }>(`/api/replies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
    },
  },
  analytics: {
    async getAll(): Promise<AnalyticsData[]> {
      return fetchJson<AnalyticsData[]>('/api/analytics')
    },
    async getSummary(): Promise<AnalyticsData[]> {
      return fetchJson<AnalyticsData[]>('/api/analytics')
    },
    async getChartData(): Promise<Array<{ date: string; sent: number }>> {
      return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
    },
  },
  activity: {
    async getRecent(): Promise<Array<Omit<ActivityRow, 'timestamp'> & { timestamp: Date }>> {
      const rows = await fetchJson<ActivityRow[]>('/api/dashboard/activity')
      return rows.map((row) => ({
        ...row,
        timestamp: new Date(row.timestamp),
      }))
    },
  },
  dashboard: {
    async getStats(): Promise<{
      emailsSentToday: number
      replies: number
      openRate: number
      bounceRate: number
    }> {
      return fetchJson<{
        emailsSentToday: number
        replies: number
        openRate: number
        bounceRate: number
      }>('/api/dashboard/stats')
    },
    async getChartData(): Promise<Array<{ date: string; sent: number }>> {
      return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
    },
    async getActivityFeed(): Promise<Array<Omit<ActivityRow, 'timestamp'> & { timestamp: Date }>> {
      const rows = await fetchJson<ActivityRow[]>('/api/dashboard/activity')
      return rows.map((row) => ({
        ...row,
        timestamp: new Date(row.timestamp),
      }))
    },
  },
  inbox: {
    async getReplies(): Promise<Reply[]> {
      const response = await fetchJson<{ data?: unknown[] }>('/api/replies?limit=100')
      return (response.data ?? []).map(toReply)
    },
  },
  domains: {
    async getAll(): Promise<unknown[]> {
      return fetchJson<unknown[]>('/api/domains')
    },
  },
}

export const api_getStats = async (): Promise<{
  emailsSentToday: number
  replies: number
  openRate: number
  bounceRate: number
}> => {
  return fetchJson<{
    emailsSentToday: number
    replies: number
    openRate: number
    bounceRate: number
  }>('/api/dashboard/stats')
}

export const api_getChartData = async (): Promise<Array<{ date: string; sent: number }>> => {
  return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
}
