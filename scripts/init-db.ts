import fs from 'node:fs/promises'
import path from 'node:path'
import { query, closePool } from '@/lib/db'

async function main() {
  const sql = await fs.readFile(path.join(process.cwd(), 'scripts/init-db.sql'), 'utf8')
  await query(sql)
  console.log('Database schema applied successfully.')
  await closePool()
}

main().catch(async (error) => {
  console.error('Failed to apply database schema:', error)
  await closePool()
  process.exit(1)
})

