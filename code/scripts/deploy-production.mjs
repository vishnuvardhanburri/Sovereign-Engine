#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  return result.status ?? 1
}

console.log('Sovereign Engine Production Deploy')
console.log('Dashboard: http://localhost:3400/dashboard')
console.log('Reputation: http://localhost:3400/reputation?investor=1')
console.log('Health: http://localhost:3400/api/health/stats?client_id=1')
console.log('')

let status = run('pnpm', ['demo:buyer'])
if (status !== 0) process.exit(status)

console.log('')
console.log('Verifying production health metrics...')
status = run('pnpm', ['doctor:demo'])
process.exit(status)
