import 'dotenv/config'
import { validateApiEnv, validateWorkerEnv } from '@/lib/env'

type Mode = 'api' | 'worker' | 'all'

function parseMode(argv: string[]): Mode {
  const flag = argv.find((a) => a.startsWith('--mode='))
  if (flag) {
    const v = flag.split('=')[1]?.trim()
    if (v === 'api' || v === 'worker' || v === 'all') return v
  }
  if (argv.includes('--api')) return 'api'
  if (argv.includes('--worker')) return 'worker'
  return 'all'
}

function ok(msg: string) {
  process.stdout.write(`${msg}\n`)
}

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`ENV CHECK FAILED: ${message}\n`)
  process.exit(1)
}

async function main() {
  const mode = parseMode(process.argv.slice(2))

  try {
    if (mode === 'api' || mode === 'all') {
      validateApiEnv()
      ok('API env: OK')
    }

    if (mode === 'worker' || mode === 'all') {
      validateWorkerEnv()
      ok('Worker env: OK')
    }

    ok('All required env vars present.')
  } catch (e) {
    fail(e)
  }
}

void main()
