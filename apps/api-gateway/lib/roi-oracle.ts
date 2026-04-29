export type RoiOracleInput = {
  sent: number
  delivered: number
  clicked: number
  replies: number
  bounces: number
  complaints: number
  inboxPlacementRate: number
  leadValueUsd?: number
  costPerSendUsd?: number
  infraDailyUsd?: number
  proxyDailyUsd?: number
  domainDailyUsd?: number
}

export type RoiOracleResult = {
  sent: number
  delivered: number
  clicked: number
  replies: number
  bounces: number
  complaints: number
  successRate: number
  clickRate: number
  replyRate: number
  bounceRate: number
  complaintRate: number
  inboxPlacementRate: number
  estimatedInboxed: number
  leadValueUsd: number
  costPerSendUsd: number
  infraDailyUsd: number
  proxyDailyUsd: number
  domainDailyUsd: number
  variableDeliveryCostUsd: number
  fixedDeliveryCostUsd: number
  totalDeliveryCostUsd: number
  estimatedValueUsd: number
  netProfitUsd: number
  roiMultiple: number | null
  observedIntentSignals: number
  confidence: 'low' | 'medium' | 'high'
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? clamp(numerator / denominator, 0, 1) : 0
}

export function calculateRoiOracle(input: RoiOracleInput): RoiOracleResult {
  const sent = Math.max(0, Math.floor(finite(input.sent)))
  const delivered = Math.max(0, Math.floor(finite(input.delivered)))
  const clicked = Math.max(0, Math.floor(finite(input.clicked)))
  const replies = Math.max(0, Math.floor(finite(input.replies)))
  const bounces = Math.max(0, Math.floor(finite(input.bounces)))
  const complaints = Math.max(0, Math.floor(finite(input.complaints)))
  const inboxPlacementRate = clamp(finite(input.inboxPlacementRate, 1), 0, 1)
  const leadValueUsd = Math.max(0, finite(input.leadValueUsd ?? 0.75, 0.75))
  const costPerSendUsd = Math.max(0, finite(input.costPerSendUsd ?? 0.002, 0.002))
  const infraDailyUsd = Math.max(0, finite(input.infraDailyUsd ?? 0))
  const proxyDailyUsd = Math.max(0, finite(input.proxyDailyUsd ?? 0))
  const domainDailyUsd = Math.max(0, finite(input.domainDailyUsd ?? 0))

  const deliveredOrSent = delivered > 0 ? delivered : Math.max(0, sent - bounces)
  const successRate = sent > 0 ? clamp(deliveredOrSent / sent, 0, 1) : 0
  const estimatedInboxed = Math.floor(sent * successRate * inboxPlacementRate)
  const variableDeliveryCostUsd = sent * costPerSendUsd
  const fixedDeliveryCostUsd = infraDailyUsd + proxyDailyUsd + domainDailyUsd
  const totalDeliveryCostUsd = variableDeliveryCostUsd + fixedDeliveryCostUsd
  const estimatedValueUsd = estimatedInboxed * leadValueUsd
  const netProfitUsd = estimatedValueUsd - totalDeliveryCostUsd

  return {
    sent,
    delivered,
    clicked,
    replies,
    bounces,
    complaints,
    successRate,
    clickRate: rate(clicked, sent),
    replyRate: rate(replies, sent),
    bounceRate: rate(bounces, sent),
    complaintRate: rate(complaints, sent),
    inboxPlacementRate,
    estimatedInboxed,
    leadValueUsd,
    costPerSendUsd,
    infraDailyUsd,
    proxyDailyUsd,
    domainDailyUsd,
    variableDeliveryCostUsd,
    fixedDeliveryCostUsd,
    totalDeliveryCostUsd,
    estimatedValueUsd,
    netProfitUsd,
    roiMultiple: totalDeliveryCostUsd > 0 ? estimatedValueUsd / totalDeliveryCostUsd : null,
    observedIntentSignals: clicked + replies,
    confidence: sent >= 10_000 ? 'high' : sent >= 1_000 ? 'medium' : 'low',
  }
}
