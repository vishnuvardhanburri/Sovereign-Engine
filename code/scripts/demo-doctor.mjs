#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flags = new Set(args)
const baseUrlArg = args.find((arg) => arg.startsWith('--base-url='))
const baseUrl = (baseUrlArg?.slice('--base-url='.length) || process.env.DEMO_BASE_URL || 'http://127.0.0.1:3400').replace(/\/$/, '')
const outputJson = flags.has('--json')
const skipHttp = flags.has('--skip-http')

const demoDefaults = {
  DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5432/sovereign_engine?sslmode=disable',
  REDIS_URL: 'redis://127.0.0.1:6379',
  APP_DOMAIN: 'localhost:3400',
  APP_PROTOCOL: 'http',
  MOCK_SMTP: 'true',
  ZEROBOUNCE_API_KEY: 'mock',
  AUTH_SECRET: 'doctor_demo_auth_secret_01234567890123456789',
  CRON_SECRET: 'doctor_demo_cron_secret_01234567890123456789',
  SECURITY_KILL_SWITCH_TOKEN: 'doctor_demo_kill_switch_01234567890123456789',
}

const checks = []

function parseEnv(raw) {
  const out = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function loadEnv() {
  const envPath = path.join(root, '.env')
  const fileEnv = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {}
  return { ...demoDefaults, ...fileEnv, ...process.env }
}

function add(name, status, detail, fix = '') {
  checks.push({ name, status, detail, fix })
}

function commandExists(name) {
  return spawnSync('sh', ['-lc', `command -v ${name} >/dev/null 2>&1`]).status === 0
}

function runText(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  }
}

async function checkDb(env) {
  const dbName = (() => {
    try {
      return new URL(env.DATABASE_URL).pathname.replace(/^\//, '') || 'sovereign_engine'
    } catch {
      return 'sovereign_engine'
    }
  })()

  if (!commandExists('docker')) {
    add('Postgres schema', 'fail', 'Docker is required for the portable schema check.', 'Start Docker Desktop or inspect Postgres manually.')
    return
  }

  const requiredTables = ['clients', 'users', 'domains', 'reputation_state', 'reputation_events', 'audit_logs', 'queue_jobs']
  const schemaSql = `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN (${requiredTables
    .map((table) => `'${table}'`)
    .join(',')}) ORDER BY table_name;`
  const schema = runText('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', dbName, '-tAc', schemaSql])
  if (!schema.ok) {
    add('Postgres connection', 'fail', schema.output || 'Could not query Postgres.', 'Run docker compose up -d postgres redis and pnpm db:init.')
    return
  }
  const found = new Set(schema.output.split(/\s+/).filter(Boolean))
  const missing = requiredTables.filter((table) => !found.has(table))
  add('Postgres schema', missing.length ? 'fail' : 'pass', missing.length ? `Missing tables: ${missing.join(', ')}` : `Required tables present (${found.size} checked).`, 'Run pnpm db:init.')

  const user = runText('docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    dbName,
    '-tAc',
    `SELECT COUNT(*) FROM users WHERE email = 'demo@sovereign.local';`,
  ])
  const exists = Number(user.output.trim()) > 0
  add('Demo user', exists ? 'pass' : 'fail', exists ? 'demo@sovereign.local exists.' : 'demo@sovereign.local is missing.', "Run pnpm user:create demo@sovereign.local 'Demo1234!'.")
}

async function checkRedis(env) {
  if (!commandExists('docker')) {
    add('Redis ping', 'fail', 'Docker is required for the portable Redis check.', 'Start Docker Desktop or inspect Redis manually.')
    return
  }
  const ping = runText('docker', ['compose', 'exec', '-T', 'redis', 'redis-cli', 'ping'])
  add('Redis ping', ping.output.trim() === 'PONG' ? 'pass' : 'fail', `Redis responded: ${ping.output || 'empty'}.`, 'Run docker compose up -d redis and verify REDIS_URL.')
}

async function fetchJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Not JSON.
  }
  return { response, json, text }
}

async function checkHttp() {
  try {
    const health = await fetchJson('/api/health/stats?client_id=1')
    add('/api/health/stats', health.response.ok && health.json?.ok ? 'pass' : 'fail', `HTTP ${health.response.status}`, 'Start the API gateway on localhost:3400.')
    if (health.json?.ok) {
      add('Worker heartbeat', Number(health.json.workers?.sender?.active ?? 0) > 0 ? 'pass' : 'fail', `${health.json.workers?.sender?.active ?? 0} active sender worker(s).`, 'Run pnpm worker:sender or pnpm demo:buyer.')
      add('Health Redis proof', health.json.redis?.set_ok && health.json.redis?.get_ok ? 'pass' : 'fail', JSON.stringify(health.json.redis), 'Verify Redis connection.')
      add('Health DB proof', Number(health.json.postgres?.reputation_state_count ?? -1) >= 0 ? 'pass' : 'fail', `${health.json.postgres?.reputation_state_count ?? 0} reputation lanes.`, 'Run pnpm db:init and prepare demo data.')
    }
  } catch (error) {
    add('/api/health/stats', 'fail', error instanceof Error ? error.message : 'Health endpoint failed.', 'Start the API gateway on localhost:3400.')
  }

  const routes = ['/dashboard', '/proof', '/reputation', '/setup', '/activity', '/raas', '/demo-import', '/handoff']
  for (const route of routes) {
    try {
      const response = await fetch(`${baseUrl}${route}`, { redirect: 'manual' })
      const ok = response.status === 200 || response.status === 307 || response.status === 308
      add(`Page ${route}`, ok ? 'pass' : 'fail', `HTTP ${response.status}`, 'Rebuild/restart the app and check routing.')
    } catch (error) {
      add(`Page ${route}`, 'fail', error instanceof Error ? error.message : 'Route failed.', 'Start the API gateway.')
    }
  }

  for (const item of [
    ['/api/setup/readiness?domain=sovereign-demo.example', 'Readiness JSON'],
    ['/api/due-diligence/report?domain=sovereign-demo.example', 'Due diligence PDF'],
    ['/api/handoff/data-room?domain=sovereign-demo.example', 'Data room ZIP'],
  ]) {
    try {
      const response = await fetch(`${baseUrl}${item[0]}`, { redirect: 'manual' })
      add(item[1], response.ok ? 'pass' : 'fail', `HTTP ${response.status}; ${response.headers.get('content-type') || 'unknown content-type'}`, 'Restart the app and verify the endpoint.')
    } catch (error) {
      add(item[1], 'fail', error instanceof Error ? error.message : `${item[1]} failed.`, 'Start the API gateway.')
    }
  }
}

async function main() {
  const env = loadEnv()

  for (const command of ['node', 'pnpm', 'docker']) {
    add(`Command ${command}`, commandExists(command) ? 'pass' : 'fail', commandExists(command) ? `${command} is available.` : `${command} is missing.`, `Install ${command}.`)
  }

  if (commandExists('docker')) {
    const compose = runText('docker', ['compose', 'ps'])
    const output = compose.output.toLowerCase()
    add('Docker compose', compose.ok ? 'pass' : 'fail', compose.ok ? 'docker compose ps completed.' : compose.output, 'Start Docker Desktop.')
    add('Docker Postgres', output.includes('postgres') && output.includes('healthy') ? 'pass' : 'fail', 'Postgres service should be healthy.', 'Run docker compose up -d postgres redis.')
    add('Docker Redis', output.includes('redis') && output.includes('healthy') ? 'pass' : 'fail', 'Redis service should be healthy.', 'Run docker compose up -d postgres redis.')
  }

  for (const name of ['DATABASE_URL', 'REDIS_URL', 'APP_DOMAIN', 'AUTH_SECRET', 'CRON_SECRET', 'SECURITY_KILL_SWITCH_TOKEN', 'ZEROBOUNCE_API_KEY']) {
    add(`Env ${name}`, env[name] ? 'pass' : 'fail', env[name] ? 'Configured.' : 'Missing.', 'Run pnpm demo:buyer or update .env.')
  }

  await checkDb(env)
  await checkRedis(env)
  if (!skipHttp) await checkHttp()

  const failed = checks.filter((check) => check.status === 'fail')
  const summary = {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl,
    passed: checks.filter((check) => check.status === 'pass').length,
    failed: failed.length,
    checks,
  }

  fs.mkdirSync(path.join(root, 'output'), { recursive: true })
  fs.writeFileSync(path.join(root, 'output', 'doctor-demo.json'), JSON.stringify(summary, null, 2))

  if (outputJson) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`Sovereign Engine demo doctor: ${summary.ok ? 'PASS' : 'FAIL'}`)
    console.log(`Base URL: ${baseUrl}`)
    console.log(`Passed: ${summary.passed}`)
    console.log(`Failed: ${summary.failed}`)
    for (const check of checks) {
      const icon = check.status === 'pass' ? 'PASS' : 'FAIL'
      console.log(`[${icon}] ${check.name}: ${check.detail}`)
      if (check.status === 'fail' && check.fix) console.log(`       Fix: ${check.fix}`)
    }
    console.log('Wrote output/doctor-demo.json')
  }

  process.exitCode = summary.ok ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
