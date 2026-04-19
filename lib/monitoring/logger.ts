export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.info('[Logger] INFO', message, JSON.stringify(meta))
      return
    }
    console.info('[Logger] INFO', message)
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.warn('[Logger] WARN', message, JSON.stringify(meta))
      return
    }
    console.warn('[Logger] WARN', message)
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    if (meta) {
      console.error('[Logger] ERROR', message, JSON.stringify(meta))
      return
    }
    console.error('[Logger] ERROR', message)
  },
}
