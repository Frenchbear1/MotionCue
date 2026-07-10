import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  Activity,
  Bell,
  Camera,
  Check,
  CircleStop,
  Copy,
  Download,
  Eye,
  Home,
  Loader2,
  Monitor,
  Play,
  QrCode,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Video,
  Wifi,
  WifiOff,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import QRCode from 'qrcode'
import clsx from 'clsx'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { buildEvent, formatBytes, isUnreadMotionAlert } from './lib/events'
import { createId, nowIso } from './lib/ids'
import {
  analyzeFrameDifference,
  shouldTriggerMotion,
  type MotionAnalysis,
  type MotionFrame,
} from './lib/motion'
import { detectPersonInFrame, type PersonDetectionResult } from './lib/personDetector'
import { defaultSettings, normalizeSettings } from './lib/settings'
import { useDeviceId } from './hooks/useDeviceId'
import { useLocalClips } from './hooks/useLocalClips'
import { exportClip } from './services/clips'
import { chooseRecordingMimeType, createPeerConnection, toSignalingDescription } from './services/webrtc'
import type {
  DeviceRole,
  LocalClip,
  MotionCueDevice,
  MotionCueEvent,
  RecorderSettings,
  SignalingDescription,
} from './types'

type AppView = 'monitor' | 'recorder' | 'clips' | 'settings'

type ServerInfo = {
  localUrls: string[]
  lanUrls: string[]
  preferredJoinUrl: string
  clipStoragePath: string
}

type ServerClip = {
  id: string
  roomId: string
  eventId: string
  deviceId: string
  startedAt: string
  endedAt: string
  durationMs: number
  size: number
  mimeType: string
  fileName: string
  url: string
  createdAt: string
}

type RollingChunk = {
  blob: Blob
  createdAt: number
}

type ActiveRecording = {
  eventId: string
  startedAtMs: number
}

type SignalPayload =
  | { kind: 'offer'; description: SignalingDescription }
  | { kind: 'answer'; description: SignalingDescription }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  | { kind: 'hangup' }

type SignalEnvelope = {
  id: string
  roomId: string
  fromDeviceId: string
  fromRole: DeviceRole
  targetDeviceId: string | null
  targetRole: DeviceRole | null
  payload: SignalPayload
}

type ClientMessage =
  | { type: 'presence'; roomId: string }
  | { type: 'settings'; roomId: string; settings: RecorderSettings }
  | { type: 'event'; roomId: string; event: MotionCueEvent }
  | {
      type: 'signal'
      roomId: string
      targetRole?: DeviceRole
      targetDeviceId?: string
      payload: SignalPayload
    }

type ServerMessage =
  | {
      type: 'server-hello' | 'room-state'
      roomId: string
      settings: RecorderSettings
      devices: MotionCueDevice[]
      events: MotionCueEvent[]
      clips?: ServerClip[]
      localUrls?: string[]
      lanUrls?: string[]
      preferredJoinUrl?: string
      clipStoragePath?: string
    }
  | { type: 'settings'; roomId: string; settings: RecorderSettings }
  | { type: 'event'; roomId: string; event: MotionCueEvent }
  | Omit<SignalEnvelope, 'id'> & { type: 'signal' }

const panelClass = 'rounded-[28px] border border-white bg-white p-4 shadow-sm'
const inputClass =
  'min-w-0 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-[var(--accent)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]'

const emptyAnalysis: MotionAnalysis = {
  motion: false,
  score: 0,
  changedRatio: 0,
  averageDelta: 0,
  sampledPixels: 0,
}

const idlePersonResult: PersonDetectionResult = {
  supported: true,
  detected: false,
  score: 0,
  status: 'idle',
}

const viewTabs: Array<{ id: AppView; label: string; Icon: LucideIcon }> = [
  { id: 'monitor', label: 'Monitor', Icon: Monitor },
  { id: 'recorder', label: 'Recorder', Icon: Smartphone },
  { id: 'clips', label: 'Clips', Icon: Video },
  { id: 'settings', label: 'Settings', Icon: Settings },
]

const MOTION_CLEAR_MS = 2500

export default function LocalApp() {
  const initialState = useMemo(getInitialState, [])
  const deviceId = useDeviceId()
  const [roomId] = useState(initialState.roomId)
  const [view, setView] = useState<AppView>(initialState.view)
  const [role, setRole] = useState<DeviceRole>(initialState.role)
  const [settings, setSettings] = useState<RecorderSettings>(defaultSettings)
  const [devices, setDevices] = useState<MotionCueDevice[]>([])
  const [events, setEvents] = useState<MotionCueEvent[]>([])
  const [serverClips, setServerClips] = useState<ServerClip[]>([])
  const [signals, setSignals] = useState<SignalEnvelope[]>([])
  const handleSocketEvent = useCallback((event: MotionCueEvent) => {
    setEvents((current) => [event, ...current.filter((entry) => entry.id !== event.id)].slice(0, 80))
  }, [])
  const handleSocketSignal = useCallback((signal: SignalEnvelope) => {
    setSignals((current) => [...current.slice(-40), signal])
  }, [])
  const localClips = useLocalClips(roomId)
  const {
    connected,
    serverError,
    serverInfo,
    send,
  } = useLocalSocket({
    roomId,
    deviceId,
    role,
    onSettings: setSettings,
    onDevices: setDevices,
    onEvents: setEvents,
    onClips: setServerClips,
    onEvent: handleSocketEvent,
    onSignal: handleSocketSignal,
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', '#2f8f7a')
    document.documentElement.style.colorScheme = 'light'
  }, [])

  useEffect(() => {
    replaceLocalUrl(roomId, view)
  }, [roomId, view])

  useEffect(() => {
    if (view === 'monitor' || view === 'recorder') {
      setRole(view)
      window.localStorage.setItem('motioncue.localRole', view)
    }
  }, [view])

  const saveEvent = useCallback(
    (event: MotionCueEvent) => {
      setEvents((current) => [event, ...current.filter((entry) => entry.id !== event.id)].slice(0, 80))
      send({ type: 'event', roomId, event })
    },
    [roomId, send],
  )

  const updateSettings = useCallback(
    (nextSettings: RecorderSettings) => {
      const normalized = normalizeSettings(nextSettings)
      setSettings(normalized)
      send({ type: 'settings', roomId, settings: normalized })
    },
    [roomId, send],
  )

  const sendSignal = useCallback(
    (payload: SignalPayload, targetRole?: DeviceRole, targetDeviceId?: string) =>
      send({ type: 'signal', roomId, payload, targetRole, targetDeviceId }),
    [roomId, send],
  )

  const markAlertsRead = useCallback(() => {
    const readAt = nowIso()
    const unread = events.filter(isUnreadMotionAlert)

    if (!unread.length) {
      return
    }

    setEvents((current) =>
      current.map((event) => (isUnreadMotionAlert(event) ? { ...event, readAt } : event)),
    )
    unread.forEach((event) => {
      send({ type: 'event', roomId, event: { ...event, readAt } })
    })
  }, [events, roomId, send])

  const handleClipSaved = useCallback(
    (clip: LocalClip) => {
      void localClips.addClip(clip)
      void uploadServerClip(roomId, clip)
        .then((serverClip) => {
          setServerClips((current) => [
            serverClip,
            ...current.filter((entry) => entry.id !== serverClip.id),
          ])
        })
        .catch((error: unknown) => {
          console.warn('MotionCue clip upload failed', error)
        })
    },
    [localClips, roomId],
  )

  const handleServerClipDelete = useCallback(
    (clipId: string) => {
      setServerClips((current) => current.filter((clip) => clip.id !== clipId))
      void deleteServerClip(roomId, clipId).catch((error: unknown) => {
        console.warn('MotionCue clip delete failed', error)
      })
    },
    [roomId],
  )

  const recorderUrl = useMemo(
    () => buildRecorderUrl(serverInfo, roomId),
    [roomId, serverInfo],
  )
  const monitorOnline = devices.some((device) => device.role === 'monitor' && isDeviceOnline(device))
  const recorderOnline = devices.some((device) => device.role === 'recorder' && isDeviceOnline(device))
  const unreadCount = events.filter(isUnreadMotionAlert).length

  if (serverError && !serverInfo && !connected) {
    return <ServerRequiredScreen />
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="motioncue-shell min-h-svh text-stone-950">
        <div className="mx-auto min-h-svh max-w-[1180px] pb-[calc(env(safe-area-inset-bottom)+6.5rem)]">
          <header className="glass-sticky sticky top-0 z-30 border-b border-stone-200/80 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+14px)] lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                  MotionCue Local
                </p>
                <h1 className="truncate text-2xl font-semibold text-stone-950 sm:text-3xl">
                  {role === 'recorder' ? 'Phone recorder' : 'Laptop monitor'}
                </h1>
              </div>
              <StatusPill
                label={connected ? 'Server live' : 'Server offline'}
                tone={connected ? 'ok' : 'warn'}
                title={serverError}
              />
            </div>
          </header>

          <main className="px-5 py-5 lg:px-8">
            <AnimatePresence mode="wait">
              <PageFrame key={view}>
                {view === 'monitor' ? (
                  <MonitorPanel
                    connected={connected}
                    devices={devices}
                    events={events}
                    monitorOnline={monitorOnline}
                    recorderOnline={recorderOnline}
                    recorderUrl={recorderUrl}
                    roomId={roomId}
                    settings={settings}
                    signals={signals}
                    sendSignal={sendSignal}
                    onMarkAlertsRead={markAlertsRead}
                  />
                ) : null}
                {view === 'recorder' ? (
                  <RecorderPanel
                    connected={connected}
                    roomId={roomId}
                    deviceId={deviceId}
                    settings={settings}
                    signals={signals}
                    sendSignal={sendSignal}
                    onClipSaved={handleClipSaved}
                    onSaveEvent={saveEvent}
                    onSettingsChange={updateSettings}
                  />
                ) : null}
                {view === 'clips' ? (
                  <ClipsPanel
                    clips={localClips.clips}
                    events={events}
                    roomId={roomId}
                    serverClips={serverClips}
                    storageEstimate={localClips.estimate}
                    onClipDelete={(clipId) => void localClips.removeClip(clipId)}
                    onServerClipDelete={handleServerClipDelete}
                  />
                ) : null}
                {view === 'settings' ? (
                  <SettingsPanel
                    connected={connected}
                    roomId={roomId}
                    recorderUrl={recorderUrl}
                    settings={settings}
                    serverInfo={serverInfo}
                    onSettingsChange={updateSettings}
                  />
                ) : null}
              </PageFrame>
            </AnimatePresence>
          </main>

          <BottomNav view={view} unreadCount={unreadCount} onViewChange={setView} />
        </div>
      </div>
    </MotionConfig>
  )
}

function MonitorPanel({
  connected,
  devices,
  events,
  monitorOnline,
  recorderOnline,
  recorderUrl,
  roomId,
  settings,
  signals,
  sendSignal,
  onMarkAlertsRead,
}: {
  connected: boolean
  devices: MotionCueDevice[]
  events: MotionCueEvent[]
  monitorOnline: boolean
  recorderOnline: boolean
  recorderUrl: string
  roomId: string
  settings: RecorderSettings
  signals: SignalEnvelope[]
  sendSignal: (payload: SignalPayload, targetRole?: DeviceRole) => boolean
  onMarkAlertsRead: () => void
}) {
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const latestOfferRef = useRef<SignalingDescription | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const processedSignalsRef = useRef<Set<string>>(new Set())
  const autoStartedRef = useRef(false)
  const lastOfferSentAtRef = useRef(0)
  const [connectionLabel, setConnectionLabel] = useState('Waiting')
  const [isOpening, setIsOpening] = useState(false)
  const [qrUrl, setQrUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(() =>
    'Notification' in window ? Notification.permission : 'denied',
  )
  const recentEvents = events.slice(0, 12)

  const addRemoteCandidate = useCallback((candidate: RTCIceCandidateInit) => {
    const peer = peerRef.current

    if (!peer) {
      return
    }

    if (!peer.currentRemoteDescription) {
      pendingCandidatesRef.current.push(candidate)
      return
    }

    void peer.addIceCandidate(candidate).catch((error: unknown) => {
      setConnectionLabel(error instanceof Error ? error.message : 'Candidate failed')
    })
  }, [])

  const flushCandidates = useCallback(() => {
    const candidates = pendingCandidatesRef.current
    pendingCandidatesRef.current = []
    candidates.forEach(addRemoteCandidate)
  }, [addRemoteCandidate])

  const stopMonitor = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null
    latestOfferRef.current = null
    pendingCandidatesRef.current = []
    setIsOpening(false)
    setConnectionLabel('Stopped')
    sendSignal({ kind: 'hangup' }, 'recorder')

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null
    }
  }, [sendSignal])

  const startMonitor = useCallback(async () => {
    if (!connected || isOpening) {
      setConnectionLabel(connected ? 'Opening' : 'Server offline')
      return
    }

    peerRef.current?.close()
    pendingCandidatesRef.current = []
    setIsOpening(true)
    setConnectionLabel('Opening')

    const peer = createPeerConnection()
    peerRef.current = peer
    peer.addTransceiver('video', { direction: 'recvonly' })
    peer.ontrack = (event) => {
      const stream = event.streams[0]

      if (remoteVideoRef.current && stream) {
        remoteVideoRef.current.srcObject = stream
      }
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setConnectionLabel('Receiving video')
        setIsOpening(false)
        return
      }

      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        setConnectionLabel(peer.connectionState)
        setIsOpening(false)
      }
    }
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ kind: 'candidate', candidate: event.candidate.toJSON() }, 'recorder')
      }
    }

    try {
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      latestOfferRef.current = toSignalingDescription(peer.localDescription)
      const sent = sendSignal(
        { kind: 'offer', description: latestOfferRef.current },
        'recorder',
      )
      lastOfferSentAtRef.current = Date.now()
      setConnectionLabel(sent ? 'Waiting for phone' : 'Server offline')
      setIsOpening(false)
    } catch (error) {
      setConnectionLabel(error instanceof Error ? error.message : 'Monitor failed')
      setIsOpening(false)
    }
  }, [connected, isOpening, sendSignal])

  useEffect(() => {
    if (!connected || autoStartedRef.current) {
      return
    }

    autoStartedRef.current = true
    void startMonitor()
  }, [connected, startMonitor])

  useEffect(() => {
    if (
      !connected ||
      !recorderOnline ||
      !latestOfferRef.current ||
      connectionLabel === 'Receiving video'
    ) {
      return
    }

    const now = Date.now()

    if (now - lastOfferSentAtRef.current < 1200) {
      return
    }

    const sent = sendSignal({ kind: 'offer', description: latestOfferRef.current }, 'recorder')
    lastOfferSentAtRef.current = now

    if (sent) {
      setConnectionLabel('Waiting for phone')
    }
  }, [connected, connectionLabel, recorderOnline, sendSignal])

  useEffect(() => {
    signals.forEach((signal) => {
      if (processedSignalsRef.current.has(signal.id) || signal.fromRole !== 'recorder') {
        return
      }

      processedSignalsRef.current.add(signal.id)

      if (signal.payload.kind === 'answer' && peerRef.current) {
        void peerRef.current
          .setRemoteDescription(signal.payload.description)
          .then(() => {
            flushCandidates()
            setConnectionLabel('Receiving video')
          })
          .catch((error: unknown) => {
            setConnectionLabel(error instanceof Error ? error.message : 'Answer failed')
          })
      }

      if (signal.payload.kind === 'candidate') {
        addRemoteCandidate(signal.payload.candidate)
      }

      if (signal.payload.kind === 'hangup') {
        stopMonitor()
      }
    })
  }, [addRemoteCandidate, flushCandidates, signals, stopMonitor])

  useEffect(() => {
    void QRCode.toDataURL(recorderUrl, {
      margin: 1,
      width: 260,
      color: { dark: '#17211f', light: '#ffffff' },
    }).then(setQrUrl)
  }, [recorderUrl])

  const copyLink = async () => {
    await navigator.clipboard.writeText(recorderUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('denied')
      return
    }

    setNotificationPermission(await Notification.requestPermission())
  }

  useMotionNotifications(events, 'monitor')

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <section className="min-w-0 space-y-5">
        <div className="relative overflow-hidden rounded-[28px] bg-stone-950 shadow-2xl">
          <div className="video-grid aspect-video w-full">
            <video
              ref={remoteVideoRef}
              className="h-full w-full object-contain"
              autoPlay
              playsInline
              muted
            />
          </div>
          <div className="absolute left-4 top-4 flex flex-wrap gap-2">
            <StatusPill
              label={connectionLabel}
              tone={connectionLabel === 'Receiving video' ? 'ok' : 'warn'}
            />
            {settings.armed ? <StatusPill label="Armed" tone="ok" /> : null}
          </div>
          <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void startMonitor()}
              disabled={isOpening}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-stone-950 shadow-lg disabled:opacity-60"
            >
              {isOpening ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
              {isOpening ? 'Opening' : 'Start monitor'}
            </button>
            <button
              type="button"
              onClick={stopMonitor}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-white/15 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/20"
            >
              <CircleStop size={18} />
              Stop
            </button>
          </div>
        </div>

        <DeviceStrip
          devices={devices}
          monitorOnline={monitorOnline}
          recorderOnline={recorderOnline}
        />
      </section>

      <aside className="min-w-0 space-y-5">
        <section className={panelClass}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-stone-950">Phone pairing</h2>
              <p className="text-sm text-stone-500">Room {shortRoom(roomId)}</p>
            </div>
            <div className="grid size-11 place-items-center rounded-2xl bg-amber-50 text-amber-700">
              <QrCode size={22} />
            </div>
          </div>
          <div className="grid place-items-center rounded-[24px] bg-white p-3 shadow-sm">
            {qrUrl ? (
              <img src={qrUrl} alt="Recorder QR code" className="size-56 rounded-2xl" />
            ) : (
              <div className="grid size-56 place-items-center text-stone-400">
                <Loader2 className="animate-spin" size={28} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="pressable mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-3 text-sm font-semibold text-white"
          >
            <Copy size={17} />
            {copied ? 'Copied' : 'Copy phone link'}
          </button>
        </section>

        <section className={panelClass}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-stone-950">Motion timeline</h2>
            <div className="flex shrink-0 items-center gap-2">
              {notificationPermission !== 'granted' ? (
                <button
                  type="button"
                  onClick={() => void requestNotifications()}
                  className="pressable flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700"
                >
                  <Bell size={14} />
                  Alerts
                </button>
              ) : null}
              <button
                type="button"
                onClick={onMarkAlertsRead}
                className="pressable flex items-center gap-2 rounded-full bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700"
              >
                <Check size={14} />
                Read
              </button>
            </div>
          </div>
          <EventList events={recentEvents} />
        </section>
      </aside>
    </div>
  )
}

function RecorderPanel({
  connected,
  roomId,
  deviceId,
  settings,
  signals,
  sendSignal,
  onClipSaved,
  onSaveEvent,
  onSettingsChange,
}: {
  connected: boolean
  roomId: string
  deviceId: string
  settings: RecorderSettings
  signals: SignalEnvelope[]
  sendSignal: (payload: SignalPayload, targetRole?: DeviceRole) => boolean
  onClipSaved: (clip: LocalClip) => void
  onSaveEvent: (event: MotionCueEvent) => void
  onSettingsChange: (settings: RecorderSettings) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const pendingOfferRef = useRef<SignalingDescription | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const processedSignalsRef = useRef<Set<string>>(new Set())
  const recordingRef = useRef(false)
  const rollingRecorderRef = useRef<MediaRecorder | null>(null)
  const rollingChunksRef = useRef<RollingChunk[]>([])
  const activeChunksRef = useRef<RollingChunk[]>([])
  const activeRecordingRef = useRef<ActiveRecording | null>(null)
  const rollingMimeTypeRef = useRef('video/webm')
  const previousFrameRef = useRef<MotionFrame | null>(null)
  const lastTriggerAtRef = useRef<number | null>(null)
  const motionActiveRef = useRef(false)
  const lastMotionSeenAtRef = useRef(0)
  const lastPersonCheckAtRef = useRef(0)
  const lastPersonResultRef = useRef<PersonDetectionResult>(idlePersonResult)
  const [cameraError, setCameraError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const [streamLabel, setStreamLabel] = useState('Waiting')
  const [analysis, setAnalysis] = useState<MotionAnalysis>(emptyAnalysis)
  const [personResult, setPersonResult] = useState<PersonDetectionResult>(idlePersonResult)
  const [isRecording, setIsRecording] = useState(false)

  const patchSettings = (patch: Partial<RecorderSettings>) => {
    onSettingsChange(normalizeSettings({ ...settings, ...patch }))
  }

  const addRemoteCandidate = useCallback((candidate: RTCIceCandidateInit) => {
    const peer = peerRef.current

    if (!peer) {
      return
    }

    if (!peer.currentRemoteDescription) {
      pendingCandidatesRef.current.push(candidate)
      return
    }

    void peer.addIceCandidate(candidate).catch((error: unknown) => {
      setStreamLabel(error instanceof Error ? error.message : 'Candidate failed')
    })
  }, [])

  const flushCandidates = useCallback(() => {
    const candidates = pendingCandidatesRef.current
    pendingCandidatesRef.current = []
    candidates.forEach(addRemoteCandidate)
  }, [addRemoteCandidate])

  const closePeer = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null
    pendingCandidatesRef.current = []
    setStreamLabel('Waiting')
  }, [])

  const acceptOffer = useCallback(
    async (description: SignalingDescription) => {
      const stream = streamRef.current

      if (!stream) {
        pendingOfferRef.current = description
        setStreamLabel('Monitor waiting')
        return
      }

      closePeer()
      setStreamLabel('Connecting')
      const peer = createPeerConnection()
      peerRef.current = peer
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setStreamLabel('Streaming')
          return
        }

        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          setStreamLabel(peer.connectionState)
        }
      }
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({ kind: 'candidate', candidate: event.candidate.toJSON() }, 'monitor')
        }
      }

      await peer.setRemoteDescription(description)
      flushCandidates()
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      const sent = sendSignal(
        { kind: 'answer', description: toSignalingDescription(peer.localDescription) },
        'monitor',
      )
      setStreamLabel(sent ? 'Streaming' : 'Server offline')
    },
    [closePeer, flushCandidates, sendSignal],
  )

  const stopCamera = useCallback(() => {
    if (rollingRecorderRef.current?.state === 'recording') {
      rollingRecorderRef.current.stop()
    }

    rollingRecorderRef.current = null
    rollingChunksRef.current = []
    activeChunksRef.current = []
    activeRecordingRef.current = null
    recordingRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraReady(false)
    setIsRecording(false)
    closePeer()

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [closePeer])

  const startCamera = useCallback(async () => {
    setCameraError('')
    stopCamera()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: settings.facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      setCameraReady(true)
      onSaveEvent(
        buildEvent({
          roomId,
          deviceId,
          type: 'device_joined',
          message: 'Recorder camera came online.',
          createdAt: nowIso(),
        }),
      )
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Camera permission failed.')
    }
  }, [deviceId, onSaveEvent, roomId, settings.facingMode, stopCamera])

  useEffect(() => stopCamera, [stopCamera])

  useEffect(() => {
    if (!cameraReady || !pendingOfferRef.current) {
      return
    }

    const offer = pendingOfferRef.current
    pendingOfferRef.current = null
    void acceptOffer(offer).catch((error: unknown) => {
      setStreamLabel(error instanceof Error ? error.message : 'Connection failed')
    })
  }, [acceptOffer, cameraReady])

  useEffect(() => {
    signals.forEach((signal) => {
      if (processedSignalsRef.current.has(signal.id) || signal.fromRole !== 'monitor') {
        return
      }

      processedSignalsRef.current.add(signal.id)

      if (signal.payload.kind === 'offer') {
        void acceptOffer(signal.payload.description).catch((error: unknown) => {
          setStreamLabel(error instanceof Error ? error.message : 'Offer failed')
        })
      }

      if (signal.payload.kind === 'candidate') {
        addRemoteCandidate(signal.payload.candidate)
      }

      if (signal.payload.kind === 'hangup') {
        closePeer()
      }
    })
  }, [acceptOffer, addRemoteCandidate, closePeer, signals])

  const trimRollingChunks = useCallback(() => {
    const maxBufferMs = Math.max(5000, settings.preRollSeconds * 1000 + 5000)
    const cutoff = Date.now() - maxBufferMs
    rollingChunksRef.current = rollingChunksRef.current.filter((chunk) => chunk.createdAt >= cutoff)
  }, [settings.preRollSeconds])

  const finishMotionRecording = useCallback(() => {
    const activeRecording = activeRecordingRef.current

    if (!activeRecording) {
      return
    }

    const chunks = activeChunksRef.current
    activeRecordingRef.current = null
    activeChunksRef.current = []
    recordingRef.current = false
    setIsRecording(false)

    if (!chunks.length) {
      return
    }

    const endedAt = nowIso()
    const startedAt = new Date(activeRecording.startedAtMs).toISOString()
    const blob = new Blob(
      chunks.map((chunk) => chunk.blob),
      { type: rollingMimeTypeRef.current || 'video/webm' },
    )
    const durationMs = new Date(endedAt).getTime() - activeRecording.startedAtMs
    const clip: LocalClip = {
      id: createId('clip'),
      roomId,
      eventId: activeRecording.eventId,
      deviceId,
      startedAt,
      endedAt,
      durationMs,
      size: blob.size,
      mimeType: blob.type,
      blob,
    }

    onClipSaved(clip)
    onSaveEvent(
      buildEvent({
        roomId,
        deviceId,
        type: 'recording_saved',
        message: 'Clip saved and shared on the laptop.',
        createdAt: endedAt,
        clipId: clip.id,
        durationMs,
        size: blob.size,
      }),
    )
  }, [deviceId, onClipSaved, onSaveEvent, roomId])

  const beginMotionRecording = useCallback(() => {
    if (!settings.recordOnMotion || recordingRef.current || typeof MediaRecorder === 'undefined') {
      return
    }

    const now = Date.now()
    const preRollMs = settings.loopRecording ? settings.preRollSeconds * 1000 : 0
    const bufferedChunks = rollingChunksRef.current.filter((chunk) => now - chunk.createdAt <= preRollMs)
    const startedAtMs = bufferedChunks[0]?.createdAt ?? now
    const eventId = createId('evt')

    activeChunksRef.current = [...bufferedChunks]
    activeRecordingRef.current = { eventId, startedAtMs }
    recordingRef.current = true
    setIsRecording(true)

    onSaveEvent({
      id: eventId,
      roomId,
      type: 'recording_started',
      deviceId,
      message: settings.loopRecording
        ? `Motion recording started with ${settings.preRollSeconds}s pre-roll.`
        : 'Motion recording started.',
      createdAt: new Date(startedAtMs).toISOString(),
      readAt: null,
      score: null,
      clipId: null,
      durationMs: null,
      size: null,
    })
  }, [
    deviceId,
    onSaveEvent,
    roomId,
    settings.loopRecording,
    settings.preRollSeconds,
    settings.recordOnMotion,
  ])

  useEffect(() => {
    const stream = streamRef.current

    if (
      !cameraReady ||
      !settings.recordOnMotion ||
      !stream ||
      typeof MediaRecorder === 'undefined'
    ) {
      return
    }

    const mimeType = chooseRecordingMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    rollingMimeTypeRef.current = recorder.mimeType || mimeType || 'video/webm'
    rollingRecorderRef.current = recorder
    recorder.ondataavailable = (event) => {
      if (!event.data.size) {
        return
      }

      const chunk: RollingChunk = {
        blob: event.data,
        createdAt: Date.now(),
      }
      rollingChunksRef.current.push(chunk)
      trimRollingChunks()

      if (recordingRef.current) {
        activeChunksRef.current.push(chunk)
      }
    }
    recorder.onerror = () => {
      onSaveEvent(
        buildEvent({
          roomId,
          deviceId,
          type: 'recording_failed',
          message: 'Loop recording failed on this device.',
          createdAt: nowIso(),
        }),
      )
    }
    recorder.start(1000)

    return () => {
      if (recordingRef.current) {
        finishMotionRecording()
      }

      if (recorder.state !== 'inactive') {
        recorder.stop()
      }

      if (rollingRecorderRef.current === recorder) {
        rollingRecorderRef.current = null
      }
    }
  }, [
    cameraReady,
    deviceId,
    finishMotionRecording,
    onSaveEvent,
    roomId,
    settings.recordOnMotion,
    trimRollingChunks,
  ])

  useEffect(() => {
    if (!settings.armed && recordingRef.current) {
      finishMotionRecording()
    }
  }, [finishMotionRecording, settings.armed])

  useEffect(() => {
    if (!cameraReady || !settings.armed || !videoRef.current || !canvasRef.current) {
      return
    }

    let cancelled = false
    let timer = 0
    const canvas = canvasRef.current
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const video = videoRef.current

    const tick = async () => {
      if (cancelled || !context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        timer = window.setTimeout(tick, 450)
        return
      }

      canvas.width = 160
      canvas.height = 90
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const frame: MotionFrame = {
        width: canvas.width,
        height: canvas.height,
        data: new Uint8ClampedArray(image.data),
      }
      const nextAnalysis = analyzeFrameDifference(previousFrameRef.current, frame, settings)
      previousFrameRef.current = frame
      setAnalysis(nextAnalysis)

      let allowedByPersonFilter = true
      if (settings.motionMode === 'person' && nextAnalysis.motion) {
        const shouldCheckPerson = Date.now() - lastPersonCheckAtRef.current > 1200

        if (shouldCheckPerson) {
          lastPersonCheckAtRef.current = Date.now()
          setPersonResult({ ...lastPersonResultRef.current, status: 'loading' })
          const nextPersonResult = await detectPersonInFrame(video)
          lastPersonResultRef.current = nextPersonResult
          setPersonResult(nextPersonResult)
        }

        allowedByPersonFilter =
          !lastPersonResultRef.current.supported || lastPersonResultRef.current.detected
      }

      const now = Date.now()
      if (nextAnalysis.motion && allowedByPersonFilter) {
        lastMotionSeenAtRef.current = now
      } else if (now - lastMotionSeenAtRef.current > MOTION_CLEAR_MS) {
        motionActiveRef.current = false
      }

      if (recordingRef.current && activeRecordingRef.current) {
        const recordingDurationMs = now - activeRecordingRef.current.startedAtMs
        const quietForMs = now - lastMotionSeenAtRef.current

        if (
          recordingDurationMs >= settings.maxClipSeconds * 1000 ||
          quietForMs >= settings.postMotionSeconds * 1000
        ) {
          finishMotionRecording()
        }
      }

      if (
        !motionActiveRef.current &&
        allowedByPersonFilter &&
        shouldTriggerMotion({
          analysis: nextAnalysis,
          settings,
          now,
          lastTriggerAt: lastTriggerAtRef.current,
        })
      ) {
        motionActiveRef.current = true
        lastTriggerAtRef.current = now
        onSaveEvent(
          buildEvent({
            roomId,
            deviceId,
            type: 'motion',
            message:
              settings.motionMode === 'person'
                ? 'Motion detected with person filter.'
                : 'Motion detected.',
            score: Math.round(nextAnalysis.score),
            createdAt: nowIso(),
          }),
        )

        if (settings.recordOnMotion) {
          beginMotionRecording()
        }
      }

      timer = window.setTimeout(tick, 450)
    }

    void tick()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    beginMotionRecording,
    cameraReady,
    deviceId,
    finishMotionRecording,
    onSaveEvent,
    roomId,
    settings,
  ])

  return (
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
      <section className="min-w-0 space-y-5">
        <div className="relative overflow-hidden rounded-[28px] bg-stone-950 shadow-2xl">
          <div className="video-grid aspect-[3/4] w-full sm:aspect-video">
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              autoPlay
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="absolute left-4 top-4 flex flex-wrap gap-2">
            <StatusPill label={cameraReady ? 'Camera live' : 'Camera off'} tone={cameraReady ? 'ok' : 'warn'} />
            <StatusPill label={streamLabel} tone={streamLabel === 'Streaming' ? 'ok' : 'warn'} />
            {isRecording ? <StatusPill label="Recording" tone="warn" /> : null}
          </div>
          <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void startCamera()}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-stone-950 shadow-lg"
            >
              <Camera size={18} />
              Start camera
            </button>
            <button
              type="button"
              onClick={() => patchSettings({ armed: !settings.armed })}
              className={clsx(
                'pressable flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold shadow-lg',
                settings.armed ? 'bg-red-500 text-white' : 'bg-[var(--accent)] text-white',
              )}
            >
              {settings.armed ? <CircleStop size={18} /> : <Zap size={18} />}
              {settings.armed ? 'Disarm' : 'Arm'}
            </button>
          </div>
        </div>

        {cameraError ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {cameraError}
          </p>
        ) : null}
      </section>

      <aside className="min-w-0 space-y-5">
        <section className={panelClass}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-stone-950">Motion engine</h2>
              <p className="text-sm text-stone-500">
                Score {Math.round(analysis.score)} / {settings.sensitivity}% sensitivity
              </p>
            </div>
            <div className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Activity size={22} />
            </div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-stone-100">
            <div
              className={clsx(
                'h-full rounded-full transition-all',
                analysis.motion ? 'bg-red-500' : 'bg-[var(--accent)]',
              )}
              style={{ width: `${Math.min(100, Math.round(analysis.score))}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric label="Changed" value={`${Math.round(analysis.changedRatio * 100)}%`} />
            <Metric label="Delta" value={analysis.averageDelta.toFixed(1)} />
          </div>
        </section>

        <RecorderControls
          connected={connected}
          settings={settings}
          personResult={personResult}
          onChange={patchSettings}
        />
      </aside>
    </div>
  )
}

function RecorderControls({
  connected,
  settings,
  personResult,
  onChange,
}: {
  connected: boolean
  settings: RecorderSettings
  personResult: PersonDetectionResult
  onChange: (patch: Partial<RecorderSettings>) => void
}) {
  return (
    <section className={panelClass}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-stone-950">Recorder setup</h2>
          <p className="text-sm text-stone-500">{connected ? 'LAN sync active' : 'LAN sync paused'}</p>
        </div>
        <SlidersHorizontal size={22} className="text-stone-400" />
      </div>

      <div className="space-y-5">
        <SegmentedControl
          label="Mode"
          value={settings.motionMode}
          options={[
            { value: 'motion', label: 'Any motion' },
            { value: 'person', label: 'Person' },
          ]}
          onChange={(value) => onChange({ motionMode: value as RecorderSettings['motionMode'] })}
        />

        {settings.motionMode === 'person' ? (
          <p className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
            {personStatusText(personResult)}
          </p>
        ) : null}

        <RangeControl
          label="Sensitivity"
          value={settings.sensitivity}
          min={1}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ sensitivity: value })}
        />
        <RangeControl
          label="Cooldown"
          value={settings.cooldownSeconds}
          min={2}
          max={120}
          suffix="s"
          onChange={(value) => onChange({ cooldownSeconds: value })}
        />
        <ToggleRow
          title="Record on motion"
          body="Save clips to this phone and the laptop server."
          checked={settings.recordOnMotion}
          onChange={(checked) => onChange({ recordOnMotion: checked })}
        />
        <ToggleRow
          title="Loop pre-roll"
          body="Keep a rolling buffer so clips can include time before motion."
          checked={settings.loopRecording}
          onChange={(checked) => onChange({ loopRecording: checked })}
        />
        <RangeControl
          label="Pre-roll"
          value={settings.preRollSeconds}
          min={0}
          max={60}
          suffix="s"
          onChange={(value) => onChange({ preRollSeconds: value })}
        />
        <RangeControl
          label="After motion"
          value={settings.postMotionSeconds}
          min={2}
          max={120}
          suffix="s"
          onChange={(value) => onChange({ postMotionSeconds: value })}
        />
        <RangeControl
          label="Max clip"
          value={settings.maxClipSeconds}
          min={30}
          max={600}
          suffix="s"
          onChange={(value) => onChange({ maxClipSeconds: value })}
        />

        <SegmentedControl
          label="Camera"
          value={settings.facingMode}
          options={[
            { value: 'environment', label: 'Back' },
            { value: 'user', label: 'Front' },
          ]}
          onChange={(value) => onChange({ facingMode: value as RecorderSettings['facingMode'] })}
        />

        <ZoneGrid zones={settings.zones} onChange={(zones) => onChange({ zones })} />
      </div>
    </section>
  )
}

function ClipsPanel({
  clips,
  events,
  roomId,
  serverClips,
  storageEstimate,
  onClipDelete,
  onServerClipDelete,
}: {
  clips: LocalClip[]
  events: MotionCueEvent[]
  roomId: string
  serverClips: ServerClip[]
  storageEstimate: { used: number; quota: number; percent: number }
  onClipDelete: (clipId: string) => void
  onServerClipDelete: (clipId: string) => void
}) {
  const savedEvents = events.filter((event) => event.type === 'recording_saved')

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className={panelClass}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">Clip storage</h2>
            <p className="text-sm text-stone-500">Shared clips live on this laptop.</p>
          </div>
          <Download size={22} className="text-stone-400" />
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-stone-100">
          <div
            className={clsx(
              'h-full rounded-full',
              storageEstimate.percent > 80 ? 'bg-red-500' : 'bg-[var(--accent)]',
            )}
            style={{ width: `${Math.min(100, storageEstimate.percent)}%` }}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric label="Phone used" value={formatBytes(storageEstimate.used)} />
          <Metric label="Phone limit" value={storageEstimate.quota ? formatBytes(storageEstimate.quota) : 'Unknown'} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric label="Shared clips" value={`${serverClips.length}`} />
          <Metric
            label="Laptop used"
            value={formatBytes(serverClips.reduce((total, clip) => total + clip.size, 0))}
          />
        </div>
      </section>

      <section className="space-y-3">
        {serverClips.length ? (
          <>
            <div className="px-1">
              <h2 className="text-lg font-semibold text-stone-950">Shared clips</h2>
              <p className="text-sm text-stone-500">Available to devices connected to this server.</p>
            </div>
            {serverClips.map((clip) => (
              <ServerClipCard
                key={clip.id}
                clip={clip}
                roomId={roomId}
                onDelete={onServerClipDelete}
              />
            ))}
          </>
        ) : null}

        {clips.length ? (
          <>
            <div className="px-1 pt-2">
              <h2 className="text-lg font-semibold text-stone-950">This device</h2>
              <p className="text-sm text-stone-500">Phone-local backup copies.</p>
            </div>
            {clips.map((clip) => (
              <ClipCard key={clip.id} clip={clip} onDelete={onClipDelete} />
            ))}
          </>
        ) : serverClips.length ? null : (
          <EmptyState
            Icon={Video}
            title="No clips yet"
            body={
              savedEvents.length
                ? 'Saved clip metadata exists, but no playable clip has synced here yet.'
                : 'Armed motion recordings appear here.'
            }
          />
        )}
      </section>
    </div>
  )
}

function SettingsPanel({
  connected,
  roomId,
  recorderUrl,
  settings,
  serverInfo,
  onSettingsChange,
}: {
  connected: boolean
  roomId: string
  recorderUrl: string
  settings: RecorderSettings
  serverInfo: ServerInfo | null
  onSettingsChange: (settings: RecorderSettings) => void
}) {
  const [copied, setCopied] = useState(false)
  const [copiedStorage, setCopiedStorage] = useState(false)
  const clipStoragePath = serverInfo?.clipStoragePath ?? 'Starting server...'
  const submitRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(recorderUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const copyStoragePath = async () => {
    await navigator.clipboard.writeText(clipStoragePath)
    setCopiedStorage(true)
    window.setTimeout(() => setCopiedStorage(false), 1200)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={panelClass}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-stone-950">Room defaults</h2>
          <Settings size={22} className="text-stone-400" />
        </div>
        <div className="space-y-5">
          <ToggleRow
            title="Armed"
            body="Recorder raises alerts when motion crosses the threshold."
            checked={settings.armed}
            onChange={(armed) => onSettingsChange(normalizeSettings({ ...settings, armed }))}
          />
          <ToggleRow
            title="Record clips"
            body="Clips save on the phone and sync to the laptop server."
            checked={settings.recordOnMotion}
            onChange={(recordOnMotion) =>
              onSettingsChange(normalizeSettings({ ...settings, recordOnMotion }))
            }
          />
          <ToggleRow
            title="Loop pre-roll"
            body="Include buffered video from before motion starts."
            checked={settings.loopRecording}
            onChange={(loopRecording) =>
              onSettingsChange(normalizeSettings({ ...settings, loopRecording }))
            }
          />
          <RangeControl
            label="Sensitivity"
            value={settings.sensitivity}
            min={1}
            max={100}
            suffix="%"
            onChange={(sensitivity) =>
              onSettingsChange(normalizeSettings({ ...settings, sensitivity }))
            }
          />
          <RangeControl
            label="Pre-roll"
            value={settings.preRollSeconds}
            min={0}
            max={60}
            suffix="s"
            onChange={(preRollSeconds) =>
              onSettingsChange(normalizeSettings({ ...settings, preRollSeconds }))
            }
          />
          <RangeControl
            label="After motion"
            value={settings.postMotionSeconds}
            min={2}
            max={120}
            suffix="s"
            onChange={(postMotionSeconds) =>
              onSettingsChange(normalizeSettings({ ...settings, postMotionSeconds }))
            }
          />
          <RangeControl
            label="Max clip"
            value={settings.maxClipSeconds}
            min={30}
            max={600}
            suffix="s"
            onChange={(maxClipSeconds) =>
              onSettingsChange(normalizeSettings({ ...settings, maxClipSeconds }))
            }
          />
        </div>
      </section>

      <section className={panelClass}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">Local server</h2>
            <p className="text-sm text-stone-500">{connected ? 'Connected' : 'Reconnecting'}</p>
          </div>
          <Home size={22} className="text-stone-400" />
        </div>
        <form className="space-y-3" onSubmit={submitRoom}>
          <input className={inputClass} value={roomId} readOnly aria-label="Room id" />
          <button
            type="button"
            onClick={() => void copyLink()}
            className="pressable flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-3 text-sm font-semibold text-white"
          >
            <Copy size={17} />
            {copied ? 'Copied' : 'Copy phone link'}
          </button>
        </form>
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
            Clip folder
          </p>
          <input
            className={inputClass}
            value={clipStoragePath}
            readOnly
            aria-label="Clip storage folder"
          />
          <button
            type="button"
            onClick={() => void copyStoragePath()}
            className="pressable flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-100 px-5 py-3 text-sm font-semibold text-stone-700"
          >
            <Copy size={17} />
            {copiedStorage ? 'Copied' : 'Copy folder'}
          </button>
          {(serverInfo?.lanUrls ?? []).map((url) => (
            <p key={url} className="truncate rounded-2xl bg-stone-100 px-4 py-3 text-sm font-semibold text-stone-600">
              {url}
            </p>
          ))}
        </div>
      </section>
    </div>
  )
}

function useLocalSocket({
  roomId,
  deviceId,
  role,
  onSettings,
  onDevices,
  onEvents,
  onClips,
  onEvent,
  onSignal,
}: {
  roomId: string
  deviceId: string
  role: DeviceRole
  onSettings: (settings: RecorderSettings) => void
  onDevices: (devices: MotionCueDevice[]) => void
  onEvents: (events: MotionCueEvent[]) => void
  onClips: (clips: ServerClip[]) => void
  onEvent: (event: MotionCueEvent) => void
  onSignal: (signal: SignalEnvelope) => void
}) {
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const [connected, setConnected] = useState(false)
  const [serverError, setServerError] = useState('')
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const serverReady = Boolean(serverInfo)

  useEffect(() => {
    let cancelled = false

    void fetch('/motioncue-server.json', { cache: 'no-store' })
      .then((response) => {
        const contentType = response.headers.get('content-type') ?? ''

        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error('Local server manifest unavailable.')
        }

        return response.json() as Promise<ServerInfo>
      })
      .then((info) => {
        if (!cancelled) {
          setServerInfo(info)
          setServerError('')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setServerError(error instanceof Error ? error.message : 'Local server unavailable.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!serverReady) {
      return
    }

    let cancelled = false

    const scheduleReconnect = () => {
      if (cancelled) {
        return
      }

      const delay = Math.min(12000, 1200 * 2 ** reconnectAttemptRef.current)
      reconnectAttemptRef.current += 1
      reconnectTimerRef.current = window.setTimeout(connect, delay)
    }

    const connect = () => {
      if (cancelled) {
        return
      }

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const params = new URLSearchParams({
        roomId,
        deviceId,
        role,
        name: getDeviceName(role),
      })
      const socket = new WebSocket(`${protocol}://${window.location.host}/signal?${params}`)
      socketRef.current = socket

      socket.onopen = () => {
        reconnectAttemptRef.current = 0
        setConnected(true)
        setServerError('')
        sendMessage(socket, { type: 'presence', roomId })
      }
      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null
        }
        setConnected(false)
        scheduleReconnect()
      }
      socket.onerror = () => {
        setServerError('Local server connection failed.')
      }
      socket.onmessage = (event) => {
        const message = parseServerMessage(event.data)

        if (!message || message.roomId !== roomId) {
          return
        }

        if (message.type === 'server-hello' || message.type === 'room-state') {
          onSettings(normalizeSettings(message.settings))
          onDevices(message.devices)
          onEvents(message.events)
          onClips(message.clips ?? [])

          if (message.preferredJoinUrl || message.lanUrls || message.localUrls) {
            const nextServerInfo = {
              preferredJoinUrl: message.preferredJoinUrl ?? window.location.origin,
              lanUrls: message.lanUrls ?? [],
              localUrls: message.localUrls ?? [window.location.origin],
              clipStoragePath: message.clipStoragePath ?? '',
            }
            setServerInfo((current) =>
              serverInfoMatches(current, nextServerInfo) ? current : nextServerInfo,
            )
          }
          return
        }

        if (message.type === 'settings') {
          onSettings(normalizeSettings(message.settings))
          return
        }

        if (message.type === 'event') {
          onEvent(message.event)
          return
        }

        if (message.type === 'signal') {
          onSignal({ ...message, id: createId('sig') })
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      socketRef.current?.close()
    }
  }, [
    deviceId,
    onClips,
    onDevices,
    onEvent,
    onEvents,
    onSettings,
    onSignal,
    role,
    roomId,
    serverReady,
  ])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const socket = socketRef.current

      if (socket?.readyState === WebSocket.OPEN) {
        sendMessage(socket, { type: 'presence', roomId })
      }
    }, 20000)

    return () => window.clearInterval(interval)
  }, [roomId])

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false
    }

    sendMessage(socket, message)
    return true
  }, [])

  return {
    connected,
    serverError,
    serverInfo,
    send,
  }
}

function DeviceStrip({
  recorderOnline,
  monitorOnline,
  devices,
}: {
  recorderOnline: boolean
  monitorOnline: boolean
  devices: MotionCueDevice[]
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <DeviceCard
        Icon={Monitor}
        title="Laptop monitor"
        online={monitorOnline}
        detail={latestDeviceText(devices, 'monitor')}
      />
      <DeviceCard
        Icon={Smartphone}
        title="Phone recorder"
        online={recorderOnline}
        detail={latestDeviceText(devices, 'recorder')}
      />
    </section>
  )
}

function DeviceCard({
  Icon,
  title,
  online,
  detail,
}: {
  Icon: LucideIcon
  title: string
  online: boolean
  detail: string
}) {
  return (
    <article className={panelClass}>
      <div className="flex items-center gap-3">
        <div
          className={clsx(
            'grid size-12 place-items-center rounded-2xl',
            online ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500',
          )}
        >
          <Icon size={23} />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-stone-950">{title}</h2>
          <p className="truncate text-sm text-stone-500">{detail}</p>
        </div>
        <div className="ml-auto text-stone-400">
          {online ? <Wifi size={20} /> : <WifiOff size={20} />}
        </div>
      </div>
    </article>
  )
}

function EventList({ events }: { events: MotionCueEvent[] }) {
  if (!events.length) {
    return <EmptyState Icon={Bell} title="No motion yet" body="Motion events appear here while the recorder is armed." />
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <article
          key={event.id}
          className={clsx(
            'rounded-[24px] border bg-white p-3 shadow-sm',
            isUnreadMotionAlert(event) ? 'border-red-200' : 'border-white',
          )}
        >
          <div className="flex gap-3">
            <div
              className={clsx(
                'grid size-11 shrink-0 place-items-center rounded-2xl',
                event.type === 'motion'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-emerald-50 text-emerald-700',
              )}
            >
              {event.type === 'motion' ? <Bell size={20} /> : <Video size={20} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-950">{event.message}</p>
              <p className="mt-1 text-xs text-stone-500">{formatDate(event.createdAt)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {event.score !== null ? <SmallPill label={`Score ${event.score}`} /> : null}
                {event.size ? <SmallPill label={formatBytes(event.size)} /> : null}
                {event.durationMs ? <SmallPill label={`${Math.round(event.durationMs / 1000)}s`} /> : null}
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

function ClipCard({
  clip,
  onDelete,
}: {
  clip: LocalClip
  onDelete: (clipId: string) => void
}) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const nextUrl = URL.createObjectURL(clip.blob)
    setUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [clip.blob])

  return (
    <article className={panelClass}>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <video
          src={url}
          controls
          playsInline
          className="aspect-video w-full rounded-2xl bg-stone-950 object-contain"
        />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-stone-950">{formatDate(clip.startedAt)}</h2>
          <p className="mt-1 text-sm text-stone-500">
            {Math.round(clip.durationMs / 1000)}s / {formatBytes(clip.size)}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => exportClip(clip)}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white"
            >
              <Download size={17} />
              Export
            </button>
            <button
              type="button"
              onClick={() => onDelete(clip.id)}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
            >
              <Trash2 size={17} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function ServerClipCard({
  clip,
  roomId,
  onDelete,
}: {
  clip: ServerClip
  roomId: string
  onDelete: (clipId: string) => void
}) {
  const clipUrl = serverClipUrl(roomId, clip.id)

  return (
    <article className={panelClass}>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <video
          src={clipUrl}
          controls
          playsInline
          className="aspect-video w-full rounded-2xl bg-stone-950 object-contain"
        />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-stone-950">{formatDate(clip.startedAt)}</h2>
          <p className="mt-1 text-sm text-stone-500">
            {Math.round(clip.durationMs / 1000)}s / {formatBytes(clip.size)}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <a
              href={clipUrl}
              download={`motioncue-${clip.startedAt.replaceAll(':', '-')}.webm`}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white"
            >
              <Download size={17} />
              Export
            </a>
            <button
              type="button"
              onClick={() => onDelete(clip.id)}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
            >
              <Trash2 size={17} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function BottomNav({
  view,
  unreadCount,
  onViewChange,
}: {
  view: AppView
  unreadCount: number
  onViewChange: (view: AppView) => void
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/92 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur-xl">
      <div className="mx-auto grid max-w-[560px] grid-cols-4 gap-1 rounded-[24px] bg-stone-100 p-1">
        {viewTabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onViewChange(id)}
            className={clsx(
              'pressable relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-[20px] px-2 py-2 text-xs font-semibold',
              view === id ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-500',
            )}
          >
            <Icon size={20} />
            <span className="truncate">{label}</span>
            {id === 'monitor' && unreadCount ? (
              <span className="absolute right-2 top-1 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                {unreadCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  )
}

function ServerRequiredScreen() {
  const [copied, setCopied] = useState(false)
  const startCommands = 'cd /d "C:\\Users\\labar\\Downloads\\Codex Only\\MotionCue"\nnpm run local'

  const copyCommands = async () => {
    await navigator.clipboard.writeText(startCommands)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <main className="motioncue-shell grid min-h-svh place-items-center px-5 py-10 text-stone-950">
      <section className="w-full max-w-[430px] rounded-[28px] border border-white bg-white p-5 shadow-xl">
        <div className="grid size-14 place-items-center rounded-3xl bg-emerald-50 text-emerald-700">
          <Home size={26} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold">Start MotionCue Local</h1>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          Run the local server on the laptop, then open the laptop URL it prints.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-stone-950 px-4 py-3 text-sm font-semibold text-white">
          <code>{startCommands}</code>
        </pre>
        <button
          type="button"
          onClick={() => void copyCommands()}
          className="pressable mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
        >
          <Copy size={17} />
          {copied ? 'Copied' : 'Copy cmd lines'}
        </button>
      </section>
    </main>
  )
}

function ZoneGrid({
  zones,
  onChange,
}: {
  zones: boolean[]
  onChange: (zones: boolean[]) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-700">Motion zones</p>
        <button
          type="button"
          onClick={() => onChange(Array.from({ length: 9 }, () => true))}
          className="pressable rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600"
        >
          All
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {zones.map((enabled, index) => (
          <button
            key={index}
            type="button"
            onClick={() => {
              const nextZones = [...zones]
              nextZones[index] = !enabled
              onChange(nextZones)
            }}
            className={clsx(
              'pressable aspect-[1.35] rounded-2xl border text-sm font-bold',
              enabled
                ? 'border-[var(--accent)] bg-emerald-50 text-emerald-700'
                : 'border-stone-200 bg-stone-100 text-stone-400',
            )}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

function RangeControl({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        <span>{label}</span>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600">
          {value}
          {suffix}
        </span>
      </div>
      <input
        className="range-accent w-full"
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-stone-700">{label}</p>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={clsx(
              'pressable rounded-xl px-3 py-2 text-sm font-semibold',
              value === option.value ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-500',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ToggleRow({
  title,
  body,
  checked,
  onChange,
}: {
  title: string
  body: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="pressable flex w-full items-center justify-between gap-4 rounded-2xl bg-stone-50 px-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-stone-950">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-stone-500">{body}</span>
      </span>
      <span
        className={clsx(
          'grid size-10 shrink-0 place-items-center rounded-full',
          checked ? 'bg-[var(--accent)] text-white' : 'bg-stone-200 text-stone-400',
        )}
      >
        {checked ? <Eye size={18} /> : <X size={18} />}
      </span>
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-stone-100 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">{label}</p>
      <p className="mt-1 truncate text-base font-semibold text-stone-950">{value}</p>
    </div>
  )
}

function StatusPill({
  label,
  tone,
  title,
}: {
  label: string
  tone: 'ok' | 'warn'
  title?: string
}) {
  return (
    <div
      title={title || label}
      className={clsx(
        'flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold shadow-sm',
        tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      )}
    >
      <span className="size-2 rounded-full bg-current" />
      <span className="max-w-40 truncate">{label}</span>
    </div>
  )
}

function SmallPill({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-500">
      {label}
    </span>
  )
}

function EmptyState({
  Icon,
  title,
  body,
}: {
  Icon: LucideIcon
  title: string
  body: string
}) {
  return (
    <section className={clsx(panelClass, 'text-center')}>
      <div className="mx-auto grid size-14 place-items-center rounded-3xl bg-stone-100 text-stone-500">
        <Icon size={26} />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-stone-500">{body}</p>
    </section>
  )
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.section>
  )
}

function useMotionNotifications(events: MotionCueEvent[], view: AppView) {
  const notifiedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (view !== 'monitor' || !('Notification' in window)) {
      return
    }

    if (Notification.permission !== 'granted') {
      return
    }

    events
      .filter((event) => event.type === 'motion')
      .filter((event) => Date.now() - new Date(event.createdAt).getTime() < 15000)
      .filter((event) => !notifiedIdsRef.current.has(event.id))
      .forEach((event) => {
        notifiedIdsRef.current.add(event.id)
        new Notification('MotionCue', {
          body: event.message,
          tag: event.id,
          silent: false,
        })
      })
  }, [events, view])
}

function getInitialState(): { roomId: string; view: AppView; role: DeviceRole } {
  const params = new URLSearchParams(window.location.search)
  const urlRoomId = params.get('room')
  const storedRoomId = window.localStorage.getItem('motioncue.localRoomId')
  const storedRole = window.localStorage.getItem('motioncue.localRole')
  const roomId = urlRoomId || storedRoomId || createId('room')
  const mode = params.get('mode')
  const view: AppView =
    mode === 'recorder' || mode === 'clips' || mode === 'settings' ? mode : 'monitor'
  const role: DeviceRole =
    view === 'recorder' || view === 'monitor'
      ? view
      : storedRole === 'recorder'
        ? 'recorder'
        : 'monitor'

  window.localStorage.setItem('motioncue.localRoomId', roomId)
  window.localStorage.setItem('motioncue.localRole', role)
  return { roomId, view, role }
}

function replaceLocalUrl(roomId: string, view: AppView) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomId)
  url.searchParams.set('mode', view)
  window.history.replaceState({}, '', url)
}

function buildRecorderUrl(serverInfo: ServerInfo | null, roomId: string) {
  const base = serverInfo?.preferredJoinUrl || window.location.origin
  const url = new URL(base)
  url.searchParams.set('room', roomId)
  url.searchParams.set('mode', 'recorder')
  return url.toString()
}

function sendMessage(socket: WebSocket, message: ClientMessage) {
  socket.send(JSON.stringify(message))
}

async function uploadServerClip(roomId: string, clip: LocalClip) {
  const params = new URLSearchParams({
    eventId: clip.eventId,
    deviceId: clip.deviceId,
    startedAt: clip.startedAt,
    endedAt: clip.endedAt,
    durationMs: String(clip.durationMs),
  })
  const response = await fetch(`${serverClipUrl(roomId, clip.id)}?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': clip.mimeType || 'video/webm',
    },
    body: clip.blob,
  })

  if (!response.ok) {
    throw new Error('Could not upload shared clip.')
  }

  const data = (await response.json()) as { clip: ServerClip }
  return data.clip
}

async function deleteServerClip(roomId: string, clipId: string) {
  const response = await fetch(serverClipUrl(roomId, clipId), {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error('Could not delete shared clip.')
  }
}

function serverClipUrl(roomId: string, clipId: string) {
  return `/api/rooms/${encodeURIComponent(roomId)}/clips/${encodeURIComponent(clipId)}`
}

function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') {
    return null
  }

  try {
    return JSON.parse(raw) as ServerMessage
  } catch {
    return null
  }
}

function serverInfoMatches(left: ServerInfo | null, right: ServerInfo) {
  if (!left) {
    return false
  }

  return (
    left.preferredJoinUrl === right.preferredJoinUrl &&
    left.clipStoragePath === right.clipStoragePath &&
    left.lanUrls.join('|') === right.lanUrls.join('|') &&
    left.localUrls.join('|') === right.localUrls.join('|')
  )
}

function getDeviceName(role: DeviceRole) {
  const platform = navigator.userAgent.includes('Mobile') ? 'Phone' : 'Laptop'
  return `${platform} ${role}`
}

function isDeviceOnline(device: MotionCueDevice) {
  return device.online && Date.now() - new Date(device.lastSeenAt).getTime() < 90000
}

function latestDeviceText(devices: MotionCueDevice[], role: DeviceRole) {
  const device = devices
    .filter((entry) => entry.role === role)
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())[0]

  if (!device) {
    return 'Waiting'
  }

  return isDeviceOnline(device) ? 'Online now' : `Last seen ${formatDate(device.lastSeenAt)}`
}

function personStatusText(result: PersonDetectionResult) {
  if (result.status === 'loading') {
    return 'Loading local person detector.'
  }

  if (!result.supported) {
    return 'Person detector unavailable here; using motion as fallback.'
  }

  if (result.detected) {
    return `Person in frame (${Math.round(result.score * 100)}%).`
  }

  return 'Person filter ready.'
}

function shortRoom(roomId: string) {
  return roomId.replace(/^room_/, '').slice(0, 8)
}

function formatDate(value: string) {
  const date = new Date(value)

  if (!Number.isFinite(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
