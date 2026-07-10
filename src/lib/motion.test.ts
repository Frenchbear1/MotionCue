import { describe, expect, it } from 'vitest'
import { defaultSettings } from './settings'
import { analyzeFrameDifference, getZoneBounds, shouldTriggerMotion, type MotionFrame } from './motion'

describe('analyzeFrameDifference', () => {
  it('does not trigger on the first frame', () => {
    const frame = createFrame(90, 90, 20)

    expect(analyzeFrameDifference(null, frame, defaultSettings).motion).toBe(false)
  })

  it('detects strong frame changes in enabled zones', () => {
    const previous = createFrame(90, 90, 20)
    const current = createFrame(90, 90, 220)
    const analysis = analyzeFrameDifference(previous, current, defaultSettings)

    expect(analysis.motion).toBe(true)
    expect(analysis.score).toBeGreaterThan(50)
  })

  it('ignores changes outside selected zones', () => {
    const previous = createFrame(90, 90, 20)
    const current = createFrame(90, 90, 20)
    paintZone(current, 8, 220)
    const settings = {
      ...defaultSettings,
      zones: [true, false, false, false, false, false, false, false, false],
    }

    expect(analyzeFrameDifference(previous, current, settings).motion).toBe(false)
  })
})

describe('shouldTriggerMotion', () => {
  it('respects cooldowns', () => {
    const analysis = { motion: true, score: 50, changedRatio: 0.4, averageDelta: 30, sampledPixels: 10 }

    expect(
      shouldTriggerMotion({
        analysis,
        settings: { ...defaultSettings, cooldownSeconds: 10 },
        now: 20_000,
        lastTriggerAt: 12_000,
      }),
    ).toBe(false)
    expect(
      shouldTriggerMotion({
        analysis,
        settings: { ...defaultSettings, cooldownSeconds: 10 },
        now: 23_000,
        lastTriggerAt: 12_000,
      }),
    ).toBe(true)
  })
})

function createFrame(width: number, height: number, value: number): MotionFrame {
  const data = new Uint8ClampedArray(width * height * 4)

  for (let index = 0; index < data.length; index += 4) {
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
    data[index + 3] = 255
  }

  return { width, height, data }
}

function paintZone(frame: MotionFrame, zoneIndex: number, value: number) {
  const bounds = getZoneBounds(zoneIndex, frame.width, frame.height)

  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const offset = (y * frame.width + x) * 4
      frame.data[offset] = value
      frame.data[offset + 1] = value
      frame.data[offset + 2] = value
    }
  }
}
