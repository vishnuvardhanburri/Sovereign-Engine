import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { resolveClientId } from '@/lib/client-context'
import { notifyTelegramEvent } from '@/lib/telegram-notifications'
import { resolveSystemApprovalWindow } from '@/lib/contact-approval-window'
import {
  scoreProspectForResearchApproval,
  type ProspectResearchContact,
  type ProspectResearchDecision,
} from '@/lib/prospect-research'

function parseIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function loadApprovalContacts(clientId: number, ids?: number[], limit?: number) {
  const params: unknown[] = [clientId]
  let idClause = ''
  let limitClause = ''

  if (ids && ids.length > 0) {
    params.push(ids)
    idClause = `AND id = ANY($${params.length}::bigint[])`
  } else {
    params.push(Math.max(1, Math.min(Number(limit ?? 100), 1000)))
    limitClause = `LIMIT $${params.length}`
  }

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
       bounced_at,
       unsubscribed_at,
       created_at
     FROM contacts
     WHERE client_id = $1
       AND status = 'active'
       AND bounced_at IS NULL
       AND unsubscribed_at IS NULL
       ${idClause}
       ${
         ids && ids.length > 0
           ? ''
           : "AND COALESCE(custom_fields->>'send_status', 'not_approved') NOT IN ('approved', 'blocked', 'review')"
       }
     ORDER BY
       CASE
         WHEN COALESCE(custom_fields->>'fit_score', '') ~ '^[0-9]+$'
         THEN (custom_fields->>'fit_score')::int
         ELSE 0
       END DESC,
       CASE
         WHEN COALESCE(custom_fields->>'hunter_confidence', '') ~ '^[0-9]+$'
         THEN (custom_fields->>'hunter_confidence')::int
         ELSE 0
       END DESC,
       created_at ASC
     ${limitClause}`,
    params
  )

  return result.rows
}

async function markHeldContacts(clientId: number, decisions: ProspectResearchDecision[]) {
  if (decisions.length === 0) return 0

  const result = await query(
    `UPDATE contacts
     SET custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb)
       || jsonb_build_object(
         'send_status', updates.send_status,
         'approval_required', true,
         'approval_blocked_reason', updates.approval_blocked_reason,
         'research_score', updates.research_score,
         'hunter_confidence', updates.hunter_confidence,
         'hunter_verdict', updates.hunter_verdict,
         'hunter_bounce_risk', updates.hunter_bounce_risk,
         'hunter_buyer_fit', updates.hunter_buyer_fit,
         'hunter_recommendation', updates.hunter_recommendation,
         'hunter_verification_label', updates.hunter_verification_label,
         'hunter_source_proof_label', updates.hunter_source_proof_label,
         'hunter_source_proof_url', updates.hunter_source_proof_url,
         'hunter_reasons', updates.hunter_reasons,
         'hunter_blockers', updates.hunter_blockers,
         'research_evidence_url', updates.research_evidence_url,
         'hunter_checked_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       ),
       updated_at = CURRENT_TIMESTAMP
     FROM jsonb_to_recordset($2::jsonb) AS updates(
       id bigint,
       send_status text,
       approval_blocked_reason text,
       research_score int,
       hunter_confidence int,
       hunter_verdict text,
       hunter_bounce_risk text,
       hunter_buyer_fit text,
       hunter_recommendation text,
       hunter_verification_label text,
       hunter_source_proof_label text,
       hunter_source_proof_url text,
       hunter_reasons jsonb,
       hunter_blockers jsonb,
       research_evidence_url text
     )
     WHERE contacts.client_id = $1
       AND contacts.id = updates.id`,
    [
      clientId,
      JSON.stringify(
        decisions.map((decision) => ({
          id: decision.id,
          send_status:
            decision.blockers.length > 0 ||
            decision.recommendation === 'hold' ||
            decision.bounceRisk === 'high'
              ? 'blocked'
              : 'review',
          approval_blocked_reason: decision.blockers[0] ?? 'hunter_review_required',
          research_score: decision.score,
          hunter_confidence: decision.confidence,
          hunter_verdict: decision.verdict,
          hunter_bounce_risk: decision.bounceRisk,
          hunter_buyer_fit: decision.buyerFit,
          hunter_recommendation: decision.recommendation,
          hunter_verification_label: decision.verificationLabel,
          hunter_source_proof_label: decision.sourceProof.label,
          hunter_source_proof_url: decision.sourceProof.url,
          hunter_reasons: decision.reasons,
          hunter_blockers: decision.blockers,
          research_evidence_url: decision.evidenceUrl,
        }))
      ),
    ]
  )

  return result.rowCount ?? 0
}

async function approveScoredContacts(
  clientId: number,
  contacts: ProspectResearchContact[],
  decisions: ProspectResearchDecision[],
  mode: string
) {
  const contactById = new Map(contacts.map((contact) => [Number(contact.id), contact]))
  const candidateIds = decisions.map((decision) => decision.id)
  if (candidateIds.length === 0) return { approved: 0, rows: [] as any[] }

  const result = await query(
    `UPDATE contacts
     SET custom_fields = COALESCE(contacts.custom_fields, '{}'::jsonb)
       || jsonb_build_object(
         'send_status', 'approved',
         'approval_required', false,
         'approved_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'approved_by', $4,
         'auto_approval_eligible', true,
         'approval_batch', $4,
         'research_score', scores.score,
         'research_reasons', scores.reasons,
         'hunter_confidence', scores.confidence,
         'hunter_verdict', 'approved',
         'hunter_bounce_risk', scores.bounce_risk,
         'hunter_buyer_fit', scores.buyer_fit,
         'hunter_recommendation', scores.recommendation,
         'hunter_verification_label', scores.verification_label,
         'hunter_source_proof_label', scores.source_proof_label,
         'hunter_source_proof_url', scores.source_proof_url,
         'research_evidence_url', scores.evidence_url,
         'email_evidence', COALESCE(NULLIF(scores.email_evidence, ''), contacts.custom_fields->>'email_evidence')
       ),
       updated_at = CURRENT_TIMESTAMP
     FROM jsonb_to_recordset($3::jsonb) AS scores(
       id bigint,
       score int,
       confidence int,
       reasons jsonb,
       evidence_url text,
       email_evidence text,
       bounce_risk text,
       buyer_fit text,
       recommendation text,
       verification_label text,
       source_proof_label text,
       source_proof_url text
     )
     WHERE contacts.client_id = $1
       AND contacts.id = ANY($2::bigint[])
       AND contacts.id = scores.id
       AND contacts.status = 'active'
       AND contacts.bounced_at IS NULL
       AND contacts.unsubscribed_at IS NULL
     RETURNING contacts.id, contacts.email, contacts.company, contacts.custom_fields`,
    [
      clientId,
      candidateIds,
      JSON.stringify(
        decisions.map((decision) => ({
          id: decision.id,
          score: decision.score,
          confidence: decision.confidence,
          reasons: decision.reasons,
          evidence_url: decision.evidenceUrl,
          email_evidence: asString(contactById.get(decision.id)?.custom_fields?.email_evidence),
          bounce_risk: decision.bounceRisk,
          buyer_fit: decision.buyerFit,
          recommendation: decision.recommendation,
          verification_label: decision.verificationLabel,
          source_proof_label: decision.sourceProof.label,
          source_proof_url: decision.sourceProof.url,
        }))
      ),
      mode,
    ]
  )

  return { approved: result.rowCount ?? result.rows.length, rows: result.rows }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const clientId = await resolveClientId({
      body,
      headers: request.headers,
      searchParams: request.nextUrl.searchParams,
    })
    const ids = parseIds(body.ids)
    const approvalWindow = await resolveSystemApprovalWindow(clientId)

    if (ids.length > 0) {
      const contacts = await loadApprovalContacts(clientId, ids)
      const decisions = contacts.map((contact) => scoreProspectForResearchApproval(contact))
      const approvable = decisions.filter(
        (decision) =>
          decision.approved &&
          decision.recommendation === 'approve' &&
          decision.bounceRisk !== 'high'
      )
      const approvableIds = new Set(approvable.map((decision) => decision.id))
      const heldDecisions = decisions.filter((decision) => !approvableIds.has(decision.id))
      const held = await markHeldContacts(clientId, heldDecisions)
      const result = await approveScoredContacts(
        clientId,
        contacts,
        approvable,
        'operator_hunter_verified_gate'
      )
      const approved = result.approved

      void notifyTelegramEvent({
        type: 'contacts_approved',
        approved,
        mode: 'selected',
      })

      return NextResponse.json({
        ok: true,
        mode: 'selected',
        approved,
        held,
        scanned: decisions.length,
        systemApprovalWindow: approvalWindow,
        contacts: result.rows,
        blocked: heldDecisions,
      })
    }

    const contacts = await loadApprovalContacts(clientId, undefined, approvalWindow.limit)
    const leadScoutContacts = contacts.filter(
      (contact) =>
        contact.custom_fields?.lead_scout === true ||
        contact.custom_fields?.lead_scout === 'true' ||
        contact.custom_fields?.public_search === true ||
        contact.custom_fields?.public_search === 'true'
    )
    const decisions = leadScoutContacts.map((contact) => scoreProspectForResearchApproval(contact))
    const approvable = decisions.filter(
      (decision) =>
        decision.approved &&
        decision.recommendation === 'approve' &&
        decision.bounceRisk !== 'high'
    )
    const approvableIds = new Set(approvable.map((decision) => decision.id))
    const heldDecisions = decisions.filter((decision) => !approvableIds.has(decision.id))
    const held = await markHeldContacts(clientId, heldDecisions)

    if (approvable.length === 0) {
      return NextResponse.json({
        ok: true,
        mode: 'safest',
        approved: 0,
        held,
        scanned: decisions.length,
        systemApprovalWindow: approvalWindow,
        contacts: [],
        blocked: heldDecisions,
        skipped: 'no_hunter_verified_prospects',
      })
    }

    const result = await approveScoredContacts(
      clientId,
      leadScoutContacts,
      approvable,
      'safest_hunter_verified_gate'
    )
    const approved = result.approved

    void notifyTelegramEvent({
      type: 'contacts_approved',
      approved,
      mode: 'safest',
    })

    return NextResponse.json({
      ok: true,
      mode: 'safest',
      approved,
      held,
      scanned: decisions.length,
      systemApprovalWindow: approvalWindow,
      contacts: result.rows,
      blocked: heldDecisions,
    })
  } catch (error) {
    console.error('[API] Failed to approve prospects', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to approve prospects' },
      { status: 500 }
    )
  }
}
