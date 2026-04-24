import { ingestEvent as ingestEventSvc } from '@xavira/tracking-engine'
import type { TrackingIngestEvent } from '@xavira/types'
import { query } from '@/lib/db'

export async function ingestEvent(event: TrackingIngestEvent) {
  return ingestEventSvc({ db: query }, event)
}

