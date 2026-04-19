/**
 * Claude-powered content agent for realistic, personalized emails
 * Generates subject lines and body copy that sound like a real person
 * Uses contact enrichment data for context-aware personalization
 */

import { appEnv } from '@/lib/env'

interface ContentRequest {
  recipientName?: string | null
  recipientCompany?: string | null
  recipientTitle?: string | null
  industry?: string | null
  campaignOffer: string // What you're selling/offering
  senderName: string
  senderCompany: string
  tone?: 'casual' | 'professional' | 'friendly' // default: friendly
  previous_subject?: string // Don't repeat
}

interface GeneratedContent {
  subject: string
  body: string
  personalizations: string[] // Variables used
}

const systemPrompt = `You are an expert email copywriter who writes emails that feel like they're from a real person reaching out personally.

Rules for your emails:
1. Write in FIRST PERSON ("I", "we") - sound human, not corporate
2. Keep subject lines SHORT and NATURAL (5-7 words max)
3. Body must be EXACTLY 3-5 lines max (concise, scannable)
4. Always include ONE personalization variable (use {{VariableName}} format)
5. End with a QUESTION to prompt response
6. NO generic phrases like "I wanted to reach out", "I came across your profile"
7. Focus on THEIR situation, not your features
8. Be specific - reference their company/role/industry
9. Include a REASON why you're reaching out to them specifically
10. Never use ALL CAPS, excessive punctuation, or sales-y language

Personalization variables you can use:
- {{FirstName}} - recipient's first name
- {{Company}} - recipient's company
- {{Title}} - recipient's job title
- {{LinkedInUrl}} - their LinkedIn profile

Output format:
SUBJECT: [subject line only]
BODY:
[body text here]
VARIABLES: [list variables used]`;

async function callClaude(userPrompt: string): Promise<string> {
  const apiKey = appEnv.openRouterApiKey()
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set - cannot generate content')
  }
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': appEnv.appBaseUrl(),
    },
    body: JSON.stringify({
      model: 'claude-3.5-sonnet',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.9, // Creative but not random
      max_tokens: 400,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${response.status} ${error}`)
  }
  
  const result = await response.json()
  return result.choices[0].message.content
}

export async function generateRealisticEmail(request: ContentRequest): Promise<GeneratedContent> {
  const contextParts: string[] = []
  
  if (request.recipientName) {
    contextParts.push(`Recipient: ${request.recipientName}`)
  }
  if (request.recipientCompany) {
    contextParts.push(`Company: ${request.recipientCompany}`)
  }
  if (request.recipientTitle) {
    contextParts.push(`Role: ${request.recipientTitle}`)
  }
  if (request.industry) {
    contextParts.push(`Industry: ${request.industry}`)
  }
  
  const context = contextParts.join(' | ')
  
  const userPrompt = `
Generate a realistic cold email for:
${context}

Sender: ${request.senderName} from ${request.senderCompany}
Offer/Goal: ${request.campaignOffer}
Tone: ${request.tone || 'friendly'}
${request.previous_subject ? `Don't use this subject: "${request.previous_subject}"` : ''}

The email should feel personal and genuine, like one professional reaching out to another.
Include specific details about their role/company to show you did your homework.
`;

  const response = await callClaude(userPrompt)
  
  // Parse response
  const subjectMatch = response.match(/SUBJECT:\s*(.+?)(?:\n|$)/)
  const bodyMatch = response.match(/BODY:\s*([\s\S]*?)(?:VARIABLES:|$)/)
  const variablesMatch = response.match(/VARIABLES:\s*(.+?)(?:\n|$)/)
  
  const subject = (subjectMatch?.[1] || 'Check this out').trim()
  const body = (bodyMatch?.[1] || '').trim()
  const variablesStr = (variablesMatch?.[1] || '').trim()
  
  const personalizations = variablesStr
    .split(/[,\n]+/)
    .map(v => v.trim())
    .filter(Boolean)
  
  // Validate email follows rules
  const lines = body.split('\n').filter(line => line.trim())
  if (lines.length > 5) {
    console.warn(`Email exceeds 5 lines (${lines.length}), truncating`)
  }
  
  return {
    subject,
    body: lines.slice(0, 5).join('\n'),
    personalizations,
  }
}

/**
 * Generate multiple subject line variations
 * User can A/B test which resonates better
 */
export async function generateSubjectLineVariations(request: {
  recipientCompany?: string | null
  recipientTitle?: string | null
  campaignOffer: string
  count?: number
}): Promise<string[]> {
  const count = request.count || 3
  
  const prompt = `Generate ${count} SHORT, natural subject lines (5-7 words each) for a cold email to:
${request.recipientTitle ? `${request.recipientTitle} at ` : ''}${request.recipientCompany || 'a company'}

Offer: ${request.campaignOffer}

Requirements:
- Feel PERSONAL, not generic/spammy
- Reference their role or company specifically  
- Create curiosity without being clickbait
- NO all-caps, NO emojis, NO question marks (except last one)
- Each on a new line, numbered

Return ONLY the numbered subject lines, nothing else.`;

  const response = await callClaude(prompt)
  
  const subjects = response
    .split('\n')
    .filter(line => line.match(/^\d+\./))
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .slice(0, count)
  
  return subjects
}
