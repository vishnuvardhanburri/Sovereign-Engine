import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { query, closePool } from '../lib/db'

async function main() {
  const sql = await fs.readFile(path.join(process.cwd(), 'scripts/tenant-rls.sql'), 'utf8')
  await query(sql)
  console.log('Tenant RLS pool model applied.')
}

main()
  .catch((error) => {
    console.error('[tenant-rls] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
