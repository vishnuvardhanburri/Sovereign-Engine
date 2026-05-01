#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const blockedTerms = [
  ['Xa', 'vira'].join(''),
  ['xa', 'vira'].join(''),
  [['xa', 'vira'].join(''), 'orbit'].join('-'),
  [['xa', 'vira'].join(''), 'orbit'].join('_'),
]

const scanTargets = [
  'README.md',
  'DOCS.md',
  'SECURITY.md',
  'package.json',
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'setup.sh',
  'docs',
  'configs',
  'infra',
  'apps/api-gateway/app',
  'apps/api-gateway/components',
  'apps/api-gateway/lib',
  'apps/api-gateway/scripts',
  'workers',
  'libs',
  'services',
  'scripts',
]

function runRg(args) {
  const result = spawnSync('rg', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    console.error(`Brand check requires ripgrep (rg): ${result.error.message}`)
    process.exit(1)
  }
  if (result.status === 0) return result.stdout.trim().split('\n').filter(Boolean)
  if (result.status === 1) return []
  console.error(result.stderr || result.stdout || 'Brand check failed while running ripgrep.')
  process.exit(result.status ?? 1)
}

const commonArgs = [
  '--line-number',
  '--no-heading',
  '--glob',
  '!scripts/check-branding.mjs',
  '--glob',
  '!**/node_modules/**',
  '--glob',
  '!**/.next/**',
  '--glob',
  '!**/dist/**',
  '--glob',
  '!**/build/**',
]

const legacyBrandMatches = runRg([
  ...commonArgs,
  '--fixed-strings',
  ...blockedTerms.flatMap((term) => ['--regexp', term]),
  ...scanTargets,
])

const legacyInitialMatches = runRg([
  ...commonArgs,
  '--regexp',
  '(^|[^A-Za-z0-9])XO([^A-Za-z0-9]|$)',
  ...scanTargets,
])

const matches = [...legacyBrandMatches, ...legacyInitialMatches]

if (matches.length) {
  console.error('Legacy brand references found:')
  for (const match of matches) console.error(match)
  process.exit(1)
}

console.log('Brand check passed: Sovereign Engine only.')
