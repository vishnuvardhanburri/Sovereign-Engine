import 'dotenv/config'
import crypto from 'crypto'
import { query } from '../lib/db'
import { recordAuditLog } from '../lib/security/audit-log'
import { isSecretVaultConfigured, storeEncryptedSecret } from '../lib/security/secret-vault'

function arg(name: string) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function usage() {
  console.log('Usage: pnpm -C apps/api-gateway public-api-key:create --name "Partner" --tier free|pro|enterprise [--client-id 1] [--daily-limit 1000]')
}

async function main() {
  const name = arg('name') || 'Public Reputation API Key'
  const tier = (arg('tier') || 'free').toLowerCase()
  const clientId = arg('client-id')
  const dailyLimit = arg('daily-limit')
  if (!['free', 'pro', 'enterprise'].includes(tier)) {
    usage()
    throw new Error('tier must be free, pro, or enterprise')
  }

  const rawKey = `xvra_live_${crypto.randomBytes(24).toString('base64url')}`
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 14)

  const result = await query<{ id: string }>(
    `INSERT INTO public_api_keys (client_id, name, key_prefix, key_hash, tier, daily_limit)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [
      clientId ? Number(clientId) : null,
      name,
      keyPrefix,
      keyHash,
      tier,
      dailyLimit ? Number(dailyLimit) : null,
    ]
  )
  const id = result.rows[0]?.id

  if (id && isSecretVaultConfigured()) {
    await storeEncryptedSecret({
      clientId: clientId ? Number(clientId) : null,
      secretType: 'api_key',
      resourceType: 'public_api_key',
      resourceId: id,
      plaintext: rawKey,
      createdBy: 'public-api-key:create',
    })
  }

  await recordAuditLog({
    actorId: 'public-api-key:create',
    actorType: 'system',
    clientId: clientId ? Number(clientId) : null,
    actionType: 'api_key.create',
    resourceType: 'public_api_key',
    resourceId: id ?? keyPrefix,
    serviceName: 'api-gateway-script',
    details: {
      name,
      tier,
      key_prefix: keyPrefix,
      encrypted_at_rest: Boolean(id && isSecretVaultConfigured()),
      daily_limit: dailyLimit ? Number(dailyLimit) : null,
    },
  })

  console.log('Created public Reputation API key. Store this once; it will not be shown again.')
  console.log(JSON.stringify({ id, name, tier, clientId: clientId ?? null, key: rawKey }, null, 2))
}

main().catch((error) => {
  console.error('[public-api-key:create] failed', error)
  process.exit(1)
})
