import type { RecorderSettings } from '../types'
import { motionThresholdForSensitivity, normalizeSettings } from './settings'

export type MotionFrame = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type MotionAnalysis = {
  motion: boolean
  score: number
  changedRatio: number
  averageDelta: number
  sampledPixels: number
}

export function analyzeFrameDifference(
  previous: MotionFrame | null,
  current: MotionFrame,
  settings: RecorderSettings,
): MotionAnalysis {
  if (!previous || previous.width !== current.width || previous.height !== current.height) {
    return emptyAnalysis()
  }

  const normalized = normalizeSettings(settings)
  const enabledZones = normalized.zones
    .map((enabled, index) => ({ enabled, index }))
    .filter((zone) => zone.enabled)

  if (!enabledZones.length) {
    return emptyAnalysis()
  }

  let sampledPixels = 0
  let changedPixels = 0
  let totalDelta = 0
  const step = 4

  for (const zone of enabledZones) {
    const bounds = getZoneBounds(zone.index, current.width, current.height)

    for (let y = bounds.top; y < bounds.bottom; y += step) {
      for (let x = bounds.left; x < bounds.right; x += step) {
        const offset = (y * current.width + x) * 4
        const previousLum = luminance(previous.data, offset)
        const currentLum = luminance(current.data, offset)
        const delta = Math.abs(currentLum - previousLum)
        sampledPixels += 1
        totalDelta += delta

        if (delta > 26) {
          changedPixels += 1
        }
      }
    }
  }

  if (!sampledPixels) {
    return emptyAnalysis()
  }

  const changedRatio = changedPixels / sampledPixels
  const averageDelta = totalDelta / sampledPixels
  const score = changedRatio * 100 + averageDelta * 0.72
  const threshold = motionThresholdForSensitivity(normalized.sensitivity)

  return {
    motion: score >= threshold,
    score,
    changedRatio,
    averageDelta,
    sampledPixels,
  }
}

export function shouldTriggerMotion(input: {
  analysis: MotionAnalysis
  settings: RecorderSettings
  now: number
  lastTriggerAt: number | null
}) {
  if (!input.analysis.motion) {
    return false
  }

  if (!input.lastTriggerAt) {
    return true
  }

  return input.now - input.lastTriggerAt >= input.settings.cooldownSeconds * 1000
}

export function getZoneBounds(index: number, width: number, height: number) {
  const column = index % 3
  const row = Math.floor(index / 3)
  const zoneWidth = Math.floor(width / 3)
  const zoneHeight = Math.floor(height / 3)

  return {
    left: column * zoneWidth,
    top: row * zoneHeight,
    right: column === 2 ? width : (column + 1) * zoneWidth,
    bottom: row === 2 ? height : (row + 1) * zoneHeight,
  }
}

function luminance(data: Uint8ClampedArray, offset: number) {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722
}

function emptyAnalysis(): MotionAnalysis {
  return {
    motion: false,
    score: 0,
    changedRatio: 0,
    averageDelta: 0,
    sampledPixels: 0,
  }
}
