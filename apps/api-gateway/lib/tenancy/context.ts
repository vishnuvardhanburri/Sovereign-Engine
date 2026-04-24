export interface ClientContext {
  clientId: number
}

export function resolveClientContext(clientId?: number): ClientContext {
  const resolved = clientId ?? Number(process.env.CLIENT_ID ?? process.env.DEFAULT_CLIENT_ID ?? '0')
  if (!resolved || Number.isNaN(resolved)) {
    throw new Error('Invalid client context: client_id is required')
  }

  return { clientId: resolved }
}

export function injectClientContext<T extends { clientId?: number }>(
  context: ClientContext,
  payload: T
): T & { clientId: number } {
  return {
    ...payload,
    clientId: context.clientId,
  } as T & { clientId: number }
}
