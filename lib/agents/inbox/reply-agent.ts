import { z } from 'zod'
import { classifyReplyText } from '@/lib/operator'

export type ReplyType = 'INTERESTED' | 'NOT_INTERESTED' | 'OOO' | 'UNKNOWN'
export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
export type ReplyAction = 'CONTINUE' | 'STOP_SEQUENCE' | 'FOLLOW_UP_LATER'

export interface ReplyClassificationResult {
  contact_email: string
  thread_id: string
  reply_type: ReplyType
  sentiment: Sentiment
  action: ReplyAction
  confidence: number
}

export interface ReplyEvent {
  event_type: 'REPLY_CLASSIFIED' | 'SYSTEM_ERROR'
  source_agent: 'reply_agent'
  timestamp: string
  payload:
    | {
        contact_email: string
        reply_type: ReplyType
        action: ReplyAction
      }
    | {
        error_type: string
        severity: 'LOW' | 'MEDIUM' | 'HIGH'
      }
}

const replyInputSchema = z.object({
  email_content: z.string().min(1),
  thread_id: z.string().min(1),
})

function extractContactEmail(emailContent: string): string {
  const match = emailContent.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0]?.toLowerCase() ?? ''
}

function toStructuredReply(text: string): {
  reply_type: ReplyType
  sentiment: Sentiment
  action: ReplyAction
  confidence: number
} {
  const classified = classifyReplyText(text)

  switch (classified) {
    case 'interested':
      return {
        reply_type: 'INTERESTED',
        sentiment: 'POSITIVE',
        action: 'STOP_SEQUENCE',
        confidence: 0.92,
      }
    case 'not_interested':
      return {
        reply_type: 'NOT_INTERESTED',
        sentiment: 'NEGATIVE',
        action: 'STOP_SEQUENCE',
        confidence: 0.96,
      }
    case 'ooo':
      return {
        reply_type: 'OOO',
        sentiment: 'NEUTRAL',
        action: 'FOLLOW_UP_LATER',
        confidence: 0.9,
      }
    default:
      return {
        reply_type: 'UNKNOWN',
        sentiment: 'NEUTRAL',
        action: 'FOLLOW_UP_LATER',
        confidence: 0.35,
      }
  }
}

function buildReplyEvent(
  result: ReplyClassificationResult,
): ReplyEvent {
  return {
    event_type: 'REPLY_CLASSIFIED',
    source_agent: 'reply_agent',
    timestamp: new Date().toISOString(),
    payload: {
      contact_email: result.contact_email,
      reply_type: result.reply_type,
      action: result.action,
    },
  }
}

function buildSystemErrorEvent(errorType: string, severity: 'LOW' | 'MEDIUM' | 'HIGH'): ReplyEvent {
  return {
    event_type: 'SYSTEM_ERROR',
    source_agent: 'reply_agent',
    timestamp: new Date().toISOString(),
    payload: {
      error_type: errorType,
      severity,
    },
  }
}

function fallback(threadId: string): ReplyClassificationResult {
  return {
    contact_email: '',
    thread_id: threadId,
    reply_type: 'UNKNOWN',
    sentiment: 'NEUTRAL',
    action: 'FOLLOW_UP_LATER',
    confidence: 0,
  }
}

export async function processReplyPayload(
  input: unknown,
): Promise<{ result: ReplyClassificationResult; events: ReplyEvent[] }> {
  const events: ReplyEvent[] = []

  try {
    const parsed = replyInputSchema.parse(input)
    const result: ReplyClassificationResult = {
      contact_email: extractContactEmail(parsed.email_content),
      thread_id: parsed.thread_id,
      ...toStructuredReply(parsed.email_content),
    }
    events.push(buildReplyEvent(result))
    return { result, events }
  } catch (error) {
    const threadId =
      typeof input === 'object' && input !== null && 'thread_id' in input
        ? String((input as { thread_id?: unknown }).thread_id ?? '')
        : ''
    const result = fallback(threadId)
    events.push(
      buildSystemErrorEvent(
        error instanceof Error ? error.name : 'UnknownError',
        'MEDIUM',
      ),
    )
    events.push(buildReplyEvent(result))
    return { result, events }
  }
}
