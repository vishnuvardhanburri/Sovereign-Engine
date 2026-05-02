#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

console.log('Sovereign Engine Investor Demo')
console.log('Shows reputation dashboard, live metrics, worker scaling, and simulated pipeline proof.')
console.log('')

const status = spawnSync('pnpm', ['demo:buyer'], { stdio: 'inherit' }).status ?? 1
if (status !== 0) process.exit(status)

const urls = [
  'http://localhost:3400/reputation?investor=1',
  'http://localhost:3400/api/health/stats?client_id=1',
  'http://localhost:3400/demo/metrics',
]

for (const url of urls) {
  if (process.platform === 'darwin') spawnSync('open', [url], { stdio: 'ignore' })
  else console.log(`Open: ${url}`)
}
