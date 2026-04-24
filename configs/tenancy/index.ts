/**
 * Multi-tenant isolation helpers.
 *
 * Rule: no cross-client contamination. Anything stored in Redis, BullMQ, or
 * derived caches must be namespaced by clientId.
 */
export function ns(clientId: number, key: string): string {
  return `xv:${clientId}:${key}`
}

export function queueName(clientId: number, base: string): string {
  return `xv:${clientId}:${base}`
}

export function tenantIdFromEnv(): number {
  const raw = process.env.TENANT_CLIENT_ID
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

