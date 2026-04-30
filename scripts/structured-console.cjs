const crypto = require('node:crypto')
const os = require('node:os')

if ((process.env.LOG_FORMAT || '').toLowerCase() === 'json') {
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  const sensitiveKey = /(password|pass|secret|token|smtp|authorization|cookie|api[_-]?key|credential|private)/i
  const emailKey = /(^email$|_email$|email_|recipient|to$|from$)/i
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

  function sanitize(value) {
    if (value == null) return value
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
    if (typeof value === 'string') return value.replace(emailRe, '[email-redacted]')
    if (Array.isArray(value)) return value.map(sanitize)
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => {
          if (sensitiveKey.test(key)) return [key, '[redacted]']
          if (emailKey.test(key)) return [key, '[email-redacted]']
          return [key, sanitize(nested)]
        })
      )
    }
    return value
  }

  function emit(level, args) {
    const first = args[0]
    const message = typeof first === 'string' ? first : 'log'
    const payload =
      args.length === 2 && typeof args[1] === 'object' && args[1] !== null
        ? sanitize(args[1])
        : sanitize(args.slice(typeof first === 'string' ? 1 : 0))

    original.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: process.env.SERVICE_NAME || process.env.npm_package_name || 'xavira-service',
        host: os.hostname(),
        pid: process.pid,
        event_id: crypto.randomUUID(),
        message,
        payload,
      })
    )
  }

  console.log = (...args) => emit('info', args)
  console.warn = (...args) => emit('warn', args)
  console.error = (...args) => emit('error', args)
}
