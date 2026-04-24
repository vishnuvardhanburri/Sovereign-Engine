import { query, queryOne } from '@/lib/db'
import { appEnv } from '@/lib/env'

export interface CopilotSettings {
  clientId: number
  autonomousMode: boolean
  updatedAt: string
}

export async function getCopilotSettings(input?: { clientId?: number }): Promise<CopilotSettings> {
  const clientId = input?.clientId ?? appEnv.defaultClientId()
  const row = await queryOne<{ autonomous_mode: boolean | null; updated_at: string | Date | null }>(
    `
    SELECT autonomous_mode, updated_at
    FROM copilot_settings
    WHERE client_id = $1
    LIMIT 1
  `,
    [clientId],
  )

  if (!row) {
    // Default row if not present yet.
    await query(
      `
      INSERT INTO copilot_settings (client_id, autonomous_mode)
      VALUES ($1, FALSE)
      ON CONFLICT (client_id) DO NOTHING
    `,
      [clientId],
    )

    return {
      clientId,
      autonomousMode: false,
      updatedAt: new Date().toISOString(),
    }
  }

  return {
    clientId,
    autonomousMode: Boolean(row.autonomous_mode),
    updatedAt: (row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()),
  }
}

export async function setAutonomousMode(input: {
  clientId?: number
  autonomousMode: boolean
}): Promise<CopilotSettings> {
  const clientId = input.clientId ?? appEnv.defaultClientId()
  const autonomousMode = Boolean(input.autonomousMode)

  const updated = await queryOne<{ autonomous_mode: boolean; updated_at: string | Date }>(
    `
    INSERT INTO copilot_settings (client_id, autonomous_mode, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (client_id) DO UPDATE
    SET autonomous_mode = EXCLUDED.autonomous_mode,
        updated_at = NOW()
    RETURNING autonomous_mode, updated_at
  `,
    [clientId, autonomousMode],
  )

  return {
    clientId,
    autonomousMode: Boolean(updated?.autonomous_mode),
    updatedAt: updated?.updated_at ? new Date(updated.updated_at).toISOString() : new Date().toISOString(),
  }
}

