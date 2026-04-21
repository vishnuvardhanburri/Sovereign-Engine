import type { QueueExecutionContext, SendIdentitySelection } from '@/lib/backend'
import {
  buildSendMessage,
  getNextBusinessWindow,
  getRandomSendDelaySeconds,
  isSuppressed,
  selectBestIdentity,
} from '@/lib/backend'
import { validateEmailPreSend, shouldStopSequence, validateAIMessage, getFallbackMessage, circuitBreaker, recordMetric } from '@/lib/production-fixes'
import { ensureContactTimezone, getSendWindowNext } from '@/lib/scheduling/timezone'
import { hasBeenContactedRecently } from '@/lib/contacts/memory'

export type QueueDecision =
  | { action: 'skip'; reason: string }
  | { action: 'defer'; reason: string; scheduledAt: Date }
  | {
      action: 'send'
      selection: SendIdentitySelection
      message: Awaited<ReturnType<typeof buildSendMessage>>
    }

export async function evaluateQueueDecision(
  context: QueueExecutionContext,
  backendAgentPrompt?: string
): Promise<QueueDecision> {
  if (backendAgentPrompt) {
    console.debug(
      '[DecisionAgent] applying backend prompt',
      backendAgentPrompt.slice(0, 120).replace(/\n/g, ' ')
    )
  }

  // PRODUCTION FIX: Stop-on-reply check
  const shouldStop = await shouldStopSequence(context.job.client_id, context.contact.id, context.campaign.id)
  if (shouldStop) {
    return { action: 'skip', reason: 'sequence stopped - reply received' }
  }

  // Cross-campaign contact memory: prevent re-contacting recently.
  if (await hasBeenContactedRecently({ clientId: context.job.client_id, contactId: context.contact.id, withinDays: 30 })) {
    return { action: 'skip', reason: 'contact already contacted recently' }
  }

  if (
    context.contact.status === 'bounced' ||
    context.contact.status === 'unsubscribed' ||
    context.contact.status === 'replied'
  ) {
    return { action: 'skip', reason: `contact is ${context.contact.status}` }
  }

  // PRODUCTION FIX: Email validation pipeline
  const emailValidation = await validateEmailPreSend(context.contact.email, context.job.client_id)
  if (!emailValidation.valid) {
    return { action: 'skip', reason: `invalid email: ${emailValidation.reason}` }
  }

  if (
    context.contact.verification_status &&
    context.contact.verification_status !== 'valid'
  ) {
    return { action: 'skip', reason: 'invalid or unverifiable email' }
  }

  if (await isSuppressed(context.job.client_id, context.contact.email)) {
    return { action: 'skip', reason: 'suppressed email' }
  }

  if (context.campaign.status === 'completed') {
    return { action: 'skip', reason: 'campaign completed' }
  }

  if (context.campaign.status !== 'active') {
    return {
      action: 'defer',
      reason: `campaign is ${context.campaign.status}`,
      scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
    }
  }

  // PRODUCTION FIX: Health-based routing with circuit breaker
  const selection = await selectBestIdentity(context.job.client_id)
  if (!selection) {
    return {
      action: 'defer',
      reason: 'no active identity available',
      scheduledAt: new Date(Date.now() + 60 * 1000),
    }
  }

  // Check circuit breakers
  const identityCircuit = await circuitBreaker.checkCircuit(String(selection.identity.id), 'identity')
  const domainCircuit = await circuitBreaker.checkCircuit(String(selection.domain.id), 'domain')
  
  if (!identityCircuit || !domainCircuit) {
    return {
      action: 'defer',
      reason: 'sender in circuit break recovery',
      scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
    }
  }

  if (selection.identity.last_sent_at) {
    const randomDelaySeconds = getRandomSendDelaySeconds()
    const nextAllowedAt =
      new Date(selection.identity.last_sent_at).getTime() + randomDelaySeconds * 1000

    if (nextAllowedAt > Date.now()) {
      return {
        action: 'defer',
        reason: `identity cooling down for ${randomDelaySeconds}s`,
        scheduledAt: new Date(nextAllowedAt),
      }
    }
  }

  const tz = ensureContactTimezone(context.contact)
  const nextBusinessWindow =
    tz ? getSendWindowNext(tz) : getNextBusinessWindow(context.contact.timezone)
  if (nextBusinessWindow) {
    return {
      action: 'defer',
      reason: 'outside contact business hours',
      scheduledAt: nextBusinessWindow,
    }
  }

  let message = await buildSendMessage(context)
  
  // PRODUCTION FIX: AI output validation
  const validation = validateAIMessage(message)
  if (!validation.valid) {
    // Use fallback template instead of failing
    message = getFallbackMessage(context.contact, context.sequenceStep)
  }
  
  if (message.spamFlags.length >= 2) {
    return {
      action: 'defer',
      reason: `spam-risk copy: ${message.spamFlags.join(', ')}`,
      scheduledAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    }
  }

  return {
    action: 'send',
    selection,
    message,
  }
}
