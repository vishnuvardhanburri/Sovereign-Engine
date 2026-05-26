export const AUTONOMOUS_QUEUE_TOPOLOGY = {
  ingestion: process.env.INGESTION_QUEUE ?? 'xv-ingestion-queue',
  enrichment: process.env.ENRICHMENT_QUEUE ?? 'xv-enrichment-queue',
  scoring: process.env.SCORING_QUEUE ?? 'xv-scoring-queue',
  decision: process.env.DECISION_QUEUE ?? 'xv-decision-queue',
  send: process.env.SEND_QUEUE ?? 'xv-send-queue',
  conversation: process.env.CONVERSATION_QUEUE ?? 'xv-conversation-queue',
  workflow: process.env.WORKFLOW_QUEUE ?? 'xv-workflow-queue',
  telemetry: process.env.TELEMETRY_QUEUE ?? 'xv-telemetry-queue',
} as const

export type AutonomousQueueName = keyof typeof AUTONOMOUS_QUEUE_TOPOLOGY

export function queueName(name: AutonomousQueueName): string {
  return AUTONOMOUS_QUEUE_TOPOLOGY[name]
}

export function allAutonomousQueues(): Array<{ name: AutonomousQueueName; queue: string }> {
  return Object.entries(AUTONOMOUS_QUEUE_TOPOLOGY).map(([name, queue]) => ({
    name: name as AutonomousQueueName,
    queue,
  }))
}
