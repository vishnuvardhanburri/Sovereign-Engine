import { queryOne } from '@/lib/db'
import { evaluatePromptGovernance } from '@/lib/local-ai/prompt-governance'
import { classifyReplyDeterministically } from '@/lib/local-ai/deterministic-fallback'
import { recordUsage } from '@/lib/licensing/enforcement'
import { appendOperationalEvent } from '@/lib/operational-events'

interface LocalModelRow {
  id: string
  model_name: string
  endpoint_url: string
}

export async function routeLocalAiTask(input: {
  clientId: number
  taskType: 'reply_classification' | 'copy_governance' | 'risk_analysis' | 'lead_scoring'
  prompt: string
  timeoutMs?: number
}): Promise<{
  route: 'ollama' | 'deterministic_fallback' | 'blocked'
  text: string
  model?: string
  governance: ReturnType<typeof evaluatePromptGovernance>
}> {
  const governance = evaluatePromptGovernance(input.prompt)
  if (governance.verdict === 'block') {
    await recordAiGovernance(input.clientId, input.taskType, 'blocked', governance)
    return { route: 'blocked', text: '', governance }
  }

  const model = await queryOne<LocalModelRow>(
    `SELECT id, model_name, endpoint_url
     FROM local_ai_models
     WHERE (client_id = $1 OR client_id IS NULL)
       AND status = 'available'
       AND task_types ? $2
     ORDER BY priority DESC
     LIMIT 1`,
    [input.clientId, input.taskType]
  )

  if (model) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 2500)
      const response = await fetch(`${model.endpoint_url.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: model.model_name,
          prompt: governance.sanitizedText,
          stream: false,
        }),
      })
      clearTimeout(timeout)

      if (response.ok) {
        const body = (await response.json()) as { response?: string }
        const text = body.response?.trim() ?? ''
        await recordUsage({
          clientId: input.clientId,
          meterType: 'ai_inference',
          source: 'ollama',
          metadata: { taskType: input.taskType, model: model.model_name },
        })
        await recordAiGovernance(input.clientId, input.taskType, 'ollama', governance, model.id)
        return { route: 'ollama', text, model: model.model_name, governance }
      }
    } catch {
      // Local model is optional by design. Deterministic governance keeps the system operational.
    }
  }

  const fallback =
    input.taskType === 'reply_classification'
      ? JSON.stringify(classifyReplyDeterministically({ body: governance.sanitizedText }))
      : JSON.stringify({ verdict: governance.verdict, riskScore: governance.riskScore, reasons: governance.reasons })

  await recordAiGovernance(input.clientId, input.taskType, 'deterministic_fallback', governance)
  return { route: 'deterministic_fallback', text: fallback, governance }
}

async function recordAiGovernance(
  clientId: number,
  taskType: string,
  route: 'ollama' | 'deterministic_fallback' | 'blocked',
  governance: ReturnType<typeof evaluatePromptGovernance>,
  modelId?: string
) {
  await appendOperationalEvent({
    clientId,
    eventType: 'ai.governance_evaluated',
    aggregateType: 'ai_task',
    aggregateId: `${taskType}:${governance.promptHash.slice(0, 16)}`,
    payload: {
      taskType,
      route,
      verdict: governance.verdict,
      riskScore: governance.riskScore,
      piiMasked: governance.piiMasked,
    },
  })

  const { query } = await import('@/lib/db')
  await query(
    `INSERT INTO ai_governance_events (
       client_id,
       model_id,
       task_type,
       route,
       prompt_hash,
       pii_masked,
       compliance_verdict,
       risk_score,
       evidence
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      clientId,
      modelId ?? null,
      taskType,
      route,
      governance.promptHash,
      governance.piiMasked,
      governance.verdict,
      governance.riskScore,
      JSON.stringify({ reasons: governance.reasons }),
    ]
  )
}
