import { query } from '@/lib/db'
import { runDailyMaintenance } from '@/lib/backend'
import { runDailyOperatorCycle } from '@/lib/agents/intelligence/insight-generation-agent'

export async function runDailyScheduler() {
  const maintenance = await runDailyMaintenance()

  const clients = await query<{ id: number }>(
    `SELECT id
     FROM clients
     WHERE operator_enabled = TRUE`
  )

  const reports = []
  for (const client of clients.rows) {
    reports.push(await runDailyOperatorCycle(client.id))
  }

  return {
    success: true,
    maintenance,
    reports,
  }
}
