import {
  collection,
  deleteDoc,
  doc,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import type {
  IceCandidateDoc,
  MotionCueDevice,
  MotionCueEvent,
  MotionCueRoom,
  RecorderSettings,
  SignalingConnection,
} from '../types'
import { normalizeSettings } from '../lib/settings'
import { getFirebaseServices } from './firebase'

const FIRESTORE_QUOTA_PAUSE_MS = 5 * 60000

let firestoreWritesPausedUntil = 0

export type MotionCueRepository = {
  subscribeRooms: (
    uid: string,
    onData: (rooms: MotionCueRoom[]) => void,
    onError: (message: string) => void,
  ) => Unsubscribe
  subscribeRoom: (
    uid: string,
    roomId: string,
    onData: (room: MotionCueRoom | null) => void,
    onError: (message: string) => void,
  ) => Unsubscribe
  subscribeDevices: (
    uid: string,
    roomId: string,
    onData: (devices: MotionCueDevice[]) => void,
    onError: (message: string) => void,
  ) => Unsubscribe
  subscribeEvents: (
    uid: string,
    roomId: string,
    onData: (events: MotionCueEvent[]) => void,
    onError: (message: string) => void,
  ) => Unsubscribe
  subscribeConnections: (
    uid: string,
    roomId: string,
    onData: (connections: SignalingConnection[]) => void,
    onError: (message: string) => void,
  ) => Unsubscribe
  subscribeConnection: (
    uid: string,
    roomId: string,
    connectionId: string,
    onData: (connection: SignalingConnection | null) => void,
    onError: (message: string) => void,
  ) => Unsubscribe
  subscribeCandidates: (
    uid: string,
    roomId: string,
    connectionId: string,
    onData: (candidates: IceCandidateDoc[]) => void,
    onError: (message: string) => void,
  ) => Unsubscribe
  saveRoom: (uid: string, room: MotionCueRoom) => Promise<void>
  saveSettings: (
    uid: string,
    roomId: string,
    settings: RecorderSettings,
    updatedAt: string,
  ) => Promise<void>
  deleteRoom: (uid: string, roomId: string) => Promise<void>
  upsertDevice: (uid: string, roomId: string, device: MotionCueDevice) => Promise<void>
  saveEvent: (uid: string, roomId: string, event: MotionCueEvent) => Promise<void>
  markEventsRead: (uid: string, roomId: string, eventIds: string[], readAt: string) => Promise<void>
  createConnection: (
    uid: string,
    roomId: string,
    connection: SignalingConnection,
  ) => Promise<void>
  updateConnection: (
    uid: string,
    roomId: string,
    connectionId: string,
    patch: Partial<SignalingConnection>,
  ) => Promise<void>
  addCandidate: (
    uid: string,
    roomId: string,
    connectionId: string,
    candidate: IceCandidateDoc,
  ) => Promise<void>
}

export function createMotionCueRepository(): MotionCueRepository {
  const firebase = getFirebaseServices()

  if (!firebase) {
    return createLocalRepository()
  }

  return createFirestoreRepository(firebase.db)
}

function createFirestoreRepository(db: Firestore): MotionCueRepository {
  const write = async (operation: () => Promise<void>) => {
    if (Date.now() < firestoreWritesPausedUntil) {
      throw new Error(firestoreQuotaMessage())
    }

    try {
      await operation()
    } catch (error) {
      if (isQuotaError(error)) {
        firestoreWritesPausedUntil = Date.now() + FIRESTORE_QUOTA_PAUSE_MS
        throw new Error(firestoreQuotaMessage())
      }

      throw error
    }
  }

  return {
    subscribeRooms(uid, onData, onError) {
      return onSnapshot(
        query(collection(db, `users/${uid}/rooms`), orderBy('updatedAt', 'desc')),
        (snapshot) =>
          onData(snapshot.docs.map((entry) => normalizeRoom(entry.data() as MotionCueRoom))),
        (error) => onError(formatFirestoreError(error)),
      )
    },
    subscribeRoom(uid, roomId, onData, onError) {
      return onSnapshot(
        doc(db, `users/${uid}/rooms/${roomId}`),
        (snapshot) =>
          onData(snapshot.exists() ? normalizeRoom(snapshot.data() as MotionCueRoom) : null),
        (error) => onError(formatFirestoreError(error)),
      )
    },
    subscribeDevices(uid, roomId, onData, onError) {
      return onSnapshot(
        collection(db, `users/${uid}/rooms/${roomId}/devices`),
        (snapshot) => onData(snapshot.docs.map((entry) => entry.data() as MotionCueDevice)),
        (error) => onError(formatFirestoreError(error)),
      )
    },
    subscribeEvents(uid, roomId, onData, onError) {
      return onSnapshot(
        query(
          collection(db, `users/${uid}/rooms/${roomId}/events`),
          orderBy('createdAt', 'desc'),
          firestoreLimit(80),
        ),
        (snapshot) => onData(snapshot.docs.map((entry) => entry.data() as MotionCueEvent)),
        (error) => onError(formatFirestoreError(error)),
      )
    },
    subscribeConnections(uid, roomId, onData, onError) {
      return onSnapshot(
        query(
          collection(db, `users/${uid}/rooms/${roomId}/connections`),
          orderBy('updatedAt', 'desc'),
          firestoreLimit(12),
        ),
        (snapshot) => onData(snapshot.docs.map((entry) => entry.data() as SignalingConnection)),
        (error) => onError(formatFirestoreError(error)),
      )
    },
    subscribeConnection(uid, roomId, connectionId, onData, onError) {
      return onSnapshot(
        doc(db, `users/${uid}/rooms/${roomId}/connections/${connectionId}`),
        (snapshot) =>
          onData(snapshot.exists() ? (snapshot.data() as SignalingConnection) : null),
        (error) => onError(formatFirestoreError(error)),
      )
    },
    subscribeCandidates(uid, roomId, connectionId, onData, onError) {
      return onSnapshot(
        collection(db, `users/${uid}/rooms/${roomId}/connections/${connectionId}/candidates`),
        (snapshot) => onData(snapshot.docs.map((entry) => entry.data() as IceCandidateDoc)),
        (error) => onError(formatFirestoreError(error)),
      )
    },
    async saveRoom(uid, room) {
      await write(() => setDoc(doc(db, `users/${uid}/rooms/${room.id}`), normalizeRoom(room)))
    },
    async saveSettings(uid, roomId, settings, updatedAt) {
      await write(() =>
        updateDoc(doc(db, `users/${uid}/rooms/${roomId}`), {
          settings: normalizeSettings(settings),
          updatedAt,
        }),
      )
    },
    async deleteRoom(uid, roomId) {
      await write(() => deleteDoc(doc(db, `users/${uid}/rooms/${roomId}`)))
    },
    async upsertDevice(uid, roomId, device) {
      await write(() =>
        setDoc(doc(db, `users/${uid}/rooms/${roomId}/devices/${device.id}`), device, {
          merge: true,
        }),
      )
    },
    async saveEvent(uid, roomId, event) {
      await write(() => setDoc(doc(db, `users/${uid}/rooms/${roomId}/events/${event.id}`), event))
    },
    async markEventsRead(uid, roomId, eventIds, readAt) {
      await write(async () => {
        await Promise.all(
          eventIds.map((eventId) =>
            updateDoc(doc(db, `users/${uid}/rooms/${roomId}/events/${eventId}`), {
              readAt,
            }),
          ),
        )
      })
    },
    async createConnection(uid, roomId, connection) {
      await write(() =>
        setDoc(
          doc(db, `users/${uid}/rooms/${roomId}/connections/${connection.id}`),
          connection,
        ),
      )
    },
    async updateConnection(uid, roomId, connectionId, patch) {
      await write(() =>
        updateDoc(doc(db, `users/${uid}/rooms/${roomId}/connections/${connectionId}`), patch),
      )
    },
    async addCandidate(uid, roomId, connectionId, candidate) {
      await write(() =>
        setDoc(
          doc(
            db,
            `users/${uid}/rooms/${roomId}/connections/${connectionId}/candidates/${candidate.id}`,
          ),
          candidate,
        ),
      )
    },
  }
}

function createLocalRepository(): MotionCueRepository {
  const localEventName = 'motioncue-local-change'
  const roomsKey = 'motioncue.rooms'

  const emit = () => window.dispatchEvent(new CustomEvent(localEventName))
  const read = <T>(key: string, fallback: T): T => {
    const stored = window.localStorage.getItem(key)

    if (!stored) {
      return fallback
    }

    try {
      return JSON.parse(stored) as T
    } catch {
      return fallback
    }
  }
  const write = (key: string, value: unknown) => {
    window.localStorage.setItem(key, JSON.stringify(value))
    emit()
  }
  const roomKey = (roomId: string, area: string) => `motioncue.${roomId}.${area}`
  const subscribe = (callback: () => void) => {
    window.setTimeout(callback, 0)
    window.addEventListener('storage', callback)
    window.addEventListener(localEventName, callback)
    return () => {
      window.removeEventListener('storage', callback)
      window.removeEventListener(localEventName, callback)
    }
  }

  return {
    subscribeRooms(_uid, onData) {
      return subscribe(() => {
        onData(sortByUpdated(read<MotionCueRoom[]>(roomsKey, []).map(normalizeRoom)))
      })
    },
    subscribeRoom(_uid, roomId, onData) {
      return subscribe(() => {
        onData(read<MotionCueRoom[]>(roomsKey, []).map(normalizeRoom).find((room) => room.id === roomId) ?? null)
      })
    },
    subscribeDevices(_uid, roomId, onData) {
      return subscribe(() => onData(read<MotionCueDevice[]>(roomKey(roomId, 'devices'), [])))
    },
    subscribeEvents(_uid, roomId, onData) {
      return subscribe(() => onData(sortByCreated(read<MotionCueEvent[]>(roomKey(roomId, 'events'), []))))
    },
    subscribeConnections(_uid, roomId, onData) {
      return subscribe(() =>
        onData(sortByUpdated(read<SignalingConnection[]>(roomKey(roomId, 'connections'), []))),
      )
    },
    subscribeConnection(_uid, roomId, connectionId, onData) {
      return subscribe(() =>
        onData(
          read<SignalingConnection[]>(roomKey(roomId, 'connections'), []).find(
            (connection) => connection.id === connectionId,
          ) ?? null,
        ),
      )
    },
    subscribeCandidates(_uid, roomId, connectionId, onData) {
      return subscribe(() =>
        onData(read<IceCandidateDoc[]>(roomKey(roomId, `candidates.${connectionId}`), [])),
      )
    },
    async saveRoom(_uid, room) {
      const rooms = read<MotionCueRoom[]>(roomsKey, [])
      write(roomsKey, [normalizeRoom(room), ...rooms.filter((entry) => entry.id !== room.id)])
    },
    async saveSettings(_uid, roomId, settings, updatedAt) {
      const rooms = read<MotionCueRoom[]>(roomsKey, [])
      write(
        roomsKey,
        rooms.map((room) =>
          room.id === roomId ? normalizeRoom({ ...room, settings, updatedAt }) : room,
        ),
      )
    },
    async deleteRoom(_uid, roomId) {
      write(
        roomsKey,
        read<MotionCueRoom[]>(roomsKey, []).filter((room) => room.id !== roomId),
      )
    },
    async upsertDevice(_uid, roomId, device) {
      const devices = read<MotionCueDevice[]>(roomKey(roomId, 'devices'), [])
      write(roomKey(roomId, 'devices'), [
        device,
        ...devices.filter((entry) => entry.id !== device.id),
      ])
    },
    async saveEvent(_uid, roomId, event) {
      const events = read<MotionCueEvent[]>(roomKey(roomId, 'events'), [])
      write(roomKey(roomId, 'events'), [event, ...events.filter((entry) => entry.id !== event.id)])
    },
    async markEventsRead(_uid, roomId, eventIds, readAt) {
      const ids = new Set(eventIds)
      const events = read<MotionCueEvent[]>(roomKey(roomId, 'events'), [])
      write(
        roomKey(roomId, 'events'),
        events.map((event) => (ids.has(event.id) ? { ...event, readAt } : event)),
      )
    },
    async createConnection(_uid, roomId, connection) {
      const connections = read<SignalingConnection[]>(roomKey(roomId, 'connections'), [])
      write(roomKey(roomId, 'connections'), [
        connection,
        ...connections.filter((entry) => entry.id !== connection.id),
      ])
    },
    async updateConnection(_uid, roomId, connectionId, patch) {
      const connections = read<SignalingConnection[]>(roomKey(roomId, 'connections'), [])
      write(
        roomKey(roomId, 'connections'),
        connections.map((connection) =>
          connection.id === connectionId ? { ...connection, ...patch } : connection,
        ),
      )
    },
    async addCandidate(_uid, roomId, connectionId, candidate) {
      const key = roomKey(roomId, `candidates.${connectionId}`)
      const candidates = read<IceCandidateDoc[]>(key, [])
      write(key, [candidate, ...candidates.filter((entry) => entry.id !== candidate.id)])
    },
  }
}

function normalizeRoom(room: MotionCueRoom): MotionCueRoom {
  return {
    ...room,
    settings: normalizeSettings(room.settings),
  }
}

function sortByUpdated<T extends { updatedAt: string; createdAt: string }>(entries: T[]) {
  return [...entries].sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() -
      new Date(a.updatedAt || a.createdAt).getTime(),
  )
}

function sortByCreated<T extends { createdAt: string }>(entries: T[]) {
  return [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

function formatFirestoreError(error: unknown) {
  return isQuotaError(error) ? firestoreQuotaMessage() : errorMessage(error)
}

function firestoreQuotaMessage() {
  return 'Firestore quota is exhausted, so MotionCue cloud sync is paused until Firebase allows writes again.'
}

function isQuotaError(error: unknown) {
  const message = errorMessage(error)
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : ''
  const normalized = `${code} ${message}`.toLowerCase()

  return normalized.includes('resource-exhausted') || normalized.includes('quota')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
