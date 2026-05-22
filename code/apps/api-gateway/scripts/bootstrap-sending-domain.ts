import 'dotenv/config'
import { closePool } from '@/lib/db'
import { reconcileBootstrapSendingDomain } from '@/lib/bootstrap-sending-domain'

async function main(): Promise<void> {
  const result = await reconcileBootstrapSendingDomain()
  if (!result.enabled) {
    console.log('[bootstrap-sending-domain] disabled', { reason: result.reason })
    return
  }

  console.log('[bootstrap-sending-domain] ready', {
    clientId: result.clientId,
    bootstrapped: result.bootstrapped,
    domainDailyLimit: result.domainDailyLimit,
    identityDailyLimit: result.identityDailyLimit,
    markAuthValid: result.markAuthValid,
  })
}

main()
  .catch((error) => {
    console.error('[bootstrap-sending-domain] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
