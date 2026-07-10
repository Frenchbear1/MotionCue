import { describe, expect, it } from 'vitest'
import { defaultSettings, motionThresholdForSensitivity, normalizeSettings } from './settings'

describe('normalizeSettings', () => {
  it('fills missing values from defaults', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings)
  })

  it('clamps numeric controls', () => {
    const settings = normalizeSettings({
      sensitivity: 999,
      cooldownSeconds: -1,
      clipSeconds: 100,
      preRollSeconds: 999,
      postMotionSeconds: -1,
      maxClipSeconds: 9999,
    })

    expect(settings.sensitivity).toBe(100)
    expect(settings.cooldownSeconds).toBe(2)
    expect(settings.clipSeconds).toBe(30)
    expect(settings.preRollSeconds).toBe(60)
    expect(settings.postMotionSeconds).toBe(2)
    expect(settings.maxClipSeconds).toBe(600)
  })

  it('keeps only complete zone maps', () => {
    expect(normalizeSettings({ zones: [false] }).zones).toEqual(defaultSettings.zones)
    expect(normalizeSettings({ zones: Array.from({ length: 9 }, () => false) }).zones).toEqual(
      Array.from({ length: 9 }, () => false),
    )
  })
})

describe('motionThresholdForSensitivity', () => {
  it('lowers the trigger threshold as sensitivity increases', () => {
    expect(motionThresholdForSensitivity(90)).toBeLessThan(motionThresholdForSensitivity(10))
  })
})
