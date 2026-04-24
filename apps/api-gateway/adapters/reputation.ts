import { getDomainScore as getDomainScoreSvc, shouldPauseDomain as shouldPauseDomainSvc, updateDomainStats as updateDomainStatsSvc } from '@xavira/reputation-engine'
import type { TrackingIngestEvent } from '@xavira/types'
import { query } from '@/lib/db'

export async function getDomainScore(clientId: number, domainId: number) {
  return getDomainScoreSvc({ db: query }, clientId, domainId)
}

export async function shouldPauseDomain(clientId: number, domainId: number) {
  return shouldPauseDomainSvc({ db: query }, clientId, domainId)
}

export async function updateDomainStats(event: TrackingIngestEvent) {
  return updateDomainStatsSvc({ db: query }, event)
}

