import 'dotenv/config'
import { rotateEncryptedSecrets } from '../lib/security/secret-vault'
import { closePool } from '../lib/db'

async function main() {
  const result = await rotateEncryptedSecrets()
  console.log(JSON.stringify({ ok: true, ...result }, null, 2))
}

main()
  .catch((error) => {
    console.error('[rotate-master-key] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
