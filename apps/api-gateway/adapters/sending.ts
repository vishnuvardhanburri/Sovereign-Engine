import { rotateInbox as rotateInboxSvc, enforceCaps as enforceCapsSvc, scheduleSend as scheduleSendSvc } from '@xavira/sending-engine'
import type { Lane, SendIdentitySelection } from '@xavira/types'
import { query } from '@/lib/db'

// Adapter mode: preserve old signatures by delegating to services with injected deps.
export async function rotateInbox(clientId: number, lane: Lane): Promise<SendIdentitySelection | null> {
  return rotateInboxSvc({ db: query }, clientId, lane)
}

export function enforceCaps(selection: SendIdentitySelection, lane: Lane) {
  return enforceCapsSvc(selection, lane)
}

export function scheduleSend(lane: Lane) {
  return scheduleSendSvc(Date.now(), lane)
}

