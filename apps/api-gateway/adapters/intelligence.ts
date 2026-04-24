import { computeGlobalIntelligence } from '@xavira/intelligence-engine'
import { query } from '@/lib/db'

export async function getGlobalIntelligence(clientId: number) {
  return computeGlobalIntelligence({ db: query as any }, clientId)
}

