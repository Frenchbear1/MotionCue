import { describe, expect, it } from 'vitest'
import { buildEvent, formatBytes, isUnreadMotionAlert } from './events'

describe('buildEvent', () => {
  it('creates lightweight event metadata', () => {
    const event = buildEvent({
      roomId: 'room_1',
      deviceId: 'dev_1',
      type: 'motion',
      message: 'Motion detected.',
      createdAt: '2026-07-10T00:00:00.000Z',
      score: 72,
    })

    expect(event.id).toMatch(/^evt_/)
    expect(event.clipId).toBeNull()
    expect(event.score).toBe(72)
    expect(isUnreadMotionAlert(event)).toBe(true)
  })
})

describe('formatBytes', () => {
  it('formats storage sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })
})
