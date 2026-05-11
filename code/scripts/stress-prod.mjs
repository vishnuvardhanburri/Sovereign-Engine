#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function composePort(service, privatePort) {
  const result = spawnSync('docker', ['compose', '-f', 'docker-compose.prod.yml', 'port', service, String(privatePort)], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`Could not discover ${service}:${privatePort}.\n${result.stderr || result.stdout}`)
  }
  const raw = result.stdout.trim().split(/\r?\n/).at(-1) ?? ''
  const match = raw.match(/:(\d+)$/)
  if (!match) throw new Error(`Unexpected docker compose port output for ${service}:${privatePort}: ${raw}`)
  return Number(match[1])
}

function main() {
  const redisPort = composePort('redis', 6379)
  const postgresPort = composePort('postgres', 5432)
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || `postgresql://postgres:password@127.0.0.1:${postgresPort}/sovereign_engine?sslmode=disable`,
    REDIS_URL: process.env.REDIS_URL || `redis://127.0.0.1:${redisPort}`,
    XV_REGION: process.env.XV_REGION || 'prod',
  }

  console.log('[stress:prod] using production compose ports', {
    postgresPort,
    redisPort,
    region: env.XV_REGION,
    stressCount: env.STRESS_COUNT || '10000',
  })

  const result = spawnSync('pnpm', ['stress:test'], {
    cwd: root,
    env,
    stdio: 'inherit',
  })
  process.exitCode = result.status ?? 1
}

try {
  main()
} catch (error) {
  console.error('[stress:prod] failed', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
