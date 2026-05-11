#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const args = new Set(process.argv.slice(2))
const baseUrlArg = process.argv.slice(2).find((arg) => arg.startsWith('--base-url='))
const baseUrl = (baseUrlArg?.slice('--base-url='.length) || process.env.QA_BASE_URL || 'http://127.0.0.1:3400').replace(/\/$/, '')
const withChaos = args.has('--chaos')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const runDir = path.join(root, 'output', 'enterprise-qa', stamp)
const latestDir = path.join(root, 'output', 'enterprise-qa', 'latest')
const checks = []
const findings = []

fs.mkdirSync(runDir, { recursive: true })
fs.rmSync(latestDir, { recursive: true, force: true })
fs.mkdirSync(latestDir, { recursive: true })

function record(check) {
  checks.push({ ...check, at: new Date().toISOString() })
}

function finding(severity, title, evidence, remediation) {
  findings.push({ severity, title, evidence, remediation })
}

function command(name, command, commandArgs, options = {}) {
  const started = Date.now()
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 30 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`
  const logName = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.log`
  fs.writeFileSync(path.join(runDir, logName), output)
  fs.writeFileSync(path.join(latestDir, logName), output)
  const ok = result.status === 0
  record({
    name,
    layer: options.layer ?? 'command',
    status: ok ? 'pass' : 'fail',
    durationMs: Date.now() - started,
    command: [command, ...commandArgs].join(' '),
    log: logName,
  })
  if (!ok && options.severity) {
    finding(options.severity, `${name} failed`, tail(output), options.remediation ?? 'Inspect the command log and fix the failing gate.')
  }
  return ok
}

async function httpCheck(name, pathname, validate, options = {}) {
  const started = Date.now()
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      redirect: 'manual',
    })
    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()
    let json = null
    try {
      json = body ? JSON.parse(body) : null
    } catch {
      // Non-JSON response.
    }
    const ok = validate ? validate({ response, contentType, body, json }) : response.ok
    const logName = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.txt`
    fs.writeFileSync(path.join(runDir, logName), `HTTP ${response.status}\ncontent-type: ${contentType}\n\n${body}`)
    fs.writeFileSync(path.join(latestDir, logName), `HTTP ${response.status}\ncontent-type: ${contentType}\n\n${body}`)
    record({
      name,
      layer: options.layer ?? 'http',
      status: ok ? 'pass' : 'fail',
      durationMs: Date.now() - started,
      statusCode: response.status,
      contentType,
      log: logName,
    })
    if (!ok && options.severity) {
      finding(options.severity, `${name} failed`, `HTTP ${response.status}`, options.remediation ?? 'Inspect endpoint behavior.')
    }
    return { ok, response, json, body }
  } catch (error) {
    record({
      name,
      layer: options.layer ?? 'http',
      status: 'fail',
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    if (options.severity) {
      finding(options.severity, `${name} failed`, error instanceof Error ? error.message : String(error), options.remediation ?? 'Start the runtime stack and retry.')
    }
    return { ok: false, error }
  }
}

function staticScan() {
  const trackedEnv = spawnSync('git', ['ls-files', '.env', 'code/.env', 'code/apps/api-gateway/.env'], {
    cwd: path.resolve(root, '..'),
    encoding: 'utf8',
  }).stdout.trim()
  record({
    name: 'No tracked runtime env files',
    layer: 'security',
    status: trackedEnv ? 'fail' : 'pass',
    evidence: trackedEnv || 'runtime env files are ignored',
  })
  if (trackedEnv) {
    finding('critical', 'Runtime env file is tracked', trackedEnv, 'Remove env files from git history and rotate exposed secrets.')
  }

  const realtimeSource = fs.readFileSync(path.join(root, 'libs/platform-sdk/src/realtime.ts'), 'utf8')
  const queryToken = /searchParams\.set\(['"]token['"]/.test(realtimeSource)
  record({
    name: 'Realtime token not placed in URL query',
    layer: 'security',
    status: queryToken ? 'fail' : 'pass',
  })
  if (queryToken) {
    finding('high', 'Realtime token can leak in URLs', 'SDK sets token in URLSearchParams', 'Move realtime auth to subprotocol/session binding.')
  }
}

async function runtimeChecks() {
  await httpCheck('Health oracle', '/api/health/stats?client_id=1', ({ response, json }) => response.ok && json?.ok === true, {
    layer: 'observability',
    severity: 'critical',
    remediation: 'Health oracle must be available before production launch.',
  })
  await httpCheck('Demo metrics', '/demo/metrics', ({ response }) => response.ok, { layer: 'proof', severity: 'medium' })
  await httpCheck('Trust summary', '/api/trust/summary?domain=sovereign-demo.example', ({ response }) => response.ok, {
    layer: 'governance',
    severity: 'medium',
  })
  await httpCheck('Production gate', '/api/production/gate?domain=sovereign-demo.example', ({ response, json }) => response.ok && Boolean(json), {
    layer: 'release',
    severity: 'high',
  })
  await httpCheck('Public reputation API rejects missing key', '/api/v1/reputation/score', ({ response }) => [401, 403, 405].includes(response.status), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'example.com', ip: '1.2.3.4' }),
    layer: 'security',
    severity: 'high',
    remediation: 'Public reputation API must require an API key.',
  })

  for (const route of ['/login', '/pricing', '/setup', '/proof', '/activity', '/raas', '/demo-import', '/handoff']) {
    await httpCheck(`Route ${route}`, route, ({ response }) => response.status === 200 || response.status === 307 || response.status === 308, {
      layer: 'functional',
      severity: 'medium',
    })
  }
}

async function chaosChecks() {
  if (!withChaos) {
    record({
      name: 'Redis restart chaos',
      layer: 'chaos',
      status: 'skipped',
      evidence: 'Run pnpm qa:enterprise -- --chaos to restart Redis and verify recovery.',
    })
    return
  }

  command('Chaos restart Redis', 'docker', ['compose', '-f', 'docker-compose.prod.yml', 'restart', 'redis'], {
    layer: 'chaos',
    timeoutMs: 90_000,
    severity: 'high',
    remediation: 'Redis restart must recover without manual operator action.',
  })

  const deadline = Date.now() + 90_000
  let recovered = false
  while (Date.now() < deadline) {
    const health = await httpCheck('Chaos health poll', '/api/health/stats?client_id=1', ({ response, json }) => response.ok && json?.ok === true, {
      layer: 'chaos',
    })
    if (health.ok) {
      recovered = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  record({
    name: 'Redis restart recovery window',
    layer: 'chaos',
    status: recovered ? 'pass' : 'fail',
    evidence: recovered ? 'health oracle recovered inside 90 seconds' : 'health oracle did not recover inside 90 seconds',
  })
  if (!recovered) {
    finding('high', 'Redis restart recovery exceeded 90 seconds', 'Health oracle did not return ok after Redis restart.', 'Review Redis reconnect handling and worker recovery.')
  }
}

function score() {
  const nonSkipped = checks.filter((check) => check.status !== 'skipped')
  const passed = nonSkipped.filter((check) => check.status === 'pass').length
  const failed = nonSkipped.filter((check) => check.status === 'fail').length
  const critical = findings.filter((item) => item.severity === 'critical').length
  const high = findings.filter((item) => item.severity === 'high').length
  const readiness = Math.max(0, Math.round((passed / Math.max(nonSkipped.length, 1)) * 100) - critical * 25 - high * 10)
  const reliability = Math.max(0, Math.round(readiness - (checks.some((check) => check.layer === 'chaos' && check.status === 'skipped') ? 8 : 0)))
  return { passed, failed, total: nonSkipped.length, readiness, reliability }
}

function writeReports() {
  const summary = score()
  const report = {
    ok: findings.every((item) => !['critical', 'high'].includes(item.severity)),
    generatedAt: new Date().toISOString(),
    baseUrl,
    scores: summary,
    findings,
    checks,
    notExecutedLocally: [
      '24h sustained load',
      '72h memory leak detection',
      'Windows native installer execution',
      'Linux native package execution',
      'Android physical-device battery and notification validation',
      'iOS TestFlight/certificate-pinning validation',
      'macOS notarization with production Developer ID',
    ],
  }

  const json = JSON.stringify(report, null, 2)
  fs.writeFileSync(path.join(runDir, 'enterprise-qa-report.json'), json)
  fs.writeFileSync(path.join(latestDir, 'enterprise-qa-report.json'), json)

  const md = `# Enterprise QA Report

Generated: ${report.generatedAt}

Base URL: \`${baseUrl}\`

## Scores

- Production readiness: ${summary.readiness}/100
- Reliability confidence: ${summary.reliability}/100
- Checks passed: ${summary.passed}/${summary.total}
- Checks failed: ${summary.failed}

## Severity-Ranked Findings

${findings.length ? findings.map((item) => `- **${item.severity.toUpperCase()}** ${item.title}: ${item.evidence}. Remediation: ${item.remediation}`).join('\n') : '- No critical or high findings in executed local gates.'}

## Local Execution Boundaries

${report.notExecutedLocally.map((item) => `- ${item}`).join('\n')}

## Recommendation

${report.ok ? 'GO for acquisition demo and controlled mock-safe due diligence. CONDITIONAL GO for production only after the listed long-duration and device-lab validations complete.' : 'NO-GO until critical/high findings are remediated and rerun.'}
`
  fs.writeFileSync(path.join(runDir, 'enterprise-qa-report.md'), md)
  fs.writeFileSync(path.join(latestDir, 'enterprise-qa-report.md'), md)
  console.log(md)
  console.log(`Wrote ${path.relative(root, latestDir)}/enterprise-qa-report.json`)
}

function tail(output) {
  return output.trim().split('\n').slice(-20).join('\n')
}

async function main() {
  command('Platform boundary check', 'pnpm', ['platform:check'], { layer: 'architecture', severity: 'critical' })
  command('Brand check', 'pnpm', ['brand:check'], { layer: 'governance', severity: 'medium' })
  command('Buyer-safe copy check', 'pnpm', ['copy:check'], { layer: 'governance', severity: 'medium' })
  command('Production dry-run gate', 'pnpm', ['prod:check'], { layer: 'release', severity: 'critical' })
  command('API TypeScript check', 'pnpm', ['typecheck'], { layer: 'functional', severity: 'high' })
  command('API production build', 'pnpm', ['build'], { layer: 'functional', severity: 'high', timeoutMs: 240_000 })
  command('Platform SDK TypeScript check', 'pnpm', ['-C', 'libs/platform-sdk', 'check'], { layer: 'cross-platform', severity: 'high' })
  command('Realtime gateway syntax check', 'pnpm', ['-C', 'apps/realtime-gateway', 'check'], { layer: 'realtime', severity: 'high' })
  command('Production compose config', 'docker', ['compose', '-f', 'docker-compose.prod.yml', 'config'], { layer: 'deployment', severity: 'critical' })

  staticScan()
  await runtimeChecks()
  await chaosChecks()
  writeReports()

  process.exitCode = findings.some((item) => ['critical', 'high'].includes(item.severity)) ? 1 : 0
}

main().catch((error) => {
  finding('critical', 'Enterprise QA harness crashed', error instanceof Error ? error.message : String(error), 'Fix the QA harness and rerun.')
  writeReports()
  process.exitCode = 1
})
