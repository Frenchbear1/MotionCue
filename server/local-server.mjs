import express from 'express'
import https from 'node:https'
import fs from 'node:fs/promises'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import selfsigned from 'selfsigned'
import { WebSocketServer } from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const localDir = path.join(rootDir, '.local')
const certPath = path.join(localDir, 'motioncue-cert.pem')
const keyPath = path.join(localDir, 'motioncue-key.pem')
const metaPath = path.join(localDir, 'motioncue-cert-meta.json')
const clipsDir = process.env.MOTIONCUE_CLIPS_DIR
  ? path.resolve(process.env.MOTIONCUE_CLIPS_DIR)
  : path.join(localDir, 'clips')
const port = Number(process.env.MOTIONCUE_PORT || 8787)
const host = '0.0.0.0'
const lanIps = getLanIps()
const lanUrls = lanIps.map((ip) => `https://${ip}:${port}/`)
const localUrls = [`https://localhost:${port}/`, ...lanUrls]
const rooms = new Map()

const defaultSettings = {
  armed: false,
  motionMode: 'motion',
  sensitivity: 58,
  cooldownSeconds: 12,
  clipSeconds: 10,
  loopRecording: true,
  preRollSeconds: 30,
  postMotionSeconds: 8,
  maxClipSeconds: 300,
  recordOnMotion: true,
  zones: Array.from({ length: 9 }, () => true),
  facingMode: 'environment',
}

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('MotionCue has not been built yet. Run `npm run build` first.')
  process.exit(1)
}

const credentials = await ensureCertificate()
const app = express()

app.get('/motioncue-server.json', (_request, response) => {
  response.json({
    name: 'MotionCue Local Server',
    protocol: 'https',
    port,
    wsPath: '/signal',
    localUrls,
    lanUrls,
    preferredJoinUrl: lanUrls[0] ?? `https://localhost:${port}/`,
    clipStoragePath: clipsDir,
  })
})

app.get('/api/rooms/:roomId/clips', (request, response) => {
  const room = getRoom(cleanId(request.params.roomId))
  response.json({ clips: room.clips })
})

app.post(
  '/api/rooms/:roomId/clips/:clipId',
  express.raw({ type: '*/*', limit: '1024mb' }),
  async (request, response) => {
    const roomId = cleanId(request.params.roomId)
    const clipId = cleanId(request.params.clipId)
    const room = getRoom(roomId)
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from([])

    if (!body.length) {
      response.status(400).json({ error: 'Clip body is empty.' })
      return
    }

    const mimeType =
      typeof request.headers['content-type'] === 'string'
        ? request.headers['content-type']
        : 'video/webm'
    const fileName = `${clipId}${extensionForMime(mimeType)}`
    const roomClipDir = clipRoomDir(roomId)
    const filePath = path.join(roomClipDir, fileName)
    const now = new Date().toISOString()
    const clip = {
      id: clipId,
      roomId,
      eventId: cleanId(request.query.eventId?.toString() ?? `evt-${clipId}`),
      deviceId: cleanId(request.query.deviceId?.toString() ?? 'recorder'),
      startedAt: safeIso(request.query.startedAt?.toString(), now),
      endedAt: safeIso(request.query.endedAt?.toString(), now),
      durationMs: numberFromQuery(request.query.durationMs, 0),
      size: body.length,
      mimeType,
      fileName,
      url: `/api/rooms/${roomId}/clips/${clipId}`,
      createdAt: now,
    }

    await fs.mkdir(roomClipDir, { recursive: true })
    await fs.writeFile(filePath, body)
    room.clips = [clip, ...room.clips.filter((entry) => entry.id !== clip.id)].slice(0, 250)
    await saveClipIndex(room)
    broadcastRoomState(room)
    response.json({ clip })
  },
)

app.get('/api/rooms/:roomId/clips/:clipId', (request, response) => {
  const roomId = cleanId(request.params.roomId)
  const clipId = cleanId(request.params.clipId)
  const room = getRoom(roomId)
  const clip = room.clips.find((entry) => entry.id === clipId)

  if (!clip) {
    response.status(404).json({ error: 'Clip not found.' })
    return
  }

  const filePath = path.join(clipRoomDir(roomId), clip.fileName)

  if (!existsSync(filePath)) {
    response.status(404).json({ error: 'Clip file not found.' })
    return
  }

  response.setHeader('Content-Type', clip.mimeType)
  response.setHeader('Content-Length', String(clip.size))
  response.setHeader('Accept-Ranges', 'bytes')
  createReadStream(filePath).pipe(response)
})

app.delete('/api/rooms/:roomId/clips/:clipId', async (request, response) => {
  const roomId = cleanId(request.params.roomId)
  const clipId = cleanId(request.params.clipId)
  const room = getRoom(roomId)
  const clip = room.clips.find((entry) => entry.id === clipId)

  if (clip) {
    await fs.rm(path.join(clipRoomDir(roomId), clip.fileName), { force: true })
    room.clips = room.clips.filter((entry) => entry.id !== clipId)
    await saveClipIndex(room)
    broadcastRoomState(room)
  }

  response.json({ ok: true })
})

app.use(
  express.static(distDir, {
    setHeaders(response, filePath) {
      if (filePath.endsWith('sw.js') || filePath.endsWith('workbox-9c191d2f.js')) {
        response.setHeader('Cache-Control', 'no-cache')
      }
    },
  }),
)

app.use((request, response, next) => {
  if (request.method !== 'GET') {
    next()
    return
  }

  response.sendFile(path.join(distDir, 'index.html'))
})

const server = https.createServer(credentials, app)
const wss = new WebSocketServer({ server, path: '/signal' })

wss.on('connection', (socket, request) => {
  const requestUrl = new URL(request.url ?? '/', `https://${request.headers.host ?? 'localhost'}`)
  const roomId = cleanId(requestUrl.searchParams.get('roomId') || 'local-room')
  const deviceId = cleanId(requestUrl.searchParams.get('deviceId') || `device-${Date.now()}`)
  const role = requestUrl.searchParams.get('role') === 'recorder' ? 'recorder' : 'monitor'
  const name =
    requestUrl.searchParams.get('name') ||
    (role === 'recorder' ? 'Phone recorder' : 'Laptop monitor')
  const room = getRoom(roomId)
  const now = new Date().toISOString()

  socket.motioncue = { roomId, deviceId, role }
  room.clients.add(socket)
  room.devices.set(deviceId, {
    id: deviceId,
    roomId,
    role,
    name,
    userAgent: request.headers['user-agent'] ?? '',
    online: true,
    lastSeenAt: now,
    createdAt: room.devices.get(deviceId)?.createdAt ?? now,
    updatedAt: now,
  })

  send(socket, {
    type: 'server-hello',
    roomId,
    deviceId,
    localUrls,
    lanUrls,
    preferredJoinUrl: lanUrls[0] ?? `https://localhost:${port}/`,
    clipStoragePath: clipsDir,
    ...snapshot(room),
  })
  broadcastRoomState(room)

  socket.on('message', (raw) => {
    const message = parseMessage(raw)

    if (!message || message.roomId !== roomId) {
      return
    }

    const timestamp = new Date().toISOString()
    const device = room.devices.get(deviceId)

    if (device) {
      room.devices.set(deviceId, {
        ...device,
        online: true,
        lastSeenAt: timestamp,
        updatedAt: timestamp,
      })
    }

    if (message.type === 'presence') {
      broadcastRoomState(room)
      return
    }

    if (message.type === 'settings') {
      room.settings = normalizeSettings(message.settings)
      broadcast(room, { type: 'settings', roomId, settings: room.settings })
      broadcastRoomState(room)
      return
    }

    if (message.type === 'event') {
      const event = message.event

      if (event && typeof event.id === 'string') {
        room.events = [event, ...room.events.filter((entry) => entry.id !== event.id)].slice(0, 80)
        broadcast(room, { type: 'event', roomId, event })
      }
      return
    }

    if (message.type === 'signal') {
      broadcast(
        room,
        {
          type: 'signal',
          roomId,
          fromDeviceId: deviceId,
          fromRole: role,
          targetDeviceId: message.targetDeviceId ?? null,
          targetRole: message.targetRole ?? null,
          payload: message.payload,
        },
        (client) => {
          if (client === socket) {
            return false
          }

          if (message.targetDeviceId) {
            return client.motioncue?.deviceId === message.targetDeviceId
          }

          if (message.targetRole) {
            return client.motioncue?.role === message.targetRole
          }

          return true
        },
      )
    }
  })

  socket.on('close', () => {
    room.clients.delete(socket)

    const stillConnected = [...room.clients].some(
      (client) => client.motioncue?.deviceId === deviceId,
    )

    if (!stillConnected) {
      const device = room.devices.get(deviceId)

      if (device) {
        const timestamp = new Date().toISOString()
        room.devices.set(deviceId, {
          ...device,
          online: false,
          lastSeenAt: timestamp,
          updatedAt: timestamp,
        })
      }
    }

    broadcastRoomState(room)
  })
})

server.listen(port, host, () => {
  console.log('')
  console.log('MotionCue local server is running.')
  console.log('')
  console.log('Open on this laptop:')
  console.log(`  https://localhost:${port}/`)
  console.log('')
  if (lanUrls.length) {
    console.log('Phone join URLs:')
    lanUrls.forEach((url) => console.log(`  ${url}`))
  } else {
    console.log('No Wi-Fi/LAN IPv4 address was found yet.')
  }
  console.log('')
  console.log('Keep this window open while using MotionCue.')
  console.log('')
})

setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) {
      socket.terminate()
      return
    }

    socket.isAlive = false
    socket.ping()
  })
}, 30000)

wss.on('connection', (socket) => {
  socket.isAlive = true
  socket.on('pong', () => {
    socket.isAlive = true
  })
})

async function ensureCertificate() {
  await fs.mkdir(localDir, { recursive: true })
  const currentIps = lanIps.sort()

  if (existsSync(certPath) && existsSync(keyPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'))
      const certIps = Array.isArray(meta.ips) ? meta.ips : []
      const coversCurrentIps = currentIps.every((ip) => certIps.includes(ip))

      if (coversCurrentIps) {
        return {
          cert: await fs.readFile(certPath),
          key: await fs.readFile(keyPath),
        }
      }
    } catch {
      // Regenerate below.
    }
  }

  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...currentIps.map((ip) => ({ type: 7, ip })),
  ]
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'MotionCue Local' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true,
      },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  })

  await fs.writeFile(certPath, pems.cert)
  await fs.writeFile(keyPath, pems.private)
  await fs.writeFile(metaPath, JSON.stringify({ ips: currentIps }, null, 2))

  return {
    cert: pems.cert,
    key: pems.private,
  }
}

function getLanIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

function getRoom(roomId) {
  const existing = rooms.get(roomId)

  if (existing) {
    return existing
  }

  const room = {
    id: roomId,
    clients: new Set(),
    devices: new Map(),
    events: [],
    settings: defaultSettings,
    clips: readClipIndex(roomId),
  }
  rooms.set(roomId, room)
  return room
}

function clipRoomDir(roomId) {
  return path.join(clipsDir, cleanId(roomId))
}

function clipIndexPath(roomId) {
  return path.join(clipRoomDir(roomId), 'index.json')
}

function readClipIndex(roomId) {
  const indexPath = clipIndexPath(roomId)

  if (!existsSync(indexPath)) {
    return []
  }

  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(isClipMetadata) : []
  } catch {
    return []
  }
}

async function saveClipIndex(room) {
  await fs.mkdir(clipRoomDir(room.id), { recursive: true })
  await fs.writeFile(clipIndexPath(room.id), JSON.stringify(room.clips, null, 2))
}

function snapshot(room) {
  return {
    settings: room.settings,
    devices: [...room.devices.values()],
    events: room.events,
    clips: room.clips,
  }
}

function broadcastRoomState(room) {
  broadcast(room, {
    type: 'room-state',
    roomId: room.id,
    ...snapshot(room),
  })
}

function broadcast(room, message, filter = () => true) {
  room.clients.forEach((client) => {
    if (client.readyState === 1 && filter(client)) {
      send(client, message)
    }
  })
}

function send(socket, message) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message))
  }
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw.toString())
  } catch {
    return null
  }
}

function cleanId(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'local-room'
}

function extensionForMime(mimeType) {
  if (mimeType.includes('mp4')) {
    return '.mp4'
  }

  return '.webm'
}

function safeIso(value, fallback) {
  if (!value) {
    return fallback
  }

  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback
}

function numberFromQuery(value, fallback) {
  const raw = Array.isArray(value) ? value[0] : value
  const number = Number(raw)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback
}

function isClipMetadata(value) {
  return (
    value &&
    typeof value.id === 'string' &&
    typeof value.roomId === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.url === 'string'
  )
}

function normalizeSettings(settings) {
  const zones =
    Array.isArray(settings?.zones) && settings.zones.length === 9
      ? settings.zones.map(Boolean)
      : defaultSettings.zones

  return {
    armed: Boolean(settings?.armed ?? defaultSettings.armed),
    motionMode: settings?.motionMode === 'person' ? 'person' : 'motion',
    sensitivity: clamp(settings?.sensitivity, 1, 100, defaultSettings.sensitivity),
    cooldownSeconds: clamp(settings?.cooldownSeconds, 2, 120, defaultSettings.cooldownSeconds),
    clipSeconds: clamp(settings?.clipSeconds, 3, 30, defaultSettings.clipSeconds),
    loopRecording: Boolean(settings?.loopRecording ?? defaultSettings.loopRecording),
    preRollSeconds: clamp(settings?.preRollSeconds, 0, 60, defaultSettings.preRollSeconds),
    postMotionSeconds: clamp(
      settings?.postMotionSeconds,
      2,
      120,
      defaultSettings.postMotionSeconds,
    ),
    maxClipSeconds: clamp(settings?.maxClipSeconds, 30, 600, defaultSettings.maxClipSeconds),
    recordOnMotion: Boolean(settings?.recordOnMotion ?? defaultSettings.recordOnMotion),
    zones,
    facingMode: settings?.facingMode === 'user' ? 'user' : 'environment',
  }
}

function clamp(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}
