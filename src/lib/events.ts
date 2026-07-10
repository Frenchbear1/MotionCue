import type { MotionCueEvent, MotionEventType } from '../types'
import { createId } from './ids'

export function buildEvent(input: {
  roomId: string
  deviceId: string
  type: MotionEventType
  message: string
  createdAt: string
  score?: number | null
  clipId?: string | null
  durationMs?: number | null
  size?: number | null
}): MotionCueEvent {
  return {
    id: createId('evt'),
    roomId: input.roomId,
    type: input.type,
    deviceId: input.deviceId,
    message: input.message,
    createdAt: input.createdAt,
    readAt: null,
    score: input.score ?? null,
    clipId: input.clipId ?? null,
    durationMs: input.durationMs ?? null,
    size: input.size ?? null,
  }
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  const amount = value / 1024 ** index
  const formatted =
    Number.isInteger(amount) || amount >= 10 || index === 0
      ? amount.toFixed(0)
      : amount.toFixed(1)
  return `${formatted} ${units[index]}`
}

export function isUnreadMotionAlert(event: MotionCueEvent) {
  return event.type === 'motion' && !event.readAt
}
