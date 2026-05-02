#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = path.resolve(import.meta.dirname, '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outRoot = path.join(root, 'output', 'data-room')
const room = path.join(outRoot, `sovereign-engine-data-room-${stamp}`)
fs.mkdirSync(room, { recursive: true })

function copy(src, dest = src) {
  const from = path.join(root, src)
  if (!fs.existsSync(from)) return
  const to = path.join(room, dest)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function write(name, content) {
  const file = path.join(room, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function run(name, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 45_000 })
  write(`logs/${name}.log`, `${result.stdout || ''}${result.stderr || ''}`)
  return result.status === 0
}

copy('docs/architecture.md')
copy('docs/api.md')
copy('docs/proof.md')
copy('docs/TECHNICAL_PROOF_CHECKLIST.md')
copy('docs/PRODUCTION_SUBMISSION_CHECKLIST.md')
copy('docs/acquisition/HOMEPAGE_COPY.md')
copy('docs/acquisition/ACQUIRE_LISTING_COPY.md')
copy('docs/acquisition/QUEUE_SCALING_PROOF.md')
copy('apps/api-gateway/public/placeholder-logo.png', 'screenshots/placeholder-logo.png')

run('typecheck-optional', 'pnpm', ['typecheck'])
run('brand-check', 'pnpm', ['brand:check'])

write('ARCHITECTURE_SUMMARY.md', `# Sovereign Engine Architecture

Category: Deliverability Operating System for Outbound Revenue Teams

Core components:
- Next.js API gateway and command center
- Reputation engine
- Sending engine
- Validator engine
- Redis/BullMQ queue layer
- Sender, reputation, optimizer, and inbound workers

Primary buyer value:
- Protect outbound revenue
- Prevent domain burn
- Preserve inbox placement
- Replace fragile sending setups
`)

write('SCALING_PROOF.md', `# Scaling Proof

The acquisition demo includes a simulated 10,000 event pipeline proof.

Endpoint:
\`\`\`text
GET /demo/metrics
\`\`\`

This is explicitly synthetic and does not claim customer traction.
`)

write('DATA_ROOM_MANIFEST.json', JSON.stringify({
  product: 'Sovereign Engine',
  category: 'Deliverability Operating System for Outbound Revenue Teams',
  generatedAt: new Date().toISOString(),
  disclaimer: 'No fake revenue, no fake customers. Demo metrics are simulated.',
  files: fs.readdirSync(room, { recursive: true }),
}, null, 2))

const zipPath = path.join(outRoot, `sovereign-engine-data-room-${stamp}.zip`)
const zip = spawnSync('zip', ['-qr', zipPath, path.basename(room)], { cwd: outRoot })
let sha256 = null
if (zip.status === 0 && fs.existsSync(zipPath)) {
  sha256 = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
}

console.log(JSON.stringify({
  status: 'DATA_ROOM_READY',
  folder: room,
  zip: fs.existsSync(zipPath) ? zipPath : null,
  sha256,
}, null, 2))
