import type { ReplyClassification } from '@/lib/agents/inbox/reply-classifier'

export interface ResponseDraft {
  subject: string
  body: string
}

export async function writeResponse(input: {
  classification: ReplyClassification
  originalMessage: string
}): Promise<ResponseDraft> {
  if (input.classification === 'interested') {
    return {
      subject: 'Next step on this',
      body: `Thanks for the reply. I can share a concise plan and next steps that keep this moving forward without extra work on your side.`,
    }
  }

  if (input.classification === 'not_interested') {
    return {
      subject: 'Understood, closing the loop',
      body: `Thanks for letting me know. If priorities shift, I can revisit a more relevant use case for your team.`,
    }
  }

  if (input.classification === 'ooa') {
    return {
      subject: 'Happy to reconnect when you return',
      body: `I appreciate the update. Let's reconnect when your schedule frees up and I can share a low-effort next step.`,
    }
  }

  return {
    subject: 'Quick clarification',
    body: `Thanks for the note. Can you share whether you want to explore this now or keep it on the radar?`,
  }
}
