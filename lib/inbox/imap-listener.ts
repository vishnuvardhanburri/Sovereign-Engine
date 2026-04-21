import tls from 'tls'
import { appEnv } from '@/lib/env'

type ProcessReplyInput = {
  email_content: string
  thread_id: string
}

interface ImapListenerConfig {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  pass?: string
  mailbox?: string
  pollIntervalMs?: number
  endpointUrl?: string
}

interface MailMessage {
  uid: number
  threadId: string
  subject: string
  body: string
  from: string
}

function buildMessagePayload(message: MailMessage): ProcessReplyInput {
  return {
    email_content: [
      `From: ${message.from}`,
      `Subject: ${message.subject}`,
      '',
      message.body,
    ].join('\n'),
    thread_id: message.threadId,
  }
}

export class ImapListener {
  private readonly host: string
  private readonly port: number
  private readonly secure: boolean
  private readonly user: string
  private readonly pass: string
  private readonly mailbox: string
  private readonly pollIntervalMs: number
  private readonly endpointUrl: string
  private timer: NodeJS.Timeout | null = null
  private seen = new Set<number>()

  constructor(config: ImapListenerConfig = {}) {
    this.host = config.host || appEnv.imapHost()
    this.port = config.port || appEnv.imapPort()
    this.secure = config.secure ?? appEnv.imapSecure()
    this.user = config.user || appEnv.imapUser()
    this.pass = config.pass || appEnv.imapPass()
    this.mailbox = config.mailbox || appEnv.imapMailbox()
    this.pollIntervalMs = config.pollIntervalMs || 45_000
    this.endpointUrl = config.endpointUrl || `${appEnv.appBaseUrl()}/api/replies/process`
  }

  start(): void {
    if (this.timer) {
      return
    }

    this.timer = setInterval(() => {
      void this.poll().catch((error) => {
        console.error('[IMAP] poll failed', error)
      })
    }, this.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async poll(): Promise<void> {
    if (!this.host || !this.user || !this.pass) {
      return
    }

    const messages = await this.fetchUnreadMessages()
    for (const message of messages) {
      if (this.seen.has(message.uid)) {
        continue
      }

      this.seen.add(message.uid)
      console.info('[IMAP] incoming email', {
        threadId: message.threadId,
        subject: message.subject,
        from: message.from,
      })

      await fetch(this.endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMessagePayload(message)),
      })
    }
  }

  private async fetchUnreadMessages(): Promise<MailMessage[]> {
    const socket = await this.connect()
    const lines = await this.runCommands(socket, [
      `a1 LOGIN ${escapeImap(this.user)} ${escapeImap(this.pass)}`,
      `a2 SELECT ${this.mailbox}`,
      'a3 SEARCH UNSEEN',
    ])

    const searchLine = lines.find((line) => line.startsWith('* SEARCH'))
    const uids = searchLine
      ? searchLine
          .replace('* SEARCH', '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => !Number.isNaN(value))
      : []

    const messages: MailMessage[] = []
    for (const uid of uids.slice(-25)) {
      const fetchLines = await this.runCommands(socket, [
        `a${uid + 10} UID FETCH ${uid} (RFC822)`,
      ])
      const raw = fetchLines.join('\n')
      const parsed = parseRawMessage(uid, raw)
      if (parsed) {
        messages.push(parsed)
      }
    }

    socket.end()
    return messages
  }

  private connect(): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: this.host,
          port: this.port,
          rejectUnauthorized: false,
        },
        () => resolve(socket)
      )

      socket.on('error', reject)
      socket.setEncoding('utf8')
    })
  }

  private runCommands(socket: tls.TLSSocket, commands: string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let buffer = ''
      const lines: string[] = []
      const onData = (chunk: string) => {
        buffer += chunk
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          const line = buffer.slice(0, index).trimEnd()
          buffer = buffer.slice(index + 1)
          if (line) {
            lines.push(line)
          }
          index = buffer.indexOf('\n')
        }
      }

      socket.on('data', onData)
      socket.once('error', reject)

      const writeNext = (i: number) => {
        if (i >= commands.length) {
          setTimeout(() => {
            socket.off('data', onData)
            resolve(lines)
          }, 1000)
          return
        }

        socket.write(`${commands[i]}\r\n`)
        setTimeout(() => writeNext(i + 1), 250)
      }

      writeNext(0)
    })
  }
}

function escapeImap(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function parseRawMessage(uid: number, raw: string): MailMessage | null {
  const fromMatch = raw.match(/From:\s*(.+)/i)
  const subjectMatch = raw.match(/Subject:\s*(.+)/i)
  const threadIdMatch = raw.match(/Message-ID:\s*<([^>]+)>/i)
  const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim()

  return {
    uid,
    threadId: threadIdMatch?.[1] ?? `${uid}`,
    subject: subjectMatch?.[1]?.trim() ?? '',
    from: fromMatch?.[1]?.trim() ?? '',
    body,
  }
}
