import { ingestEvent as ingestEventSvc } from '@sovereign/tracking-engine'
import type { TrackingIngestEvent } from '@sovereign/types'
import { query } from '@/lib/db'

export async function ingestEvent(event: TrackingIngestEvent) {
  return ingestEventSvc({ db: query }, event)
}

