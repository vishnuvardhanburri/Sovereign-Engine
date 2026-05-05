#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const demoDir = path.join(root, '.demo')
const logsDir = path.join(demoDir, 'logs')
const pidFile = path.join(demoDir, 'pids.json')

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const argValue = (name, fallback = '') => {
  const prefix = `${name}=`
  const found = args.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

const port = Number(argValue('--port', '3400'))
const stressCount = Number(argValue('--stress-count', '0'))
const shouldStop = flags.has('--stop')
const shouldStart = !flags.has('--no-start') && !shouldStop
const shouldOpen = !flags.has('--no-open') && !shouldStop
const skipDocker = flags.has('--skip-docker')
const skipInstall = flags.has('--skip-install')
const skipDb = flags.has('--skip-db')

const demoEnv = {
  DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5432/sovereign_engine?sslmode=disable',
  REDIS_URL: 'redis://127.0.0.1:6379',
  CONTAINER_DATABASE_URL: 'postgresql://postgres:password@postgres:5432/sovereign_engine?sslmode=disable',
  CONTAINER_REDIS_URL: 'redis://redis:6379',
  APP_DOMAIN: `localhost:${port}`,
  APP_PROTOCOL: 'http',
  MOCK_SMTP: 'true',
  MOCK_SMTP_FASTLANE: 'true',
  // In local dev there is no supervisor to restart a rotated worker.
  // Disable rotation so the 10K mock stress proof completes reliably.
  WORKER_ROTATION_SEND_LIMIT: '0',
  WORKER_ROTATION_MAX_AGE_MS: '0',
  ZEROBOUNCE_API_KEY: 'mock',
  SMTP_HOST: 'mock.local',
  SMTP_PORT: '587',
  SMTP_USER: 'mock@localhost',
  SMTP_PASS: 'mock',
  SMTP_SECURE: 'false',
  AUTH_SECRET: 'demo_auth_secret_012345678901234567890123456789',
  CRON_SECRET: 'demo_cron_secret_012345678901234567890123456789',
  SECURITY_KILL_SWITCH_TOKEN: 'demo_kill_switch_012345678901234567890123456789',
  SECRET_MASTER_KEY_ID: 'demo-v1',
  SECRET_MASTER_KEY: 'demo_master_key_012345678901234567890123456789',
  SEND_ALLOW_UNKNOWN_VALIDATION: 'true',
  SENDER_WORKER_CONCURRENCY: '50',
  STRESS_TIMEOUT_MS: '60000',
}

function log(message = '') {
  console.log(message)
}

function run(command, commandArgs, options = {}) {
  log(`\n$ ${[command, ...commandArgs].join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...demoEnv, ...(options.env || {}) },
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${commandArgs.join(' ')}`)
  }
}

function canRun(command) {
  return spawnSync('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`]).status === 0
}

function hasICloudDatalessFiles() {
  if (process.platform !== 'darwin') return { ok: true, dataless: [] }
  // On macOS with iCloud “Optimize Mac Storage”, some files can be offloaded and marked
  // `dataless`. Reading them can block/hang, which breaks the buyer demo scripts.
  const criticalFiles = [
    path.join(root, 'apps', 'api-gateway', 'lib', 'backend.ts'),
    path.join(root, 'apps', 'api-gateway', 'lib', 'db.ts'),
    path.join(root, 'apps', 'api-gateway', 'lib', 'env.ts'),
    path.join(root, 'workers', 'sender-worker', 'index.ts'),
  ]
  const dataless = []
  for (const file of criticalFiles) {
    if (!fs.existsSync(file)) continue
    const res = spawnSync('ls', ['-lO', file], { encoding: 'utf8' })
    if (res.status === 0 && /\bdataless\b/.test(res.stdout || '')) dataless.push(path.relative(root, file))
  }
  return { ok: dataless.length === 0, dataless }
}

function readPids() {
  if (!fs.existsSync(pidFile)) return []
  try {
    return JSON.parse(fs.readFileSync(pidFile, 'utf8'))
  } catch {
    return []
  }
}

function writePids(pids) {
  fs.mkdirSync(demoDir, { recursive: true })
  fs.writeFileSync(pidFile, JSON.stringify(pids, null, 2))
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function stopProcesses() {
  const pids = readPids()
  if (!pids.length) {
    log('No buyer-demo background processes were recorded.')
    return
  }

  for (const item of pids) {
    if (!item.pid || !isAlive(item.pid)) continue
    log(`Stopping ${item.name} (pid ${item.pid})`)
    try {
      process.kill(item.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  fs.rmSync(pidFile, { force: true })
}

function ensureEnvFile() {
  const envPath = path.join(root, '.env')
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const existingKeys = new Set()
  for (const line of existing.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=/)
    if (match) existingKeys.add(match[1])
  }

  const lines = []
  if (!existing) {
    lines.push('# Sovereign Engine buyer demo environment')
  } else {
    lines.push('', '# Sovereign Engine buyer demo defaults added by pnpm demo:buyer')
  }

  for (const [key, value] of Object.entries(demoEnv)) {
    if (!existingKeys.has(key)) lines.push(`${key}=${value}`)
  }

  if (lines.length > 1 || !existing) {
    fs.appendFileSync(envPath, `${lines.join('\n')}\n`)
    log(`Updated ${path.relative(root, envPath)} with missing demo-safe defaults.`)
  } else {
    log('.env already contains the required buyer-demo values.')
  }
}

function spawnBackground(name, command, commandArgs, extraEnv = {}) {
  fs.mkdirSync(logsDir, { recursive: true })
  const logPath = path.join(logsDir, `${name}.log`)
  const out = fs.openSync(logPath, 'a')
  const child = spawn(command, commandArgs, {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ...demoEnv, ...extraEnv },
  })
  child.unref()
  log(`Started ${name} on pid ${child.pid}; log: ${path.relative(root, logPath)}`)
  return { name, pid: child.pid, logPath }
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function postJson(url, payload, timeoutMs = 20_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    })
    const text = await response.text().catch(() => '')
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // ignore
    }
    if (!response.ok || json?.ok !== true) {
      throw new Error(`POST ${url} failed: HTTP ${response.status}${text ? `; ${text.slice(0, 240)}` : ''}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

function openUrl(url) {
  if (process.platform === 'darwin') {
    spawnSync('open', [url], { stdio: 'ignore' })
  } else {
    log(`Open: ${url}`)
  }
}

async function main() {
  fs.mkdirSync(demoDir, { recursive: true })

  if (shouldStop) {
    stopProcesses()
    return
  }

  log('Sovereign Engine Buyer Demo')
  log('Mode: mock-safe; no real email is sent.')

  ensureEnvFile()

  const datalessCheck = hasICloudDatalessFiles()
  if (!datalessCheck.ok) {
    log('\nBuyer demo failed: iCloud offloaded files detected (macOS dataless flag).')
    log('These files must be downloaded locally before running the demo:')
    for (const file of datalessCheck.dataless) log(`- ${file}`)
    log('\nFix:')
    log('- Move the repo out of iCloud-synced Desktop/Documents, OR')
    log('- In Finder: right-click the repo folder -> Download Now')
    throw new Error('iCloud dataless files detected')
  }

  if (!skipInstall && !fs.existsSync(path.join(root, 'node_modules'))) {
    run('pnpm', ['install'])
  }

  if (!skipDocker) {
    if (!canRun('docker')) throw new Error('Docker is required unless you pass --skip-docker.')
    run('docker', ['compose', 'up', '-d', 'postgres', 'redis'])
  }

  if (!skipDb) {
    run('pnpm', ['db:init'])
    run('pnpm', ['user:create', 'demo@sovereign.local', 'Demo1234!'])
  }

  run('node', ['scripts/final-production-check.mjs'])

  if (shouldStart) {
    stopProcesses()
    const pids = [
      spawnBackground('api-gateway', 'pnpm', ['-C', 'apps/api-gateway', 'dev', '-p', String(port)]),
      spawnBackground('reputation-worker', 'pnpm', ['worker:reputation']),
      spawnBackground('sender-worker', 'pnpm', ['worker:sender']),
    ]
    writePids(pids)
    await waitForUrl(`http://127.0.0.1:${port}/api/health/stats?client_id=1`)

    // Seed demo data so /reputation and /reputation?investor=1 look "alive" immediately.
    await postJson(`http://127.0.0.1:${port}/api/demo/recording/prepare`, { client_id: 1 }).catch((err) => {
      console.warn('[buyer-demo] recording prepare failed (continuing)', err?.message ?? String(err))
    })
  }

  if (stressCount > 0) {
    run('pnpm', ['stress:test'], { env: { STRESS_COUNT: String(stressCount) } })
  }

  const urls = [
    `http://localhost:${port}/login`,
    `http://localhost:${port}/dashboard`,
    `http://localhost:${port}/proof`,
    `http://localhost:${port}/reputation`,
    `http://localhost:${port}/reputation?investor=1`,
    `http://localhost:${port}/api/health/stats?client_id=1`,
    `http://localhost:${port}/api/v1/reputation/docs`,
  ]

  log('\nBuyer demo is ready.')
  log('Login: demo@sovereign.local / Demo1234!')
  for (const url of urls) log(`- ${url}`)
  log('\nRecording command for the proof moment:')
  log('  STRESS_COUNT=10000 STRESS_TIMEOUT_MS=60000 pnpm stress:test')
  log('\nStop background demo processes:')
  log('  pnpm demo:buyer:stop')

  if (shouldOpen) {
    openUrl(urls[0])
    openUrl(urls[1])
  }
}

main().catch((error) => {
  console.error(`\nBuyer demo failed: ${error.message}`)
  process.exitCode = 1
})
