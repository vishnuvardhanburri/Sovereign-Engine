export interface FollowUpInstruction {
  nextStep: 'step_1' | 'step_2' | 'step_3'
  scheduledAt: string
}

export async function assignFollowUp(input: {
  currentStep: 'step_1' | 'step_2' | 'step_3'
  delayMinutes?: number
}): Promise<FollowUpInstruction> {
  const nextStep = input.currentStep === 'step_1' ? 'step_2' : input.currentStep === 'step_2' ? 'step_3' : 'step_3'
  const delay = typeof input.delayMinutes === 'number' ? input.delayMinutes : 48 * 60
  const scheduledAt = new Date(Date.now() + delay * 60 * 1000).toISOString()

  return {
    nextStep,
    scheduledAt,
  }
}
