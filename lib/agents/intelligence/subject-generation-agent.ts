import { generateSubjectLine } from '@/lib/ai/generator'

export async function suggestSubjectLines(input: {
  offer: string
  company?: string | null
  angle: 'pattern' | 'pain' | 'authority'
}) {
  return generateSubjectLine({
    contact: {
      id: 0,
      client_id: 0,
      email: 'placeholder@example.com',
      email_domain: 'example.com',
      name: null,
      company: input.company ?? null,
      company_domain: null,
      title: null,
      timezone: null,
      source: null,
      custom_fields: {},
      enrichment: null,
      verification_status: 'unknown',
      verification_sub_status: null,
      status: 'active',
      unsubscribed_at: null,
      bounced_at: null,
      created_at: '',
      updated_at: '',
    },
    angle: input.angle,
  }).result.subject as string
}
