export interface EmailDraft {
  body: string
  bulletPoints: string[]
}

export async function writeEmailBody(input: {
  company?: string | null
  painPoint?: string | null
  angle: 'pattern' | 'pain' | 'authority'
}): Promise<EmailDraft> {
  const opening = input.angle === 'pain'
    ? `I noticed ${input.company ?? 'your team'} is likely facing a growth bottleneck.`
    : input.angle === 'authority'
    ? `We help high-performing teams win more meetings without adding headcount.`
    : `A quick note on how to break through the noise with your outreach.`

  const body = `${opening}\n\nIf your current process is costing time, I can share one practical way to lower reply friction and increase qualified conversations.`

  return {
    body,
    bulletPoints: [
      'Clear next step with a low-risk ask',
      'Proof point tailored to your market',
      'Fast follow-up process to keep momentum',
    ],
  }
}
