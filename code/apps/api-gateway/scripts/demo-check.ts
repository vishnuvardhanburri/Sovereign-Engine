/* eslint-disable no-console */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type CheckResult =
  | { ok: true }
  | { ok: false; reason: string }

function run(cmd: string, args: string[], opts?: { cwd?: string }) {
  execFileSync(cmd, args, {
    cwd: opts?.cwd,
    stdio: 'inherit',
  })
}

function runQuiet(cmd: string, args: string[], opts?: { cwd?: string }): string {
  return execFileSync(cmd, args, {
    cwd: opts?.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  }).trim()
}

function lineOk(label: string) {
  console.log(`\u2714 ${label} \u2014 OK`)
}

function lineFail(label: string, reason: string) {
  console.log(`\u274c ${label} \u2014 ${reason}`)
}

function asJson(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (res.ok) return true
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 350))
  }
  return false
}

async function httpJson(url: string, init?: RequestInit): Promise<{ status: number; json: any; raw: string }> {
  const res = await fetch(url, init)
  const raw = await res.text()
  const json = asJson(raw)
  return { status: res.status, json, raw }
}

function requireField(obj: any, path: string): boolean {
  const parts = path.split('.')
  let cur: any = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) return false
    cur = cur[p]
  }
  return true
}

function validateExecutiveSummary(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  const needed = [
    'timestamp',
    'today.sent',
    'today.replyRate',
    'today.bounceRate',
    'yesterday.sent',
    'businessImpact.replyTrendPct',
    'safety.blockedContactsToday',
  ]
  for (const p of needed) {
    if (!requireField(payload, p)) return { ok: false, reason: `Missing field: ${p}` }
  }
  return { ok: true }
}

function validateExecutiveForecast(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  const needed = [
    'timestamp',
    'forecast.expectedRepliesToday',
    'forecast.projectedBounceRisk',
    'forecast.estimatedSafeSendCapacityRemaining',
    'trends.reply.text',
    'trends.bounce.text',
    'baselines.avgReplyRate',
  ]
  for (const p of needed) {
    if (!requireField(payload, p)) return { ok: false, reason: `Missing field: ${p}` }
  }
  return { ok: true }
}

function validateEvents(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  if (!Array.isArray(payload.data)) return { ok: false, reason: 'Missing data[]' }
  // Accept both pagination shapes (nested pagination or flat lib/pagination shape).
  if (payload.pagination && typeof payload.pagination === 'object') return { ok: true }
  if (typeof payload.total === 'number' && typeof payload.page === 'number' && typeof payload.totalPages === 'number') {
    return { ok: true }
  }
  return { ok: false, reason: 'Missing pagination' }
}

function validateInfraAnalytics(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  const needed = [
    'timestamp',
    'metrics.capacity.utilization',
    'metrics.health.avgBounceRate',
    'metrics.health.avgSpamRate',
    'domains',
    'recommendations',
  ]
  for (const p of needed) {
    if (!requireField(payload, p)) return { ok: false, reason: `Missing field: ${p}` }
  }
  return { ok: true }
}

function validateCopilotPlan(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  if (payload.ok !== true) return { ok: false, reason: payload.error ? String(payload.error) : 'ok=false' }
  if (!payload.data) return { ok: false, reason: 'Missing data' }
  const needed = ['data.context.systemStatus', 'data.context.riskLevel', 'data.context.performance.last24h.sent']
  for (const p of needed) {
    if (!requireField(payload, p)) return { ok: false, reason: `Missing field: ${p}` }
  }
  return { ok: true }
}

function validateCopilotAuto(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  if (payload.ok !== true) return { ok: false, reason: payload.error ? String(payload.error) : 'ok=false' }
  // ok:true is enough (it may skip when autonomous is OFF).
  return { ok: true }
}

function validateCopilotImpacts(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  if (payload.ok !== true) return { ok: false, reason: payload.error ? String(payload.error) : 'ok=false' }
  if (!Array.isArray(payload.data)) return { ok: false, reason: 'Missing data[]' }
  return { ok: true }
}

function validateCopilotChat(payload: any): CheckResult {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Invalid JSON object' }
  if (payload.ok !== true) return { ok: false, reason: payload.error ? String(payload.error) : 'ok=false' }
  if (!Array.isArray(payload.lines)) return { ok: false, reason: 'Missing lines[]' }
  if (payload.lines.length < 2) return { ok: false, reason: 'Too few lines' }
  return { ok: true }
}

async function main() {
  const cwd = process.cwd()
  const baseUrl = process.env.DEMO_BASE_URL || 'http://localhost:3000'

  console.log('\nDemo Health Check\n')

  // Keep the demo check non-invasive: `next dev` may rewrite `next-env.d.ts`.
  const nextEnvPath = resolve(cwd, 'next-env.d.ts')
  let nextEnvSnapshot: string | null = null
  let canGitRestoreNextEnv = false
  try {
    nextEnvSnapshot = readFileSync(nextEnvPath, 'utf8')
  } catch {
    // ignore
  }

  const restoreNextEnv = () => {
    try {
      // Prefer restoring the tracked file to avoid leaving the repo dirty.
      runQuiet('git', ['rev-parse', '--is-inside-work-tree'], { cwd })
      runQuiet('git', ['ls-files', '--error-unmatch', 'next-env.d.ts'], { cwd })
      canGitRestoreNextEnv = true
    } catch {
      canGitRestoreNextEnv = false
    }

    if (canGitRestoreNextEnv) {
      try {
        execFileSync('git', ['checkout', '--', 'next-env.d.ts'], { cwd, stdio: 'ignore' })
        return
      } catch {
        // fall through to snapshot restore
      }
    }

    if (nextEnvSnapshot == null) return
    try {
      writeFileSync(nextEnvPath, nextEnvSnapshot, 'utf8')
    } catch {
      // ignore
    }
  }

  // Ensure Next dev server is up; start if needed.
  let startedServer = false
  let devProc: ReturnType<typeof spawn> | null = null
  const stopServer = () => {
    if (startedServer && devProc) devProc.kill('SIGINT')
  }

  try {
    // Part 1: start system
    try {
      runQuiet('docker', ['info'])
    } catch {
      lineFail('Docker', 'Docker is not running (start Docker Desktop)')
      process.exitCode = 1
      return
    }

    try {
      console.log('\n[1/4] Starting services (docker compose)\n')
      run('docker', ['compose', 'up', '-d'], { cwd })
    } catch (e: any) {
      lineFail('Docker compose', e?.message || 'Failed to start services')
      process.exitCode = 1
      return
    }

    try {
      console.log('\n[2/4] Initializing database\n')
      run('pnpm', ['-s', 'db:init'], { cwd })
    } catch (e: any) {
      lineFail('DB init', e?.message || 'db:init failed')
      process.exitCode = 1
      return
    }

    const alreadyUp = await waitForHttp(`${baseUrl}/api/health`, 1500)
    if (!alreadyUp) {
      console.log('\n[3/4] Starting app (pnpm dev -p 3000)\n')
      devProc = spawn('pnpm', ['dev', '-p', '3000'], {
        cwd,
        stdio: 'inherit',
        env: { ...process.env, PORT: '3000' },
      })
      startedServer = true

      const ready = await waitForHttp(`${baseUrl}/api/health`, 25_000)
      if (!ready) {
        lineFail('App server', 'Failed to start or become ready at /api/health')
        process.exitCode = 1
        return
      }
    }

    // Part 2: API checks
    console.log('\n[4/4] API validation\n')

	  const checks: Array<{
	    label: string
	    url: string
	    method?: 'GET' | 'POST'
	    body?: any
	    validate: (payload: any) => CheckResult
	  }> = [
    {
      label: 'Executive Summary',
      url: `${baseUrl}/api/executive/summary`,
      validate: validateExecutiveSummary,
    },
    {
      label: 'Forecast',
      url: `${baseUrl}/api/executive/forecast?days=5`,
      validate: validateExecutiveForecast,
    },
    {
      label: 'Events',
      url: `${baseUrl}/api/events?limit=20&page=1`,
      validate: validateEvents,
    },
    {
      label: 'Infrastructure',
      url: `${baseUrl}/api/infrastructure/analytics`,
      validate: validateInfraAnalytics,
    },
	    {
	      label: 'Copilot Plan',
	      url: `${baseUrl}/api/copilot/plan`,
	      validate: validateCopilotPlan,
	    },
	    {
	      label: 'Copilot Chat',
	      url: `${baseUrl}/api/copilot/chat`,
	      method: 'POST',
	      body: { text: 'How many emails sent today?' },
	      validate: validateCopilotChat,
	    },
	  ]

  let anyFail = false
  for (const c of checks) {
    const { status, json, raw } = await httpJson(c.url, {
      method: c.method ?? 'GET',
      headers: c.body ? { 'Content-Type': 'application/json' } : undefined,
      body: c.body ? JSON.stringify(c.body) : undefined,
    })
    if (status !== 200) {
      anyFail = true
      lineFail(c.label, `HTTP ${status}`)
      console.log(raw.slice(0, 400))
      continue
    }
    if (!json) {
      anyFail = true
      lineFail(c.label, 'Invalid JSON')
      console.log(raw.slice(0, 400))
      continue
    }
    const v = c.validate(json)
    if (!v.ok) {
      anyFail = true
      lineFail(c.label, v.reason)
      continue
    }
    lineOk(c.label)
  }

  // Part 4: Autonomous mode check (toggle ON, tick, toggle OFF)
  {
    const settingsUrl = `${baseUrl}/api/copilot/settings`
    const autoUrl = `${baseUrl}/api/copilot/auto`

    const settingsOn = await httpJson(settingsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autonomousMode: true }),
    })
    if (settingsOn.status !== 200 || !settingsOn.json?.ok) {
      anyFail = true
      lineFail('Autonomous Mode', 'Failed to enable autonomousMode')
    } else {
      const tick = await httpJson(autoUrl, { method: 'POST' })
      if (tick.status !== 200 || !tick.json) {
        anyFail = true
        lineFail('Autonomous Tick', `HTTP ${tick.status}`)
      } else {
        const v = validateCopilotAuto(tick.json)
        if (!v.ok) {
          anyFail = true
          lineFail('Autonomous Tick', v.reason)
        } else {
          lineOk('Autonomous Tick')
        }
      }

      // Always attempt to restore OFF.
      await httpJson(settingsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomousMode: false }),
      })
    }
  }

  // Part 5: impacts endpoint should always be valid.
  {
    const impacts = await httpJson(`${baseUrl}/api/copilot/impacts?limit=10`)
    if (impacts.status !== 200 || !impacts.json) {
      anyFail = true
      lineFail('Copilot Impacts', `HTTP ${impacts.status}`)
    } else {
      const v = validateCopilotImpacts(impacts.json)
      if (!v.ok) {
        anyFail = true
        lineFail('Copilot Impacts', v.reason)
      } else {
        lineOk('Copilot Impacts')
      }
    }
  }

    console.log('')
    if (anyFail) {
      console.log('Demo check failed.')
      process.exitCode = 1
      return
    }

    console.log('System is demo-ready')
  } finally {
    stopServer()
    restoreNextEnv()
  }

}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
