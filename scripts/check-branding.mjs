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
const legacyInitials = new RegExp(`(^|[^A-Za-z0-9])${['X', 'O'].join('')}([^A-Za-z0-9]|$)`)

const skipDirs = new Set(['.git', 'node_modules', 'output', '.next', 'dist', 'build', '.turbo'])
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sh',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
])

function shouldRead(file) {
  const base = path.basename(file)
  if (base === 'pnpm-lock.yaml') return true
  if (base.includes('tsbuildinfo')) return true
  return textExtensions.has(path.extname(file))
}

function walk(dir, matches = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, matches)
      continue
    }
    if (!entry.isFile() || !shouldRead(full)) continue
    const raw = fs.readFileSync(full, 'utf8')
    const lines = raw.split(/\r?\n/)
    lines.forEach((line, index) => {
      const isLockfile = path.basename(full) === 'pnpm-lock.yaml'
      if (blockedTerms.some((term) => line.includes(term)) || (!isLockfile && legacyInitials.test(line))) {
        matches.push(`${path.relative(root, full)}:${index + 1}:${line}`)
      }
    })
  }
  return matches
}

const matches = walk(root)
if (matches.length) {
  console.error('Legacy brand references found:')
  for (const match of matches) console.error(match)
  process.exit(1)
}

console.log('Brand check passed: Sovereign Engine only.')
