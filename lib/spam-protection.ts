// @ts-nocheck
/**
 * Spam Protection Engine
 * Rule-based spam detection and content filtering
 * Scores emails before sending and prevents spam delivery
 */

import { query } from '@/lib/db'

export interface SpamAnalysisResult {
  emailId: string
  score: number // 0-100, higher = more spammy
  risk: 'low' | 'medium' | 'high' | 'critical'
  flags: SpamFlag[]
  suggestions?: string[]
  analyzedAt: Date
  aiAnalysis?: AIAnalysisResult
}

export interface SpamFlag {
  type: 'word' | 'pattern' | 'structure' | 'ai'
  severity: 'low' | 'medium' | 'high'
  description: string
  matchedText?: string
  confidence: number
}

export interface AIAnalysisResult {
  provider: string
  score: number
  reasoning: string
  suggestions: string[]
  processedAt: Date
}

export interface SpamRules {
  blockedWords: string[]
  suspiciousPatterns: RegExp[]
  maxCapsPercentage: number
  maxExclamationMarks: number
  minWordCount: number
  maxWordCount: number
  blockedDomains: string[]
}

class SpamProtectionEngine {
  private readonly spamRules: SpamRules
  private readonly cache: Map<string, SpamAnalysisResult> = new Map()

  constructor() {
    // Default spam rules - can be configured via database
    this.spamRules = {
      blockedWords: [
        'free money', 'guaranteed income', 'work from home', 'millionaire',
        'lose weight fast', 'viagra', 'casino', 'lottery', 'inheritance',
        'urgent business', 'confidential', 'secret formula', 'amazing deal'
      ],
      suspiciousPatterns: [
        /\bFREE\b.*\bMONEY\b/i,
        /\bGUARANTEED\b.*\bINCOME\b/i,
        /\bWORK\b.*\bFROM\b.*\bHOME\b/i,
        /\bMILLIONAIRE\b/i,
        /\bLOSE\b.*\bWEIGHT\b.*\bFAST\b/i,
        /\bVIAGRA\b/i,
        /\bCASINO\b/i,
        /\bLOTTERY\b/i,
        /\bINHERITANCE\b/i,
        /\bURGENT\b.*\bBUSINESS\b/i,
        /\bCONFIDENTIAL\b/i,
        /\bSECRET\b.*\bFORMULA\b/i,
        /\bAMAZING\b.*\bDEAL\b/i
      ],
      maxCapsPercentage: 30,
      maxExclamationMarks: 3,
      minWordCount: 10,
      maxWordCount: 1000,
      blockedDomains: [
        'spamdomain.com', 'suspiciousmail.com'
      ]
    }
  }

  /**
   * Analyze email content for spam
   */
  async analyzeEmail(emailId: string, subject: string, body: string, recipient?: string): Promise<SpamAnalysisResult> {
    // Check cache first
    const cacheKey = `${emailId}-${subject}-${body}`.slice(0, 100)
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.analyzedAt.getTime() < 3600000) { // 1 hour cache
      return cached
    }

    const flags: SpamFlag[] = []
    let totalScore = 0

    // Rule-based analysis
    const ruleFlags = this.analyzeRules(subject, body, recipient)
    flags.push(...ruleFlags)
    totalScore += ruleFlags.reduce((sum, flag) => sum + this.getFlagScore(flag), 0)

    // Deterministic analysis
    let aiAnalysis: AIAnalysisResult | undefined
    aiAnalysis = this.analyzeDeterministically(subject, body)
    const aiFlag: SpamFlag = {
      type: 'ai',
      severity: aiAnalysis.score > 70 ? 'high' : aiAnalysis.score > 40 ? 'medium' : 'low',
      description: `Deterministic spam likelihood: ${aiAnalysis.score}%`,
      confidence: aiAnalysis.score / 100
    }
    flags.push(aiFlag)
    totalScore += aiAnalysis.score * 0.8

    // Calculate final score and risk level
    const finalScore = Math.min(100, Math.max(0, totalScore))
    const risk = this.calculateRisk(finalScore)

    const result: SpamAnalysisResult = {
      emailId,
      score: finalScore,
      risk,
      flags,
      analyzedAt: new Date(),
      aiAnalysis
    }

    // Cache result
    this.cache.set(cacheKey, result)

    // Store in database for analytics
    await this.storeAnalysisResult(result)

    return result
  }

  /**
   * Rule-based spam analysis
   */
  private analyzeRules(subject: string, body: string, recipient?: string): SpamFlag[] {
    const flags: SpamFlag[] = []
    const fullText = `${subject} ${body}`.toLowerCase()

    // Check blocked words
    for (const word of this.spamRules.blockedWords) {
      if (fullText.includes(word.toLowerCase())) {
        flags.push({
          type: 'word',
          severity: 'high',
          description: `Contains blocked word: "${word}"`,
          matchedText: word,
          confidence: 0.95
        })
      }
    }

    // Check suspicious patterns
    for (const pattern of this.spamRules.suspiciousPatterns) {
      if (pattern.test(fullText)) {
        flags.push({
          type: 'pattern',
          severity: 'medium',
          description: `Matches suspicious pattern: ${pattern}`,
          confidence: 0.85
        })
      }
    }

    // Check caps percentage
    const capsCount = (subject + body).replace(/[^A-Z]/g, '').length
    const totalChars = (subject + body).length
    const capsPercentage = totalChars > 0 ? (capsCount / totalChars) * 100 : 0

    if (capsPercentage > this.spamRules.maxCapsPercentage) {
      flags.push({
        type: 'structure',
        severity: 'medium',
        description: `Too many capital letters: ${capsPercentage.toFixed(1)}% (max: ${this.spamRules.maxCapsPercentage}%)`,
        confidence: Math.min(1, capsPercentage / 100)
      })
    }

    // Check exclamation marks
    const exclamationCount = (subject + body).split('!').length - 1
    if (exclamationCount > this.spamRules.maxExclamationMarks) {
      flags.push({
        type: 'structure',
        severity: 'low',
        description: `Too many exclamation marks: ${exclamationCount} (max: ${this.spamRules.maxExclamationMarks})`,
        confidence: Math.min(1, exclamationCount / 10)
      })
    }

    // Check word count
    const wordCount = body.split(/\s+/).length
    if (wordCount < this.spamRules.minWordCount) {
      flags.push({
        type: 'structure',
        severity: 'low',
        description: `Email too short: ${wordCount} words (min: ${this.spamRules.minWordCount})`,
        confidence: 0.6
      })
    } else if (wordCount > this.spamRules.maxWordCount) {
      flags.push({
        type: 'structure',
        severity: 'medium',
        description: `Email too long: ${wordCount} words (max: ${this.spamRules.maxWordCount})`,
        confidence: 0.7
      })
    }

    // Check recipient domain if provided
    if (recipient) {
      const domain = recipient.split('@')[1]?.toLowerCase()
      if (domain && this.spamRules.blockedDomains.includes(domain)) {
        flags.push({
          type: 'structure',
          severity: 'high',
          description: `Sending to blocked domain: ${domain}`,
          matchedText: domain,
          confidence: 1.0
        })
      }
    }

    return flags
  }

  /**
   * Deterministic spam analysis using rule scoring
   */
  private analyzeDeterministically(subject: string, body: string): AIAnalysisResult {
    const text = `${subject} ${body}`.toLowerCase()
    const signals = [
      { pattern: /free money|guaranteed income|instant cash|act now|limited time/i, score: 18, label: 'pressure or promise language' },
      { pattern: /!!!+|[A-Z]{6,}/, score: 12, label: 'aggressive formatting' },
      { pattern: /click here|buy now|make money|risk free|no obligation/i, score: 14, label: 'sales pressure' },
      { pattern: /viagra|casino|lottery|crypto rich/i, score: 20, label: 'blocked spam terms' },
    ]

    const matchedSignals = signals.filter((signal) => signal.pattern.test(text))
    const score = Math.min(100, matchedSignals.reduce((sum, signal) => sum + signal.score, 10))

    return {
      provider: 'rule',
      score,
      reasoning: matchedSignals.length > 0
        ? `Matched ${matchedSignals.map((signal) => signal.label).join(', ')}`
        : 'No strong spam signals detected',
      suggestions: matchedSignals.length > 0
        ? ['Reduce promotional pressure', 'Remove spam-trigger language', 'Shorten aggressive claims']
        : ['Keep the copy concise and specific'],
      processedAt: new Date()
    }
  }

  /**
   * Calculate risk level from score
   */
  private calculateRisk(score: number): SpamAnalysisResult['risk'] {
    if (score >= 80) return 'critical'
    if (score >= 60) return 'high'
    if (score >= 40) return 'medium'
    return 'low'
  }

  /**
   * Get score contribution from a flag
   */
  private getFlagScore(flag: SpamFlag): number {
    const baseScore = flag.severity === 'high' ? 25 :
                     flag.severity === 'medium' ? 15 :
                     flag.severity === 'low' ? 5 : 0

    return baseScore * flag.confidence
  }

  /**
   * Check if email should be blocked
   */
  shouldBlockEmail(result: SpamAnalysisResult): boolean {
    return result.risk === 'critical' ||
           result.score >= 75 ||
           result.flags.some(flag => flag.severity === 'high' && flag.confidence > 0.8)
  }

  /**
   * Get spam analysis suggestions
   */
  getSuggestions(result: SpamAnalysisResult): string[] {
    const suggestions: string[] = []

    if (result.aiAnalysis?.suggestions) {
      suggestions.push(...result.aiAnalysis.suggestions)
    }

    // Add rule-based suggestions
    for (const flag of result.flags) {
      switch (flag.type) {
        case 'word':
          suggestions.push(`Remove or rephrase blocked word: "${flag.matchedText}"`)
          break
        case 'pattern':
          suggestions.push('Avoid suspicious phrases and patterns')
          break
        case 'structure':
          if (flag.description.includes('capital')) {
            suggestions.push('Reduce use of capital letters')
          } else if (flag.description.includes('exclamation')) {
            suggestions.push('Reduce exclamation mark usage')
          } else if (flag.description.includes('short')) {
            suggestions.push('Add more content to make email substantial')
          } else if (flag.description.includes('long')) {
            suggestions.push('Shorten email content')
          }
          break
      }
    }

    return [...new Set(suggestions)] // Remove duplicates
  }

  /**
   * Store analysis result in database
   */
  private async storeAnalysisResult(result: SpamAnalysisResult): Promise<void> {
    await query(`
      INSERT INTO spam_analysis (
        email_id, score, risk, flags, ai_analysis, analyzed_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email_id) DO UPDATE SET
        score = EXCLUDED.score,
        risk = EXCLUDED.risk,
        flags = EXCLUDED.flags,
        ai_analysis = EXCLUDED.ai_analysis,
        analyzed_at = EXCLUDED.analyzed_at
    `, [
      result.emailId,
      result.score,
      result.risk,
      JSON.stringify(result.flags),
      result.aiAnalysis ? JSON.stringify(result.aiAnalysis) : null,
      result.analyzedAt
    ])
  }

  /**
   * Get spam analysis statistics
   */
  async getSpamStats(timeframe: 'day' | 'week' | 'month' = 'week'): Promise<{
    totalAnalyzed: number
    blocked: number
    averageScore: number
    riskDistribution: Record<string, number>
  }> {
    const interval = timeframe === 'day' ? '1 day' :
                    timeframe === 'week' ? '7 days' : '30 days'

    const results = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN risk = 'critical' OR score >= 75 THEN 1 END) as blocked,
        AVG(score) as avg_score,
        COUNT(CASE WHEN risk = 'low' THEN 1 END) as low_risk,
        COUNT(CASE WHEN risk = 'medium' THEN 1 END) as medium_risk,
        COUNT(CASE WHEN risk = 'high' THEN 1 END) as high_risk,
        COUNT(CASE WHEN risk = 'critical' THEN 1 END) as critical_risk
      FROM spam_analysis
      WHERE analyzed_at >= NOW() - INTERVAL '${interval}'
    `)

    const stats = results.rows[0]
    return {
      totalAnalyzed: parseInt(stats.total) || 0,
      blocked: parseInt(stats.blocked) || 0,
      averageScore: parseFloat(stats.avg_score) || 0,
      riskDistribution: {
        low: parseInt(stats.low_risk) || 0,
        medium: parseInt(stats.medium_risk) || 0,
        high: parseInt(stats.high_risk) || 0,
        critical: parseInt(stats.critical_risk) || 0
      }
    }
  }
}

// Singleton instance
export const spamProtection = new SpamProtectionEngine()

/**
 * Analyze email for spam before sending
 */
export async function analyzeEmailForSpam(
  emailId: string,
  subject: string,
  body: string,
  recipient?: string
): Promise<{
  shouldSend: boolean
  analysis: SpamAnalysisResult
  suggestions?: string[]
}> {
  const analysis = await spamProtection.analyzeEmail(emailId, subject, body, recipient)
  const shouldSend = !spamProtection.shouldBlockEmail(analysis)

  return {
    shouldSend,
    analysis,
    suggestions: shouldSend ? undefined : spamProtection.getSuggestions(analysis)
  }
}

/**
 * Batch analyze emails for campaign
 */
export async function analyzeEmailsForCampaign(
  emails: Array<{ id: string; subject: string; body: string; recipient?: string }>
): Promise<{
  approved: Array<{ id: string; analysis: SpamAnalysisResult }>
  rejected: Array<{ id: string; analysis: SpamAnalysisResult; suggestions: string[] }>
  stats: Awaited<ReturnType<SpamProtectionEngine['getSpamStats']>>
}> {
  const results = await Promise.all(
    emails.map(email =>
      analyzeEmailForSpam(email.id, email.subject, email.body, email.recipient)
    )
  )

  const approved = results
    .filter(result => result.shouldSend)
    .map(result => ({ id: result.analysis.emailId, analysis: result.analysis }))

  const rejected = results
    .filter(result => !result.shouldSend)
    .map(result => ({
      id: result.analysis.emailId,
      analysis: result.analysis,
      suggestions: result.suggestions || []
    }))

  const stats = await spamProtection.getSpamStats()

  return { approved, rejected, stats }
}
