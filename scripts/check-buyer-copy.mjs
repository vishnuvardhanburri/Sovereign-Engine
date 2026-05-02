#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

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
  'apps/api-gateway/app/api/trust',
  'apps/api-gateway/app/api/handoff',
  'apps/api-gateway/app/api/due-diligence',
].filter((target) => fs.existsSync(path.join(root, target)))

const blockedPatterns = [
  /bypass(?:ing)?\s+(?:spam|filters?|provider|gmail|outlook|yahoo|icloud)/i,
  /evad(?:e|ing|es)\s+(?:spam|filters?|provider|gmail|outlook|yahoo|icloud)/i,
  /anti[-\s]?detection/i,
  /anti[-\s]?forensic/i,
  /invisible\s+to\s+(?:isp|provider|gmail|outlook|yahoo|icloud|filters?)/i,
  /untraceable\s+(?:sending|email|infrastructure)/i,
  /guaranteed\s+inbox/i,
  /impossible\s+to\s+detect/i,
  /ai[-\s]?immune/i,
  /bulk\s+signature\s+detection/i,
  /deliverability\s+warfare/i,
]

const skipPathPatterns = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /^docs\/legacy\//,
  /^scripts\/check-buyer-copy\.mjs$/,
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

const matches = []
for (const file of listedFiles()) {
  const fullPath = path.join(root, file)
  if (!isProbablyText(fullPath)) continue
  const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (blockedPatterns.some((pattern) => pattern.test(line))) {
      matches.push(`${file}:${index + 1}:${line}`)
    }
  }
}

if (matches.length) {
  console.error('Buyer copy check failed. Replace risky language with compliance-first positioning:')
  for (const match of matches) console.error(match)
  process.exit(1)
}

console.log('Buyer copy check passed: public surfaces use safe enterprise positioning.')
