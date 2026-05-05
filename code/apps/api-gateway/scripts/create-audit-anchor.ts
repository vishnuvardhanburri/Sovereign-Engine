import { closePool } from '../lib/db'
import { createAuditChainAnchor, verifyAuditChain } from '../lib/security/audit-log'

async function main() {
  const scope = process.argv[2] || 'global'
  const chain = await verifyAuditChain(10_000)
  if (!chain.valid) {
    throw new Error(`Audit chain is invalid before anchoring: ${chain.brokenReason} at ${chain.brokenAtId}`)
  }

  const anchor = await createAuditChainAnchor(scope)
  console.log(JSON.stringify({ ok: true, chain, anchor }, null, 2))
}

main()
  .catch((error) => {
    console.error('Failed to create audit anchor', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
