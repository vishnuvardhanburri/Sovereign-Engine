// @ts-nocheck
/**
 * A/B Testing Engine
 * Automated testing of email variants with statistical analysis
 * Auto-selects winning variants based on performance metrics
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'

export interface ABTest {
  id: string
  campaignId: string
  name: string
  type: 'subject_line' | 'body' | 'send_time' | 'full_email'
  status: 'active' | 'completed' | 'paused'
  variants: ABVariant[]
  winner?: string // variant ID
  winnerSelectedAt?: Date
  testDurationDays: number
  minSampleSize: number
  confidenceThreshold: number // 0-1
  primaryMetric: 'open_rate' | 'click_rate' | 'reply_rate' | 'conversion_rate'
  secondaryMetrics?: string[]
  createdAt: Date
  completedAt?: Date
}

export interface ABVariant {
  id: string
  name: string
  subject?: string
  body?: string
  sendTime?: string // HH:MM format
  sampleSize: number
  metrics: VariantMetrics
  isWinner?: boolean
  confidence: number // statistical confidence 0-1
}

export interface VariantMetrics {
  sent: number
  opens: number
  clicks: number
  replies: number
  bounces: number
  unsubscribes: number
  conversions: number
  openRate: number
  clickRate: number
  replyRate: number
  conversionRate: number
  bounceRate: number
  unsubscribeRate: number
}

export interface ABTestResult {
  testId: string
  winner: ABVariant
  loser: ABVariant
  confidence: number
  improvement: number // percentage improvement
  statisticalSignificance: boolean
  recommendedAction: 'deploy_winner' | 'continue_testing' | 'no_clear_winner'
}

export interface TestAnalytics {
  totalTests: number
  activeTests: number
  completedTests: number
  averageImprovement: number
  winnerDistribution: Record<string, number>
}

class ABTestingEngine {
  private readonly minSampleSize: number = 100
  private readonly confidenceThreshold: number = 0.95
  private readonly maxTestDurationDays: number = 30

  /**
   * Create a new A/B test
   */
  async createTest(
    campaignId: string,
    name: string,
    type: ABTest['type'],
    variants: Omit<ABVariant, 'id' | 'sampleSize' | 'metrics' | 'confidence'>[],
    options: {
      testDurationDays?: number
      minSampleSize?: number
      confidenceThreshold?: number
      primaryMetric?: ABTest['primaryMetric']
    } = {}
  ): Promise<string> {
    if (variants.length < 2) {
      throw new Error('A/B test must have at least 2 variants')
    }

    // Create test record
    const testResult = await query(`
      INSERT INTO ab_tests (
        campaign_id, name, type, status, variants, test_duration_days,
        min_sample_size, confidence_threshold, primary_metric, created_at
      ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, NOW())
      RETURNING id
    `, [
      campaignId,
      name,
      type,
      JSON.stringify(variants.map(v => ({ ...v, id: this.generateVariantId() }))),
      options.testDurationDays || 7,
      options.minSampleSize || this.minSampleSize,
      options.confidenceThreshold || this.confidenceThreshold,
      options.primaryMetric || 'open_rate'
    ])

    return testResult.rows[0].id
  }

  /**
   * Get next variant for contact
   */
  async getNextVariant(testId: string, contactEmail: string): Promise<ABVariant | null> {
    const test = await this.getTest(testId)
    if (!test || test.status !== 'active') {
      return null
    }

    // Check if contact already received a variant
    const existing = await query(`
      SELECT variant_id FROM ab_test_assignments
      WHERE test_id = $1 AND contact_email = $2
    `, [testId, contactEmail])

    if (existing.rows.length > 0) {
      // Return existing variant
      const variantId = existing.rows[0].variant_id
      return test.variants.find(v => v.id === variantId) || null
    }

    // Assign next variant using round-robin distribution
    const variant = this.selectVariantRoundRobin(test.variants)
    if (!variant) return null

    // Record assignment
    await query(`
      INSERT INTO ab_test_assignments (test_id, contact_email, variant_id, assigned_at)
      VALUES ($1, $2, $3, NOW())
    `, [testId, contactEmail, variant.id])

    return variant
  }

  /**
   * Record email event for A/B test
   */
  async recordEvent(
    testId: string,
    contactEmail: string,
    eventType: 'sent' | 'open' | 'click' | 'reply' | 'bounce' | 'unsubscribe' | 'conversion'
  ): Promise<void> {
    // Get variant for this contact
    const assignment = await query(`
      SELECT variant_id FROM ab_test_assignments
      WHERE test_id = $1 AND contact_email = $2
    `, [testId, contactEmail])

    if (assignment.rows.length === 0) return

    const variantId = (assignment.rows[0] as any).variant_id

    // Update metrics
    const metricColumn = this.eventTypeToMetricColumn(eventType)
    await query(`
      UPDATE ab_test_variants
      SET ${metricColumn} = ${metricColumn} + 1,
          updated_at = NOW()
      WHERE test_id = $1 AND variant_id = $2
    `, [testId, variantId])

    // Recalculate rates
    await this.recalculateRates(testId, variantId)
  }

  /**
   * Check if test should be completed
   */
  async checkTestCompletion(testId: string): Promise<boolean> {
    const test = await this.getTest(testId)
    if (!test || test.status !== 'active') return false

    // Check duration
    const age = Date.now() - test.createdAt.getTime()
    const maxDuration = test.testDurationDays * 24 * 60 * 60 * 1000

    if (age >= maxDuration) {
      await this.completeTest(testId, 'Duration limit reached')
      return true
    }

    // Check sample sizes
    const allVariantsReady = test.variants.every(v => v.sampleSize >= test.minSampleSize)
    if (!allVariantsReady) return false

    // Check statistical significance
    const result = await this.analyzeTest(test)
    if (result.statisticalSignificance && result.confidence >= test.confidenceThreshold) {
      await this.selectWinner(testId, result)
      return true
    }

    return false
  }

  /**
   * Analyze test results
   */
  async analyzeTest(test: ABTest): Promise<ABTestResult> {
    if (test.variants.length !== 2) {
      throw new Error('Analysis currently supports only 2 variants')
    }

    const [variantA, variantB] = test.variants
    const metricA = this.getMetricValue(variantA.metrics, test.primaryMetric)
    const metricB = this.getMetricValue(variantB.metrics, test.primaryMetric)

    // Calculate statistical significance using chi-square test
    const significance = this.calculateStatisticalSignificance(
      variantA.sampleSize, metricA,
      variantB.sampleSize, metricB
    )

    const improvement = metricB > metricA ?
      ((metricB - metricA) / metricA) * 100 :
      ((metricA - metricB) / metricB) * 100

    const winner = metricB > metricA ? variantB : variantA
    const loser = metricB > metricA ? variantA : variantB

    return {
      testId: test.id,
      winner,
      loser,
      confidence: significance.confidence,
      improvement,
      statisticalSignificance: significance.isSignificant,
      recommendedAction: significance.isSignificant ? 'deploy_winner' : 'continue_testing'
    }
  }

  /**
   * Select winner and complete test
   */
  private async selectWinner(testId: string, result: ABTestResult): Promise<void> {
    await query(`
      UPDATE ab_tests
      SET status = 'completed',
          winner = $2,
          winner_selected_at = NOW(),
          completed_at = NOW()
      WHERE id = $1
    `, [testId, result.winner.id])

    // Mark winner variant
    await query(`
      UPDATE ab_test_variants
      SET is_winner = true
      WHERE test_id = $1 AND variant_id = $2
    `, [testId, result.winner.id])
  }

  /**
   * Complete test manually
   */
  async completeTest(testId: string, reason: string): Promise<void> {
    const test = await this.getTest(testId)
    if (!test) return

    // If no clear winner, pick the best performing
    if (!test.winner && test.variants.length >= 2) {
      const bestVariant = test.variants.reduce((best, current) =>
        this.getMetricValue(current.metrics, test.primaryMetric) >
        this.getMetricValue(best.metrics, test.primaryMetric) ? current : best
      )

      await query(`
        UPDATE ab_tests
        SET status = 'completed',
            winner = $2,
            winner_selected_at = NOW(),
            completed_at = NOW()
        WHERE id = $1
      `, [testId, bestVariant.id])
    } else {
      await query(`
        UPDATE ab_tests
        SET status = 'completed',
            completed_at = NOW()
        WHERE id = $1
      `, [testId])
    }
  }

  /**
   * Get test by ID
   */
  async getTest(testId: string): Promise<ABTest | null> {
    const result = await query(`
      SELECT * FROM ab_tests WHERE id = $1
    `, [testId])

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    const variants = await this.getTestVariants(testId)

    return {
      id: (row as any).id,
      campaignId: (row as any).campaign_id,
      name: (row as any).name,
      type: (row as any).type,
      status: (row as any).status,
      variants,
      winner: (row as any).winner,
      winnerSelectedAt: (row as any).winner_selected_at,
      testDurationDays: (row as any).test_duration_days,
      minSampleSize: row.min_sample_size,
      confidenceThreshold: row.confidence_threshold,
      primaryMetric: row.primary_metric,
      secondaryMetrics: row.secondary_metrics ? JSON.parse(row.secondary_metrics) : undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at
    }
  }

  /**
   * Get test variants
   */
  private async getTestVariants(testId: string): Promise<ABVariant[]> {
    const result = await query(`
      SELECT * FROM ab_test_variants WHERE test_id = $1
    `, [testId])

    return result.rows.map(row => ({
      id: row.variant_id,
      name: row.name,
      subject: row.subject,
      body: row.body,
      sendTime: row.send_time,
      sampleSize: row.sample_size,
      metrics: {
        sent: row.sent,
        opens: row.opens,
        clicks: row.clicks,
        replies: row.replies,
        bounces: row.bounces,
        unsubscribes: row.unsubscribes,
        conversions: row.conversions,
        openRate: row.open_rate,
        clickRate: row.click_rate,
        replyRate: row.reply_rate,
        conversionRate: row.conversion_rate,
        bounceRate: row.bounce_rate,
        unsubscribeRate: row.unsubscribe_rate
      },
      isWinner: row.is_winner,
      confidence: row.confidence
    }))
  }

  /**
   * Select variant using round-robin
   */
  private selectVariantRoundRobin(variants: ABVariant[]): ABVariant | null {
    if (variants.length === 0) return null

    // Find variant with smallest sample size
    return variants.reduce((min, current) =>
      current.sampleSize < min.sampleSize ? current : min
    )
  }

  /**
   * Convert event type to metric column
   */
  private eventTypeToMetricColumn(eventType: string): string {
    switch (eventType) {
      case 'sent': return 'sent'
      case 'open': return 'opens'
      case 'click': return 'clicks'
      case 'reply': return 'replies'
      case 'bounce': return 'bounces'
      case 'unsubscribe': return 'unsubscribes'
      case 'conversion': return 'conversions'
      default: return 'sent'
    }
  }

  /**
   * Recalculate rates for variant
   */
  private async recalculateRates(testId: string, variantId: string): Promise<void> {
    await query(`
      UPDATE ab_test_variants
      SET
        open_rate = CASE WHEN sent > 0 THEN opens::float / sent ELSE 0 END,
        click_rate = CASE WHEN sent > 0 THEN clicks::float / sent ELSE 0 END,
        reply_rate = CASE WHEN sent > 0 THEN replies::float / sent ELSE 0 END,
        conversion_rate = CASE WHEN sent > 0 THEN conversions::float / sent ELSE 0 END,
        bounce_rate = CASE WHEN sent > 0 THEN bounces::float / sent ELSE 0 END,
        unsubscribe_rate = CASE WHEN sent > 0 THEN unsubscribes::float / sent ELSE 0 END,
        sample_size = sent,
        updated_at = NOW()
      WHERE test_id = $1 AND variant_id = $2
    `, [testId, variantId])
  }

  /**
   * Calculate statistical significance using chi-square test
   */
  private calculateStatisticalSignificance(
    sampleA: number, rateA: number,
    sampleB: number, rateB: number
  ): { isSignificant: boolean; confidence: number } {
    // Simplified chi-square test for proportions
    const successesA = Math.round(sampleA * rateA)
    const successesB = Math.round(sampleB * rateB)

    if (sampleA === 0 || sampleB === 0) {
      return { isSignificant: false, confidence: 0 }
    }

    const totalSuccesses = successesA + successesB
    const totalSamples = sampleA + sampleB
    const expectedRate = totalSuccesses / totalSamples

    const chiSquare = (
      Math.pow(successesA - sampleA * expectedRate, 2) / (sampleA * expectedRate) +
      Math.pow(successesB - sampleB * expectedRate, 2) / (sampleB * expectedRate)
    )

    // Chi-square critical value for 95% confidence (1 degree of freedom)
    const criticalValue = 3.841
    const isSignificant = chiSquare > criticalValue

    // Convert to confidence score (simplified)
    const confidence = Math.min(chiSquare / criticalValue, 1)

    return { isSignificant, confidence }
  }

  /**
   * Get metric value from variant
   */
  private getMetricValue(metrics: VariantMetrics, metric: ABTest['primaryMetric']): number {
    switch (metric) {
      case 'open_rate': return metrics.openRate
      case 'click_rate': return metrics.clickRate
      case 'reply_rate': return metrics.replyRate
      case 'conversion_rate': return metrics.conversionRate
      default: return metrics.openRate
    }
  }

  /**
   * Generate unique variant ID
   */
  private generateVariantId(): string {
    return `variant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get A/B testing analytics
   */
  async getTestingAnalytics(timeframe: 'day' | 'week' | 'month' = 'month'): Promise<TestAnalytics> {
    const interval = timeframe === 'day' ? '1 day' :
                    timeframe === 'week' ? '7 days' : '30 days'

    const results = await query(`
      SELECT
        COUNT(DISTINCT t.id) as total_tests,
        COUNT(DISTINCT CASE WHEN t.status = 'active' THEN t.id END) as active_tests,
        COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) as completed_tests,
        AVG(
          CASE
            WHEN t.winner IS NOT NULL THEN (
              SELECT v1.open_rate - v2.open_rate
              FROM ab_test_variants v1, ab_test_variants v2
              WHERE v1.test_id = t.id AND v1.is_winner = true
              AND v2.test_id = t.id AND v2.is_winner = false
              LIMIT 1
            )
            ELSE 0
          END
        ) as avg_improvement
      FROM ab_tests t
      WHERE t.created_at >= NOW() - INTERVAL '${interval}'
    `)

    const winnerResults = await query(`
      SELECT
        CASE
          WHEN v.subject IS NOT NULL AND v.subject != '' THEN 'subject_line'
          WHEN v.body IS NOT NULL AND v.body != '' THEN 'body'
          WHEN v.send_time IS NOT NULL THEN 'send_time'
          ELSE 'other'
        END as winner_type,
        COUNT(*) as count
      FROM ab_tests t
      JOIN ab_test_variants v ON t.winner = v.variant_id
      WHERE t.status = 'completed'
      AND t.created_at >= NOW() - INTERVAL '${interval}'
      GROUP BY winner_type
    `)

    const winnerDistribution: Record<string, number> = {}
    for (const row of winnerResults.rows) {
      winnerDistribution[row.winner_type] = parseInt(row.count)
    }

    const stats = results.rows[0]
    return {
      totalTests: parseInt(stats.total_tests) || 0,
      activeTests: parseInt(stats.active_tests) || 0,
      completedTests: parseInt(stats.completed_tests) || 0,
      averageImprovement: parseFloat(stats.avg_improvement) || 0,
      winnerDistribution
    }
  }

  /**
   * Get recommended variant for email
   */
  async getRecommendedVariant(testId: string): Promise<ABVariant | null> {
    const test = await this.getTest(testId)
    if (!test) return null

    // If test completed, return winner
    if (test.status === 'completed' && test.winner) {
      return test.variants.find(v => v.id === test.winner) || null
    }

    // If test active, return best performing so far
    if (test.status === 'active') {
      const bestVariant = test.variants.reduce((best, current) =>
        this.getMetricValue(current.metrics, test.primaryMetric) >
        this.getMetricValue(best.metrics, test.primaryMetric) ? current : best
      )
      return bestVariant
    }

    return null
  }
}

// Singleton instance
export const abTestingEngine = new ABTestingEngine()

/**
 * Create A/B test for subject lines
 */
export async function createSubjectLineTest(
  campaignId: string,
  name: string,
  subjectVariants: string[],
  options?: Partial<Parameters<ABTestingEngine['createTest']>[3]>
): Promise<string> {
  const variants = subjectVariants.map((subject, index) => ({
    name: `Subject ${index + 1}`,
    subject
  }))

  return await abTestingEngine.createTest(
    campaignId,
    name,
    'subject_line',
    variants,
    options
  )
}

/**
 * Create A/B test for email bodies
 */
export async function createBodyTest(
  campaignId: string,
  name: string,
  bodyVariants: Array<{ subject: string; body: string }>,
  options?: Partial<Parameters<ABTestingEngine['createTest']>[3]>
): Promise<string> {
  const variants = bodyVariants.map((variant, index) => ({
    name: `Body ${index + 1}`,
    subject: variant.subject,
    body: variant.body
  }))

  return await abTestingEngine.createTest(
    campaignId,
    name,
    'body',
    variants,
    options
  )
}

/**
 * Record event for A/B test
 */
export async function recordABTestEvent(
  testId: string,
  contactEmail: string,
  eventType: Parameters<ABTestingEngine['recordEvent']>[2]
): Promise<void> {
  await abTestingEngine.recordEvent(testId, contactEmail, eventType)
}

/**
 * Get recommended variant (winner or best performing)
 */
export async function getRecommendedVariant(testId: string): Promise<ABVariant | null> {
  return await abTestingEngine.getRecommendedVariant(testId)
}
