#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const scanTargets = [
  'README.md',
  'DOCS.md',
  'SECURITY.md',
  'docs/README.md',
  'docs/BUYER_DEMO_GUIDE.md',
  'docs/VIDEO_RECORDING_GUIDE.md',
  'docs/TECHNICAL_PROOF_CHECKLIST.md',
  'docs/PRODUCTION_SUBMISSION_CHECKLIST.md',
  'docs/KNOWN_LIMITATIONS.md',
  'apps/api-gateway/app/(dashboard)',
  'apps/api-gateway/app/api/trust',
  'apps/api-gateway/app/api/handoff',
  'apps/api-gateway/app/api/due-diligence',
]

const blockedPatterns = [
  'bypass(?:ing)?\\s+(?:spam|filters?|provider|gmail|outlook|yahoo|icloud)',
  'evad(?:e|ing|es)\\s+(?:spam|filters?|provider|gmail|outlook|yahoo|icloud)',
  'anti[-\\s]?detection',
  'anti[-\\s]?forensic',
  'invisible\\s+to\\s+(?:isp|provider|gmail|outlook|yahoo|icloud|filters?)',
  'untraceable\\s+(?:sending|email|infrastructure)',
  'guaranteed\\s+inbox',
  'impossible\\s+to\\s+detect',
  'ai[-\\s]?immune',
  'bulk\\s+signature\\s+detection',
  'deliverability\\s+warfare',
]

const result = spawnSync(
  'rg',
  [
    '--line-number',
    '--no-heading',
    '--ignore-case',
    '--glob',
    '!**/node_modules/**',
    '--glob',
    '!**/.next/**',
    '--glob',
    '!**/dist/**',
    '--glob',
    '!**/build/**',
    '--glob',
    '!docs/legacy/**',
    '--regexp',
    blockedPatterns.join('|'),
    ...scanTargets,
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
)

if (result.error) {
  console.error(`Buyer copy check requires ripgrep (rg): ${result.error.message}`)
  process.exit(1)
}

if (result.status === 0) {
  console.error('Buyer copy check failed. Replace risky language with compliance-first positioning:')
  console.error(result.stdout.trim())
  process.exit(1)
}

if (result.status !== 1) {
  console.error(result.stderr || result.stdout || 'Buyer copy check failed while running ripgrep.')
  process.exit(result.status ?? 1)
}

console.log('Buyer copy check passed: public surfaces use safe enterprise positioning.')
