#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const clipsDir = path.join(root, 'output', 'video-clips')
const bundleName = 'sovereign-engine-demo-clips.zip'
const bundlePath = path.join(clipsDir, bundleName)
const manifestPath = path.join(clipsDir, 'SOVEREIGN_ENGINE_VIDEO_MANIFEST.md')
const force = process.argv.includes('--force')
const freshnessReference = path.join(root, '..', 'README.md')

const requiredPrefixes = [
  '01-command-center-login-reputation',
  '02-health-oracle-live-stats',
  '03-10k-stress-proof-terminal',
  '04-roi-handoff-summary',
]

function rel(file) {
  return path.relative(root, file)
}

if (!fs.existsSync(clipsDir)) {
  console.error('No output/video-clips directory found. Record fresh clips first.')
  process.exit(1)
}

const files = fs.readdirSync(clipsDir)
const legacyBrandPattern = new RegExp(['xa', 'vira'].join(''), 'i')
const legacyFiles = files.filter((file) => legacyBrandPattern.test(file))
const clipFiles = files.filter((file) => {
  if (file.startsWith('.')) return false
  if (file === bundleName) return false
  if (legacyBrandPattern.test(file)) return false
  return /\.(mp4|webm|png|log)$/i.test(file) && requiredPrefixes.some((prefix) => file.startsWith(prefix))
})

const missing = requiredPrefixes.filter((prefix) => !clipFiles.some((file) => file.startsWith(prefix) && /\.mp4$/i.test(file)))
const referenceMtime = fs.statSync(freshnessReference).mtimeMs
const stale = clipFiles.filter((file) => {
  if (!/\.mp4$/i.test(file)) return false
  return fs.statSync(path.join(clipsDir, file)).mtimeMs < referenceMtime
})

const manifest = [
  '# Sovereign Engine Demo Clip Manifest',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Buyer Clip Order',
  '',
  '1. Command Center: login and reputation dashboard.',
  '2. Health Oracle: `/api/health/stats` proof surface.',
  '3. Stress Proof: 10,000 mock sends through the pipeline.',
  '4. ROI Handoff: investor value ticker and close.',
  '',
  '## Included Files',
  '',
  ...clipFiles.map((file) => `- ${file}`),
  '',
  '## Notes',
  '',
  '- Only share clips recorded after the Sovereign Engine rename.',
  '- Keep `MOCK_SMTP=true` during demo recordings.',
  '- Do not claim guaranteed inbox placement; say the system is designed for compliant, provider-aware scale.',
  legacyFiles.length ? `- Legacy files with old branding were detected and excluded: ${legacyFiles.join(', ')}` : '- No legacy branded bundle files were detected.',
  missing.length ? `- Missing recommended MP4 clips: ${missing.join(', ')}` : '- All recommended MP4 clips are present.',
  stale.length ? `- Stale MP4 clips older than the current README branding were detected: ${stale.join(', ')}` : '- MP4 clips are newer than the current README branding checkpoint.',
  '',
].join('\n')

fs.writeFileSync(manifestPath, manifest)

if (missing.length) {
  console.error(`Missing fresh MP4 clips: ${missing.join(', ')}`)
  console.error(`Wrote manifest: ${rel(manifestPath)}`)
  process.exit(1)
}

if (stale.length && !force) {
  console.error(`Stale clips detected: ${stale.join(', ')}`)
  console.error('Record fresh Sovereign Engine clips, then run pnpm demo:package again.')
  console.error('If you intentionally want to package existing clips, run: node scripts/package-demo-clips.mjs --force')
  console.error(`Wrote manifest: ${rel(manifestPath)}`)
  process.exit(1)
}

const zipInput = [...clipFiles, path.basename(manifestPath)]
const result = spawnSync('zip', ['-j', '-q', bundlePath, ...zipInput.map((file) => path.join(clipsDir, file))], {
  cwd: clipsDir,
  stdio: 'inherit',
})

if (result.status !== 0) {
  console.error('zip command failed. Install zip or package the listed files manually.')
  process.exit(result.status || 1)
}

console.log(`Created ${rel(bundlePath)}`)
console.log(`Manifest ${rel(manifestPath)}`)
