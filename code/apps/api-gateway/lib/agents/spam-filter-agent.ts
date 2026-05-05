/**
 * Gmail & ISP Spam Filter Avoidance System
 * Detects patterns that trigger spam/promotion filters
 * Works with Gmail, Outlook, Yahoo, Apple Mail, etc.
 */

interface SpamRiskAnalysis {
  riskLevel: 'safe' | 'warning' | 'critical'
  issues: SpamIssue[]
  recommendations: string[]
  spamScore: number // 0-100, higher = more likely to be flagged
}

interface SpamIssue {
  type: 'content' | 'formatting' | 'headers' | 'links' | 'engagement'
  severity: 'low' | 'medium' | 'high'
  message: string
}

// Gmail and major ISP spam keywords
const PROMOTIONAL_KEYWORDS = [
  // High urgency
  'act now', 'limited time', 'urgent', 'only today', 'exclusive offer',
  'buy now', 'order now', 'shop now', 'get now',
  
  // Money/pricing language
  'free', 'discount', 'save', 'price', 'cost', 'cheap',
  'risk free', 'money back', 'guarantee', 'guaranteed',
  'double your', 'triple your', '100% free',
  
  // CTA heavy
  'click here', 'click now', 'call now', 'apply now',
  'sign up', 'register now', 'join now', 'enroll now',
  
  // Too sales-y
  'special offer', 'incredible deal', 'amazing deal',
  'don\'t miss out', 'limited slots', 'fast action',
  'opportunity', 'unbelievable',
  
  // Suspicious patterns
  'no credit card', 'no commitment', 'no obligation',
  'no experience needed', 'no qualifications',
]

const SPAM_TRIGGER_PATTERNS = [
  // All caps words (except common acronyms)
  /\b([A-Z]{4,}(?![A-Z]))\b/g,
  
  // Excessive punctuation
  /[!?]{2,}/g,
  
  // Money symbols with numbers
  /[\$£€¥][\d,]+/,
  
  // Excessive links (more than 3)
  /https?:\/\//g,
]

const SAFE_GREETING_PATTERNS = [
  'Hi {{FirstName}}',
  'Hey {{FirstName}}',
  '{{FirstName}},',
  'Hi there',
  'Hello',
]

const SAFE_CLOSING_PATTERNS = [
  'Thanks',
  'Best',
  'Cheers',
  'Talk soon',
  'Looking forward to hearing from you',
]

// Gmail-specific filter triggers
const GMAIL_FILTER_TRIGGERS = {
  promotionalLanguage: {
    keywords: ['sale', 'offer', 'deal', 'coupon', 'discount', 'limited'],
    weight: 15,
  },
  urgencyLanguage: {
    keywords: ['urgent', 'immediately', 'hurry', 'fast', 'quick'],
    weight: 20,
  },
  frequencyRules: {
    // Too many emails from same sender in short time
    description: 'High sending frequency triggers promotion tab',
    weight: 10,
  },
  imageHeavy: {
    description: 'Images > 50% of content',
    weight: 15,
  },
  shortEmails: {
    description: 'Very short emails (< 2 lines) are often promotional',
    weight: 8,
  },
  genericGreeting: {
    keywords: ['dear recipient', 'to whom it may concern', 'valued customer'],
    weight: 12,
  },
}

export function analyzeEmailForSpamRisk(input: {
  subject: string
  body: string
  fromName?: string
  identity?: {
    domain?: string
    reputation?: number // 0-100, from warmup
  }
}): SpamRiskAnalysis {
  const issues: SpamIssue[] = []
  let spamScore = 0
  
  const subjectLower = input.subject.toLowerCase()
  const bodyLower = input.body.toLowerCase()
  const fullContent = `${input.subject}\n${input.body}`.toLowerCase()
  
  // ============ SUBJECT LINE ANALYSIS ============
  
  // Excessive caps in subject
  const capsRatio = (input.subject.match(/[A-Z]/g) || []).length / input.subject.length
  if (capsRatio > 0.3) {
    issues.push({
      type: 'formatting',
      severity: 'high',
      message: 'Subject has excessive capital letters (looks like shouting)',
    })
    spamScore += 18
  }
  
  // Promotional keywords in subject
  for (const keyword of PROMOTIONAL_KEYWORDS) {
    if (subjectLower.includes(keyword)) {
      issues.push({
        type: 'content',
        severity: 'medium',
        message: `Promotional keyword in subject: "${keyword}"`,
      })
      spamScore += 8
      break // Only flag once
    }
  }
  
  // Question marks in subject (can be clickbait)
  const questionMarks = (input.subject.match(/\?/g) || []).length
  if (questionMarks > 1) {
    issues.push({
      type: 'content',
      severity: 'low',
      message: 'Multiple question marks in subject (can appear clickbait-y)',
    })
    spamScore += 5
  }
  
  // ============ BODY ANALYSIS ============
  
  // Spam trigger patterns
  const allCapsWords = (bodyLower.match(/\b[A-Z]{4,}\b/g) || []).length
  if (allCapsWords > 2) {
    issues.push({
      type: 'formatting',
      severity: 'medium',
      message: `${allCapsWords} all-caps words detected`,
    })
    spamScore += 12
  }
  
  // Excessive punctuation
  const exclamationMarks = (input.body.match(/!/g) || []).length
  const questionMarksBody = (input.body.match(/\?/g) || []).length
  if (exclamationMarks > 3) {
    issues.push({
      type: 'formatting',
      severity: 'medium',
      message: `Excessive exclamation marks (${exclamationMarks})`,
    })
    spamScore += 10
  }
  
  // Link density
  const linkCount = (input.body.match(/https?:\/\//g) || []).length
  if (linkCount > 3) {
    issues.push({
      type: 'links',
      severity: 'high',
      message: `Too many links (${linkCount}). Limit to 1-2 per email.`,
    })
    spamScore += 20
  }
  
  // Generic greetings
  let hasGenericGreeting = false
  const genericGreetings = ['dear recipient', 'to whom it may concern', 'valued customer', 'dear sir or madam']
  for (const greeting of genericGreetings) {
    if (bodyLower.includes(greeting)) {
      issues.push({
        type: 'content',
        severity: 'high',
        message: 'Generic greeting detected (not personalized)',
      })
      spamScore += 15
      hasGenericGreeting = true
      break
    }
  }
  
  // Missing personalization
  if (!hasGenericGreeting && !input.body.includes('{{') && input.body.length < 100) {
    // Short email without variables might be template-ish
    issues.push({
      type: 'content',
      severity: 'medium',
      message: 'Email is very short and lacks personalization variables',
    })
    spamScore += 8
  }
  
  // ============ PROMOTIONAL CONTENT ANALYSIS ============
  
  let promotionalCount = 0
  for (const keyword of PROMOTIONAL_KEYWORDS) {
    if (fullContent.includes(keyword)) {
      promotionalCount++
    }
  }
  
  if (promotionalCount > 0) {
    issues.push({
      type: 'content',
      severity: promotionalCount > 3 ? 'high' : 'medium',
      message: `${promotionalCount} promotional keywords detected`,
    })
    spamScore += Math.min(promotionalCount * 5, 25)
  }
  
  // ============ DOMAIN REPUTATION ANALYSIS ============
  
  if (input.identity?.reputation !== undefined) {
    if (input.identity.reputation < 40) {
      issues.push({
        type: 'headers',
        severity: 'high',
        message: 'Domain has low reputation score (still warming up). Increase sending gradually.',
      })
      spamScore += 20
    } else if (input.identity.reputation < 60) {
      issues.push({
        type: 'headers',
        severity: 'medium',
        message: 'Domain reputation is moderate. Continue following sending best practices.',
      })
      spamScore += 10
    }
  }
  
  // ============ ENGAGEMENT PATTERNS ============
  
  // Email length (too short can be risky)
  const lineCount = input.body.split('\n').filter(l => l.trim()).length
  if (lineCount < 2) {
    issues.push({
      type: 'engagement',
      severity: 'medium',
      message: 'Email is very short (< 2 lines). Add more context for better deliverability.',
    })
    spamScore += 8
  }
  
  // No call to action
  if (!input.body.match(/\?[\s]*$/m)) {
    // Doesn't end with question
    issues.push({
      type: 'engagement',
      severity: 'low',
      message: 'Email should end with a question to encourage reply (avoids "broadcast" detection)',
    })
    spamScore += 5
  }
  
  // ============ DETERMINE RISK LEVEL ============
  
  let riskLevel: 'safe' | 'warning' | 'critical' = 'safe'
  if (spamScore >= 60) {
    riskLevel = 'critical'
  } else if (spamScore >= 40) {
    riskLevel = 'warning'
  }
  
  // ============ RECOMMENDATIONS ============
  
  const recommendations: string[] = []
  
  if (riskLevel === 'critical') {
    recommendations.push('🚨 CRITICAL: This email is likely to be flagged. Major revisions needed.')
  } else if (riskLevel === 'warning') {
    recommendations.push('⚠️  WARNING: This email has elevated spam risk. Consider revisions.')
  } else {
    recommendations.push('✅ Safe: This email should pass most spam filters.')
  }
  
  if (promotionalCount > 2) {
    recommendations.push('Reduce promotional language. Focus on the prospect\'s need, not your offer.')
  }
  
  if (linkCount > 2) {
    recommendations.push('Remove unnecessary links. Keep to 1-2 maximum.')
  }
  
  if (exclamationMarks > 2) {
    recommendations.push('Reduce exclamation marks. Use periods for a more professional tone.')
  }
  
  if (capsRatio > 0.2) {
    recommendations.push('Reduce capital letters in subject. Avoid shouting.')
  }
  
  if (questionMarksBody === 0) {
    recommendations.push('End with a question to increase reply rates and avoid spam filters.')
  }
  
  if (!input.body.includes('{{FirstName}}') && !input.body.includes('{{Company}}')) {
    recommendations.push('Add personalization variables ({{FirstName}}, {{Company}}) for better engagement.')
  }
  
  return {
    riskLevel,
    issues,
    recommendations,
    spamScore: Math.min(spamScore, 100),
  }
}

/**
 * Check if email passes Gmail-specific filters
 */
export function checkGmailFilterRules(input: {
  subject: string
  body: string
  senderDomain?: string
}): { passesGmail: boolean; reasoning: string[] } {
  const reasoning: string[] = []
  let score = 0
  
  const fullContent = `${input.subject}\n${input.body}`.toLowerCase()
  
  // Check promotional triggers
  const promoKeywords = ['sale', 'offer', 'deal', 'coupon', 'buy now']
  let promoMatches = 0
  for (const keyword of promoKeywords) {
    if (fullContent.includes(keyword)) promoMatches++
  }
  
  if (promoMatches > 2) {
    reasoning.push('Multiple promotional keywords trigger Gmail promotion tab')
    score += 25
  }
  
  // Check subject line for common promotional patterns
  const subjectLower = input.subject.toLowerCase()
  if (subjectLower.includes('%') || subjectLower.includes('off') || subjectLower.includes('save')) {
    reasoning.push('Subject line contains discount/offer language')
    score += 20
  }
  
  // Check for image-only emails (no detection possible here, but warn)
  if (!input.body.trim().startsWith('<')) {
    reasoning.push('✓ Email contains text (not image-heavy)')
  }
  
  // Personal vs broadcast detection
  if (input.body.includes('{{FirstName}}') || input.body.includes('you')) {
    reasoning.push('✓ Email appears personal (uses recipient name/personalization)')
  } else {
    reasoning.push('Email lacks personalization — may be treated as broadcast')
    score += 15
  }
  
  return {
    passesGmail: score < 30,
    reasoning,
  }
}

export function formatSpamAnalysisForDisplay(analysis: SpamRiskAnalysis): string {
  const lines: string[] = [
    `Spam Risk: ${analysis.riskLevel.toUpperCase()} (Score: ${analysis.spamScore}/100)`,
    '',
  ]
  
  if (analysis.issues.length > 0) {
    lines.push('Issues:')
    for (const issue of analysis.issues) {
      const emoji = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢'
      lines.push(`  ${emoji} [${issue.type}] ${issue.message}`)
    }
    lines.push('')
  }
  
  if (analysis.recommendations.length > 0) {
    lines.push('Recommendations:')
    for (const rec of analysis.recommendations) {
      lines.push(`  • ${rec}`)
    }
  }
  
  return lines.join('\n')
}
