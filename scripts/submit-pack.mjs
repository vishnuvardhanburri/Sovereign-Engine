#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const baseUrlArg = args.find((arg) => arg.startsWith('--base-url='))
const baseUrl = (baseUrlArg?.slice('--base-url='.length) || process.env.DEMO_BASE_URL || 'http://127.0.0.1:3400').replace(/\/$/, '')
const skipBuild = args.includes('--skip-build')
const withQa = args.includes('--with-qa')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const packDir = path.join(root, 'output', 'submit-pack', stamp)
const demoEnv = {
  DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5432/sovereign_engine?sslmode=disable',
  REDIS_URL: 'redis://127.0.0.1:6379',
  APP_DOMAIN: 'localhost:3400',
  APP_PROTOCOL: 'http',
  AUTH_SECRET: 'submit_pack_auth_secret_01234567890123456789',
  CRON_SECRET: 'submit_pack_cron_secret_01234567890123456789',
  SECURITY_KILL_SWITCH_TOKEN: 'submit_pack_kill_switch_01234567890123456789',
  SECRET_MASTER_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
  MOCK_SMTP: 'true',
  SMTP_HOST: 'mock.smtp.local',
  SMTP_USER: 'mock',
  SMTP_PASS: 'mock',
  ZEROBOUNCE_API_KEY: 'mock',
}

fs.mkdirSync(packDir, { recursive: true })

function run(command, commandArgs, logName) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...demoEnv, ...process.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  fs.writeFileSync(path.join(packDir, logName), output)
  return { ok: result.status === 0, status: result.status ?? 1, output }
}

async function download(pathname, fileName, binary = false) {
  const response = await fetch(`${baseUrl}${pathname}`)
  const target = path.join(packDir, fileName)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    fs.writeFileSync(target.replace(/\.[^.]+$/, '.error.txt'), `HTTP ${response.status}\n${text}`)
    throw new Error(`${pathname} returned HTTP ${response.status}`)
  }
  if (binary) {
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()))
  } else {
    fs.writeFileSync(target, await response.text())
  }
}

function copyIfExists(source, targetName) {
  const sourcePath = path.join(root, source)
  if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, path.join(packDir, targetName || path.basename(source)))
}

function copyDirIfExists(source, target) {
  const sourcePath = path.join(root, source)
  if (!fs.existsSync(sourcePath)) return false
  fs.cpSync(sourcePath, path.join(packDir, target), { recursive: true })
  return true
}

const commandResults = []

commandResults.push(['typecheck', run('pnpm', ['typecheck'], 'typecheck.log')])
commandResults.push(['brand:check', run('pnpm', ['brand:check'], 'brand-check.log')])
commandResults.push(['doctor:demo', run('pnpm', ['doctor:demo'], 'doctor-demo.log')])
if (!skipBuild) commandResults.push(['build', run('pnpm', ['-C', 'apps/api-gateway', 'build'], 'build.log')])
if (withQa) commandResults.push(['qa:demo', run('pnpm', ['qa:demo'], 'browser-qa.log')])

await download('/api/health/stats?client_id=1', 'health-stats.json')
await download('/api/setup/readiness?domain=sovereign-demo.example', 'readiness.json')
await download('/api/reputation/monitor?client_id=1', 'reputation-monitor.json')
await download('/api/activity/replay?client_id=1&limit=50', 'activity-replay.json')
await download('/api/due-diligence/report?domain=sovereign-demo.example', 'sovereign-engine-due-diligence.pdf', true)
await download('/api/handoff/data-room?domain=sovereign-demo.example', 'sovereign-engine-data-room.zip', true)

copyIfExists('README.md')
copyIfExists('DOCS.md')
copyIfExists('docs/PRODUCTION_SUBMISSION_CHECKLIST.md')
copyIfExists('docs/TECHNICAL_PROOF_CHECKLIST.md')
copyIfExists('docs/VIDEO_RECORDING_GUIDE.md')
copyIfExists('docs/KNOWN_LIMITATIONS.md')
const copiedScreenshots = copyDirIfExists('output/playwright/demo-qa', 'screenshots')

const failed = commandResults.filter(([, result]) => !result.ok)
const summary = [
  '# Sovereign Engine Submit Pack',
  '',
  `Generated UTC: ${new Date().toISOString()}`,
  `Base URL: ${baseUrl}`,
  `Pack directory: ${path.relative(root, packDir)}`,
  '',
  '## Command Results',
  '',
  ...commandResults.map(([name, result]) => `- ${name}: ${result.ok ? 'PASS' : `FAIL (${result.status})`}`),
  '',
  '## Included Evidence',
  '',
  '- health-stats.json',
  '- readiness.json',
  '- reputation-monitor.json',
  '- activity-replay.json',
  '- sovereign-engine-due-diligence.pdf',
  '- sovereign-engine-data-room.zip',
  '- command logs',
  withQa || copiedScreenshots ? '- browser QA screenshots and report' : '- browser QA screenshots not present; run pnpm qa:demo',
  '',
  '## Recording Flow',
  '',
  '1. Open /dashboard and click Prepare Recording.',
  '2. Show /proof for infrastructure evidence.',
  '3. Show /reputation for lane status and brain feed.',
  '4. Show /setup for DNS/readiness guidance.',
  '5. Show /handoff and downloads for buyer transfer.',
  '',
].join('\n')

fs.writeFileSync(path.join(packDir, 'SUMMARY.md'), summary)

console.log(summary)
console.log(`Submit pack written to ${path.relative(root, packDir)}`)

if (failed.length) {
  console.error(`Submit pack completed with ${failed.length} failing command(s). Check logs in ${path.relative(root, packDir)}.`)
  process.exitCode = 1
}
