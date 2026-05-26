import { closePool, query } from '../lib/db'

async function main() {
  const startedAt = Date.now()
  const result = await query<{
    database_name: string
    database_user: string
    server_addr: string | null
    server_port: number | null
    postgres_version: string
    pgcrypto_available: boolean
  }>(
    `SELECT
       current_database() AS database_name,
       current_user AS database_user,
       inet_server_addr()::text AS server_addr,
       inet_server_port() AS server_port,
       version() AS postgres_version,
       EXISTS (
         SELECT 1
         FROM pg_available_extensions
         WHERE name = 'pgcrypto'
       ) AS pgcrypto_available`
  )

  const row = result.rows[0]
  if (!row) throw new Error('Database check returned no rows.')

  console.log(
    JSON.stringify(
      {
        ok: true,
        providerReady: row.pgcrypto_available,
        database: row.database_name,
        user: row.database_user,
        server: row.server_addr ? `${row.server_addr}:${row.server_port ?? 5432}` : 'pooled_or_hidden',
        pgcryptoAvailable: row.pgcrypto_available,
        version: row.postgres_version.split(' on ')[0],
        latencyMs: Date.now() - startedAt,
      },
      null,
      2
    )
  )
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      )
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
