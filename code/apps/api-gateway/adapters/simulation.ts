import { simulate } from '@sovereign/simulation-engine'
import { query } from '@/lib/db'
import type { Lane } from '@sovereign/types'

export async function simulateOutcome(input: { clientId: number; domainId: number; identityId: number; lane: Lane }) {
  return simulate({ db: query as any }, input)
}

