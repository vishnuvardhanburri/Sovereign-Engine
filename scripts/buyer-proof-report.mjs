#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = path.join(root, 'output', 'buyer-proof', stamp)
const latestDir = path.join(root, 'output', 'buyer-proof', 'latest')

fs.mkdirSync(outDir, { recursive: true })
fs.rmSync(latestDir, { recursive: true, force: true })
fs.mkdirSync(path.dirname(latestDir), { recursive: true })

function run(name, command, args) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  fs.writeFileSync(path.join(outDir, `${name}.log`), output)
  return {
    name,
    command: [command, ...args].join(' '),
    ok: result.status === 0,
    status: result.status ?? 1,
    durationMs: Date.now() - started,
  }
}

function latestPath(relativePath) {
  const target = path.join(root, relativePath)
  return fs.existsSync(target) ? target : null
}

const checks = [
  run('brand-check', 'pnpm', ['brand:check']),
  run('copy-check', 'pnpm', ['copy:check']),
]

const latestLaunchSummary = latestPath('output/launch-ready/latest/SUMMARY.md')
const latestDataRooms = latestPath('output/data-room')
const latestSubmitPack = latestPath('output/submit-pack')

const report = `# Sovereign Engine Buyer Proof Report

Generated: ${new Date().toISOString()}

## Automated Checks

${checks
  .map((check) => `- ${check.ok ? 'PASS' : 'FAIL'}: \`${check.command}\` (${Math.round(check.durationMs / 1000)}s)`)
  .join('\n')}

## Required Human Proof Command

\`\`\`bash
pnpm launch:ready
\`\`\`

This is the main evidence command. It validates the mock-safe stack, health oracle, pricing page, demo metrics, trust summary, production gate, and submission pack.

## Latest Evidence

- Launch summary: ${latestLaunchSummary || 'Not generated yet. Run pnpm launch:ready.'}
- Data room folder: ${latestDataRooms || 'Not generated yet. Run pnpm generate:data-room.'}
- Submit pack folder: ${latestSubmitPack || 'Not generated yet. Run pnpm submit:pack.'}

## Human QA Checklist

See:

\`\`\`text
docs/acquisition/HUMAN_QA_CHECKLIST.md
docs/acquisition/BUYER_PROOF_GUARANTEE.md
\`\`\`

## Safe Guarantee

Sovereign Engine can guarantee a repeatable evaluation proof process. It does not guarantee inbox placement, reply rate, revenue, or real 100k+/day sending without operator-owned domains, provider capacity, DNS, warmup, and compliance inputs.
`

fs.writeFileSync(path.join(outDir, 'BUYER_PROOF_REPORT.md'), report)
fs.cpSync(outDir, latestDir, { recursive: true })

const ok = checks.every((check) => check.ok)
console.log(
  JSON.stringify(
    {
      status: ok ? 'BUYER_PROOF_READY' : 'BUYER_PROOF_CHECK_FAILED',
      folder: outDir,
      latest: latestDir,
      checks,
    },
    null,
    2
  )
)

process.exit(ok ? 0 : 1)
