export type DeviceRole = 'monitor' | 'recorder'

export type MotionMode = 'motion' | 'person'

export type FacingMode = 'environment' | 'user'

export type RecorderSettings = {
  armed: boolean
  motionMode: MotionMode
  sensitivity: number
  cooldownSeconds: number
  clipSeconds: number
  recordOnMotion: boolean
  zones: boolean[]
  facingMode: FacingMode
}

export type MotionCueRoom = {
  id: string
  ownerId: string
  name: string
  settings: RecorderSettings
  createdAt: string
  updatedAt: string
}

export type MotionCueDevice = {
  id: string
  roomId: string
  role: DeviceRole
  name: string
  userAgent: string
  online: boolean
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

export type MotionEventType =
  | 'motion'
  | 'recording_started'
  | 'recording_saved'
  | 'recording_failed'
  | 'device_joined'

export type MotionCueEvent = {
  id: string
  roomId: string
  type: MotionEventType
  deviceId: string
  message: string
  createdAt: string
  readAt: string | null
  score: number | null
  clipId: string | null
  durationMs: number | null
  size: number | null
}

export type SignalingDescription = {
  type: RTCSdpType
  sdp: string
}

export type ConnectionState =
  | 'offer'
  | 'answer'
  | 'connected'
  | 'closed'
  | 'failed'

export type SignalingConnection = {
  id: string
  roomId: string
  monitorDeviceId: string
  recorderDeviceId: string | null
  state: ConnectionState
  offer: SignalingDescription | null
  answer: SignalingDescription | null
  createdAt: string
  updatedAt: string
}

export type IceCandidateDoc = {
  id: string
  connectionId: string
  fromDeviceId: string
  candidate: RTCIceCandidateInit
  createdAt: string
}

export type SessionUser = {
  uid: string
  displayName: string
  email: string
  photoURL: string | null
  isPreview: boolean
}

export type LocalClip = {
  id: string
  roomId: string
  eventId: string
  deviceId: string
  startedAt: string
  endedAt: string
  durationMs: number
  size: number
  mimeType: string
  blob: Blob
}

export type StorageEstimate = {
  used: number
  quota: number
  percent: number
}
