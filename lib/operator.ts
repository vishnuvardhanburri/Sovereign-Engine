import { query, queryOne } from '@/lib/db'
import { Campaign, Client, OperatorAction, SequenceStep } from '@/lib/db/types'
import { appEnv } from '@/lib/env'
import { sendTelegramMessage } from '@/lib/telegram'

export type MessageAngle = 'pattern' | 'pain' | 'authority'
export type ReplyClassification = 'interested' | 'not_interested' | 'ooo'

interface PerformanceSnapshot {
  sent: number
  replies: number
  bounces: number
  opens: number
  replyRate: number
  bounceRate: number
  openRate: number
}

const TOUCH_PLAN = [
  { day: 0, label: 'initial' },
  { day: 2, label: 'follow_up' },
  { day: 4, label: 'insight' },
  { day: 7, label: 'loom_trigger' },
  { day: 11, label: 'case_proof' },
  { day: 15, label: 'breakup' },
] as const

const FORBIDDEN_PHRASES = ['just checking', 'checking in', 'follow up on my last email']

function trimLine(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function buildFiveLineEmail(lines: string[]) {
  const sanitized = lines.map(trimLine).filter(Boolean).slice(0, 5)
  return sanitized.join('\n')
}

function parseProofPoints(client: Client) {
  return (
    client.proof_points?.split('\n').map((item) => item.trim()).filter(Boolean) ?? [
      'improve reply rates with stronger outbound systems',
    ]
  )
}

export function validateSequenceStepCopy(step: Pick<SequenceStep, 'subject' | 'body'>) {
  const lines = step.body.split('\n').map(trimLine).filter(Boolean)

  if (lines.length > 5) {
    throw new Error('AI operator rejected sequence step: more than 5 lines')
  }

  if (step.body.length > 700) {
    throw new Error('AI operator rejected sequence step: copy is too long')
  }

  const normalized = step.body.toLowerCase()
  for (const phrase of FORBIDDEN_PHRASES) {
    if (normalized.includes(phrase)) {
      throw new Error(`AI operator rejected sequence step: forbidden phrase "${phrase}"`)
    }
  }
}

async function getClientProfile(clientId: number) {
  return queryOne<Client>(
    `SELECT *
     FROM clients
     WHERE id = $1`,
    [clientId]
  )
}

async function getPerformanceSnapshot(clientId: number, campaignId?: number): Promise<PerformanceSnapshot> {
  const params: unknown[] = [clientId]
  let where = 'client_id = $1'

  if (campaignId) {
    params.push(campaignId)
    where += ` AND id = $2`
  }

  const rows = await query<Campaign>(
    `SELECT *
     FROM campaigns
     WHERE ${where}`,
    params
  )

  const sent = rows.rows.reduce((sum, campaign) => sum + Number(campaign.sent_count ?? 0), 0)
  const replies = rows.rows.reduce((sum, campaign) => sum + Number(campaign.reply_count ?? 0), 0)
  const bounces = rows.rows.reduce((sum, campaign) => sum + Number(campaign.bounce_count ?? 0), 0)
  const opens = rows.rows.reduce((sum, campaign) => sum + Number(campaign.open_count ?? 0), 0)

  return {
    sent,
    replies,
    bounces,
    opens,
    replyRate: sent > 0 ? Number(((replies / sent) * 100).toFixed(2)) : 0,
    bounceRate: sent > 0 ? Number(((bounces / sent) * 100).toFixed(2)) : 0,
    openRate: sent > 0 ? Number(((opens / sent) * 100).toFixed(2)) : 0,
  }
}

export async function logOperatorAction(input: {
  clientId: number
  campaignId?: number | null
  actionType: string
  summary: string
  payload?: Record<string, unknown>
}) {
  return queryOne<OperatorAction>(
    `INSERT INTO operator_actions (
      client_id,
      campaign_id,
      action_type,
      summary,
      payload
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [
      input.clientId,
      input.campaignId ?? null,
      input.actionType,
      input.summary,
      input.payload ?? null,
    ]
  )
}

export function chooseMessageAngle(snapshot: PerformanceSnapshot): MessageAngle {
  if (snapshot.replyRate >= 8) {
    return 'authority'
  }

  if (snapshot.bounceRate > 3 || snapshot.openRate < 15) {
    return 'pattern'
  }

  return 'pain'
}

export function classifyReplyText(text: string): ReplyClassification {
  const normalized = text.toLowerCase()

  if (
    /\bout of office\b|\booo\b|\baway until\b|\bon vacation\b|\bout until\b/.test(
      normalized
    )
  ) {
    return 'ooo'
  }

  if (
    /\binterested\b|\byes\b|\blet'?s talk\b|\bsend details\b|\bbook\b|\bcall\b/.test(
      normalized
    )
  ) {
    return 'interested'
  }

  return 'not_interested'
}

export function buildOperatorSequence(client: Client, angle: MessageAngle) {
  const audience = client.target_audience?.trim() || 'growth-focused companies'
  const offer = client.offer_summary?.trim() || 'a system that improves outbound performance'
  const proof = parseProofPoints(client)[0]

  const subjectByAngle: Record<MessageAngle, string[]> = {
    pattern: [
      'Quick thought for {{Company}}',
      '{{FirstName}}, one outbound gap',
      'Idea worth pressure-testing?',
      'A short loom for {{Company}}',
      'Proof this can work quickly',
      'Close the loop?',
    ],
    pain: [
      'Are leads leaking here?',
      '{{Company}} may be losing replies here',
      'One fix for stalled outbound',
      'Worth sending a loom?',
      'Case proof on reply lift',
      'Should I step away?',
    ],
    authority: [
      'How peers lifted replies',
      '{{FirstName}}, quick proof point',
      'One structure high-ticket teams use',
      'Recorded this for {{Company}}',
      'Case study: faster meetings',
      'Last note from me',
    ],
  }

  const bodyBuilders: Record<
    MessageAngle,
    Array<(touch: number) => string>
  > = {
    pattern: [
      () =>
        buildFiveLineEmail([
          `Noticed {{Company}} is pushing into ${audience}.`,
          `${offer} usually breaks when the message sounds like everyone else.`,
          `We used ${proof}.`,
          `Happy to show the short structure we use.`,
          `Worth sharing?`,
        ]),
      () =>
        buildFiveLineEmail([
          `Saw one more thing at {{Company}}.`,
          `Most teams lose replies because the second touch repeats the first.`,
          `We fix that with a new angle every follow-up.`,
          `I can send the 6-touch outline if helpful.`,
          `Want it?`,
        ]),
      () =>
        buildFiveLineEmail([
          `One insight from recent outbound audits.`,
          `Pain, money loss, and growth are the 3 triggers buyers react to fastest.`,
          `Most sequences only hit one of them.`,
          `I mapped how to cover all three for {{Company}}.`,
          `Should I send it over?`,
        ]),
      () =>
        buildFiveLineEmail([
          `I recorded a quick loom idea for {{Company}}.`,
          `It shows where reply friction is coming from right now.`,
          `Same lens helped ${proof}.`,
          `Can send the 2-minute breakdown.`,
          `Want the link?`,
        ]),
      () =>
        buildFiveLineEmail([
          `A case proof worth seeing.`,
          `${proof} came from tightening message relevance and follow-up tension.`,
          `No long copy. No hard pitch.`,
          `That same pattern could fit {{Company}}.`,
          `Open to the breakdown?`,
        ]),
      () =>
        buildFiveLineEmail([
          `I’ll close the loop after this.`,
          `Usually silence means timing, not lack of need.`,
          `If outbound reply quality matters this quarter, there is a clean fix.`,
          `I can leave the blueprint here and step back.`,
          `Should I do that?`,
        ]),
    ],
    pain: [
      () =>
        buildFiveLineEmail([
          `Most ${audience} teams lose revenue between first touch and close.`,
          `That gap usually comes from weak follow-up structure, not weak offers.`,
          `We tighten that using ${proof}.`,
          `Could show the framework we use.`,
          `Useful?`,
        ]),
      () =>
        buildFiveLineEmail([
          `Another angle on the same problem.`,
          `When replies are low, the hidden cost is pipeline volatility.`,
          `That makes forecasting and closing harder.`,
          `We solve it with tighter sequencing and message tension.`,
          `Worth a look?`,
        ]),
      () =>
        buildFiveLineEmail([
          `One risk I keep seeing.`,
          `Outbound stalls when every message sounds informational instead of consequential.`,
          `People respond faster when the tension is specific.`,
          `I wrote a version for {{Company}}.`,
          `Should I send it?`,
        ]),
      () =>
        buildFiveLineEmail([
          `I can send a short video teardown.`,
          `It will show the exact point where prospects disengage.`,
          `That usually uncovers why follow-ups flatten out.`,
          `The fix is straightforward once seen.`,
          `Want me to record it?`,
        ]),
      () =>
        buildFiveLineEmail([
          `Quick proof point.`,
          `${proof} worked because the emails exposed cost, not features.`,
          `That shift usually raises positive replies fastest.`,
          `I can outline the sequence logic for {{Company}}.`,
          `Interested?`,
        ]),
      () =>
        buildFiveLineEmail([
          `Final note from me.`,
          `If reply rates are already solved, no need to keep this open.`,
          `If not, there is likely a revenue leak sitting in the follow-ups.`,
          `I can send the fix and get out of your inbox.`,
          `Want that?`,
        ]),
    ],
    authority: [
      () =>
        buildFiveLineEmail([
          `${proof}.`,
          `That came from a tighter outbound operating system, not more volume.`,
          `Saw overlap with what {{Company}} is building.`,
          `I can show the structure behind it.`,
          `Worth sending?`,
        ]),
      () =>
        buildFiveLineEmail([
          `One thing strong outbound teams do differently.`,
          `They anchor every touch in proof before they make the offer.`,
          `That lowers resistance fast.`,
          `We use it to shorten the path to meetings.`,
          `Want the template?`,
        ]),
      () =>
        buildFiveLineEmail([
          `A quick authority angle for {{Company}}.`,
          `Buyers trust a process more when they can see proof, pain, and payoff in one thread.`,
          `That is how we keep follow-ups from feeling repetitive.`,
          `I mapped the exact sequence for your market.`,
          `Should I send it?`,
        ]),
      () =>
        buildFiveLineEmail([
          `I can send a short loom with examples.`,
          `It covers the exact email structure behind the best reply spikes we have seen.`,
          `The goal is meetings, not vanity opens.`,
          `If helpful, I will record it today.`,
          `Want it?`,
        ]),
      () =>
        buildFiveLineEmail([
          `Another proof point.`,
          `${proof} came after tightening line length, proof density, and CTA softness.`,
          `That same stack is usually enough to revive flat campaigns.`,
          `Happy to show how it would look for {{Company}}.`,
          `Open to it?`,
        ]),
      () =>
        buildFiveLineEmail([
          `Last message from me.`,
          `I only kept reaching out because the fit looked real.`,
          `If improving reply quality is not a priority right now, I will close this.`,
          `If it is, I can send the full operator playbook.`,
          `Should I?`,
        ]),
    ],
  }

  return TOUCH_PLAN.map((touch, index) => {
    const body = bodyBuilders[angle][index](index)
    const step = {
      day: touch.day + 1,
      subject: subjectByAngle[angle][index],
      body,
    }

    validateSequenceStepCopy({
      subject: step.subject,
      body: step.body,
    } as Pick<SequenceStep, 'subject' | 'body'>)

    return step
  })
}

export async function prepareCampaignOperatorPlan(input: {
  clientId: number
  campaignId: number
}) {
  const client = await getClientProfile(input.clientId)
  if (!client) {
    throw new Error('Client not found for operator plan')
  }

  const snapshot = await getPerformanceSnapshot(input.clientId, input.campaignId)
  const angle = chooseMessageAngle(snapshot)
  const volumeAction =
    snapshot.bounceRate > 4
      ? 'decrease'
      : snapshot.replyRate > 8
      ? 'increase'
      : 'hold'

  const steps = buildOperatorSequence(client, angle)
  await logOperatorAction({
    clientId: input.clientId,
    campaignId: input.campaignId,
    actionType: 'campaign_strategy',
    summary: `Operator selected ${angle} angle and ${volumeAction} volume action`,
    payload: {
      snapshot,
      angle,
      volumeAction,
      steps,
    },
  })

  return {
    angle,
    volumeAction,
    steps,
    snapshot,
  }
}

export async function buildDailyOperatorReport(clientId: number) {
  const client = await getClientProfile(clientId)
  if (!client) {
    throw new Error('Client not found')
  }

  const daily = await queryOne<{
    sent: string
    replies: string
    positive_replies: string
    active_conversations: string
    bounces: string
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
       COUNT(*) FILTER (WHERE event_type = 'reply')::text AS replies,
       COUNT(*) FILTER (
         WHERE event_type = 'reply'
           AND COALESCE(metadata->>'reply_status', 'unread') = 'interested'
       )::text AS positive_replies,
       COUNT(*) FILTER (
         WHERE event_type = 'reply'
           AND COALESCE(metadata->>'reply_status', 'unread') IN ('interested', 'unread')
       )::text AS active_conversations,
       COUNT(*) FILTER (WHERE event_type = 'bounce')::text AS bounces
     FROM events
     WHERE client_id = $1
       AND created_at >= CURRENT_DATE`,
    [clientId]
  )

  const snapshot = await getPerformanceSnapshot(clientId)
  const insight =
    snapshot.replyRate < 3
      ? 'Reply rate dipped, likely due to weak subject-line curiosity or low personalization density.'
      : snapshot.bounceRate > 3
      ? 'Bounce pressure increased, so the operator should tighten volume and rotate the healthiest identities.'
      : 'Reply quality is healthy; the operator can press authority-driven proof more aggressively tomorrow.'

  const action =
    snapshot.bounceRate > 3
      ? 'Decrease volume tomorrow and favor pattern-interrupt subjects on the healthiest domains.'
      : snapshot.replyRate < 3
      ? 'Increase personalization and use a pain-led opener on the first two touches tomorrow.'
      : 'Increase volume slightly and keep the strongest proof-first angle live.'

  const text = [
    `*${client.name}* daily outbound report`,
    '',
    `Emails sent today: ${Number(daily?.sent ?? 0)}`,
    `Replies received: ${Number(daily?.replies ?? 0)}`,
    `Positive replies: ${Number(daily?.positive_replies ?? 0)}`,
    `Bounce rate: ${snapshot.bounceRate}%`,
    `Active conversations: ${Number(daily?.active_conversations ?? 0)}`,
    `Calls booked: 0`,
    '',
    `Insight: ${insight}`,
    `Action: ${action}`,
  ].join('\n')

  return {
    client,
    text,
    insight,
    action,
  }
}

export async function runDailyOperatorCycle(clientId: number) {
  const report = await buildDailyOperatorReport(clientId)

  await logOperatorAction({
    clientId,
    actionType: 'daily_report',
    summary: report.insight,
    payload: {
      action: report.action,
    },
  })

  const botToken = appEnv.telegramBotToken()
  const delivery = await sendTelegramMessage({
    botToken,
    chatId: report.client.telegram_chat_id,
    text: report.text,
  })

  return {
    ...report,
    delivery,
  }
}
