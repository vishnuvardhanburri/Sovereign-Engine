import net from 'node:net'
import type { SmtpClassification } from './types'

type SmtpReply = { code: number; message: string }

function parseReply(line: string): SmtpReply | null {
  const m = /^(\d{3})[ -](.*)$/.exec(line.trim())
  if (!m) return null
  return { code: Number(m[1]), message: (m[2] ?? '').trim() }
}

async function readReply(socket: net.Socket, timeoutMs: number): Promise<SmtpReply> {
  return await new Promise((resolve, reject) => {
    let buf = ''
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      // SMTP replies are line-based; accept first complete line with code.
      const lines = buf.split(/\r?\n/)
      for (const line of lines) {
        const parsed = parseReply(line)
        if (parsed) {
          cleanup()
          resolve(parsed)
          return
        }
      }
    }
    const onErr = (err: any) => {
      cleanup()
      reject(err)
    }
    const timer = setTimeout(() => {
      cleanup()
      const e: any = new Error('smtp_timeout')
      e.code = 'SMTP_TIMEOUT'
      reject(e)
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onErr)
    }

    socket.on('data', onData)
    socket.on('error', onErr)
  })
}

async function sendCmd(socket: net.Socket, cmd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(cmd + '\r\n', (err) => (err ? reject(err) : resolve()))
  })
}

function classifyRcpt(code: number, message: string): SmtpClassification {
  if (code >= 200 && code < 300) return { kind: 'deliverable' }
  if (code >= 500 && code < 600) return { kind: 'undeliverable', code, message }
  if (code >= 400 && code < 500) return { kind: 'soft_fail', code, message }
  return { kind: 'soft_fail', code, message }
}

export async function smtpVerifyRcpt(opts: {
  mxHost: string
  port: number
  heloName: string
  fromEmail: string
  toEmail: string
  timeoutMs: number
}): Promise<SmtpClassification> {
  const socket = net.createConnection({ host: opts.mxHost, port: opts.port })
  socket.setTimeout(opts.timeoutMs)

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('error', reject)
      socket.once('timeout', () => reject(Object.assign(new Error('smtp_timeout'), { code: 'SMTP_TIMEOUT' })))
    })

    // Banner
    await readReply(socket, opts.timeoutMs)

    // HELO (simpler than EHLO for compatibility)
    await sendCmd(socket, `HELO ${opts.heloName}`)
    await readReply(socket, opts.timeoutMs)

    // MAIL FROM
    await sendCmd(socket, `MAIL FROM:<${opts.fromEmail}>`)
    await readReply(socket, opts.timeoutMs)

    // RCPT TO
    await sendCmd(socket, `RCPT TO:<${opts.toEmail}>`)
    const rcpt = await readReply(socket, opts.timeoutMs)

    return classifyRcpt(rcpt.code, rcpt.message)
  } catch (err: any) {
    if (err?.code === 'SMTP_TIMEOUT') return { kind: 'timeout' }
    return { kind: 'soft_fail', message: err?.message ?? String(err) }
  } finally {
    try {
      socket.end('QUIT\r\n')
    } catch {}
    socket.destroy()
  }
}

