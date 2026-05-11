#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

const required = [
  'libs/platform-sdk/src/index.ts',
  'libs/platform-sdk/src/client.ts',
  'libs/platform-sdk/src/realtime.ts',
  'apps/realtime-gateway/src/server.ts',
  'apps/desktop-console/src/App.tsx',
  'apps/desktop-console/src-tauri/tauri.conf.json',
  'apps/mobile-console/App.tsx',
  '../docs/cross-platform/README.md',
  '../docs/cross-platform/SECURITY_CHECKLIST.md',
  '../.github/workflows/platform-release.yml',
]

const forbiddenClientPatterns = [
  /\bfrom\s+['"]bullmq['"]/,
  /\bfrom\s+['"]ioredis['"]/,
  /\bfrom\s+['"]nodemailer['"]/,
  /\bfrom\s+['"]@sovereign\/smtp-client['"]/,
  /\bnew\s+Queue\s*\(/,
  /\bnew\s+Worker\s*\(/,
]

const clientRoots = ['apps/desktop-console', 'apps/mobile-console', 'libs/platform-sdk']

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.next', 'target'].includes(entry.name)) return []
      return walk(fullPath)
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) return []
    return [fullPath]
  })
}

const missing = required.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)))
if (missing.length) {
  console.error('Cross-platform check failed. Missing files:')
  for (const file of missing) console.error(`- ${file}`)
  process.exit(1)
}

const violations = []
for (const clientRoot of clientRoots) {
  for (const file of walk(path.join(root, clientRoot))) {
    const source = fs.readFileSync(file, 'utf8')
    for (const pattern of forbiddenClientPatterns) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(root, file)} matches ${pattern}`)
      }
    }
  }
}

if (violations.length) {
  console.error('Client centralization rule failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Cross-platform console check passed: clients remain control-plane only.')
