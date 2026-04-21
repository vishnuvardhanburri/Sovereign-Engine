import { query } from '@/lib/db'

export interface SystemEvent {
  event_type: string
  source_agent: string
  payload: Record<string, unknown>
}

export async function emitEvent(event: SystemEvent): Promise<SystemEvent> {
  try {
    await query(
      `INSERT INTO operator_actions (client_id, campaign_id, action_type, summary, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        0,
        null,
        event.event_type,
        `${event.source_agent} event`,
        {
          ...event.payload,
          source_agent: event.source_agent,
          event_type: event.event_type,
        },
      ]
    )
  } catch {
    // fail safely: event object is still returned to caller
  }

  return event
}
