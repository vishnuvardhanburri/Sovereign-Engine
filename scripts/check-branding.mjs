#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

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
  'docs/README.md',
  'docs/BUYER_DEMO_GUIDE.md',
  'docs/VIDEO_RECORDING_GUIDE.md',
  'docs/TECHNICAL_PROOF_CHECKLIST.md',
  'docs/PRODUCTION_SUBMISSION_CHECKLIST.md',
  'docs/KNOWN_LIMITATIONS.md',
  'configs',
  'infra',
  'apps/api-gateway/app/layout.tsx',
  'apps/api-gateway/app/page.tsx',
  'apps/api-gateway/app/(auth)',
  'apps/api-gateway/app/(dashboard)/activity/page.tsx',
  'apps/api-gateway/app/(dashboard)/dashboard/page.tsx',
  'apps/api-gateway/app/(dashboard)/demo-import/page.tsx',
  'apps/api-gateway/app/(dashboard)/handoff/page.tsx',
  'apps/api-gateway/app/(dashboard)/limits/page.tsx',
  'apps/api-gateway/app/(dashboard)/proof/page.tsx',
  'apps/api-gateway/app/(dashboard)/raas/page.tsx',
  'apps/api-gateway/app/(dashboard)/reputation/page.tsx',
  'apps/api-gateway/app/(dashboard)/setup/page.tsx',
  'apps/api-gateway/app/(dashboard)/trust/page.tsx',
  'apps/api-gateway/components/header.tsx',
  'apps/api-gateway/components/sidebar.tsx',
  'apps/api-gateway/components/demo-mode-indicator.tsx',
  'apps/api-gateway/components/production-readiness-badge.tsx',
  'apps/api-gateway/components/recording-mode-toggle.tsx',
  'apps/api-gateway/components/worker-live-map.tsx',
].filter((target) => fs.existsSync(path.join(root, target)))

const skipPathPatterns = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /^scripts\/check-branding\.mjs$/,
]

function listedFiles() {
  const files = new Set()

  const walk = (relativePath) => {
    if (skipPathPatterns.some((pattern) => pattern.test(relativePath))) return
    const fullPath = path.join(root, relativePath)
    let stat
    try {
      stat = fs.statSync(fullPath)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(fullPath)) {
        walk(path.posix.join(relativePath, entry))
      }
      return
    }
    if (stat.isFile()) files.add(relativePath)
  }

  for (const target of scanTargets) walk(target)
  return [...files].sort()
}

function isProbablyText(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > 1_000_000) return false
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(Math.min(512, stat.size))
    fs.readSync(fd, buffer, 0, buffer.length, 0)
    fs.closeSync(fd)
    return !buffer.includes(0)
  } catch {
    return false
  }
}

function lineMatches(file, text) {
  const matches = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const hasLegacyBrand = blockedTerms.some((term) => line.includes(term))
    const hasLegacyInitials = /(^|[^A-Za-z0-9])XO([^A-Za-z0-9]|$)/.test(line)
    if (hasLegacyBrand || hasLegacyInitials) matches.push(`${file}:${index + 1}:${line}`)
  }
  return matches
}

const matches = []
for (const file of listedFiles()) {
  const fullPath = path.join(root, file)
  if (!isProbablyText(fullPath)) continue
  const text = fs.readFileSync(fullPath, 'utf8')
  matches.push(...lineMatches(file, text))
}

if (matches.length) {
  console.error('Legacy brand references found:')
  for (const match of matches) console.error(match)
  process.exit(1)
}

console.log('Brand check passed: public surfaces use Sovereign Engine only.')
