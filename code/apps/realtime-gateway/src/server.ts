import crypto from 'node:crypto'
import http from 'node:http'

type ClientPlatform = 'web' | 'macos' | 'windows' | 'linux' | 'android' | 'ios'

interface RealtimeSubscriber {
  id: string
  clientId: string
  deviceId: string
  platform: ClientPlatform
  socket: import('node:net').Socket
  connectedAt: string
}

const port = Number(process.env.REALTIME_PORT ?? 3410)
const subscribers = new Map<string, RealtimeSubscriber>()

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url?.startsWith('/health')) {
    writeJson(response, 200, {
      ok: true,
      service: 'realtime-gateway',
      subscribers: subscribers.size,
      generatedAt: new Date().toISOString(),
    })
    return
  }

  if (request.method === 'POST' && request.url === '/publish') {
    const secret = process.env.REALTIME_PUBLISH_SECRET
    if (secret && request.headers.authorization !== `Bearer ${secret}`) {
      writeJson(response, 401, { ok: false, error: 'unauthorized' })
      return
    }

    const event = await readJson(request).catch(() => null)
    if (!event?.type || typeof event.type !== 'string') {
      writeJson(response, 400, { ok: false, error: 'invalid_event' })
      return
    }

    const delivered = broadcast(JSON.stringify(event), String(event.clientId ?? ''))
    writeJson(response, 202, { ok: true, delivered })
    return
  }

  writeJson(response, 404, { ok: false, error: 'not_found' })
})

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (url.pathname !== '/realtime') {
    socket.destroy()
    return
  }

  const clientId = url.searchParams.get('client_id')
  const deviceId = url.searchParams.get('device_id')
  const platform = url.searchParams.get('platform') as ClientPlatform | null
  const token = url.searchParams.get('token')

  if (!clientId || !deviceId || !isSupportedPlatform(platform)) {
    socket.destroy()
    return
  }

  if (!isTokenAllowed(token)) {
    socket.destroy()
    return
  }

  const acceptKey = createAcceptKey(request.headers['sec-websocket-key'])
  if (!acceptKey) {
    socket.destroy()
    return
  }

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    '',
  ].join('\r\n'))

  const id = crypto.randomUUID()
  subscribers.set(id, {
    id,
    clientId,
    deviceId,
    platform,
    socket,
    connectedAt: new Date().toISOString(),
  })

  sendFrame(socket, JSON.stringify({
    type: 'system.notice',
    payload: {
      level: 'info',
      message: 'Realtime console connected. REST remains authoritative for state reconciliation.',
    },
  }))

  socket.on('close', () => subscribers.delete(id))
  socket.on('end', () => subscribers.delete(id))
  socket.on('error', () => subscribers.delete(id))
})

setInterval(() => {
  const generatedAt = new Date().toISOString()
  broadcast(JSON.stringify({
    type: 'health.stats.updated',
    payload: {
      ok: true,
      generatedAt,
      dbLatencyMs: 4,
      redisLatencyMs: 2,
      queue: { waiting: 0, active: 0, delayed: 0, failed: 0 },
      workers: [],
    },
  }))
}, 15000).unref()

server.listen(port, () => {
  console.log(`[realtime-gateway] listening on :${port}`)
})

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        request.destroy()
        reject(new Error('payload_too_large'))
      }
    })
    request.on('end', () => resolve(JSON.parse(body || '{}')))
    request.on('error', reject)
  })
}

function createAcceptKey(key: string | string[] | undefined) {
  if (!key || Array.isArray(key)) return null
  return crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
}

function isSupportedPlatform(platform: string | null): platform is ClientPlatform {
  return ['web', 'macos', 'windows', 'linux', 'android', 'ios'].includes(platform ?? '')
}

function isTokenAllowed(token: string | null) {
  const requiredToken = process.env.REALTIME_ACCESS_TOKEN
  return !requiredToken || token === requiredToken
}

function broadcast(payload: string, clientId = '') {
  let delivered = 0
  for (const subscriber of subscribers.values()) {
    if (clientId && subscriber.clientId !== clientId) continue
    sendFrame(subscriber.socket, payload)
    delivered += 1
  }
  return delivered
}

function sendFrame(socket: import('node:net').Socket, data: string) {
  const payload = Buffer.from(data)
  const header = createFrameHeader(payload.length)
  socket.write(Buffer.concat([header, payload]))
}

function createFrameHeader(length: number) {
  if (length < 126) return Buffer.from([0x81, length])
  if (length < 65536) {
    const header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(length, 2)
    return header
  }
  const header = Buffer.alloc(10)
  header[0] = 0x81
  header[1] = 127
  header.writeBigUInt64BE(BigInt(length), 2)
  return header
}
