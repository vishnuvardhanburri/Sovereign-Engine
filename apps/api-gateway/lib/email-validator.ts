/**
 * EMAIL QUALITY PRE-SEND VALIDATION
 * Validates email before SMTP send
 * Falls back to safe template if quality fails
 */

import { generateFallbackEmail } from '@/lib/failsafe'
import { Contact, SequenceStep } from '@/lib/db/types'

export interface EmailValidation {
  isValid: boolean
  quality: number // 0-100
  issues: string[]
  wouldBeFlagged: boolean
  fallbackRequired: boolean
}

export interface ValidatedEmail {
  subject: string
  body: string
  usedFallback: boolean
  validation: EmailValidation
}

function validateLineCount(body: string): { valid: boolean; issue?: string } {
  const lines = body.split('\n').filter(l => l.trim())
  if (lines.length > 5) {
    return { valid: false, issue: `Email has ${lines.length} lines (max 5)` }
  }
  return { valid: true }
}

function validateLength(body: string): { valid: boolean; issue?: string } {
  if (body.length > 700) {
    return { valid: false, issue: `Email is ${body.length} chars (max 700)` }
  }
  return { valid: true }
}

function validateQuestion(body: string): { valid: boolean; issue?: string } {
  const trimmed = body.trim()
  if (!trimmed.endsWith('?')) {
    return { valid: false, issue: 'Email must end with a question' }
  }
  return { valid: true }
}

function validatePersonalization(body: string): { valid: boolean; issue?: string } {
  // Check if personalized OR uses variables
  const hasVariables = /\{\{.+?\}\}/.test(body)
  const mentionsRecipient = /you|your|we|us/.test(body.toLowerCase())
  
  if (!hasVariables && !mentionsRecipient) {
    return { valid: false, issue: 'Email lacks personalization or pronouns' }
  }
  return { valid: true }
}

function validateSpamSignals(subject: string, body: string): { issues: string[] } {
  const issues: string[] = []
  const fullText = `${subject}\n${body}`.toLowerCase()
  
  // Check for promotional keywords
  const promoKeywords = [
    'free', 'discount', 'buy now', 'click here', 'limited time',
    'urgent', 'act now', 'guarantee', 'risk free'
  ]
  
  for (const keyword of promoKeywords) {
    if (fullText.includes(keyword)) {
      issues.push(`Promotional keyword: "${keyword}"`)
    }
  }
  
  // Check for excessive caps
  const capsRatio = (subject.match(/[A-Z]/g) || []).length / subject.length
  if (capsRatio > 0.3) {
    issues.push('Subject has excessive capital letters')
  }
  
  // Check for excessive punctuation
  const exclamations = (body.match(/!/g) || []).length
  if (exclamations > 3) {
    issues.push(`Too many exclamation marks (${exclamations})`)
  }
  
  // Check for links
  const links = (body.match(/https?:\/\//g) || []).length
  if (links > 2) {
    issues.push(`Too many links (${links}, max 2)`)
  }
  
  return { issues }
}

export function validateEmail(input: {
  subject: string
  body: string
  contact: Pick<Contact, 'name' | 'company' | 'title'>
}): EmailValidation {
  const issues: string[] = []
  let quality = 100
  
  // Validate structure
  const lineCheck = validateLineCount(input.body)
  if (!lineCheck.valid) {
    issues.push(lineCheck.issue!)
    quality -= 25
  }
  
  const lengthCheck = validateLength(input.body)
  if (!lengthCheck.valid) {
    issues.push(lengthCheck.issue!)
    quality -= 20
  }
  
  const questionCheck = validateQuestion(input.body)
  if (!questionCheck.valid) {
    issues.push(questionCheck.issue!)
    quality -= 20
  }
  
  // Validate personalization
  const personalizationCheck = validatePersonalization(input.body)
  if (!personalizationCheck.valid) {
    issues.push(personalizationCheck.issue!)
    quality -= 15
  }
  
  // Check spam signals
  const spamCheck = validateSpamSignals(input.subject, input.body)
  for (const issue of spamCheck.issues) {
    issues.push(issue)
    quality -= 5
  }
  
  // Determine if Gmail would flag it
  const wouldBeFlagged = quality < 60 || issues.length > 3
  
  // Determine if fallback is needed
  const fallbackRequired = quality < 40 || !lineCheck.valid || !questionCheck.valid
  
  return {
    isValid: quality >= 60 && issues.length === 0,
    quality: Math.max(0, quality),
    issues,
    wouldBeFlagged,
    fallbackRequired,
  }
}

export function validateAndSafeEmail(input: {
  subject: string
  body: string
  contact: Contact
}): ValidatedEmail {
  const validation = validateEmail({
    subject: input.subject,
    body: input.body,
    contact: input.contact,
  })
  
  // If quality too low, use fallback
  if (validation.fallbackRequired) {
    const fallback = generateFallbackEmail({
      contact_name: input.contact.name,
      company: input.contact.company,
      title: input.contact.title,
    })
    
    return {
      subject: fallback.subject,
      body: fallback.body,
      usedFallback: true,
      validation,
    }
  }
  
  return {
    subject: input.subject,
    body: input.body,
    usedFallback: false,
    validation,
  }
}

export function formatValidationForLogging(validation: EmailValidation): string {
  const lines: string[] = [
    `Quality: ${validation.quality}/100`,
    `Valid: ${validation.isValid}`,
  ]
  
  if (validation.wouldBeFlagged) {
    lines.push('⚠️ Gmail flagging risk')
  }
  
  if (validation.fallbackRequired) {
    lines.push('🔄 Fallback will be used')
  }
  
  if (validation.issues.length > 0) {
    lines.push('Issues:')
    for (const issue of validation.issues) {
      lines.push(`  • ${issue}`)
    }
  }
  
  return lines.join('\n')
}
