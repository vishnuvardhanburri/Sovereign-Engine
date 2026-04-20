/**
 * Enhanced Delivery Optimization System
 * Advanced email delivery optimization for 50K+ daily sends
 * Intelligent domain rotation, throttling, warming, and performance monitoring
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { DomainHealth } from '@/lib/domain-manager'

export interface DeliveryConfig {
  id: string
  organizationId: string
  maxDailySends: number
  maxHourlySends: number
  maxMinuteSends: number
  warmingMode: boolean
  warmingSchedule: WarmingSchedule[]
  domainRotation: DomainRotationConfig
  throttlingRules: ThrottlingRule[]
  ipRotation: IPRotationConfig
  reputationMonitoring: ReputationMonitoringConfig
  createdAt: Date
  updatedAt: Date
}

export interface WarmingSchedule {
  day: number
  maxSends: number
  intervalMinutes: number
  rampUpPercentage: number
}

export interface DomainRotationConfig {
  enabled: boolean
  strategy: 'round_robin' | 'performance_based' | 'volume_based'
  domains: DomainConfig[]
  rotationInterval: number // minutes
  maxPerDomainHourly: number
}

export interface DomainConfig {
  domainId: string
  priority: number
  maxHourlySends: number
  healthScore: number
  lastUsed: Date
  consecutiveFailures: number
}

export interface ThrottlingRule {
  id: string
  condition: {
    metric: 'bounce_rate' | 'complaint_rate' | 'send_volume' | 'domain_health'
    operator: 'greater_than' | 'less_than' | 'equals'
    value: number
    timeWindow: number // minutes
  }
  action: {
    type: 'reduce_volume' | 'pause_sends' | 'switch_domain' | 'throttle_rate'
    value: number // percentage reduction or new rate
    duration: number // minutes
  }
  enabled: boolean
}

export interface IPRotationConfig {
  enabled: boolean
  ips: IPConfig[]
  rotationStrategy: 'round_robin' | 'least_used' | 'performance_based'
  maxPerIPHourly: number
  healthCheckInterval: number // minutes
}

export interface IPConfig {
  ip: string
  provider: string
  reputation: number
  lastHealthCheck: Date
  consecutiveFailures: number
  dailySendLimit: number
  currentDaySends: number
}

export interface ReputationMonitoringConfig {
  enabled: boolean
  metrics: ReputationMetric[]
  alertThresholds: {
    bounceRate: number
    complaintRate: number
    unsubscribeRate: number
  }
  recoveryActions: RecoveryAction[]
}

export interface ReputationMetric {
  name: string
  provider: 'google_postmaster' | 'microsoft_snar' | 'sendforensics' | 'talos'
  apiKey?: string
  checkInterval: number // hours
  lastCheck: Date
  score: number
}

export interface RecoveryAction {
  trigger: 'bounce_rate_high' | 'complaint_rate_high' | 'domain_blacklisted'
  action: 'reduce_volume' | 'pause_domain' | 'switch_provider' | 'warming_restart'
  value: number
  duration: number // hours
}

export interface DeliveryMetrics {
  timestamp: Date
  totalSends: number
  delivered: number
  bounced: number
  complained: number
  unsubscribed: number
  deliveryRate: number
  bounceRate: number
  complaintRate: number
  unsubscribeRate: number
  avgSendTime: number
  throttlingEvents: number
  domainSwitches: number
  ipRotations: number
}

export interface SendDecision {
  canSend: boolean
  recommendedDomain?: string
  recommendedIP?: string
  throttleDelay?: number // milliseconds
  reason?: string
  nextAvailableSlot?: Date
}

class EnhancedDeliveryOptimizer {
  private configCache: Map<string, DeliveryConfig> = new Map()
  private metricsBuffer: DeliveryMetrics[] = []
  private lastMetricsFlush: Date = new Date()

  /**
   * Initialize delivery optimization for organization
   */
  async initializeOrganization(organizationId: string): Promise<DeliveryConfig> {
    const config: Omit<DeliveryConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      organizationId,
      maxDailySends: 50000,
      maxHourlySends: 2500,
      maxMinuteSends: 50,
      warmingMode: true,
      warmingSchedule: this.getDefaultWarmingSchedule(),
      domainRotation: {
        enabled: true,
        strategy: 'performance_based',
        domains: [],
        rotationInterval: 15,
        maxPerDomainHourly: 1000
      },
      throttlingRules: this.getDefaultThrottlingRules(),
      ipRotation: {
        enabled: true,
        ips: [],
        rotationStrategy: 'performance_based',
        maxPerIPHourly: 500,
        healthCheckInterval: 30
      },
      reputationMonitoring: {
        enabled: true,
        metrics: this.getDefaultReputationMetrics(),
        alertThresholds: {
          bounceRate: 0.02, // 2%
          complaintRate: 0.001, // 0.1%
          unsubscribeRate: 0.01 // 1%
        },
        recoveryActions: this.getDefaultRecoveryActions()
      }
    }

    const configId = `delivery_config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await query(`
      INSERT INTO delivery_configs (
        id, organization_id, config, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      configId,
      organizationId,
      JSON.stringify(config),
      new Date(),
      new Date()
    ])

    const fullConfig = { ...config, id: configId, createdAt: new Date(), updatedAt: new Date() }
    this.configCache.set(organizationId, fullConfig)

    return fullConfig
  }

  /**
   * Make send decision for email
   */
  async makeSendDecision(
    organizationId: string,
    emailData: {
      to: string
      from: string
      subject: string
      campaignId?: string
      sequenceId?: string
    }
  ): Promise<SendDecision> {
    const config = await this.getConfig(organizationId)
    if (!config) {
      return { canSend: false, reason: 'No delivery configuration found' }
    }

    // Check daily limits
    const dailySends = await this.getDailySends(organizationId)
    if (dailySends >= config.maxDailySends) {
      return {
        canSend: false,
        reason: `Daily send limit reached (${dailySends}/${config.maxDailySends})`,
        nextAvailableSlot: new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
      }
    }

    // Check hourly limits
    const hourlySends = await this.getHourlySends(organizationId)
    if (hourlySends >= config.maxHourlySends) {
      const nextHour = new Date()
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
      return {
        canSend: false,
        reason: `Hourly send limit reached (${hourlySends}/${config.maxHourlySends})`,
        nextAvailableSlot: nextHour
      }
    }

    // Check minute limits
    const minuteSends = await this.getMinuteSends(organizationId)
    if (minuteSends >= config.maxMinuteSends) {
      const nextMinute = new Date(Date.now() + 60 * 1000)
      nextMinute.setSeconds(0, 0)
      return {
        canSend: false,
        reason: `Per-minute send limit reached (${minuteSends}/${config.maxMinuteSends})`,
        throttleDelay: 60000 // 1 minute
      }
    }

    // Check throttling rules
    const throttlingDecision = await this.checkThrottlingRules(config, organizationId)
    if (!throttlingDecision.canSend) {
      return throttlingDecision
    }

    // Warming mode checks
    if (config.warmingMode) {
      const warmingDecision = await this.checkWarmingSchedule(config, organizationId)
      if (!warmingDecision.canSend) {
        return warmingDecision
      }
    }

    // Domain rotation
    const domainDecision = await this.selectDomain(config, organizationId)
    if (!domainDecision.canSend) {
      return domainDecision
    }

    // IP rotation
    const ipDecision = await this.selectIP(config, organizationId)
    if (!ipDecision.canSend) {
      return ipDecision
    }

    // Reputation monitoring
    const reputationDecision = await this.checkReputation(config, organizationId)
    if (!reputationDecision.canSend) {
      return reputationDecision
    }

    return {
      canSend: true,
      recommendedDomain: domainDecision.recommendedDomain,
      recommendedIP: ipDecision.recommendedIP
    }
  }

  /**
   * Record send event
   */
  async recordSendEvent(
    organizationId: string,
    emailData: {
      to: string
      from: string
      domain: string
      ip?: string
      campaignId?: string
      sequenceId?: string
    },
    result: 'delivered' | 'bounced' | 'complained' | 'unsubscribed'
  ): Promise<void> {
    await query(`
      INSERT INTO delivery_events (
        id, organization_id, email, domain, ip, campaign_id, sequence_id,
        result, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      organizationId,
      emailData.to,
      emailData.domain,
      emailData.ip || null,
      emailData.campaignId || null,
      emailData.sequenceId || null,
      result,
      new Date()
    ])

    // Update metrics buffer
    await this.updateMetricsBuffer(organizationId, result)

    // Check for throttling triggers
    await this.checkThrottlingTriggers(organizationId)
  }

  /**
   * Get delivery metrics
   */
  async getDeliveryMetrics(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<DeliveryMetrics[]> {
    const result = await query(`
      SELECT
        DATE_TRUNC('hour', timestamp) as hour,
        COUNT(*) as total_sends,
        COUNT(CASE WHEN result = 'delivered' THEN 1 END) as delivered,
        COUNT(CASE WHEN result = 'bounced' THEN 1 END) as bounced,
        COUNT(CASE WHEN result = 'complained' THEN 1 END) as complained,
        COUNT(CASE WHEN result = 'unsubscribed' THEN 1 END) as unsubscribed
      FROM delivery_events
      WHERE organization_id = $1 AND timestamp BETWEEN $2 AND $3
      GROUP BY DATE_TRUNC('hour', timestamp)
      ORDER BY hour DESC
    `, [organizationId, startDate, endDate])

    return result.rows.map(row => ({
      timestamp: row.hour,
      totalSends: parseInt(row.total_sends) || 0,
      delivered: parseInt(row.delivered) || 0,
      bounced: parseInt(row.bounced) || 0,
      complained: parseInt(row.complained) || 0,
      unsubscribed: parseInt(row.unsubscribed) || 0,
      deliveryRate: 0, // Calculated below
      bounceRate: 0,
      complaintRate: 0,
      unsubscribeRate: 0,
      avgSendTime: 0,
      throttlingEvents: 0,
      domainSwitches: 0,
      ipRotations: 0
    })).map(metrics => ({
      ...metrics,
      deliveryRate: metrics.totalSends > 0 ? metrics.delivered / metrics.totalSends : 0,
      bounceRate: metrics.totalSends > 0 ? metrics.bounced / metrics.totalSends : 0,
      complaintRate: metrics.totalSends > 0 ? metrics.complained / metrics.totalSends : 0,
      unsubscribeRate: metrics.totalSends > 0 ? metrics.unsubscribed / metrics.totalSends : 0
    }))
  }

  /**
   * Update domain health
   */
  async updateDomainHealth(domainId: string, health: DomainHealth): Promise<void> {
    await query(`
      UPDATE delivery_domain_configs
      SET health_score = $1, last_health_check = NOW(), consecutive_failures = $2
      WHERE domain_id = $3
    `, [health.score, health.consecutiveFailures, domainId])
  }

  /**
   * Update IP reputation
   */
  async updateIPReputation(ip: string, reputation: number): Promise<void> {
    await query(`
      UPDATE delivery_ip_configs
      SET reputation = $1, last_health_check = NOW()
      WHERE ip = $2
    `, [reputation, ip])
  }

  /**
   * Get optimization recommendations
   */
  async getOptimizationRecommendations(organizationId: string): Promise<string[]> {
    const recommendations: string[] = []
    const config = await this.getConfig(organizationId)
    if (!config) return recommendations

    // Check current metrics
    const metrics = await this.getDeliveryMetrics(
      organizationId,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      new Date()
    )

    if (metrics.length > 0) {
      const latest = metrics[0]

      if (latest.bounceRate > 0.05) {
        recommendations.push('High bounce rate detected. Consider warming domains or checking email quality.')
      }

      if (latest.complaintRate > 0.001) {
        recommendations.push('Complaint rate is elevated. Review email content and sending practices.')
      }

      if (latest.deliveryRate < 0.95) {
        recommendations.push('Delivery rate below 95%. Consider IP rotation or domain warming.')
      }
    }

    // Check domain rotation
    if (config.domainRotation.enabled && config.domainRotation.domains.length < 3) {
      recommendations.push('Consider adding more domains for better rotation and redundancy.')
    }

    // Check IP rotation
    if (config.ipRotation.enabled && config.ipRotation.ips.length < 2) {
      recommendations.push('Multiple IPs recommended for high-volume sending.')
    }

    return recommendations
  }

  // Private methods

  private async getConfig(organizationId: string): Promise<DeliveryConfig | null> {
    if (this.configCache.has(organizationId)) {
      return this.configCache.get(organizationId)!
    }

    const result = await query(`
      SELECT * FROM delivery_configs WHERE organization_id = $1
    `, [organizationId])

    if (result.rows.length === 0) return null

    const config = JSON.parse(result.rows[0].config)
    config.id = result.rows[0].id
    config.createdAt = result.rows[0].created_at
    config.updatedAt = result.rows[0].updated_at

    this.configCache.set(organizationId, config)
    return config
  }

  private async getDailySends(organizationId: string): Promise<number> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const result = await query(`
      SELECT COUNT(*) as count FROM delivery_events
      WHERE organization_id = $1 AND timestamp >= $2
    `, [organizationId, today])

    return parseInt(result.rows[0].count) || 0
  }

  private async getHourlySends(organizationId: string): Promise<number> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const result = await query(`
      SELECT COUNT(*) as count FROM delivery_events
      WHERE organization_id = $1 AND timestamp >= $2
    `, [organizationId, hourAgo])

    return parseInt(result.rows[0].count) || 0
  }

  private async getMinuteSends(organizationId: string): Promise<number> {
    const minuteAgo = new Date(Date.now() - 60 * 1000)

    const result = await query(`
      SELECT COUNT(*) as count FROM delivery_events
      WHERE organization_id = $1 AND timestamp >= $2
    `, [organizationId, minuteAgo])

    return parseInt(result.rows[0].count) || 0
  }

  private async checkThrottlingRules(config: DeliveryConfig, organizationId: string): Promise<SendDecision> {
    for (const rule of config.throttlingRules) {
      if (!rule.enabled) continue

      const triggered = await this.evaluateThrottlingCondition(rule.condition, organizationId)
      if (triggered) {
        return {
          canSend: false,
          reason: `Throttling rule triggered: ${rule.condition.metric} ${rule.condition.operator} ${rule.condition.value}`,
          throttleDelay: rule.action.duration * 60 * 1000
        }
      }
    }

    return { canSend: true }
  }

  private async checkWarmingSchedule(config: DeliveryConfig, organizationId: string): Promise<SendDecision> {
    // Get account age in days
    const accountAge = await this.getAccountAge(organizationId)
    const schedule = config.warmingSchedule.find(s => s.day === accountAge)

    if (!schedule) {
      // Past warming period
      return { canSend: true }
    }

    const hourlySends = await this.getHourlySends(organizationId)
    if (hourlySends >= schedule.maxSends) {
      const nextInterval = new Date(Date.now() + schedule.intervalMinutes * 60 * 1000)
      return {
        canSend: false,
        reason: `Warming schedule limit reached (${hourlySends}/${schedule.maxSends})`,
        nextAvailableSlot: nextInterval
      }
    }

    return { canSend: true }
  }

  private async selectDomain(config: DeliveryConfig, organizationId: string): Promise<SendDecision> {
    if (!config.domainRotation.enabled || config.domainRotation.domains.length === 0) {
      return { canSend: true }
    }

    // Get domain performance
    const domainPerformance = await this.getDomainPerformance(organizationId)

    let selectedDomain: DomainConfig | null = null

    switch (config.domainRotation.strategy) {
      case 'round_robin':
        selectedDomain = this.selectRoundRobinDomain(config.domainRotation.domains)
        break
      case 'performance_based':
        selectedDomain = this.selectPerformanceBasedDomain(config.domainRotation.domains, domainPerformance)
        break
      case 'volume_based':
        selectedDomain = this.selectVolumeBasedDomain(config.domainRotation.domains)
        break
    }

    if (!selectedDomain) {
      return { canSend: false, reason: 'No healthy domains available' }
    }

    // Check domain hourly limit
    const domainHourlySends = await this.getDomainHourlySends(selectedDomain.domainId)
    if (domainHourlySends >= config.domainRotation.maxPerDomainHourly) {
      return {
        canSend: false,
        reason: `Domain hourly limit reached for ${selectedDomain.domainId}`
      }
    }

    return { canSend: true, recommendedDomain: selectedDomain.domainId }
  }

  private async selectIP(config: DeliveryConfig, organizationId: string): Promise<SendDecision> {
    if (!config.ipRotation.enabled || config.ipRotation.ips.length === 0) {
      return { canSend: true }
    }

    let selectedIP: IPConfig | null = null

    switch (config.ipRotation.rotationStrategy) {
      case 'round_robin':
        selectedIP = this.selectRoundRobinIP(config.ipRotation.ips)
        break
      case 'least_used':
        selectedIP = this.selectLeastUsedIP(config.ipRotation.ips)
        break
      case 'performance_based':
        selectedIP = this.selectPerformanceBasedIP(config.ipRotation.ips)
        break
    }

    if (!selectedIP) {
      return { canSend: false, reason: 'No healthy IPs available' }
    }

    // Check IP limits
    if (selectedIP.currentDaySends >= selectedIP.dailySendLimit) {
      return { canSend: false, reason: `IP daily limit reached for ${selectedIP.ip}` }
    }

    const ipHourlySends = await this.getIPHourlySends(selectedIP.ip)
    if (ipHourlySends >= config.ipRotation.maxPerIPHourly) {
      return { canSend: false, reason: `IP hourly limit reached for ${selectedIP.ip}` }
    }

    return { canSend: true, recommendedIP: selectedIP.ip }
  }

  private async checkReputation(config: DeliveryConfig, organizationId: string): Promise<SendDecision> {
    if (!config.reputationMonitoring.enabled) return { canSend: true }

    // Check current metrics against thresholds
    const metrics = await this.getDeliveryMetrics(
      organizationId,
      new Date(Date.now() - 60 * 60 * 1000), // Last hour
      new Date()
    )

    if (metrics.length > 0) {
      const latest = metrics[0]

      if (latest.bounceRate > config.reputationMonitoring.alertThresholds.bounceRate) {
        return {
          canSend: false,
          reason: `Bounce rate too high: ${(latest.bounceRate * 100).toFixed(1)}%`
        }
      }

      if (latest.complaintRate > config.reputationMonitoring.alertThresholds.complaintRate) {
        return {
          canSend: false,
          reason: `Complaint rate too high: ${(latest.complaintRate * 100).toFixed(2)}%`
        }
      }
    }

    return { canSend: true }
  }

  private async getAccountAge(organizationId: string): Promise<number> {
    const result = await query(`
      SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as age_days
      FROM organizations WHERE id = $1
    `, [organizationId])

    return Math.floor(parseFloat(result.rows[0].age_days) || 0)
  }

  private async getDomainPerformance(organizationId: string): Promise<Record<string, any>> {
    const result = await query(`
      SELECT domain,
             COUNT(*) as total_sends,
             COUNT(CASE WHEN result = 'delivered' THEN 1 END) as delivered,
             COUNT(CASE WHEN result = 'bounced' THEN 1 END) as bounced
      FROM delivery_events
      WHERE organization_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'
      GROUP BY domain
    `, [organizationId])

    const performance: Record<string, any> = {}
    for (const row of result.rows) {
      performance[row.domain] = {
        totalSends: parseInt(row.total_sends) || 0,
        delivered: parseInt(row.delivered) || 0,
        bounced: parseInt(row.bounced) || 0,
        deliveryRate: row.total_sends > 0 ? row.delivered / row.total_sends : 0
      }
    }

    return performance
  }

  private async getDomainHourlySends(domainId: string): Promise<number> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const result = await query(`
      SELECT COUNT(*) as count FROM delivery_events
      WHERE domain = $1 AND timestamp >= $2
    `, [domainId, hourAgo])

    return parseInt(result.rows[0].count) || 0
  }

  private async getIPHourlySends(ip: string): Promise<number> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const result = await query(`
      SELECT COUNT(*) as count FROM delivery_events
      WHERE ip = $1 AND timestamp >= $2
    `, [ip, hourAgo])

    return parseInt(result.rows[0].count) || 0
  }

  private selectRoundRobinDomain(domains: DomainConfig[]): DomainConfig | null {
    const healthyDomains = domains.filter(d => d.consecutiveFailures === 0)
    if (healthyDomains.length === 0) return null

    // Simple round-robin based on last used
    healthyDomains.sort((a, b) => a.lastUsed.getTime() - b.lastUsed.getTime())
    return healthyDomains[0]
  }

  private selectPerformanceBasedDomain(domains: DomainConfig[], performance: Record<string, any>): DomainConfig | null {
    const healthyDomains = domains.filter(d => d.consecutiveFailures === 0)
    if (healthyDomains.length === 0) return null

    // Select domain with best delivery rate
    let bestDomain = healthyDomains[0]
    let bestScore = 0

    for (const domain of healthyDomains) {
      const perf = performance[domain.domainId]
      const score = perf ? perf.deliveryRate * domain.healthScore : domain.healthScore
      if (score > bestScore) {
        bestScore = score
        bestDomain = domain
      }
    }

    return bestDomain
  }

  private selectVolumeBasedDomain(domains: DomainConfig[]): DomainConfig | null {
    const healthyDomains = domains.filter(d => d.consecutiveFailures === 0)
    if (healthyDomains.length === 0) return null

    // Select domain with lowest recent usage
    healthyDomains.sort((a, b) => a.lastUsed.getTime() - b.lastUsed.getTime())
    return healthyDomains[0]
  }

  private selectRoundRobinIP(ips: IPConfig[]): IPConfig | null {
    const healthyIPs = ips.filter(ip => ip.reputation > 0.7 && ip.consecutiveFailures === 0)
    if (healthyIPs.length === 0) return null

    healthyIPs.sort((a, b) => a.lastHealthCheck.getTime() - b.lastHealthCheck.getTime())
    return healthyIPs[0]
  }

  private selectLeastUsedIP(ips: IPConfig[]): IPConfig | null {
    const healthyIPs = ips.filter(ip => ip.reputation > 0.7 && ip.consecutiveFailures === 0)
    if (healthyIPs.length === 0) return null

    // Select IP with lowest current day sends
    healthyIPs.sort((a, b) => a.currentDaySends - b.currentDaySends)
    return healthyIPs[0]
  }

  private selectPerformanceBasedIP(ips: IPConfig[]): IPConfig | null {
    const healthyIPs = ips.filter(ip => ip.reputation > 0.7 && ip.consecutiveFailures === 0)
    if (healthyIPs.length === 0) return null

    // Select IP with best reputation
    healthyIPs.sort((a, b) => b.reputation - a.reputation)
    return healthyIPs[0]
  }

  private async evaluateThrottlingCondition(condition: any, organizationId: string): Promise<boolean> {
    const timeWindow = new Date(Date.now() - condition.timeWindow * 60 * 1000)

    let query: string
    let params: any[]

    switch (condition.metric) {
      case 'bounce_rate':
        query = `
          SELECT
            COUNT(CASE WHEN result = 'bounced' THEN 1 END)::float / COUNT(*) as rate
          FROM delivery_events
          WHERE organization_id = $1 AND timestamp >= $2
        `
        params = [organizationId, timeWindow]
        break

      case 'complaint_rate':
        query = `
          SELECT
            COUNT(CASE WHEN result = 'complained' THEN 1 END)::float / COUNT(*) as rate
          FROM delivery_events
          WHERE organization_id = $1 AND timestamp >= $2
        `
        params = [organizationId, timeWindow]
        break

      case 'send_volume':
        query = `SELECT COUNT(*) as volume FROM delivery_events WHERE organization_id = $1 AND timestamp >= $2`
        params = [organizationId, timeWindow]
        break

      default:
        return false
    }

    const result = await query(query, params)
    const value = parseFloat(result.rows[0].rate || result.rows[0].volume) || 0

    switch (condition.operator) {
      case 'greater_than':
        return value > condition.value
      case 'less_than':
        return value < condition.value
      case 'equals':
        return value === condition.value
      default:
        return false
    }
  }

  private async updateMetricsBuffer(organizationId: string, result: string): Promise<void> {
    // Simple in-memory buffer for metrics
    // In production, this would be more sophisticated
    const now = new Date()
    const hourKey = `${organizationId}_${now.getFullYear()}_${now.getMonth()}_${now.getDate()}_${now.getHours()}`

    // This is a simplified version - real implementation would aggregate properly
  }

  private async checkThrottlingTriggers(organizationId: string): Promise<void> {
    // Check if any throttling rules should be triggered
    // Implementation would evaluate conditions and apply throttling
  }

  private getDefaultWarmingSchedule(): WarmingSchedule[] {
    return [
      { day: 1, maxSends: 50, intervalMinutes: 60, rampUpPercentage: 0 },
      { day: 2, maxSends: 100, intervalMinutes: 30, rampUpPercentage: 100 },
      { day: 3, maxSends: 200, intervalMinutes: 15, rampUpPercentage: 100 },
      { day: 4, maxSends: 400, intervalMinutes: 10, rampUpPercentage: 100 },
      { day: 5, maxSends: 800, intervalMinutes: 5, rampUpPercentage: 100 },
      { day: 6, maxSends: 1600, intervalMinutes: 3, rampUpPercentage: 100 },
      { day: 7, maxSends: 3200, intervalMinutes: 2, rampUpPercentage: 100 },
      // Continue ramping up to 50K over 30 days
    ]
  }

  private getDefaultThrottlingRules(): ThrottlingRule[] {
    return [
      {
        id: 'high_bounce_rate',
        condition: {
          metric: 'bounce_rate',
          operator: 'greater_than',
          value: 0.05,
          timeWindow: 60
        },
        action: {
          type: 'reduce_volume',
          value: 50, // 50% reduction
          duration: 60 // 1 hour
        },
        enabled: true
      },
      {
        id: 'high_complaint_rate',
        condition: {
          metric: 'complaint_rate',
          operator: 'greater_than',
          value: 0.001,
          timeWindow: 60
        },
        action: {
          type: 'pause_sends',
          value: 0,
          duration: 120 // 2 hours
        },
        enabled: true
      }
    ]
  }

  private getDefaultReputationMetrics(): ReputationMetric[] {
    return [
      {
        name: 'Google Postmaster',
        provider: 'google_postmaster',
        checkInterval: 24,
        lastCheck: new Date(),
        score: 0
      },
      {
        name: 'Microsoft SNAR',
        provider: 'microsoft_snar',
        checkInterval: 24,
        lastCheck: new Date(),
        score: 0
      }
    ]
  }

  private getDefaultRecoveryActions(): RecoveryAction[] {
    return [
      {
        trigger: 'bounce_rate_high',
        action: 'reduce_volume',
        value: 50,
        duration: 24
      },
      {
        trigger: 'complaint_rate_high',
        action: 'pause_domain',
        value: 0,
        duration: 6
      }
    ]
  }
}

// Singleton instance
export const deliveryOptimizer = new EnhancedDeliveryOptimizer()

/**
 * Initialize delivery optimization for all organizations
 */
export async function initializeDeliveryOptimization(): Promise<void> {
  // Get all organizations
  const result = await query('SELECT id FROM organizations')

  for (const row of result.rows) {
    const existing = await query('SELECT id FROM delivery_configs WHERE organization_id = $1', [row.id])
    if (existing.rows.length === 0) {
      await deliveryOptimizer.initializeOrganization(row.id)
    }
  }
}

/**
 * Quick send decision helper
 */
export async function canSendEmail(
  organizationId: string,
  emailData: { to: string; from: string; subject: string; campaignId?: string; sequenceId?: string }
): Promise<SendDecision> {
  return await deliveryOptimizer.makeSendDecision(organizationId, emailData)
}

/**
 * Record delivery result
 */
export async function recordDeliveryResult(
  organizationId: string,
  emailData: { to: string; from: string; domain: string; ip?: string; campaignId?: string; sequenceId?: string },
  result: 'delivered' | 'bounced' | 'complained' | 'unsubscribed'
): Promise<void> {
  await deliveryOptimizer.recordSendEvent(organizationId, emailData, result)
}