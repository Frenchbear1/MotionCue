import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  Activity,
  Bell,
  Camera,
  Check,
  ChevronLeft,
  CircleStop,
  Copy,
  Download,
  Eye,
  Home,
  Loader2,
  LogOut,
  Monitor,
  Play,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  UserRound,
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
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type FormEvent,
  type MutableRefObject,
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
import { exportClip } from './services/clips'
import { createMotionCueRepository, type MotionCueRepository } from './services/repository'
import { chooseRecordingMimeType, createPeerConnection, toSignalingDescription } from './services/webrtc'
import { useAuthSession } from './hooks/useAuthSession'
import { useDeviceId } from './hooks/useDeviceId'
import { useLocalClips } from './hooks/useLocalClips'
import type {
  DeviceRole,
  IceCandidateDoc,
  LocalClip,
  MotionCueDevice,
  MotionCueEvent,
  MotionCueRoom,
  RecorderSettings,
  SessionUser,
  SignalingConnection,
} from './types'

type AppView = 'rooms' | 'monitor' | 'recorder' | 'clips' | 'settings'

const inputClass =
  'min-w-0 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-[var(--accent)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]'

const panelClass = 'rounded-[28px] border border-white bg-white p-4 shadow-sm'

const viewTabs: Array<{ id: AppView; label: string; Icon: LucideIcon }> = [
  { id: 'monitor', label: 'Monitor', Icon: Monitor },
  { id: 'recorder', label: 'Recorder', Icon: Smartphone },
  { id: 'clips', label: 'Clips', Icon: Video },
  { id: 'settings', label: 'Settings', Icon: Settings },
]

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

function App() {
  const {
    session,
    isReady,
    error,
    isFirebaseConfigured,
    signIn,
    signInEmail,
    createEmailAccount,
    signOut,
  } = useAuthSession()
  const repository = useMemo(() => createMotionCueRepository(), [])
  const deviceId = useDeviceId()
  const urlState = useMemo(() => getUrlState(), [])
  const [rooms, setRooms] = useState<MotionCueRoom[]>([])
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(urlState.roomId)
  const [roomSnapshot, setRoomSnapshot] = useState<MotionCueRoom | null>(null)
  const [devices, setDevices] = useState<MotionCueDevice[]>([])
  const [events, setEvents] = useState<MotionCueEvent[]>([])
  const [connections, setConnections] = useState<SignalingConnection[]>([])
  const [view, setView] = useState<AppView>(urlState.view)
  const [syncState, setSyncState] = useState<'loading' | 'synced' | 'error'>('loading')
  const [syncMessage, setSyncMessage] = useState('')
  const activeRoom = useMemo(
    () => roomSnapshot ?? rooms.find((room) => room.id === selectedRoomId) ?? null,
    [roomSnapshot, rooms, selectedRoomId],
  )
  const activeRoomId = activeRoom?.id ?? null
  const localClips = useLocalClips(activeRoom?.id ?? null)
  const {
    clips,
    estimate: storageEstimate,
    addClip,
    removeClip,
  } = localClips

  const setSyncError = useCallback((message: string) => {
    setSyncState('error')
    setSyncMessage(message)
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', '#2f8f7a')
    document.documentElement.style.colorScheme = 'light'
  }, [])

  useEffect(() => {
    if (!session) {
      setRooms([])
      return
    }

    setSyncState('loading')
    return repository.subscribeRooms(
      session.uid,
      (nextRooms) => {
        setRooms(nextRooms)
        setSyncState('synced')
        setSyncMessage('')
      },
      (message) => {
        setSyncState('error')
        setSyncMessage(message)
      },
    )
  }, [repository, session])

  useEffect(() => {
    if (!session || !selectedRoomId) {
      setRoomSnapshot(null)
      setDevices([])
      setEvents([])
      setConnections([])
      return
    }

    const unsubscribes = [
      repository.subscribeRoom(
        session.uid,
        selectedRoomId,
        setRoomSnapshot,
        (message) => setSyncError(message),
      ),
      repository.subscribeDevices(
        session.uid,
        selectedRoomId,
        setDevices,
        (message) => setSyncError(message),
      ),
      repository.subscribeEvents(
        session.uid,
        selectedRoomId,
        setEvents,
        (message) => setSyncError(message),
      ),
      repository.subscribeConnections(
        session.uid,
        selectedRoomId,
        setConnections,
        (message) => setSyncError(message),
      ),
    ]

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [repository, selectedRoomId, session, setSyncError])

  useEffect(() => {
    if (!activeRoom || view === 'rooms') {
      return
    }

    replaceUrlState(activeRoom.id, view)
  }, [activeRoom, view])

  const createRoom = useCallback(
    async (name: string) => {
      if (!session) {
        return
      }

      const timestamp = nowIso()
      const room: MotionCueRoom = {
        id: createId('room'),
        ownerId: session.uid,
        name: name.trim() || 'Home camera',
        settings: defaultSettings,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      setSelectedRoomId(room.id)
      setView('monitor')
      setRoomSnapshot(room)
      try {
        await repository.saveRoom(session.uid, room)
      } catch (saveError) {
        setSyncError(formatUnknownError(saveError, 'Could not save room.'))
      }
    },
    [repository, session, setSyncError],
  )

  const updateSettings = useCallback(
    async (settings: RecorderSettings) => {
      if (!activeRoom || !session) {
        return
      }

      const nextSettings = normalizeSettings(settings)
      const updatedAt = nowIso()
      setRoomSnapshot({ ...activeRoom, settings: nextSettings, updatedAt })
      try {
        await repository.saveSettings(session.uid, activeRoom.id, nextSettings, updatedAt)
      } catch (saveError) {
        setSyncError(formatUnknownError(saveError, 'Could not save settings.'))
      }
    },
    [activeRoom, repository, session, setSyncError],
  )

  const saveEvent = useCallback(
    async (event: MotionCueEvent) => {
      if (!session) {
        return
      }

      setEvents((current) => [event, ...current.filter((entry) => entry.id !== event.id)])
      try {
        await repository.saveEvent(session.uid, event.roomId, event)
      } catch (saveError) {
        setSyncError(formatUnknownError(saveError, 'Could not save event.'))
      }
    },
    [repository, session, setSyncError],
  )

  const touchDevice = useCallback(
    async (role: DeviceRole, online = true) => {
      if (!activeRoomId || !session) {
        return
      }

      const timestamp = nowIso()
      const device: MotionCueDevice = {
        id: deviceId,
        roomId: activeRoomId,
        role,
        name: getDeviceName(role),
        userAgent: navigator.userAgent,
        online,
        lastSeenAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      try {
        await repository.upsertDevice(session.uid, activeRoomId, device)
      } catch (saveError) {
        setSyncError(formatUnknownError(saveError, 'Could not update device presence.'))
      }
    },
    [activeRoomId, deviceId, repository, session, setSyncError],
  )

  const markAlertsRead = useCallback(async () => {
    if (!activeRoom || !session) {
      return
    }

    const unreadIds = events.filter(isUnreadMotionAlert).map((event) => event.id)

    if (!unreadIds.length) {
      return
    }

    const readAt = nowIso()
    setEvents((current) =>
      current.map((event) => (unreadIds.includes(event.id) ? { ...event, readAt } : event)),
    )
    try {
      await repository.markEventsRead(session.uid, activeRoom.id, unreadIds, readAt)
    } catch (saveError) {
      setSyncError(formatUnknownError(saveError, 'Could not mark alerts read.'))
    }
  }, [activeRoom, events, repository, session, setSyncError])

  useMotionNotifications(activeRoom, events, view)

  const handleClipSaved = useCallback(
    (clip: LocalClip) => {
      void addClip(clip)
    },
    [addClip],
  )

  const handleClipDelete = useCallback(
    (clipId: string) => {
      void removeClip(clipId)
    },
    [removeClip],
  )

  const handleSaveEvent = useCallback(
    (event: MotionCueEvent) => {
      void saveEvent(event)
    },
    [saveEvent],
  )

  const handleTouchDevice = useCallback(
    (role: DeviceRole, online?: boolean) => {
      void touchDevice(role, online)
    },
    [touchDevice],
  )

  const handleSettingsChange = useCallback(
    (settings: RecorderSettings) => {
      void updateSettings(settings)
    },
    [updateSettings],
  )

  const handleMarkAlertsRead = useCallback(() => {
    void markAlertsRead()
  }, [markAlertsRead])

  if (!isReady) {
    return <LoadingScreen label="Opening MotionCue" />
  }

  if (!session) {
    return (
      <AuthScreen
        error={error}
        isConfigured={isFirebaseConfigured}
        onGoogleSignIn={() => void signIn()}
        onEmailSignIn={(email, password) => void signInEmail(email, password)}
        onEmailSignUp={(email, password) => void createEmailAccount(email, password)}
      />
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="motioncue-shell min-h-svh text-stone-950">
        <div className="mx-auto min-h-svh max-w-[1180px] pb-[calc(env(safe-area-inset-bottom)+6.5rem)]">
          {!activeRoom || view === 'rooms' ? (
            <RoomsScreen
              rooms={rooms}
              session={session}
              syncState={syncState}
              syncMessage={syncMessage}
              onCreate={(name) => void createRoom(name)}
              onOpen={(room, nextView) => {
                setSelectedRoomId(room.id)
                setRoomSnapshot(room)
                setView(nextView)
              }}
              onSignOut={() => void signOut()}
            />
          ) : (
            <AppErrorBoundary onReset={() => window.location.reload()}>
              <Workspace
                room={activeRoom}
                rooms={rooms}
                session={session}
                repository={repository}
                deviceId={deviceId}
                devices={devices}
                events={events}
                connections={connections}
                view={view}
                syncState={syncState}
                syncMessage={syncMessage}
                clips={clips}
                storageEstimate={storageEstimate}
                onClipSaved={handleClipSaved}
                onClipDelete={handleClipDelete}
                onSaveEvent={handleSaveEvent}
                onTouchDevice={handleTouchDevice}
                onViewChange={setView}
                onBack={() => {
                  setSelectedRoomId(null)
                  setRoomSnapshot(null)
                  setView('rooms')
                  replaceUrlState(null, 'rooms')
                }}
                onSettingsChange={handleSettingsChange}
                onMarkAlertsRead={handleMarkAlertsRead}
              />
            </AppErrorBoundary>
          )}
        </div>
      </div>
    </MotionConfig>
  )
}

class AppErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { message: string }
> {
  state = { message: '' }

  static getDerivedStateFromError(error: unknown) {
    return {
      message: formatUnknownError(error, 'The room view crashed.'),
    }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('MotionCue room error', error, errorInfo)
  }

  render() {
    if (this.state.message) {
      return (
        <main className="grid min-h-[70svh] place-items-center px-5 py-10">
          <section className="w-full max-w-[430px] rounded-[28px] border border-white bg-white p-5 text-center shadow-xl">
            <div className="mx-auto grid size-14 place-items-center rounded-3xl bg-red-50 text-red-700">
              <WifiOff size={26} />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-stone-950">Room needs a refresh</h1>
            <p className="mt-2 text-sm leading-6 text-stone-500">{this.state.message}</p>
            <button
              type="button"
              onClick={this.props.onReset}
              className="pressable mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-4 text-sm font-semibold text-white"
            >
              <RefreshCw size={17} />
              Refresh MotionCue
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

function RoomsScreen({
  rooms,
  session,
  syncState,
  syncMessage,
  onCreate,
  onOpen,
  onSignOut,
}: {
  rooms: MotionCueRoom[]
  session: SessionUser
  syncState: 'loading' | 'synced' | 'error'
  syncMessage: string
  onCreate: (name: string) => void
  onOpen: (room: MotionCueRoom, view: AppView) => void
  onSignOut: () => void
}) {
  const [name, setName] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onCreate(name)
    setName('')
  }

  return (
    <main className="px-5 pt-[calc(env(safe-area-inset-top)+1rem)] lg:px-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
            MotionCue
          </p>
          <h1 className="truncate text-3xl font-semibold text-stone-950 sm:text-4xl">
            Camera rooms
          </h1>
        </div>
        <IconButton title="Sign out" onClick={onSignOut}>
          <LogOut size={20} />
        </IconButton>
      </header>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <section className={panelClass}>
          <div className="mb-5 flex items-center gap-3">
            <div className="grid size-14 place-items-center rounded-3xl bg-stone-950 text-white">
              <ShieldCheck size={26} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-stone-950">Create a room</h2>
              <p className="text-sm text-stone-500">
                Pair a laptop monitor and phone recorder in one calm flow.
              </p>
            </div>
          </div>
          <form className="space-y-3" onSubmit={submit}>
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Front door, garage, nursery"
            />
            <button
              type="submit"
              className="pressable flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 py-4 text-base font-semibold text-white shadow-lg"
            >
              <Plus size={19} />
              Create room
            </button>
          </form>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-stone-100 px-4 py-3 text-sm">
            <span className="font-semibold text-stone-600">{session.email || session.displayName}</span>
            <StatusPill
              tone={syncState === 'error' ? 'warn' : 'ok'}
              label={syncState === 'error' ? 'Offline' : 'Synced'}
              title={syncMessage}
            />
          </div>
        </section>

        <section className="space-y-3">
          {rooms.length ? (
            rooms.map((room) => (
              <article key={room.id} className={clsx(panelClass, 'p-3')}>
                <button
                  type="button"
                  onClick={() => onOpen(room, 'monitor')}
                  className="pressable flex w-full min-w-0 items-center gap-4 rounded-[22px] p-2 text-left hover:bg-stone-50"
                >
                  <div className="grid size-16 shrink-0 place-items-center rounded-3xl bg-emerald-50 text-emerald-700">
                    <Camera size={28} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-lg font-semibold text-stone-950">{room.name}</h2>
                    <p className="text-sm text-stone-500">{formatDate(room.updatedAt)}</p>
                  </div>
                  <StatusPill label={room.settings.armed ? 'Armed' : 'Idle'} tone="ok" />
                </button>
              </article>
            ))
          ) : (
            <EmptyState
              Icon={Camera}
              title="No rooms yet"
              body="Create one room, show the QR code on your laptop, then open it with your phone."
            />
          )}
        </section>
      </div>
    </main>
  )
}

function Workspace({
  room,
  rooms,
  session,
  repository,
  deviceId,
  devices,
  events,
  connections,
  view,
  syncState,
  syncMessage,
  clips,
  storageEstimate,
  onClipSaved,
  onClipDelete,
  onSaveEvent,
  onTouchDevice,
  onViewChange,
  onBack,
  onSettingsChange,
  onMarkAlertsRead,
}: {
  room: MotionCueRoom
  rooms: MotionCueRoom[]
  session: SessionUser
  repository: MotionCueRepository
  deviceId: string
  devices: MotionCueDevice[]
  events: MotionCueEvent[]
  connections: SignalingConnection[]
  view: AppView
  syncState: 'loading' | 'synced' | 'error'
  syncMessage: string
  clips: LocalClip[]
  storageEstimate: { used: number; quota: number; percent: number }
  onClipSaved: (clip: LocalClip) => void
  onClipDelete: (clipId: string) => void
  onSaveEvent: (event: MotionCueEvent) => void
  onTouchDevice: (role: DeviceRole, online?: boolean) => void
  onViewChange: (view: AppView) => void
  onBack: () => void
  onSettingsChange: (settings: RecorderSettings) => void
  onMarkAlertsRead: () => void
}) {
  const unreadCount = events.filter(isUnreadMotionAlert).length
  const recorderOnline = devices.some((device) => device.role === 'recorder' && isDeviceOnline(device))
  const monitorOnline = devices.some((device) => device.role === 'monitor' && isDeviceOnline(device))

  useEffect(() => {
    if (view !== 'monitor' && view !== 'recorder') {
      return
    }

    const role: DeviceRole = view
    onTouchDevice(role, true)
    const interval = window.setInterval(() => onTouchDevice(role, true), 25000)

    return () => {
      window.clearInterval(interval)
      onTouchDevice(role, false)
    }
  }, [onTouchDevice, view])

  return (
    <>
      <header className="glass-sticky sticky top-0 z-30 border-b border-stone-200/80 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+14px)] lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton title="Rooms" onClick={onBack}>
              <ChevronLeft size={20} />
            </IconButton>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                MotionCue
              </p>
              <h1 className="truncate text-2xl font-semibold text-stone-950 sm:text-3xl">
                {room.name}
              </h1>
            </div>
          </div>
          <StatusPill
            label={syncState === 'error' ? 'Offline' : 'Live'}
            tone={syncState === 'error' ? 'warn' : 'ok'}
            title={syncMessage}
          />
        </div>
      </header>

      <main className="px-5 py-5 lg:px-8">
        <AnimatePresence mode="wait">
          <PageFrame key={view}>
            {view === 'monitor' ? (
              <MonitorPanel
                room={room}
                session={session}
                repository={repository}
                deviceId={deviceId}
                connections={connections}
                recorderOnline={recorderOnline}
                monitorOnline={monitorOnline}
                events={events}
                devices={devices}
                onMarkAlertsRead={onMarkAlertsRead}
              />
            ) : null}
            {view === 'recorder' ? (
              <RecorderPanel
                room={room}
                session={session}
                repository={repository}
                deviceId={deviceId}
                connections={connections}
                onClipSaved={onClipSaved}
                onSaveEvent={onSaveEvent}
                onTouchDevice={onTouchDevice}
                onSettingsChange={onSettingsChange}
              />
            ) : null}
            {view === 'clips' ? (
              <ClipsPanel
                clips={clips}
                storageEstimate={storageEstimate}
                events={events}
                onClipDelete={onClipDelete}
              />
            ) : null}
            {view === 'settings' ? (
              <SettingsPanel
                room={room}
                rooms={rooms}
                onSettingsChange={onSettingsChange}
              />
            ) : null}
          </PageFrame>
        </AnimatePresence>
      </main>

      <BottomNav
        view={view}
        unreadCount={unreadCount}
        onViewChange={(nextView) => {
          onViewChange(nextView)
          replaceUrlState(room.id, nextView)
        }}
      />
    </>
  )
}

function MonitorPanel({
  room,
  session,
  repository,
  deviceId,
  connections,
  recorderOnline,
  monitorOnline,
  events,
  devices,
  onMarkAlertsRead,
}: {
  room: MotionCueRoom
  session: SessionUser
  repository: MotionCueRepository
  deviceId: string
  connections: SignalingConnection[]
  recorderOnline: boolean
  monitorOnline: boolean
  events: MotionCueEvent[]
  devices: MotionCueDevice[]
  onMarkAlertsRead: () => void
}) {
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const seenCandidateIdsRef = useRef<Set<string>>(new Set())
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionLabel, setConnectionLabel] = useState('Not connected')
  const [qrUrl, setQrUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState(() =>
    'Notification' in window ? Notification.permission : 'denied',
  )
  const autoStartedRef = useRef(false)
  const recorderUrl = useMemo(() => buildRecorderUrl(room.id), [room.id])
  const recentEvents = events.slice(0, 12)
  const activeConnection = useMemo(
    () =>
      connectionId
        ? connections.find((connection) => connection.id === connectionId) ?? null
        : null,
    [connectionId, connections],
  )
  const monitorButtonLabel = peerRef.current ? 'Retry stream' : 'Start monitor'

  useEffect(() => {
    void QRCode.toDataURL(recorderUrl, {
      margin: 1,
      width: 260,
      color: { dark: '#17211f', light: '#ffffff' },
    }).then(setQrUrl)
  }, [recorderUrl])

  useEffect(() => {
    if (!connectionId) {
      return
    }

    const unsubscribeConnection = repository.subscribeConnection(
      session.uid,
      room.id,
      connectionId,
      (connection) => {
        if (!connection || !connection.answer || !peerRef.current) {
          return
        }

        if (!peerRef.current.currentRemoteDescription) {
          void peerRef.current
            .setRemoteDescription(connection.answer)
            .then(() => {
              setConnectionLabel('Receiving video')
              setIsConnecting(false)
            })
            .catch((error: unknown) => {
              setConnectionLabel(formatUnknownError(error, 'Could not receive video.'))
              setIsConnecting(false)
            })
        }
      },
      setConnectionLabel,
    )
    const unsubscribeCandidates = repository.subscribeCandidates(
      session.uid,
      room.id,
      connectionId,
      (candidates) => {
        candidates
          .filter((candidate) => candidate.fromDeviceId !== deviceId)
          .filter((candidate) => !seenCandidateIdsRef.current.has(candidate.id))
          .forEach((candidate) => {
            seenCandidateIdsRef.current.add(candidate.id)
            void peerRef.current?.addIceCandidate(candidate.candidate)
          })
      },
      setConnectionLabel,
    )

    return () => {
      unsubscribeConnection()
      unsubscribeCandidates()
    }
  }, [connectionId, deviceId, repository, room.id, session.uid])

  const stopMonitor = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null
    }

    if (connectionId) {
      void repository.updateConnection(session.uid, room.id, connectionId, {
        state: 'closed',
        updatedAt: nowIso(),
      })
    }

    setConnectionId(null)
    setIsConnecting(false)
    setConnectionLabel('Not connected')
  }, [connectionId, repository, room.id, session.uid])

  const startMonitor = useCallback(async () => {
    if (isConnecting || peerRef.current) {
      return
    }

    setIsConnecting(true)
    setConnectionLabel('Opening monitor')
    seenCandidateIdsRef.current = new Set()

    const nextConnectionId = createId('conn')
    const peer = createPeerConnection()
    peerRef.current = peer
    peer.addTransceiver('video', { direction: 'recvonly' })
    peer.ontrack = (event) => {
      const stream = event.streams[0]

      if (remoteVideoRef.current && stream) {
        remoteVideoRef.current.srcObject = stream
      }
    }
    peer.oniceconnectionstatechange = () => {
      setConnectionLabel(peer.iceConnectionState)
      if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
        setIsConnecting(false)
        void repository.updateConnection(session.uid, room.id, nextConnectionId, {
          state: 'connected',
          updatedAt: nowIso(),
        })
      }

      if (peer.iceConnectionState === 'failed') {
        setIsConnecting(false)
        void repository.updateConnection(session.uid, room.id, nextConnectionId, {
          state: 'failed',
          updatedAt: nowIso(),
        })
      }

      if (peer.iceConnectionState === 'disconnected') {
        setIsConnecting(false)
      }
    }
    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        return
      }

      const candidate: IceCandidateDoc = {
        id: createId('ice'),
        connectionId: nextConnectionId,
        fromDeviceId: deviceId,
        candidate: event.candidate.toJSON(),
        createdAt: nowIso(),
      }
      void repository.addCandidate(session.uid, room.id, nextConnectionId, candidate)
    }

    const createdAt = nowIso()

    try {
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const connection: SignalingConnection = {
        id: nextConnectionId,
        roomId: room.id,
        monitorDeviceId: deviceId,
        recorderDeviceId: null,
        state: 'offer',
        offer: toSignalingDescription(peer.localDescription),
        answer: null,
        createdAt,
        updatedAt: createdAt,
      }

      setConnectionId(nextConnectionId)
      setConnectionLabel('Waiting for phone')
      setIsConnecting(false)
      void repository
        .createConnection(session.uid, room.id, connection)
        .catch((error: unknown) => {
          if (peerRef.current === peer) {
            setConnectionLabel(formatUnknownError(error, 'Could not write video signal.'))
            setIsConnecting(false)
          }
        })
    } catch (error) {
      peer.close()
      peerRef.current = null
      setIsConnecting(false)
      setConnectionLabel(formatUnknownError(error, 'Could not start monitor.'))
    }
  }, [deviceId, isConnecting, repository, room.id, session.uid])

  useEffect(() => {
    if (autoStartedRef.current || connectionId || peerRef.current) {
      return
    }

    autoStartedRef.current = true
    void startMonitor()
  }, [connectionId, startMonitor])

  useEffect(() => {
    if (!activeConnection || !peerRef.current) {
      return
    }

    if (activeConnection.state === 'closed' || activeConnection.state === 'failed') {
      peerRef.current.close()
      peerRef.current = null
      setConnectionId(null)
      setIsConnecting(false)
      setConnectionLabel(activeConnection.state)
    }
  }, [activeConnection])

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
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <StatusPill
              label={connectionLabel}
              tone={connectionId ? 'ok' : 'warn'}
            />
            {room.settings.armed ? <StatusPill label="Armed" tone="ok" /> : null}
          </div>
          <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                stopMonitor()
                window.setTimeout(() => void startMonitor(), 0)
              }}
              disabled={isConnecting}
              className="pressable flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-stone-950 shadow-lg disabled:opacity-60"
            >
              {isConnecting ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
              {isConnecting ? 'Opening' : monitorButtonLabel}
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
          recorderOnline={recorderOnline}
          monitorOnline={monitorOnline}
          devices={devices}
        />
      </section>

      <aside className="min-w-0 space-y-5">
        <section className={panelClass}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-stone-950">Phone pairing</h2>
              <p className="text-sm text-stone-500">Scan this on the phone that records.</p>
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
            {copied ? 'Copied' : 'Copy recorder link'}
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
  room,
  session,
  repository,
  deviceId,
  connections,
  onClipSaved,
  onSaveEvent,
  onTouchDevice,
  onSettingsChange,
}: {
  room: MotionCueRoom
  session: SessionUser
  repository: MotionCueRepository
  deviceId: string
  connections: SignalingConnection[]
  onClipSaved: (clip: LocalClip) => void
  onSaveEvent: (event: MotionCueEvent) => void
  onTouchDevice: (role: DeviceRole, online?: boolean) => void
  onSettingsChange: (settings: RecorderSettings) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderPeerRef = useRef<RTCPeerConnection | null>(null)
  const recordingRef = useRef(false)
  const previousFrameRef = useRef<MotionFrame | null>(null)
  const lastTriggerAtRef = useRef<number | null>(null)
  const lastPersonCheckAtRef = useRef(0)
  const lastPersonResultRef = useRef<PersonDetectionResult>(idlePersonResult)
  const seenCandidateIdsRef = useRef<Set<string>>(new Set())
  const acceptingConnectionRef = useRef(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const [analysis, setAnalysis] = useState<MotionAnalysis>(emptyAnalysis)
  const [personResult, setPersonResult] = useState<PersonDetectionResult>(idlePersonResult)
  const [isRecording, setIsRecording] = useState(false)
  const [recorderConnectionId, setRecorderConnectionId] = useState<string | null>(null)
  const settings = room.settings

  const patchSettings = (patch: Partial<RecorderSettings>) => {
    onSettingsChange(normalizeSettings({ ...settings, ...patch }))
  }

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraReady(false)

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

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
      onTouchDevice('recorder', true)
      await onSaveEvent(
        buildEvent({
          roomId: room.id,
          deviceId,
          type: 'device_joined',
          message: 'Recorder camera came online.',
          createdAt: nowIso(),
        }),
      )
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Camera permission failed.')
    }
  }, [deviceId, onSaveEvent, onTouchDevice, room.id, settings.facingMode, stopCamera])

  useEffect(() => stopCamera, [stopCamera])

  useEffect(() => {
    if (!cameraReady) {
      return
    }

    onTouchDevice('recorder', true)
    const interval = window.setInterval(() => onTouchDevice('recorder', true), 10000)

    return () => window.clearInterval(interval)
  }, [cameraReady, onTouchDevice])

  useEffect(() => {
    const pending = connections.find(
      (connection) =>
        connection.state === 'offer' &&
        connection.offer &&
        !connection.answer &&
        connection.monitorDeviceId !== deviceId,
    )

    if (
      !cameraReady ||
      !pending ||
      !streamRef.current ||
      acceptingConnectionRef.current ||
      recorderConnectionId === pending.id
    ) {
      return
    }

    acceptingConnectionRef.current = true
    void acceptMonitorConnection({
      connection: pending,
      stream: streamRef.current,
      repository,
      uid: session.uid,
      roomId: room.id,
      deviceId,
      peerRef: recorderPeerRef,
      seenCandidateIdsRef,
      setRecorderConnectionId,
    }).finally(() => {
      acceptingConnectionRef.current = false
    })
  }, [
    cameraReady,
    connections,
    deviceId,
    recorderConnectionId,
    repository,
    room.id,
    session.uid,
  ])

  useEffect(() => {
    if (!recorderConnectionId) {
      return
    }

    return repository.subscribeCandidates(
      session.uid,
      room.id,
      recorderConnectionId,
      (candidates) => {
        candidates
          .filter((candidate) => candidate.fromDeviceId !== deviceId)
          .filter((candidate) => !seenCandidateIdsRef.current.has(candidate.id))
          .forEach((candidate) => {
            seenCandidateIdsRef.current.add(candidate.id)
            void recorderPeerRef.current?.addIceCandidate(candidate.candidate)
          })
      },
      setCameraError,
    )
  }, [deviceId, recorderConnectionId, repository, room.id, session.uid])

  const recordClip = useCallback(async () => {
    const stream = streamRef.current

    if (!stream || recordingRef.current || typeof MediaRecorder === 'undefined') {
      return
    }

    recordingRef.current = true
    setIsRecording(true)
    const chunks: Blob[] = []
    const startedAt = nowIso()
    const eventId = createId('evt')
    const mimeType = chooseRecordingMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

    await onSaveEvent({
      id: eventId,
      roomId: room.id,
      type: 'recording_started',
      deviceId,
      message: 'Motion recording started.',
      createdAt: startedAt,
      readAt: null,
      score: null,
      clipId: null,
      durationMs: null,
      size: null,
    })

    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data)
      }
    }
    recorder.onerror = () => {
      void onSaveEvent(
        buildEvent({
          roomId: room.id,
          deviceId,
          type: 'recording_failed',
          message: 'Recording failed on this device.',
          createdAt: nowIso(),
        }),
      )
    }
    recorder.onstop = () => {
      const endedAt = nowIso()
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
      const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime()
      const clip: LocalClip = {
        id: createId('clip'),
        roomId: room.id,
        eventId,
        deviceId,
        startedAt,
        endedAt,
        durationMs,
        size: blob.size,
        mimeType: blob.type,
        blob,
      }
      onClipSaved(clip)
      void onSaveEvent(
        buildEvent({
          roomId: room.id,
          deviceId,
          type: 'recording_saved',
          message: 'Clip saved on the phone.',
          createdAt: endedAt,
          clipId: clip.id,
          durationMs,
          size: blob.size,
        }),
      )
      recordingRef.current = false
      setIsRecording(false)
    }

    recorder.start(250)
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
    }, settings.clipSeconds * 1000)
  }, [deviceId, onClipSaved, onSaveEvent, room.id, settings.clipSeconds])

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
      if (
        allowedByPersonFilter &&
        shouldTriggerMotion({
          analysis: nextAnalysis,
          settings,
          now,
          lastTriggerAt: lastTriggerAtRef.current,
        })
      ) {
        lastTriggerAtRef.current = now
        void onSaveEvent(
          buildEvent({
            roomId: room.id,
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
          void recordClip()
        }
      }

      timer = window.setTimeout(tick, 450)
    }

    void tick()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [cameraReady, deviceId, onSaveEvent, recordClip, room.id, settings])

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
          settings={settings}
          personResult={personResult}
          onChange={patchSettings}
        />
      </aside>
    </div>
  )
}

function RecorderControls({
  settings,
  personResult,
  onChange,
}: {
  settings: RecorderSettings
  personResult: PersonDetectionResult
  onChange: (patch: Partial<RecorderSettings>) => void
}) {
  return (
    <section className={panelClass}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-stone-950">Recorder setup</h2>
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
        <RangeControl
          label="Clip length"
          value={settings.clipSeconds}
          min={3}
          max={30}
          suffix="s"
          onChange={(value) => onChange({ clipSeconds: value })}
        />

        <ToggleRow
          title="Record on motion"
          body="Save event clips to this phone only."
          checked={settings.recordOnMotion}
          onChange={(checked) => onChange({ recordOnMotion: checked })}
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

        <ZoneGrid
          zones={settings.zones}
          onChange={(zones) => onChange({ zones })}
        />
      </div>
    </section>
  )
}

function ClipsPanel({
  clips,
  storageEstimate,
  events,
  onClipDelete,
}: {
  clips: LocalClip[]
  storageEstimate: { used: number; quota: number; percent: number }
  events: MotionCueEvent[]
  onClipDelete: (clipId: string) => void
}) {
  const savedEvents = events.filter((event) => event.type === 'recording_saved')

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className={panelClass}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">Phone storage</h2>
            <p className="text-sm text-stone-500">Manual export and delete only.</p>
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
          <Metric label="Used" value={formatBytes(storageEstimate.used)} />
          <Metric label="Quota" value={storageEstimate.quota ? formatBytes(storageEstimate.quota) : 'Unknown'} />
        </div>
        {storageEstimate.percent > 80 ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            Storage is getting tight. Export clips you want, then delete old ones.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        {clips.length ? (
          clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onDelete={onClipDelete} />
          ))
        ) : (
          <EmptyState
            Icon={Video}
            title="No local clips"
            body={
              savedEvents.length
                ? 'This device has metadata for saved clips, but no local blobs. Open the recorder phone to export them.'
                : 'Arm the recorder and enable record-on-motion to save clips on this phone.'
            }
          />
        )}
      </section>
    </div>
  )
}

function SettingsPanel({
  room,
  rooms,
  onSettingsChange,
}: {
  room: MotionCueRoom
  rooms: MotionCueRoom[]
  onSettingsChange: (settings: RecorderSettings) => void
}) {
  const recorderUrl = buildRecorderUrl(room.id)

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
            body="Recorder will raise alerts when motion crosses the threshold."
            checked={room.settings.armed}
            onChange={(armed) => onSettingsChange(normalizeSettings({ ...room.settings, armed }))}
          />
          <ToggleRow
            title="Record clips"
            body="Clips stay in IndexedDB on the recorder phone."
            checked={room.settings.recordOnMotion}
            onChange={(recordOnMotion) =>
              onSettingsChange(normalizeSettings({ ...room.settings, recordOnMotion }))
            }
          />
          <RangeControl
            label="Sensitivity"
            value={room.settings.sensitivity}
            min={1}
            max={100}
            suffix="%"
            onChange={(sensitivity) =>
              onSettingsChange(normalizeSettings({ ...room.settings, sensitivity }))
            }
          />
        </div>
      </section>

      <section className={panelClass}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">Install notes</h2>
            <p className="text-sm text-stone-500">HTTPS is required on phones.</p>
          </div>
          <Home size={22} className="text-stone-400" />
        </div>
        <div className="space-y-3 text-sm leading-6 text-stone-600">
          <p>Rooms on this account: {rooms.length}</p>
          <p className="break-all rounded-2xl bg-stone-100 p-3 font-medium text-stone-700">{recorderUrl}</p>
          <p>
            Live video is same-Wi-Fi first. Motion events and settings sync through Firestore;
            clips stay local to avoid Firebase Storage costs.
          </p>
        </div>
      </section>
    </div>
  )
}

function AuthScreen({
  error,
  isConfigured,
  onGoogleSignIn,
  onEmailSignIn,
  onEmailSignUp,
}: {
  error: string
  isConfigured: boolean
  onGoogleSignIn: () => void
  onEmailSignIn: (email: string, password: string) => void
  onEmailSignUp: (email: string, password: string) => void
}) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setLocalError('')

    if (!email.trim()) {
      setLocalError('Enter your email address.')
      return
    }

    if (!password) {
      setLocalError('Enter your password.')
      return
    }

    if (mode === 'sign-up' && password.length < 6) {
      setLocalError('Use at least 6 characters for the password.')
      return
    }

    if (mode === 'sign-in') {
      onEmailSignIn(email, password)
      return
    }

    onEmailSignUp(email, password)
  }

  return (
    <main className="motioncue-shell grid min-h-svh place-items-center px-5 py-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <section className="w-full max-w-[430px] rounded-[32px] border border-white bg-white p-6 shadow-2xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-14 place-items-center rounded-3xl bg-stone-950 text-white">
            <Radio size={28} />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-400">
              MotionCue
            </p>
            <h1 className="text-3xl font-semibold text-stone-950">Live watch</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={onGoogleSignIn}
          className="pressable flex w-full items-center justify-center gap-3 rounded-2xl bg-stone-950 px-5 py-4 text-base font-semibold text-white shadow-lg"
        >
          <UserRound size={20} />
          {isConfigured ? 'Continue with Google' : 'Open preview'}
        </button>

        <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
          <span className="h-px flex-1 bg-stone-200" />
          Email
          <span className="h-px flex-1 bg-stone-200" />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
          {[
            { id: 'sign-in', label: 'Log in' },
            { id: 'sign-up', label: 'Create' },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setMode(option.id as 'sign-in' | 'sign-up')
                setLocalError('')
              }}
              className={clsx(
                'pressable rounded-xl px-3 py-2 text-sm font-semibold',
                mode === option.id ? 'bg-white text-stone-950 shadow-sm' : 'text-stone-500',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <input
            className={inputClass}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === 'sign-up' ? 'At least 6 characters' : 'Password'}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          />
          <button
            type="submit"
            className="pressable flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-4 text-base font-semibold text-white shadow-lg"
          >
            <UserRound size={19} />
            {mode === 'sign-in' ? 'Log in with email' : 'Create account'}
          </button>
        </form>

        {localError || error ? (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {localError || error}
          </p>
        ) : null}
      </section>
    </main>
  )
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
      <span className="max-w-32 truncate">{label}</span>
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

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="pressable grid size-11 shrink-0 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm"
    >
      {children}
    </button>
  )
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="motioncue-shell grid min-h-svh place-items-center text-stone-700">
      <div className="grid place-items-center gap-3">
        <Loader2 className="animate-spin" size={32} />
        <p className="text-sm font-semibold text-stone-500">{label}</p>
      </div>
    </main>
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

async function acceptMonitorConnection(input: {
  connection: SignalingConnection
  stream: MediaStream
  repository: MotionCueRepository
  uid: string
  roomId: string
  deviceId: string
  peerRef: MutableRefObject<RTCPeerConnection | null>
  seenCandidateIdsRef: MutableRefObject<Set<string>>
  setRecorderConnectionId: (connectionId: string) => void
}) {
  input.peerRef.current?.close()
  input.seenCandidateIdsRef.current = new Set()

  const peer = createPeerConnection()
  input.peerRef.current = peer
  input.stream.getTracks().forEach((track) => peer.addTrack(track, input.stream))
  peer.oniceconnectionstatechange = () => {
    if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
      void input.repository.updateConnection(input.uid, input.roomId, input.connection.id, {
        state: 'connected',
        updatedAt: nowIso(),
      })
      return
    }

    if (peer.iceConnectionState === 'failed') {
      void input.repository.updateConnection(input.uid, input.roomId, input.connection.id, {
        state: 'failed',
        updatedAt: nowIso(),
      })
    }
  }
  peer.onicecandidate = (event) => {
    if (!event.candidate) {
      return
    }

    const candidate: IceCandidateDoc = {
      id: createId('ice'),
      connectionId: input.connection.id,
      fromDeviceId: input.deviceId,
      candidate: event.candidate.toJSON(),
      createdAt: nowIso(),
    }
    void input.repository.addCandidate(input.uid, input.roomId, input.connection.id, candidate)
  }

  if (!input.connection.offer) {
    return
  }

  await peer.setRemoteDescription(input.connection.offer)
  const answer = await peer.createAnswer()
  await peer.setLocalDescription(answer)
  await input.repository.updateConnection(input.uid, input.roomId, input.connection.id, {
    recorderDeviceId: input.deviceId,
    state: 'answer',
    answer: toSignalingDescription(peer.localDescription),
    updatedAt: nowIso(),
  })
  input.setRecorderConnectionId(input.connection.id)
}

function useMotionNotifications(
  room: MotionCueRoom | null,
  events: MotionCueEvent[],
  view: AppView,
) {
  const notifiedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!room || view !== 'monitor' || !('Notification' in window)) {
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
        new Notification(`MotionCue: ${room.name}`, {
          body: event.message,
          tag: event.id,
          silent: false,
        })
      })
  }, [events, room, view])
}

function getUrlState(): { roomId: string | null; view: AppView } {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  const view: AppView = mode === 'recorder' ? 'recorder' : mode === 'monitor' ? 'monitor' : 'rooms'
  return {
    roomId: params.get('room'),
    view,
  }
}

function replaceUrlState(roomId: string | null, view: AppView) {
  const url = new URL(window.location.href)

  if (!roomId || view === 'rooms') {
    url.searchParams.delete('room')
    url.searchParams.delete('mode')
  } else {
    url.searchParams.set('room', roomId)
    url.searchParams.set('mode', view)
  }

  window.history.replaceState({}, '', url)
}

function buildRecorderUrl(roomId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomId)
  url.searchParams.set('mode', 'recorder')
  return url.toString()
}

function getDeviceName(role: DeviceRole) {
  const platform = navigator.userAgent.includes('Mobile') ? 'Phone' : 'Desktop'
  return `${platform} ${role}`
}

function isDeviceOnline(device: MotionCueDevice) {
  return device.online && Date.now() - new Date(device.lastSeenAt).getTime() < 180000
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

  return 'Person filter ready. Motion records when a person is visible.'
}

function formatUnknownError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
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

export default App
