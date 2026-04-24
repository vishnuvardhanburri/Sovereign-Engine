import { simulate } from '@xavira/simulation-engine'
import { query } from '@/lib/db'
import type { Lane } from '@xavira/types'

export async function simulateOutcome(input: { clientId: number; domainId: number; identityId: number; lane: Lane }) {
  return simulate({ db: query as any }, input)
}

