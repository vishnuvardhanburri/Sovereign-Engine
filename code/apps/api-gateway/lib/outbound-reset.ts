import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'
import { query, transaction, type QueryExecutor } from '@/lib/db'

export type OutboundResetStep = {
  table: string
  description: string
  countSql: string
  deleteSql: string
}

export type OutboundResetRowCount = {
  table: string
  description: string
  matched: number
  deleted: number
}

export type OutboundResetInput = {
  clientId: number
  dryRun?: boolean
  apply?: boolean
  queueScanLimit?: number
}

export const OUTBOUND_RESET_PRESERVED_TABLES = [
  'clients',
  'domains',
  'identities',
  'suppression_list',
  'reputation_state',
  'reputation_events',
  'domain_pause_events',
]

export const OUTBOUND_RESET_DELETE_STEPS: OutboundResetStep[] = [
  {
    table: 'events',
    description: 'sent mail, bounce, failed, queued, reply event display history',
    countSql: `SELECT COUNT(*)::int AS count FROM events WHERE client_id = $1`,
    deleteSql: `DELETE FROM events WHERE client_id = $1`,
  },
  {
    table: 'queue_jobs',
    description: 'database-backed pending/retry/completed queue records',
    countSql: `SELECT COUNT(*)::int AS count FROM queue_jobs WHERE client_id = $1`,
    deleteSql: `DELETE FROM queue_jobs WHERE client_id = $1`,
  },
  {
    table: 'email_threads',
    description: 'conversation thread state tied to old prospects',
    countSql: `SELECT COUNT(*)::int AS count FROM email_threads WHERE client_id = $1`,
    deleteSql: `DELETE FROM email_threads WHERE client_id = $1`,
  },
  {
    table: 'campaigns',
    description: 'old outbound campaigns',
    countSql: `SELECT COUNT(*)::int AS count FROM campaigns WHERE client_id = $1`,
    deleteSql: `DELETE FROM campaigns WHERE client_id = $1`,
  },
  {
    table: 'sequence_steps',
    description: 'old sequence step copy for deleted sequences',
    countSql: `
      SELECT COUNT(*)::int AS count
      FROM sequence_steps
      WHERE sequence_id IN (SELECT id FROM sequences WHERE client_id = $1)
    `,
    deleteSql: `
      DELETE FROM sequence_steps
      WHERE sequence_id IN (SELECT id FROM sequences WHERE client_id = $1)
    `,
  },
  {
    table: 'sequences',
    description: 'old message sequences',
    countSql: `SELECT COUNT(*)::int AS count FROM sequences WHERE client_id = $1`,
    deleteSql: `DELETE FROM sequences WHERE client_id = $1`,
  },
  {
    table: 'public_email_evidence',
    description: 'old lead evidence ledger',
    countSql: `SELECT COUNT(*)::int AS count FROM public_email_evidence WHERE client_id = $1`,
    deleteSql: `DELETE FROM public_email_evidence WHERE client_id = $1`,
  },
  {
    table: 'compliant_domain_scans',
    description: 'old domain discovery scan ledger',
    countSql: `SELECT COUNT(*)::int AS count FROM compliant_domain_scans WHERE client_id = $1`,
    deleteSql: `DELETE FROM compliant_domain_scans WHERE client_id = $1`,
  },
  {
    table: 'email_validations',
    description: 'validation cache only for old contacts being removed',
    countSql: `
      SELECT COUNT(*)::int AS count
      FROM email_validations
      WHERE normalized_email IN (
        SELECT LOWER(email)
        FROM contacts
        WHERE client_id = $1
      )
    `,
    deleteSql: `
      DELETE FROM email_validations
      WHERE normalized_email IN (
        SELECT LOWER(email)
        FROM contacts
        WHERE client_id = $1
      )
    `,
  },
  {
    table: 'contacts',
    description: 'old prospects/leads',
    countSql: `SELECT COUNT(*)::int AS count FROM contacts WHERE client_id = $1`,
    deleteSql: `DELETE FROM contacts WHERE client_id = $1`,
  },
]

export function buildOutboundResetPreview(input: Required<Pick<OutboundResetInput, 'clientId'>> & {
  dryRun: boolean
  apply: boolean
}) {
  return {
    ok: true,
    mode: 'safe_outbound_reset',
    clientId: input.clientId,
    dryRun: input.dryRun,
    apply: input.apply,
    requiresApplyParam: true,
    clears: OUTBOUND_RESET_DELETE_STEPS.map((step) => ({
      table: step.table,
      description: step.description,
    })),
    preserves: OUTBOUND_RESET_PRESERVED_TABLES,
    safety:
      'Prospects, campaigns, queue records, and sent-event noise are cleared. Domains, identities, suppression, and reputation memory are preserved.',
  }
}

async function countStep(
  executor: QueryExecutor,
  step: OutboundResetStep,
  clientId: number
): Promise<number> {
  const result = await executor<{ count: number | string }>(step.countSql, [clientId])
  return Number(result.rows[0]?.count ?? 0)
}

async function deleteStep(
  executor: QueryExecutor,
  step: OutboundResetStep,
  clientId: number
): Promise<number> {
  const result = await executor(step.deleteSql, [clientId])
  return result.rowCount ?? 0
}

async function resetDatabaseRows(input: Required<Pick<OutboundResetInput, 'clientId' | 'dryRun' | 'apply'>>) {
  if (input.dryRun || !input.apply) {
    const rows: OutboundResetRowCount[] = []
    for (const step of OUTBOUND_RESET_DELETE_STEPS) {
      rows.push({
        table: step.table,
        description: step.description,
        matched: await countStep(query, step, input.clientId),
        deleted: 0,
      })
    }
    return rows
  }

  return transaction(async (executor) => {
    const rows: OutboundResetRowCount[] = []
    for (const step of OUTBOUND_RESET_DELETE_STEPS) {
      const matched = await countStep(executor, step, input.clientId)
      const deleted = await deleteStep(executor, step, input.clientId)
      rows.push({
        table: step.table,
        description: step.description,
        matched,
        deleted,
      })
    }
    return rows
  })
}

async function resetBullMq(input: Required<Pick<OutboundResetInput, 'clientId' | 'dryRun' | 'apply' | 'queueScanLimit'>>) {
  const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'
  const queue = new Queue(queueName, { connection: { url: appEnv.redisUrl() } })
  const statuses = ['waiting', 'delayed', 'failed', 'completed', 'prioritized', 'waiting-children', 'paused'] as const
  let matched = 0
  let removed = 0
  let skipped = 0

  try {
    for (const status of statuses) {
      const jobs = await queue.getJobs([status], 0, input.queueScanLimit - 1, true)
      for (const job of jobs) {
        const jobClientId = Number(job.data?.clientId ?? job.data?.client_id ?? 0)
        if (jobClientId !== input.clientId) continue
        matched += 1
        if (input.dryRun || !input.apply) continue

        try {
          await job.remove()
          removed += 1
        } catch {
          skipped += 1
        }
      }
    }

    return {
      queue: queueName,
      scannedStatuses: statuses,
      matched,
      removed,
      skipped,
      scanLimitPerStatus: input.queueScanLimit,
    }
  } finally {
    await queue.close()
  }
}

export async function runOutboundReset(input: OutboundResetInput) {
  const clientId = Number(input.clientId || 1)
  const dryRun = input.dryRun ?? !input.apply
  const apply = input.apply === true
  const queueScanLimit = Math.max(1, Math.min(Number(input.queueScanLimit ?? 5000), 10000))
  const preview = buildOutboundResetPreview({ clientId, dryRun, apply })
  const rows = await resetDatabaseRows({ clientId, dryRun, apply })
  const bullmq = await resetBullMq({ clientId, dryRun, apply, queueScanLimit })

  return {
    ...preview,
    dryRun,
    apply,
    database: {
      rows,
      totalMatched: rows.reduce((sum, row) => sum + row.matched, 0),
      totalDeleted: rows.reduce((sum, row) => sum + row.deleted, 0),
    },
    bullmq,
  }
}
