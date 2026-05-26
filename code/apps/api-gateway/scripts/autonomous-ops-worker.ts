import 'dotenv/config'
import { startAutonomousOpsWorker } from '@/lib/autonomous-ops-worker'

startAutonomousOpsWorker()

console.log('[autonomous-ops-worker] process ready')

process.on('SIGTERM', () => {
  console.log('[autonomous-ops-worker] SIGTERM received')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[autonomous-ops-worker] SIGINT received')
  process.exit(0)
})

setInterval(() => undefined, 60_000)
