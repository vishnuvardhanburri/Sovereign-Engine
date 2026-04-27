export type FollowupPlan = {
  max_followups: number
  delays_hours: number[]
  templates: Array<{ subject_prefix?: string; body: string }>
}

export function defaultFollowupPlan(): FollowupPlan {
  return {
    max_followups: 2,
    delays_hours: [48, 96],
    templates: [
      { body: `Just bumping this in case it got buried.` },
      { body: `Happy to share how we’re improving replies without increasing volume.` },
    ],
  }
}

