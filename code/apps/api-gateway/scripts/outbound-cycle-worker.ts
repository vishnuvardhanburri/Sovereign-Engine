import 'dotenv/config'
import { startOutboundCycleWorker } from '@/lib/outbound-cycle-worker'

startOutboundCycleWorker()

console.log('[outbound-cycle-worker] process ready')

process.on('SIGTERM', () => {
  console.log('[outbound-cycle-worker] SIGTERM received')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[outbound-cycle-worker] SIGINT received')
  process.exit(0)
})

// Keep this embedded worker process alive; BullMQ does the actual work.
setInterval(() => undefined, 60_000)
