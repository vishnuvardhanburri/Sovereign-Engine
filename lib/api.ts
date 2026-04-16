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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Request failed for ${url}`)
  }

  return response.json()
}

function toCampaign(row: any): Campaign {
  return {
    id: String(row.id),
    name: row.name,
    sequenceId: String(row.sequence_id),
    sequenceName: row.sequence_name,
    contactCount: Number(row.contact_count ?? 0),
    status: row.status,
    sent: Number(row.sent_count ?? 0),
    replies: Number(row.reply_count ?? 0),
    openRate:
      Number(row.sent_count ?? 0) > 0
        ? Math.round((Number(row.open_count ?? 0) / Number(row.sent_count)) * 100)
        : 0,
    bounceRate:
      Number(row.sent_count ?? 0) > 0
        ? Number(
            ((Number(row.bounce_count ?? 0) / Number(row.sent_count)) * 100).toFixed(2)
          )
        : 0,
    createdAt: new Date(row.created_at),
  }
}

function toContact(row: any): Contact {
  return {
    id: String(row.id),
    email: row.email,
    name: row.name ?? '',
    company: row.company ?? '',
    status: row.status,
    addedAt: new Date(row.created_at),
  }
}

function toSequence(row: any): Sequence {
  return {
    id: String(row.id),
    name: row.name,
    steps: (row.steps ?? []).map((step: any) => ({
      id: String(step.id),
      day: Number(step.day_delay ?? 0),
      subject: step.subject,
      body: step.body,
    })),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function toReply(row: any): Reply {
  const metadata = row.metadata ?? {}
  const messages = Array.isArray(metadata.messages)
    ? metadata.messages.map((message: any, index: number) => ({
        id: String(message.id ?? `${row.id}-${index}`),
        from: message.from ?? row.from_email,
        to: message.to ?? '',
        subject: message.subject ?? row.subject,
        body: message.body ?? '',
        date: new Date(message.date ?? row.date),
        isIncoming: message.isIncoming ?? true,
      }))
    : [
        {
          id: `${row.id}-0`,
          from: row.from_email,
          to: '',
          subject: row.subject,
          body: metadata.body ?? '',
          date: new Date(row.date),
          isIncoming: true,
        },
      ]

  return {
    id: String(row.id),
    fromEmail: row.from_email,
    fromName: row.from_name ?? row.from_email,
    subject: row.subject,
    date: new Date(row.date),
    status: row.status,
    campaignId: String(row.campaign_id ?? ''),
    contactId: String(row.contact_id ?? ''),
    messages,
  }
}

export const api = {
  campaigns: {
    async getAll() {
      const rows = await fetchJson<any[]>('/api/campaigns')
      return rows.map(toCampaign)
    },
    async getById(id: string) {
      const row = await fetchJson<any>(`/api/campaigns/${id}`)
      return toCampaign(row)
    },
    async create(data: { name: string; sequenceId: string; sequenceName?: string }) {
      const row = await fetchJson<any>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          sequenceId: Number(data.sequenceId),
        }),
      })
      return toCampaign({
        ...row,
        sequence_name: data.sequenceName ?? '',
      })
    },
    async updateStatus(id: string, status: Campaign['status']) {
      const row = await fetchJson<any>(`/api/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      return toCampaign(row)
    },
  },
  contacts: {
    async getAll() {
      const response = await fetchJson<any>('/api/contacts?limit=100')
      return (response.data ?? []).map(toContact)
    },
    async bulkCreate(data: Array<{ email: string; name: string; company: string }>) {
      const rows = await fetchJson<any[]>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ contacts: data }),
      })
      return rows.map(toContact)
    },
    async delete(id: string) {
      return fetchJson<{ success: boolean }>(`/api/contacts/${id}`, {
        method: 'DELETE',
      })
    },
  },
  sequences: {
    async getAll() {
      const rows = await fetchJson<any[]>('/api/sequences')
      return rows.map(toSequence)
    },
    async getById(id: string) {
      const row = await fetchJson<any>(`/api/sequences/${id}`)
      return toSequence(row)
    },
    async create(data: { name: string; steps: SequenceStep[] }) {
      const row = await fetchJson<any>('/api/sequences', {
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
    async update(id: string, data: { name: string; steps: SequenceStep[] }) {
      const row = await fetchJson<any>(`/api/sequences/${id}`, {
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
    async getAll() {
      const response = await fetchJson<any>('/api/replies?limit=100')
      return (response.data ?? []).map(toReply)
    },
    async getById(id: string) {
      const row = await fetchJson<any>(`/api/replies/${id}`)
      return toReply(row)
    },
    async updateStatus(
      id: string,
      status: 'unread' | 'interested' | 'not_interested'
    ) {
      const row = await fetchJson<any>(`/api/replies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      return row
    },
  },
  analytics: {
    async getAll() {
      return fetchJson<AnalyticsData[]>('/api/analytics')
    },
    async getSummary() {
      return fetchJson<AnalyticsData[]>('/api/analytics')
    },
    async getChartData() {
      return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
    },
  },
  activity: {
    async getRecent() {
      const rows = await fetchJson<any[]>('/api/dashboard/activity')
      return rows.map((row) => ({
        ...row,
        timestamp: new Date(row.timestamp),
      }))
    },
  },
  dashboard: {
    async getStats() {
      return fetchJson<{
        emailsSentToday: number
        replies: number
        openRate: number
        bounceRate: number
      }>('/api/dashboard/stats')
    },
    async getChartData() {
      return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
    },
    async getActivityFeed() {
      const rows = await fetchJson<any[]>('/api/dashboard/activity')
      return rows.map((row) => ({
        ...row,
        timestamp: new Date(row.timestamp),
      }))
    },
  },
  inbox: {
    async getReplies() {
      const response = await fetchJson<any>('/api/replies?limit=100')
      return (response.data ?? []).map(toReply)
    },
  },
  domains: {
    async getAll() {
      return fetchJson<any[]>('/api/domains')
    },
  },
}

export const api_getStats = async () => {
  return fetchJson<{
    emailsSentToday: number
    replies: number
    openRate: number
    bounceRate: number
  }>('/api/dashboard/stats')
}

export const api_getChartData = async () => {
  return fetchJson<Array<{ date: string; sent: number }>>('/api/dashboard/chart')
}
