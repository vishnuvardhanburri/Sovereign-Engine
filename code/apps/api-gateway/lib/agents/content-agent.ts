interface ContentRequest {
  recipientName?: string | null
  recipientCompany?: string | null
  recipientTitle?: string | null
  industry?: string | null
  campaignOffer: string
  senderName: string
  senderCompany: string
  tone?: 'casual' | 'professional' | 'friendly'
  previous_subject?: string
}

interface GeneratedContent {
  subject: string
  body: string
  personalizations: string[]
}

export async function generateRealisticEmail(request: ContentRequest): Promise<GeneratedContent> {
  const firstName = request.recipientName?.split(' ')[0] || 'there'
  const company = request.recipientCompany || 'your team'

  return {
    subject: request.previous_subject ? `Re: ${request.previous_subject}` : `Quick idea for ${company}`,
    body: [
      `Hi ${firstName},`,
      `saw what ${company} is building and thought of a simple idea.`,
      `${request.senderName} here from ${request.senderCompany}.`,
      `Worth a quick look?`,
    ].join('\n'),
    personalizations: ['FirstName', 'Company'],
  }
}

export async function generateSubjectLineVariations(request: {
  recipientCompany?: string | null
  recipientTitle?: string | null
  campaignOffer: string
  count?: number
}): Promise<string[]> {
  const company = request.recipientCompany || 'your team'
  return [
    `Quick idea for ${company}`,
    `${request.recipientTitle || 'there'}, quick question`,
    `Regarding ${company} growth`,
  ].slice(0, request.count || 3)
}
