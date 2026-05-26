import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Queue } from 'bullmq'
import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'
import { importContacts, runDailyMaintenance, type ContactInput } from '@/lib/backend'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'
import { buildDailyOutboundPlan } from '@/lib/daily-outbound'
import { searchDomainWithHunter, type HunterDomainEmail } from '@/lib/integrations/hunter'
import { validateBusinessEmailSyntax } from '@/lib/email-address'
import {
  buildApifyGoogleMapsActorInput,
  prepareMapsLeadContacts,
  resolveApifyMapsItems,
} from '@/lib/maps-lead-source'
import { buildGoogleSheetCsvUrl, prepareSheetContacts } from '@/lib/sheet-import'
import {
  approvedContactQueueBlockers,
  enrichProspectWithProviderValidation,
  enrichProspectWithPublicEmailEvidence,
  prospectNeedsExactPublicEmailEvidence,
  scoreProspectForResearchApproval,
  type ProspectResearchContact,
  type ProspectResearchDecision,
} from '@/lib/prospect-research'
import { leadScoutToContacts, scoutOpenLeads, verifyOpenLeadEvidenceTimeboxed } from '@/lib/lead-scout'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import { getOutboundTelegramDigest } from '@/lib/outbound-telegram-digest'
import { runOutboundEventRetention } from '@/lib/outbound-event-retention'
import { enqueueOutboundCycleJob } from '@/lib/outbound-cycle-queue'
import { reconcileBootstrapSendingDomain } from '@/lib/bootstrap-sending-domain'
import {
  buildSovereignCopyForLead,
  balanceSovereignOfferMix,
  inferSovereignOfferType,
  sovereignDealValueUsd,
} from '@/lib/outbound-copy'
import { getSendingCapacityDiagnosis } from '@/lib/sending-capacity-diagnostics'

type StageResult = {
  stage:
    | 'lead_scout'
    | 'maps_import'
    | 'sheet_import'
    | 'hunter_domain_search'
    | 'research_approval'
    | 'queue_outbound'
    | 'run_followups'
    | 'event_retention'
    | 'sender_reconcile'
  ok: boolean
  status: number
  skipped?: string
  data?: Record<string, unknown>
  error?: string
}

type ApprovedLead = {
  contact_id?: number
  email: string
  first_name: string
  company: string
  title?: string
  company_domain?: string
  consent_source: string
  reason_to_contact: string
  offer_type: 'direct' | 'agency'
  deal_value_usd: number
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const expected = appEnv.cronSecret()
  const provided =
    request.headers.get('x-cron-secret') ||
    request.nextUrl.searchParams.get('secret') ||
    ''
  return Boolean(expected && provided && provided === expected)
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function clampThreshold(value: unknown): number {
  const parsed = Number(value ?? 72)
  if (!Number.isFinite(parsed)) return 72
  return Math.max(50, Math.min(Math.trunc(parsed), 95))
}

function getNumericField(data: unknown, key: string): number {
  if (!data || typeof data !== 'object') return 0
  const value = (data as Record<string, unknown>)[key]
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getRecordCounts(data: unknown, key: string): Record<string, number> | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = (data as Record<string, unknown>)[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const counts: Record<string, number> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const safeKey = rawKey.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80) || 'unknown'
    const parsed = Number(rawValue)
    if (Number.isFinite(parsed) && parsed > 0) {
      counts[safeKey] = Math.trunc(parsed)
    }
  }

  return Object.keys(counts).length > 0 ? counts : undefined
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(Math.trunc(parsed), max))
}

function resolveTargetDailyVolume(params: URLSearchParams): number {
  return Math.max(
    1,
    clampLimit(
      params.get('targetDailyVolume') ||
        process.env.DAILY_OUTBOUND_TARGET_DAILY_VOLUME ||
        process.env.TARGET_DAILY_VOLUME ||
        process.env.INFRASTRUCTURE_TARGET_DAILY_VOLUME,
      800,
      1_000_000
    )
  )
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function normalizeDomain(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
}

function rootDomain(value: string): string {
  const parts = normalizeDomain(value).split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  return parts.slice(-2).join('.')
}

function isSameRootDomain(left: string, right: string): boolean {
  return Boolean(left && right && rootDomain(left) === rootDomain(right))
}

const SAFE_HUNTER_MAILBOX_PREFIXES = new Set([
  'bd',
  'business',
  'contact',
  'growth',
  'hello',
  'hi',
  'info',
  'marketing',
  'opportunities',
  'opportunity',
  'partner',
  'partners',
  'partnership',
  'partnerships',
  'sales',
  'team',
])

const BLOCKED_HUNTER_MAILBOX_PREFIXES = new Set([
  'abuse',
  'admin',
  'accounting',
  'billing',
  'career',
  'careers',
  'compliance',
  'copyright',
  'customer',
  'customerservice',
  'dmca',
  'donotreply',
  'finance',
  'fraud',
  'help',
  'helpdesk',
  'hr',
  'investor',
  'investors',
  'ir',
  'invoice',
  'invoices',
  'jobs',
  'legal',
  'media',
  'news',
  'no-reply',
  'noreply',
  'orders',
  'payroll',
  'postmaster',
  'pr',
  'press',
  'privacy',
  'security',
  'support',
  'tax',
  'webmaster',
])

const VALIDATION_PRIORITY_PREFIXES = new Set([
  'business',
  'contact',
  'growth',
  'hello',
  'hi',
  'info',
  'marketing',
  'opportunities',
  'opportunity',
  'partner',
  'partners',
  'partnership',
  'partnerships',
  'sales',
  'team',
])

function firstHunterSourceUrl(email: HunterDomainEmail): string {
  return email.sources.find((source) => asString(source.uri))?.uri || ''
}

function hunterEmailRejectionReason(input: {
  email: HunterDomainEmail
  domain: string
  minConfidence: number
}): string | null {
  const value = input.email.value.trim().toLowerCase()
  if (!validateBusinessEmailSyntax(value).valid) return 'invalid_email'
  const [prefix = '', emailDomain = ''] = value.split('@')
  if (!isSameRootDomain(emailDomain, input.domain)) return 'domain_mismatch'
  if (input.email.confidence < input.minConfidence) return 'low_confidence'
  if (BLOCKED_HUNTER_MAILBOX_PREFIXES.has(prefix)) return 'blocked_mailbox'
  if (!firstHunterSourceUrl(input.email)) return 'missing_public_source'

  if (SAFE_HUNTER_MAILBOX_PREFIXES.has(prefix)) return null

  // Hunter can return source-backed named corporate contacts. Permit only
  // high-confidence named contacts; never guessed/pattern-only addresses.
  const isNamedCorporate =
    input.email.type === 'personal' &&
    Boolean(input.email.firstName && input.email.lastName) &&
    input.email.confidence >= Math.max(input.minConfidence, 90)

  return isNamedCorporate ? null : 'unsafe_mailbox_role'
}

function hunterName(email: HunterDomainEmail): string | undefined {
  return [email.firstName, email.lastName].filter(Boolean).join(' ') || undefined
}

function pickRotatingValue(value: string | undefined, fallback: string): string {
  const items = String(value || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (items.length <= 1) return items[0] || fallback
  const day = Math.floor(Date.now() / 86_400_000)
  return items[day % items.length] || fallback
}

async function maybeRunDailyMaintenance(clientId: number): Promise<{
  ran: boolean
  reason: string
  lastResetAt: string | null
  domainsProcessed?: number
}> {
  if (!envBool(process.env.DAILY_OUTBOUND_AUTO_MAINTENANCE, true)) {
    return { ran: false, reason: 'auto_maintenance_disabled', lastResetAt: null }
  }

  const row = await query<{ last_reset_at: string | null }>(
    `SELECT MAX(last_reset_at)::text AS last_reset_at
     FROM domains
     WHERE client_id = $1`,
    [clientId]
  )
  const lastResetAt = row.rows[0]?.last_reset_at ?? null
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const lastResetTime = lastResetAt ? new Date(lastResetAt).getTime() : 0

  if (lastResetAt && Number.isFinite(lastResetTime) && lastResetTime >= todayUtc) {
    return { ran: false, reason: 'already_reset_today', lastResetAt }
  }

  const result = await runDailyMaintenance(clientId)

  return {
    ran: true,
    reason: lastResetAt ? 'stale_daily_reset' : 'missing_daily_reset',
    lastResetAt,
    domainsProcessed: result.domainsProcessed,
  }
}

function leadScoutOffset(limit: number): number {
  const rotationMinutes = clampLimit(process.env.LEAD_SCOUT_ROTATION_MINUTES, 60, 1_440)
  const windowMs = Math.max(rotationMinutes, 15) * 60_000
  return Math.floor(Date.now() / windowMs) * limit
}

function compactStage(stage: StageResult): StageResult {
  if (!stage.data) return stage
  const data = stage.data
  return {
    ...stage,
    data: {
      imported: getNumericField(data, 'imported'),
      prepared: getNumericField(data, 'prepared'),
      rejected: getNumericField(data, 'rejected'),
      scanned: getNumericField(data, 'scanned'),
      evidenceFetches: getNumericField(data, 'evidenceFetches'),
      evidenceMatches: getNumericField(data, 'evidenceMatches'),
      providerValidationChecks: getNumericField(data, 'providerValidationChecks'),
      providerValidationValid: getNumericField(data, 'providerValidationValid'),
      providerValidationInvalid: getNumericField(data, 'providerValidationInvalid'),
      providerValidationRisky: getNumericField(data, 'providerValidationRisky'),
      providerValidationUnknown: getNumericField(data, 'providerValidationUnknown'),
      providerValidationBlocked: getNumericField(data, 'providerValidationBlocked'),
      staleInvalidBlocked: getNumericField(data, 'staleInvalidBlocked'),
      hunterErrors: getNumericField(data, 'hunterErrors'),
      errorCounts: getRecordCounts(data, 'errorCounts'),
      rejectionCounts: getRecordCounts(data, 'rejectionCounts'),
      providerValidationProviderCounts: getRecordCounts(data, 'providerValidationProviderCounts'),
      providerValidationErrorCounts: getRecordCounts(data, 'providerValidationErrorCounts'),
      approved: getNumericField(data, 'approved'),
      queued: getNumericField(data, 'queued'),
      blockedUnverified: getNumericField(data, 'blockedUnverified'),
      skipped: typeof data.skipped === 'string' ? data.skipped : undefined,
      queue: typeof data.queue === 'string' ? data.queue : undefined,
      datasetId: typeof data.datasetId === 'string' ? data.datasetId : undefined,
      taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
      actorId: typeof data.actorId === 'string' ? data.actorId : undefined,
      sourceType: typeof data.sourceType === 'string' ? data.sourceType : undefined,
      estimatedPipelineValueUsd: getNumericField(data, 'estimatedPipelineValueUsd'),
      agencyQueued: getNumericField(data, 'agencyQueued'),
      directQueued: getNumericField(data, 'directQueued'),
      processed: getNumericField(data, 'processed'),
      emailsSent: getNumericField(data, 'emailsSent'),
      sequencesCompleted: getNumericField(data, 'sequencesCompleted'),
      errorsCount: getNumericField(data, 'errorsCount'),
      brevoFailuresDeleted: getNumericField(data, 'brevoFailuresDeleted'),
      staleGuardrailFailuresDeleted: getNumericField(data, 'staleGuardrailFailuresDeleted'),
      staleFailuresDeleted: getNumericField(data, 'staleFailuresDeleted'),
      bodiesRedacted: getNumericField(data, 'bodiesRedacted'),
      bootstrapped: getNumericField(data, 'bootstrapped'),
    },
  }
}

async function runEventRetentionStage(clientId: number): Promise<StageResult> {
  try {
    const data = await runOutboundEventRetention(clientId)
    return {
      stage: 'event_retention',
      ok: true,
      status: 200,
      data,
    }
  } catch (error) {
    return {
      stage: 'event_retention',
      ok: false,
      status: 500,
      error: safeError(error),
    }
  }
}

async function runSenderReconcileStage(clientId: number): Promise<StageResult> {
  try {
    const data = await reconcileBootstrapSendingDomain({ clientId })
    return {
      stage: 'sender_reconcile',
      ok: true,
      status: data.enabled ? 200 : 204,
      skipped: data.enabled ? undefined : data.reason,
      data: {
        enabled: data.enabled,
        markAuthValid: data.markAuthValid,
        domainDailyLimit: data.domainDailyLimit,
        identityDailyLimit: data.identityDailyLimit,
        bootstrapped: data.bootstrapped.length,
        domains: Array.from(new Set(data.bootstrapped.map((item) => item.domain))),
        identities: data.bootstrapped.map((item) => item.email),
      },
    }
  } catch (error) {
    return {
      stage: 'sender_reconcile',
      ok: false,
      status: 500,
      error: safeError(error),
    }
  }
}

async function runLeadScoutStage(input: {
  clientId: number
  dryRun: boolean
  limit: number
  industry?: string | null
  persona?: string | null
  region?: string | null
}): Promise<StageResult> {
  try {
    const result = scoutOpenLeads({
      industry:
        input.industry ||
        pickRotatingValue(process.env.LEAD_SCOUT_INDUSTRIES || process.env.LEAD_SCOUT_INDUSTRY, 'agency'),
      persona: input.persona || process.env.LEAD_SCOUT_PERSONA || 'partnerships',
      region: input.region || process.env.LEAD_SCOUT_REGION || 'global',
      limit: input.limit,
      offset: leadScoutOffset(input.limit),
    })
    const verifiedLeads = await verifyOpenLeadEvidenceTimeboxed(result.leads, {
      deadlineMs: 6_000,
      maxPagesPerLead: 3,
      requestTimeoutMs: 1_200,
    })
    const importableLeads = verifiedLeads.filter((lead) => lead.autoApprovalEligible)
    const contacts = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts: leadScoutToContacts(importableLeads),
          verify: false,
          enrich: false,
          dedupeByDomain: true,
        })

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'lead_scout',
        imported: contacts.length,
        scanned: result.leads.length,
        evidenceBacked: importableLeads.length,
        blockedUnverified: verifiedLeads.length - importableLeads.length,
        industry: result.industry,
        persona: result.persona,
      })
    }

    return {
      stage: 'lead_scout',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        imported: contacts.length,
        scanned: result.leads.length,
        evidenceBacked: importableLeads.length,
        blockedUnverified: verifiedLeads.length - importableLeads.length,
        industry: result.industry,
        persona: result.persona,
        region: result.region,
        guardrails: result.guardrails,
      },
    }
  } catch (error) {
    return {
      stage: 'lead_scout',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function runSheetImport(input: {
  clientId: number
  dryRun: boolean
  sheetUrl: string
  sheetLimit: number
}): Promise<StageResult> {
  try {
    const csvUrl = buildGoogleSheetCsvUrl(input.sheetUrl)
    const response = await fetch(csvUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })

    if (!response.ok) {
      return {
        stage: 'sheet_import',
        ok: false,
        status: response.status,
        error: `Google Sheet CSV export returned HTTP ${response.status}`,
      }
    }

    const csv = await response.text()
    if (/<!doctype html|<html/i.test(csv.slice(0, 500))) {
      return {
        stage: 'sheet_import',
        ok: false,
        status: 400,
        error: 'Google Sheet did not return CSV. Share it as "Anyone with the link can view".',
      }
    }

    const prepared = prepareSheetContacts(csv, {
      sourceUrl: input.sheetUrl,
      limit: input.sheetLimit,
      dedupeByDomain: true,
    })
    const imported = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts: prepared.contacts,
          verify: false,
          enrich: false,
          dedupeByDomain: true,
        })

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'sheet_import',
        imported: imported.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        evidenceBacked: prepared.summary.evidenceBacked,
        sheetUrl: input.sheetUrl,
      })
    }

    return {
      stage: 'sheet_import',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        imported: imported.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        summary: prepared.summary,
      },
    }
  } catch (error) {
    return {
      stage: 'sheet_import',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function runMapsImport(input: {
  clientId: number
  dryRun: boolean
  datasetId: string
  mapsLimit: number
  taskId?: string
  actorId?: string
  actorInput?: Record<string, unknown>
  industry?: string | null
  region?: string | null
}): Promise<StageResult> {
  try {
    const token = process.env.APIFY_API_TOKEN || ''
    if (!token) {
      return {
        stage: 'maps_import',
        ok: false,
        status: 400,
        error: 'APIFY_API_TOKEN is not configured',
      }
    }

    const taskId =
      input.taskId ||
      process.env.APIFY_GOOGLE_MAPS_TASK_ID ||
      process.env.GOOGLE_MAPS_APIFY_TASK_ID ||
      ''
    const actorId =
      input.actorId ||
      process.env.APIFY_GOOGLE_MAPS_ACTOR_ID ||
      process.env.GOOGLE_MAPS_APIFY_ACTOR_ID ||
      ''
    const preferLiveRun = envBool(process.env.APIFY_GOOGLE_MAPS_PREFER_LIVE_RUN, true)

    const resolved = await resolveApifyMapsItems({
      // Fresh actor/task runs must win over stale datasets. Dataset fallback stays available
      // for cheap recovery when no live Apify runner is configured.
      requestedDatasetId: preferLiveRun && (taskId || actorId) ? '' : input.datasetId,
      taskId,
      actorId,
      actorInput: input.actorInput,
      token,
      limit: input.mapsLimit,
      datasetDiscoveryLimit: Math.max(1, Math.min(Number(process.env.APIFY_DATASET_DISCOVERY_LIMIT ?? 20), 100)),
      taskTimeoutSecs: Math.max(30, Math.min(Number(process.env.APIFY_TASK_TIMEOUT_SECONDS ?? 120), 300)),
    })
    const prepared = prepareMapsLeadContacts(resolved.items, {
      sourceName: 'apify_google_maps',
      sourceUrl: resolved.sourceUrl,
      limit: input.mapsLimit,
      dedupeByDomain: true,
      industry: input.industry || process.env.GOOGLE_MAPS_INDUSTRY || 'agency',
      region: input.region || process.env.GOOGLE_MAPS_REGION || 'global',
    })
    const imported = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts: prepared.contacts,
          verify: false,
          enrich: false,
          dedupeByDomain: true,
        })
    const rejectionReasons = prepared.rejected.reduce<Record<string, number>>((acc, item) => {
      const reason = String(item.reason || 'unknown')
      acc[reason] = (acc[reason] || 0) + 1
      return acc
    }, {})

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'maps_import',
        imported: imported.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        evidenceBacked: prepared.summary.evidenceBacked,
        datasetId: resolved.datasetId || resolved.taskId || null,
        source: 'apify_google_maps',
        rejectionReasons,
      })
    }

    return {
      stage: 'maps_import',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        imported: imported.length,
        scanned: resolved.items.length,
        prepared: prepared.contacts.length,
        rejected: prepared.rejected.length,
        evidenceBacked: prepared.summary.evidenceBacked,
        datasetId: resolved.datasetId || null,
        taskId: resolved.taskId || null,
        actorId: resolved.actorId || null,
        sourceType: resolved.sourceType,
        sourceUrl: resolved.sourceUrl,
        liveRunPreferred: preferLiveRun,
        staleDatasetBypassed: Boolean(preferLiveRun && (taskId || actorId) && input.datasetId),
        duplicateOrSkipped: Math.max(0, prepared.contacts.length - imported.length),
        rejectionReasons,
      },
    }
  } catch (error) {
    return {
      stage: 'maps_import',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function loadHunterSearchDomains(clientId: number, limit: number) {
  const result = await query<{
    domain: string
    company: string | null
    evidence_url: string | null
  }>(
    `SELECT
       LOWER(COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, ''))) AS domain,
       MAX(NULLIF(company, '')) AS company,
       MAX(NULLIF(COALESCE(custom_fields->>'public_evidence_url', custom_fields->>'research_evidence_url', custom_fields->>'source_url'), '')) AS evidence_url
     FROM contacts
     WHERE client_id = $1
       AND status = 'active'
       AND bounced_at IS NULL
       AND unsubscribed_at IS NULL
       AND COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, '')) IS NOT NULL
       AND COALESCE(custom_fields->>'send_status', 'not_approved') <> 'queued'
     GROUP BY LOWER(COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, '')))
     HAVING LOWER(COALESCE(NULLIF(company_domain, ''), NULLIF(email_domain, ''))) !~ '(example|localhost|\\.local)$'
     ORDER BY MAX(updated_at) DESC
     LIMIT $2`,
    [clientId, limit]
  )

  return result.rows
}

async function runHunterDomainSearch(input: {
  clientId: number
  dryRun: boolean
  domainLimit: number
  emailsPerDomain: number
  minConfidence: number
}): Promise<StageResult> {
  try {
    if (!process.env.HUNTER_API_KEY) {
      return {
        stage: 'hunter_domain_search',
        ok: false,
        status: 400,
        error: 'HUNTER_API_KEY is not configured',
      }
    }

    const domains = await loadHunterSearchDomains(input.clientId, input.domainLimit)
    const contacts: ContactInput[] = []
    let searched = 0
    let rejected = 0
    let hunterErrors = 0
    const errorCounts: Record<string, number> = {}
    const rejectionCounts: Record<string, number> = {}

    const count = (bucket: Record<string, number>, key: string) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }

    for (const row of domains) {
      const domain = normalizeDomain(row.domain)
      if (!domain) continue
      searched += 1

      const result = await searchDomainWithHunter(domain, {
        limit: input.emailsPerDomain,
        timeoutMs: 10_000,
      })

      if (result.error) {
        hunterErrors += 1
        count(errorCounts, result.error)
        continue
      }

      for (const email of result.emails) {
        const rejectionReason = hunterEmailRejectionReason({
          email,
          domain,
          minConfidence: input.minConfidence,
        })
        if (rejectionReason) {
          rejected += 1
          count(rejectionCounts, rejectionReason)
          continue
        }

        const sourceUrl = firstHunterSourceUrl(email)
        const company = result.organization || row.company || domain
        contacts.push({
          email: email.value,
          name: hunterName(email),
          company,
          companyDomain: domain,
          title: email.position || email.department || 'business team',
          source: 'hunter_domain_search',
          customFields: {
            hunter_domain_search: true,
            data_source: 'hunter_domain_search',
            consent_source: 'hunter_public_domain_search',
            public_evidence_url: sourceUrl,
            research_evidence_url: sourceUrl,
            source_url: sourceUrl,
            email_evidence: 'hunter_domain_search',
            email_validation_provider: 'hunter_domain_search',
            email_validation_score: Number((email.confidence / 100).toFixed(2)),
            email_validation_verdict: 'valid',
            hunter_confidence: email.confidence,
            hunter_type: email.type,
            hunter_department: email.department,
            hunter_seniority: email.seniority,
            hunter_linkedin: email.linkedin,
            auto_approval_eligible: true,
            fit_score: Math.max(70, Math.min(98, email.confidence)),
            reason_to_contact: `${company} has public Hunter-sourced business contact evidence and appears relevant to outbound infrastructure or AI security risk review.`,
          },
        })
      }
    }

    const imported = input.dryRun
      ? []
      : await importContacts(input.clientId, {
          contacts,
          verify: false,
          enrich: false,
          dedupeByDomain: false,
        })

    if (!input.dryRun) {
      void notifyTelegramEvent({
        type: 'hunter_domain_search',
        imported: imported.length,
        scanned: searched,
        rejected,
        failures: hunterErrors,
      })
    }

    return {
      stage: 'hunter_domain_search',
      ok: true,
      status: 200,
      data: {
        dryRun: input.dryRun,
        scanned: searched,
        prepared: contacts.length,
        imported: imported.length,
        rejected,
        hunterErrors,
        errorCounts,
        rejectionCounts,
        minConfidence: input.minConfidence,
      },
    }
  } catch (error) {
    return {
      stage: 'hunter_domain_search',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function getResearchPool(clientId: number) {
  const result = await query<ProspectResearchContact & { created_at: string }>(
    `SELECT
       id,
       email,
       email_domain,
       company,
       company_domain,
       title,
       source,
       custom_fields,
       verification_status,
       status,
       unsubscribed_at,
       bounced_at,
       created_at
     FROM contacts
     WHERE client_id = $1
       AND status = 'active'
       AND bounced_at IS NULL
       AND unsubscribed_at IS NULL
       AND COALESCE(custom_fields->>'send_status', 'not_approved') NOT IN ('approved', 'queued', 'blocked')
       AND COALESCE(verification_status, 'pending') NOT IN ('invalid', 'do_not_mail')
       AND (
         source IN ('google_sheet_import', 'google_maps_apify', 'hunter_domain_search', 'open_lead_graph', 'owned_open_lead_graph')
         OR COALESCE(custom_fields->>'sheet_import', 'false') = 'true'
         OR COALESCE(custom_fields->>'maps_import', 'false') = 'true'
         OR COALESCE(custom_fields->>'hunter_domain_search', 'false') = 'true'
         OR COALESCE(custom_fields->>'lead_scout', 'false') = 'true'
       )
     ORDER BY
       CASE
         WHEN verification_status = 'valid' THEN 0
         WHEN COALESCE(custom_fields->>'email_validation_verdict', '') = 'valid' THEN 1
         WHEN COALESCE(custom_fields->>'email_evidence', '') IN ('provider_validated', 'hunter_domain_search', 'public_page_email_match') THEN 2
         ELSE 3
       END,
       CASE
         WHEN COALESCE(custom_fields->>'fit_score', '') ~ '^[0-9]+$'
         THEN (custom_fields->>'fit_score')::int
         ELSE 0
       END DESC,
       updated_at ASC,
       created_at ASC
     LIMIT 5000`,
    [clientId]
  )

  return result.rows
}

function researchValidationPriority(contact: ProspectResearchContact): number {
  const customFields = contact.custom_fields ?? {}
  const email = contact.email.trim().toLowerCase()
  const [prefix = ''] = email.split('@')
  const verificationStatus = String(contact.verification_status ?? 'pending').toLowerCase()
  let score = 0

  if (verificationStatus === 'valid') score += 1_000
  if (asString(customFields.email_validation_verdict) === 'valid') score += 500
  if (asString(customFields.email_evidence)) score += 150
  if (asString(customFields.public_evidence_url) || asString(customFields.research_evidence_url)) {
    score += 100
  }
  if (VALIDATION_PRIORITY_PREFIXES.has(prefix)) score += 80
  if (asBool(customFields.auto_approval_eligible)) score += 60
  score += Math.min(Number(customFields.fit_score) || 0, 100)

  return score
}

function rankResearchPool(pool: ProspectResearchContact[]): ProspectResearchContact[] {
  return [...pool].sort(
    (left, right) =>
      researchValidationPriority(right) - researchValidationPriority(left) ||
      left.email.localeCompare(right.email)
  )
}

function balanceResearchApprovalMix(
  decisions: ProspectResearchDecision[],
  contactById: Map<number, ProspectResearchContact>,
  limit: number
): ProspectResearchDecision[] {
  const normalizedLimit = Math.max(0, Math.trunc(limit))
  if (normalizedLimit <= 0) return []

  const ranked = [...decisions].sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
  const agency = ranked.filter((decision) => {
    const contact = contactById.get(decision.id)
    if (!contact) return false
    return inferSovereignOfferType({
      company: contact.company,
      companyDomain: contact.company_domain,
      title: contact.title,
      source: contact.source,
      reasonToContact: asString(contact.custom_fields?.reason_to_contact),
      customFields: contact.custom_fields,
    }) === 'agency'
  })
  const direct = ranked.filter((decision) => !agency.includes(decision))
  const targetAgency = Math.ceil(normalizedLimit / 2)
  const targetDirect = normalizedLimit - targetAgency
  const selected = [
    ...agency.slice(0, targetAgency),
    ...direct.slice(0, targetDirect),
  ]
  const selectedIds = new Set(selected.map((decision) => decision.id))
  const remainder = ranked.filter((decision) => !selectedIds.has(decision.id))

  return [...selected, ...remainder.slice(0, normalizedLimit - selected.length)]
}

function decorateProviderValidationUpdate(contact: ProspectResearchContact): ProspectResearchContact {
  const verificationStatus = String(contact.verification_status ?? '').toLowerCase()
  const customFields = contact.custom_fields ?? {}

  if (!['invalid', 'do_not_mail'].includes(verificationStatus)) {
    return contact
  }

  return {
    ...contact,
    custom_fields: {
      ...customFields,
      send_status: 'blocked',
      approval_required: true,
      approval_blocked_reason: `provider_verification_${verificationStatus}`,
      blocked_by: 'daily_provider_validation_gate',
      blocked_at: new Date().toISOString(),
    },
  }
}

async function blockPreviouslyInvalidContacts(clientId: number): Promise<number> {
  const result = await query(
    `UPDATE contacts
     SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
       || jsonb_build_object(
         'send_status', 'blocked',
         'approval_required', true,
         'approval_blocked_reason', 'existing_invalid_verification',
         'blocked_by', 'daily_provider_validation_gate',
         'blocked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       ),
       updated_at = CURRENT_TIMESTAMP
     WHERE client_id = $1
       AND status = 'active'
       AND COALESCE(verification_status, 'pending') IN ('invalid', 'do_not_mail')
       AND COALESCE(custom_fields->>'send_status', 'not_approved') NOT IN ('blocked', 'queued')
       AND bounced_at IS NULL
       AND unsubscribed_at IS NULL`,
    [clientId]
  )

  return result.rowCount ?? 0
}

async function runResearchApproval(input: {
  clientId: number
  dryRun: boolean
  approveLimit: number
  evidenceFetchLimit?: number
  providerValidationLimit?: number
  recoveryMode?: boolean
  growthMode?: boolean
}): Promise<StageResult> {
  try {
    const threshold = clampThreshold(process.env.DAILY_OUTBOUND_APPROVAL_THRESHOLD)
    const recoveryMode = Boolean(input.recoveryMode)
    const staleInvalidBlocked = input.dryRun ? 0 : await blockPreviouslyInvalidContacts(input.clientId)
    const pool = rankResearchPool(await getResearchPool(input.clientId))
    const evidenceFetchLimit = clampLimit(
      input.evidenceFetchLimit ??
        (input.dryRun ? 0 : process.env.DAILY_OUTBOUND_EVIDENCE_FETCH_LIMIT),
      input.dryRun ? 0 : recoveryMode ? 10 : 5,
      input.dryRun ? (recoveryMode ? 20 : 5) : recoveryMode ? 40 : 20
    )
    const providerValidationLimit = clampLimit(
      input.providerValidationLimit ??
        (input.dryRun ? 0 : process.env.DAILY_OUTBOUND_PROVIDER_VALIDATION_LIMIT),
      input.dryRun
        ? recoveryMode || input.growthMode
          ? 10
          : 0
        : recoveryMode || input.growthMode
          ? 100
          : 5,
      input.dryRun
        ? recoveryMode || input.growthMode
          ? 50
          : 5
        : recoveryMode || input.growthMode
          ? 250
          : 20
    )
    const networkDeadlineMs = input.dryRun ? (recoveryMode ? 20_000 : 8_000) : 45_000
    const networkDeadlineAt = Date.now() + networkDeadlineMs
    let evidenceFetches = 0
    let evidenceMatches = 0
    let providerValidationChecks = 0
    let providerValidationValid = 0
    let providerValidationInvalid = 0
    let providerValidationRisky = 0
    let providerValidationUnknown = 0
    let providerValidationBlocked = 0
    const providerValidationProviderCounts: Record<string, number> = {}
    const providerValidationErrorCounts: Record<string, number> = {}
    const enrichedPool: ProspectResearchContact[] = []
    const providerValidationUpdates: ProspectResearchContact[] = []
    const count = (bucket: Record<string, number>, key: string) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }

    for (const contact of pool) {
      let candidate: ProspectResearchContact = contact
      const hasNetworkBudget = () => Date.now() < networkDeadlineAt

      if (
        hasNetworkBudget() &&
        prospectNeedsExactPublicEmailEvidence(contact) &&
        evidenceFetches < evidenceFetchLimit
      ) {
        evidenceFetches += 1
        const result = await enrichProspectWithPublicEmailEvidence(contact)
        if (result.matched) evidenceMatches += 1
        candidate = result.contact
      }

      if (hasNetworkBudget() && providerValidationChecks < providerValidationLimit) {
        const validation = await enrichProspectWithProviderValidation(candidate)
        if (validation.checked) {
          providerValidationChecks += 1
          if (validation.verdict === 'valid') providerValidationValid += 1
          if (validation.verdict === 'invalid') providerValidationInvalid += 1
          if (validation.verdict === 'risky') providerValidationRisky += 1
          if (validation.verdict === 'unknown') providerValidationUnknown += 1
          candidate = validation.contact
          const validationFields = candidate.custom_fields ?? {}
          count(
            providerValidationProviderCounts,
            asString(validationFields.email_validation_provider) || 'unknown_provider'
          )
          const validationError = asString(validationFields.email_validation_error)
          if (validationError) {
            count(providerValidationErrorCounts, validationError)
          }
          const update = decorateProviderValidationUpdate(candidate)
          if (asString(update.custom_fields?.send_status) === 'blocked') {
            providerValidationBlocked += 1
          }
          providerValidationUpdates.push(update)
          candidate = update
        }
      }

      enrichedPool.push(candidate)
    }

    if (!input.dryRun && providerValidationUpdates.length > 0) {
      await query(
        `UPDATE contacts
         SET verification_status = COALESCE(NULLIF(updates.verification_status, ''), contacts.verification_status),
             custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb) || updates.custom_fields,
             updated_at = CURRENT_TIMESTAMP
         FROM jsonb_to_recordset($2::jsonb) AS updates(id bigint, verification_status text, custom_fields jsonb)
         WHERE contacts.client_id = $1
           AND contacts.id = updates.id`,
        [
          input.clientId,
          JSON.stringify(
            providerValidationUpdates.map((contact) => ({
              id: Number(contact.id),
              verification_status: asString(contact.verification_status),
              custom_fields: contact.custom_fields ?? {},
            }))
          ),
        ]
      )
    }

    const contactById = new Map(enrichedPool.map((contact) => [Number(contact.id), contact]))
    const decisions = enrichedPool.map((contact) =>
      scoreProspectForResearchApproval(contact, { threshold })
    )
    const approvedDecisions = decisions.filter((decision) => decision.approved)
    const approvedCandidates = balanceResearchApprovalMix(
      approvedDecisions,
      contactById,
      input.approveLimit
    )
    const blocked = decisions
      .filter((decision) => !decision.approved)
      .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
      .slice(0, 25)

    if (input.dryRun) {
      return {
        stage: 'research_approval',
        ok: true,
        status: 200,
        data: {
          dryRun: true,
          recoveryMode,
          scanned: decisions.length,
          evidenceFetches,
          evidenceMatches,
          providerValidationChecks,
          providerValidationValid,
          providerValidationInvalid,
          providerValidationRisky,
          providerValidationUnknown,
          providerValidationBlocked,
          providerValidationProviderCounts,
          providerValidationErrorCounts,
          staleInvalidBlocked,
          providerValidationLimit,
          approvalReady: approvedCandidates.length,
          approved: 0,
          candidates: approvedCandidates,
          blocked,
        },
      }
    }

    const candidateIds = approvedCandidates.map((candidate) => candidate.id)
    if (candidateIds.length === 0) {
      return {
        stage: 'research_approval',
        ok: true,
        status: 200,
        data: {
          approved: 0,
          recoveryMode,
          scanned: decisions.length,
          evidenceFetches,
          evidenceMatches,
          providerValidationChecks,
          providerValidationValid,
          providerValidationInvalid,
          providerValidationRisky,
          providerValidationUnknown,
          providerValidationBlocked,
          providerValidationProviderCounts,
          providerValidationErrorCounts,
          staleInvalidBlocked,
          providerValidationLimit,
          skipped: 'no_research_verified_prospects',
          blocked,
        },
      }
    }

    const result = await query(
      `UPDATE contacts
       SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
         || jsonb_build_object(
           'send_status', 'approved',
           'approval_required', false,
           'approved_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'approved_by', 'daily_research_approval_gate',
           'approval_batch', 'daily_research_verified_best',
           'research_score', scores.score,
           'research_reasons', scores.reasons,
           'research_evidence_url', scores.evidence_url,
           'email_evidence', COALESCE(NULLIF(scores.email_evidence, ''), contacts.custom_fields->>'email_evidence')
         ),
         verification_status = COALESCE(NULLIF(scores.verification_status, ''), contacts.verification_status),
         updated_at = CURRENT_TIMESTAMP
       FROM (
         SELECT *
         FROM jsonb_to_recordset($3::jsonb) AS x(id bigint, score int, reasons jsonb, evidence_url text, email_evidence text, verification_status text)
       ) AS scores
       WHERE contacts.client_id = $1
         AND contacts.id = ANY($2::bigint[])
         AND contacts.id = scores.id
         AND contacts.status = 'active'
         AND contacts.bounced_at IS NULL
         AND contacts.unsubscribed_at IS NULL
       RETURNING contacts.id, contacts.email, contacts.company, contacts.custom_fields`,
      [
        input.clientId,
        candidateIds,
        JSON.stringify(
          approvedCandidates.map((candidate) => ({
            id: candidate.id,
            score: candidate.score,
            reasons: candidate.reasons,
            evidence_url: candidate.evidenceUrl,
            email_evidence: asString(contactById.get(candidate.id)?.custom_fields?.email_evidence),
            verification_status: asString(contactById.get(candidate.id)?.verification_status),
          }))
        ),
      ]
    )
    const approved = result.rowCount ?? result.rows.length

    void notifyTelegramEvent({
      type: 'contacts_approved',
      approved,
      mode: 'daily_research_verified_best',
    })

    return {
      stage: 'research_approval',
      ok: true,
      status: 200,
      data: {
        approved,
        recoveryMode,
        scanned: decisions.length,
        evidenceFetches,
        evidenceMatches,
        providerValidationChecks,
        providerValidationValid,
        providerValidationInvalid,
        providerValidationRisky,
        providerValidationUnknown,
        providerValidationBlocked,
        providerValidationProviderCounts,
        providerValidationErrorCounts,
        staleInvalidBlocked,
        providerValidationLimit,
        contacts: result.rows,
        blocked,
      },
    }
  } catch (error) {
    return {
      stage: 'research_approval',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

async function loadApprovedContacts(clientId: number, limit: number): Promise<ApprovedLead[]> {
  const scanLimit = Math.min(Math.max(limit * 50, 500), 10_000)
  const result = await query<{
    id: string
    email: string
    email_domain: string | null
    first_name: string | null
    company: string | null
    company_domain: string | null
    title: string | null
    source: string | null
    reason_to_contact: string | null
    custom_fields: Record<string, unknown> | null
    verification_status: string | null
    status: string | null
    bounced_at: string | null
    unsubscribed_at: string | null
  }>(
    `SELECT
       c.id::text,
       c.email,
       c.email_domain,
       COALESCE(NULLIF(c.name, ''), split_part(c.email, '@', 1)) AS first_name,
       COALESCE(NULLIF(c.company, ''), c.company_domain, c.email_domain, 'your team') AS company,
       c.company_domain,
       c.title,
       c.source,
       COALESCE(c.custom_fields->>'reason_to_contact', 'reviewed approved business prospect') AS reason_to_contact,
       c.custom_fields,
       c.verification_status,
       c.status,
       c.bounced_at,
       c.unsubscribed_at
     FROM contacts c
     WHERE c.client_id = $1
       AND c.status = 'active'
       AND c.bounced_at IS NULL
       AND c.unsubscribed_at IS NULL
       AND COALESCE(c.custom_fields->>'send_status', 'not_approved') = 'approved'
       AND NOT (
         COALESCE(c.custom_fields->>'lead_scout', 'false') = 'true'
         AND COALESCE(c.custom_fields->>'auto_approval_eligible', 'false') <> 'true'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM suppression_list s
         WHERE s.client_id = c.client_id
           AND LOWER(s.email) = LOWER(c.email)
       )
     ORDER BY
       CASE
         WHEN COALESCE(c.custom_fields->>'fit_score', '') ~ '^[0-9]+$'
         THEN (c.custom_fields->>'fit_score')::int
         ELSE 0
       END DESC,
       c.updated_at ASC,
       c.created_at ASC
     LIMIT $2`,
    [clientId, scanLimit]
  )

  const eligibleRows = result.rows.filter(
    (row) =>
      approvedContactQueueBlockers({
        id: row.id,
        email: row.email,
        email_domain: row.email_domain,
        company: row.company,
        company_domain: row.company_domain,
        title: row.title,
        source: row.source,
        custom_fields: row.custom_fields,
        verification_status: row.verification_status,
        status: row.status,
        bounced_at: row.bounced_at,
        unsubscribed_at: row.unsubscribed_at,
      }).length === 0
  )

  const leads = eligibleRows.map((row) => {
    const leadBase = {
      company: row.company,
      companyDomain: row.company_domain,
      title: row.title,
      source: row.source,
      reasonToContact: row.reason_to_contact,
      customFields: row.custom_fields,
    }
    const offerType = inferSovereignOfferType(leadBase)

    return {
      contact_id: Number(row.id),
      email: row.email,
      first_name: row.first_name || row.email.split('@')[0] || 'there',
      company: row.company || row.email.split('@')[1] || 'your team',
      title: row.title || undefined,
      company_domain: row.company_domain || undefined,
      consent_source: 'operator_approved_business_outreach',
      reason_to_contact: row.reason_to_contact || 'reviewed approved business prospect',
      offer_type: offerType,
      deal_value_usd: sovereignDealValueUsd({ ...leadBase, offerType }),
      customFields: row.custom_fields,
    }
  })

  return balanceSovereignOfferMix(leads, limit)
}

async function runQueue(input: {
  clientId: number
  sendLimit: number
}): Promise<StageResult> {
  let queue: Queue | null = null
  try {
    const leads = await loadApprovedContacts(input.clientId, input.sendLimit)
    const queueName = process.env.SEND_QUEUE ?? 'xv-send-queue'

    if (leads.length === 0) {
      void notifyTelegramEvent({
        type: 'queue_skipped',
        reason: 'no_verified_approved_leads',
        source: 'daily_approved_contacts_only',
      })

      return {
        stage: 'queue_outbound',
        ok: true,
        status: 200,
        data: {
          queued: 0,
          source: 'daily_approved_contacts_only',
          skipped: 'no_verified_approved_leads',
        },
      }
    }

    const physicalAddress = process.env.SENDER_PHYSICAL_ADDRESS || 'Xavira Tech Labs, India'
    const allowCopyOverride = envBool(process.env.OUTBOUND_CRON_ALLOW_COPY_OVERRIDE, false)
    const today = new Date().toISOString().slice(0, 10)
    queue = new Queue(queueName, { connection: { url: appEnv.redisUrl() } })

    const jobs = await Promise.all(leads.map(async (lead) => {
      const copy = await buildSovereignCopyForLead(lead, {
        physicalAddress,
        subjectOverride:
          allowCopyOverride && process.env.OUTBOUND_CRON_SUBJECT
            ? process.env.OUTBOUND_CRON_SUBJECT
            : undefined,
        bodyOverride:
          allowCopyOverride && process.env.OUTBOUND_CRON_BODY
            ? process.env.OUTBOUND_CRON_BODY
            : undefined,
      })
      const idempotencyKey = crypto
        .createHash('sha256')
        .update(`daily:${today}:${input.clientId}:${lead.email}:${copy.subject}`)
        .digest('hex')

      return {
        name: 'cron_outbound_sales',
        data: {
          clientId: input.clientId,
          contactId: lead.contact_id,
          toEmail: lead.email,
          subject: copy.subject,
          text: copy.text,
          html: copy.html,
          offerType: lead.offer_type,
          dealValueUsd: lead.deal_value_usd,
          copySource: copy.source,
          copyError: copy.error,
          idempotencyKey,
        },
        opts: {
          jobId: idempotencyKey,
          attempts: 1,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      }
    }))

    const added = await queue.addBulk(jobs)
    const queuedLeads = leads.slice(0, added.length)
    const estimatedPipelineValueUsd = queuedLeads.reduce(
      (sum, lead) => sum + lead.deal_value_usd,
      0
    )
    const agencyQueued = queuedLeads.filter((lead) => lead.offer_type === 'agency').length
    const directQueued = queuedLeads.length - agencyQueued
    const contactIds = leads
      .map((lead) => lead.contact_id)
      .filter((id): id is number => Number.isSafeInteger(id))

    if (contactIds.length > 0 && added.length > 0) {
      await query(
        `UPDATE contacts
         SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
           || jsonb_build_object(
             'send_status', 'queued',
             'queued_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ),
           updated_at = CURRENT_TIMESTAMP
         WHERE client_id = $1
           AND id = ANY($2::bigint[])`,
        [input.clientId, contactIds]
      )
    }

    void notifyTelegramEvent({
      type: 'queue_batch',
      queued: added.length,
      source: 'daily_approved_contacts',
      queue: queueName,
      limit: input.sendLimit,
      estimatedPipelineValueUsd,
      agencyQueued,
      directQueued,
    })

    return {
      stage: 'queue_outbound',
      ok: true,
      status: 200,
      data: {
        queue: queueName,
        queued: added.length,
        limit: input.sendLimit,
        estimatedPipelineValueUsd,
        agencyQueued,
        directQueued,
        firstJobId: added[0]?.id ?? null,
        lastJobId: added.at(-1)?.id ?? null,
      },
    }
  } catch (error) {
    return {
      stage: 'queue_outbound',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  } finally {
    await queue?.close()
  }
}

async function runFollowupsStage(input: {
  clientId: number
  dryRun: boolean
}): Promise<StageResult> {
  try {
    const tableCheck = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'sequence_executions'
       ) AS exists`
    )
    const hasSequenceExecutions = Boolean(tableCheck.rows[0]?.exists)
    if (!hasSequenceExecutions) {
      return {
        stage: 'run_followups',
        ok: true,
        status: 204,
        data: {
          processed: 0,
          emailsSent: 0,
          sequencesCompleted: 0,
          errorsCount: 0,
          skipped: 'sequence_executions table is not installed yet',
        },
      }
    }

    if (input.dryRun) {
      const dueCountRes = await query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt
         FROM sequence_executions
         WHERE status = 'active'
           AND next_email_scheduled_at <= NOW()`
      )
      const dueCount = Number(dueCountRes.rows[0]?.cnt ?? 0)
      return {
        stage: 'run_followups',
        ok: true,
        status: 200,
        data: {
          processed: 0,
          emailsSent: 0,
          sequencesCompleted: 0,
          errorsCount: 0,
          skipped: `dry_run: would process ${dueCount} pending followups`,
        },
      }
    }

    const { processAllSequences } = await import('@/lib/sequence-engine')
    const result = await processAllSequences()
    return {
      stage: 'run_followups',
      ok: result.errors.length === 0,
      status: 200,
      data: {
        processed: result.processed,
        emailsSent: result.emailsSent,
        sequencesCompleted: result.sequencesCompleted,
        errorsCount: result.errors.length,
        errors: result.errors,
      },
    }
  } catch (error) {
    return {
      stage: 'run_followups',
      ok: false,
      status: 0,
      error: safeError(error),
    }
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const kick =
    envBool(
      request.nextUrl.searchParams.get('kick') ||
        request.nextUrl.searchParams.get('background') ||
        undefined,
      false
    )
  if (kick) {
    try {
      const clientId = Number(request.nextUrl.searchParams.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
      const runUrl = new URL(request.nextUrl.toString())
      runUrl.searchParams.delete('kick')
      runUrl.searchParams.delete('background')
      runUrl.searchParams.delete('secret')
      runUrl.searchParams.set('compact', '1')
      runUrl.searchParams.set('cronCompact', '1')

      const queued = await enqueueOutboundCycleJob({
        clientId,
        runUrl: runUrl.toString(),
      })

      return new Response(
        [
          'ok=1',
          'cycleQueued=1',
          `client=${clientId}`,
          `queue=${queued.queue}`,
          `job=${queued.jobId ?? queued.dedupeKey}`,
          `replacedFailed=${queued.replacedFailed ? 1 : 0}`,
          'worker=embedded',
          `ts=${new Date().toISOString()}`,
        ].join(' '),
        {
          status: 202,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        }
      )
    } catch (error) {
      console.error('[api/cron/daily-outbound] cycle enqueue failed', error)
      return new Response(`ok=0 cycleQueued=0 error=${safeError(error).slice(0, 240)}`, {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
  }

  try {
    const params = request.nextUrl.searchParams
    const clientId = Number(params.get('client_id') || process.env.DEFAULT_CLIENT_ID || 1)
    const targetDailyVolume = resolveTargetDailyVolume(params)
    const maintenance = await maybeRunDailyMaintenance(clientId)
    const stages: StageResult[] = []
    stages.push(await runSenderReconcileStage(clientId))
    const approvalWindow = await resolveSystemApprovalWindow(clientId)
    const plan = buildDailyOutboundPlan({
      approvalWindow,
      env: process.env,
      query: {
        clientId: String(clientId),
        dryRun: params.get('dryRun') || params.get('preview'),
        sheetUrl: params.get('sheetUrl'),
        sheetLimit: params.get('sheetLimit'),
        mapsDatasetId: params.get('mapsDatasetId') || params.get('datasetId'),
        mapsLimit: params.get('mapsLimit'),
        mapsImport: params.get('mapsImport'),
        leadScout: params.get('leadScout'),
        leadScoutLimit: params.get('leadScoutLimit'),
        approveLimit: params.get('approveLimit'),
        sendLimit: params.get('sendLimit'),
        mode: params.get('mode'),
        recoveryMode: params.get('recoveryMode'),
      },
    })
    const verbose = envBool(params.get('verbose') || process.env.DAILY_OUTBOUND_VERBOSE_RESPONSE, false)
    const compactResponse = envBool(
      params.get('compact') ||
        params.get('cronCompact') ||
        process.env.DAILY_OUTBOUND_COMPACT_RESPONSE,
      false
    )
    const runHunterSearch = envBool(
      params.get('hunterSearch') || process.env.DAILY_OUTBOUND_RUN_HUNTER,
      false
    )
    const recoveryMode = plan.recoveryMode
    const mapsActorId =
      params.get('mapsActorId') ||
      params.get('actorId') ||
      process.env.APIFY_GOOGLE_MAPS_ACTOR_ID ||
      process.env.GOOGLE_MAPS_APIFY_ACTOR_ID ||
      ''

    if (!plan.enabled) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        daily: true,
        plan,
        stages,
      })
    }

    if (plan.runLeadScout) {
      stages.push(
        await runLeadScoutStage({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          limit: plan.leadScoutLimit,
          industry: params.get('industry') || params.get('leadScoutIndustry'),
          persona: params.get('persona') || params.get('leadScoutPersona'),
          region: params.get('region') || params.get('leadScoutRegion'),
        })
      )
    } else {
      stages.push({
        stage: 'lead_scout',
        ok: true,
        status: 204,
        skipped: 'lead_scout_disabled',
      })
    }

    if (plan.runMapsImport) {
      stages.push(
        await runMapsImport({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          datasetId: plan.mapsDatasetId,
          mapsLimit: plan.mapsLimit,
          taskId: params.get('mapsTaskId') || params.get('taskId') || undefined,
          actorId: mapsActorId || undefined,
          actorInput: mapsActorId
            ? buildApifyGoogleMapsActorInput({
                inputJson: params.get('actorInputJson') || process.env.APIFY_GOOGLE_MAPS_ACTOR_INPUT_JSON,
                searches:
                  params.get('mapsSearches') ||
                  params.get('searches') ||
                  process.env.APIFY_GOOGLE_MAPS_SEARCHES,
                location:
                  params.get('mapsLocation') ||
                  params.get('location') ||
                  process.env.APIFY_GOOGLE_MAPS_LOCATION ||
                  params.get('mapsRegion') ||
                  params.get('region') ||
                  process.env.GOOGLE_MAPS_REGION,
                limit: plan.mapsLimit,
                placesPerSearch:
                  params.get('mapsPlacesPerSearch') ||
                  params.get('placesPerSearch') ||
                  process.env.APIFY_GOOGLE_MAPS_PLACES_PER_SEARCH,
              })
            : undefined,
          industry: params.get('mapsIndustry') || params.get('industry'),
          region: params.get('mapsRegion') || params.get('region'),
        })
      )
    } else {
      stages.push({
        stage: 'maps_import',
        ok: true,
        status: 204,
        skipped: 'maps_import_disabled_or_no_dataset',
      })
    }

    if (plan.runSheetImport) {
      stages.push(
        await runSheetImport({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          sheetUrl: plan.sheetUrl,
          sheetLimit: plan.sheetLimit,
        })
      )
    } else {
      stages.push({
        stage: 'sheet_import',
        ok: true,
        status: 204,
        skipped: 'no_sheet_configured_existing_contacts_only',
      })
    }

    if (runHunterSearch) {
      stages.push(
        await runHunterDomainSearch({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          domainLimit: clampLimit(
            params.get('hunterDomainLimit') || process.env.HUNTER_DOMAIN_SEARCH_DAILY_LIMIT,
            10,
            50
          ),
          emailsPerDomain: clampLimit(
            params.get('hunterEmailsPerDomain') || process.env.HUNTER_EMAILS_PER_DOMAIN,
            5,
            25
          ),
          minConfidence: clampLimit(
            params.get('hunterMinConfidence') || process.env.HUNTER_MIN_CONFIDENCE,
            80,
            100
          ),
        })
      )
    } else {
      stages.push({
        stage: 'hunter_domain_search',
        ok: true,
        status: 204,
        skipped: 'hunter_domain_search_disabled',
      })
    }

    if (plan.runResearchApproval) {
      stages.push(
        await runResearchApproval({
          clientId: plan.clientId,
          dryRun: plan.dryRun,
          approveLimit: plan.approveLimit,
          recoveryMode,
          growthMode: plan.mode === 'growth',
          evidenceFetchLimit: params.has('evidenceFetchLimit')
            ? clampLimit(params.get('evidenceFetchLimit'), 0, recoveryMode ? 40 : 20)
            : undefined,
          providerValidationLimit: params.has('providerValidationLimit')
            ? clampLimit(
                params.get('providerValidationLimit'),
                0,
                recoveryMode || plan.mode === 'growth' ? 250 : 20
              )
            : undefined,
        })
      )
    }

    if (plan.runQueue) {
      stages.push(
        await runQueue({
          clientId: plan.clientId,
          sendLimit: plan.sendLimit,
        })
      )
    } else {
      stages.push({
        stage: 'queue_outbound',
        ok: true,
        status: 204,
        skipped: plan.dryRun ? 'dry_run_no_email_queued' : 'send_limit_or_capacity_blocked',
      })
    }

    // Run follow-ups stage
    stages.push(
      await runFollowupsStage({
        clientId: plan.clientId,
        dryRun: plan.dryRun,
      })
    )

    stages.push(await runEventRetentionStage(plan.clientId))

    const queuedStage = stages.find((stage) => stage.stage === 'queue_outbound')
    const approvalStage = stages.find((stage) => stage.stage === 'research_approval')
    const sheetStage = stages.find((stage) => stage.stage === 'sheet_import')
    const mapsStage = stages.find((stage) => stage.stage === 'maps_import')
    const leadScoutStage = stages.find((stage) => stage.stage === 'lead_scout')
    const hunterStage = stages.find((stage) => stage.stage === 'hunter_domain_search')
    const queued = getNumericField(queuedStage?.data, 'queued')
    const estimatedPipelineValueUsd = getNumericField(
      queuedStage?.data,
      'estimatedPipelineValueUsd'
    )
    const agencyQueued = getNumericField(queuedStage?.data, 'agencyQueued')
    const directQueued = getNumericField(queuedStage?.data, 'directQueued')
    const approved = getNumericField(approvalStage?.data, 'approved')
    const imported = getNumericField(sheetStage?.data, 'imported')
    const mapsImported = getNumericField(mapsStage?.data, 'imported')
    const mapsPrepared = getNumericField(mapsStage?.data, 'prepared')
    const mapsEvidenceBacked = getNumericField(mapsStage?.data, 'evidenceBacked')
    const mapsScanned = getNumericField(mapsStage?.data, 'scanned')
    const mapsSource =
      mapsStage?.data && typeof mapsStage.data === 'object'
        ? String((mapsStage.data as Record<string, unknown>).sourceType || 'none')
        : 'none'
    const leadScoutImported = getNumericField(leadScoutStage?.data, 'imported')
    const leadScoutEvidenceBacked = getNumericField(leadScoutStage?.data, 'evidenceBacked')
    const hunterImported = getNumericField(hunterStage?.data, 'imported')
    const hunterPrepared = getNumericField(hunterStage?.data, 'prepared')
    const hunterRejected = getNumericField(hunterStage?.data, 'rejected')
    const senderReconcileStage = stages.find((stage) => stage.stage === 'sender_reconcile')
    const sendersReconciled = getNumericField(senderReconcileStage?.data, 'bootstrapped')
    const providerValidationChecks = getNumericField(approvalStage?.data, 'providerValidationChecks')
    const providerValidationValid = getNumericField(approvalStage?.data, 'providerValidationValid')
    const providerValidationInvalid = getNumericField(approvalStage?.data, 'providerValidationInvalid')
    const providerValidationBlocked = getNumericField(approvalStage?.data, 'providerValidationBlocked')
    const staleInvalidBlocked = getNumericField(approvalStage?.data, 'staleInvalidBlocked')

    const followupsStage = stages.find((stage) => stage.stage === 'run_followups')
    const followupsProcessed = getNumericField(followupsStage?.data, 'processed')
    const followupsSent = getNumericField(followupsStage?.data, 'emailsSent')
    const followupsCompleted = getNumericField(followupsStage?.data, 'sequencesCompleted')
    const followupsErrors = getNumericField(followupsStage?.data, 'errorsCount')
    const retentionStage = stages.find((stage) => stage.stage === 'event_retention')
    const brevoFailuresDeleted = getNumericField(retentionStage?.data, 'brevoFailuresDeleted')
    const staleGuardrailFailuresDeleted = getNumericField(
      retentionStage?.data,
      'staleGuardrailFailuresDeleted'
    )
    const staleFailuresDeleted = getNumericField(retentionStage?.data, 'staleFailuresDeleted')
    const eventBodiesRedacted = getNumericField(retentionStage?.data, 'bodiesRedacted')

    const hardFailures = stages.filter(
      (stage) =>
        !stage.ok &&
        stage.stage !== 'sheet_import' &&
        stage.stage !== 'maps_import' &&
        stage.stage !== 'lead_scout'
    )
    const capacityDiagnosis = await getSendingCapacityDiagnosis(plan.clientId, {
      targetDailyVolume,
    })

    const digest = await getOutboundTelegramDigest(plan.clientId)
    const generatedAt = new Date().toISOString()
    const summary = {
      imported: imported + mapsImported + leadScoutImported + hunterImported,
      sheetImported: imported,
      mapsImported,
      mapsPrepared,
      mapsEvidenceBacked,
      leadScoutImported,
      leadScoutEvidenceBacked,
      hunterImported,
      hunterPrepared,
      hunterRejected,
      sendersReconciled,
      approved,
      queued,
      estimatedPipelineValueUsd,
      agencyQueued,
      directQueued,
      providerValidationChecks,
      providerValidationValid,
      providerValidationInvalid,
      providerValidationBlocked,
      staleInvalidBlocked,
      followupsProcessed,
      followupsSent,
      followupsCompleted,
      followupsErrors,
      brevoFailuresDeleted,
      staleGuardrailFailuresDeleted,
      staleFailuresDeleted,
      eventBodiesRedacted,
      hardFailures: hardFailures.length,
      targetDailyVolume: capacityDiagnosis.targetDailyVolume,
      capacityRemaining: capacityDiagnosis.currentRemainingCapacity,
      capacityGap: capacityDiagnosis.targetGap,
      capacityBlocker: capacityDiagnosis.primaryBlocker,
    }

    void notifyTelegramEvent({
      type: 'daily_outbound',
      dryRun: plan.dryRun,
      imported: summary.imported,
      approved,
      queued,
      estimatedPipelineValueUsd,
      agencyQueued,
      directQueued,
      sendLimit: plan.sendLimit,
      approveLimit: plan.approveLimit,
      failures: stages.filter((stage) => !stage.ok).length,
      targetDailyVolume: capacityDiagnosis.targetDailyVolume,
      capacityRemaining: capacityDiagnosis.currentRemainingCapacity,
      healthyDomains: capacityDiagnosis.healthyDomains,
      eligibleSenderIdentities: capacityDiagnosis.eligibleSenderIdentities,
      primaryBlocker: capacityDiagnosis.primaryBlocker,
      ...digest,
      nextAction: digest.nextAction || capacityDiagnosis.nextAction,
    })

    if (compactResponse) {
      return new Response(
        [
          `ok=${hardFailures.length === 0 ? 1 : 0}`,
          `client=${plan.clientId}`,
          `imported=${summary.imported}`,
          `maps=${mapsImported}/${mapsPrepared}/${mapsScanned}`,
          `mapsSource=${mapsSource}`,
          `approved=${approved}`,
          `queued=${queued}`,
          `agency=${agencyQueued}`,
          `direct=${directQueued}`,
          `failures=${hardFailures.length}`,
          `capacity=${capacityDiagnosis.currentRemainingCapacity}`,
          `blocker=${capacityDiagnosis.primaryBlocker}`,
        ].join(' '),
        {
          status: hardFailures.length === 0 ? 200 : 207,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        }
      )
    }

    return NextResponse.json({
      ok: hardFailures.length === 0,
      enabled: true,
      daily: true,
      clientId: plan.clientId,
      dryRun: plan.dryRun,
      generatedAt,
      summary,
      capacity: {
        targetDailyVolume: capacityDiagnosis.targetDailyVolume,
        currentRemainingCapacity: capacityDiagnosis.currentRemainingCapacity,
        targetGap: capacityDiagnosis.targetGap,
        activeDomains: capacityDiagnosis.activeDomains,
        healthyDomains: capacityDiagnosis.healthyDomains,
        eligibleSenderIdentities: capacityDiagnosis.eligibleSenderIdentities,
        primaryBlocker: capacityDiagnosis.primaryBlocker,
        nextAction: capacityDiagnosis.nextAction,
        scaleModel: capacityDiagnosis.scaleModel,
      },
      plan: verbose ? plan : {
        mode: plan.mode,
        recoveryMode,
        sheetImport: plan.runSheetImport,
        mapsImport: plan.runMapsImport,
        mapsLimit: plan.mapsLimit,
        leadScout: plan.runLeadScout,
        leadScoutLimit: plan.leadScoutLimit,
        approveLimit: plan.approveLimit,
        sendLimit: plan.sendLimit,
      },
      approvalWindow: verbose ? approvalWindow : {
        limit: approvalWindow.limit,
        activeDomains: approvalWindow.activeDomains,
        remainingCapacity: approvalWindow.remainingCapacity,
        averageHealthScore: approvalWindow.averageHealthScore,
        policy: approvalWindow.policy,
      },
      maintenance,
      stages: verbose ? stages : stages.map(compactStage),
    })
  } catch (error) {
    console.error('[api/cron/daily-outbound] failed', error)
    const params = request.nextUrl.searchParams
    const compactResponse = envBool(
      params.get('compact') ||
        params.get('cronCompact') ||
        process.env.DAILY_OUTBOUND_COMPACT_RESPONSE,
      false
    )
    if (compactResponse) {
      return new Response(`ok=0 error=${safeError(error).slice(0, 160)}`, {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
    return NextResponse.json(
      { ok: false, error: 'failed', detail: safeError(error) },
      { status: 500 }
    )
  }
}
