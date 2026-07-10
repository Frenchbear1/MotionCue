import type { RecorderSettings } from '../types'

export const defaultSettings: RecorderSettings = {
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

export function normalizeSettings(
  settings: Partial<RecorderSettings> | null | undefined,
): RecorderSettings {
  const zones =
    Array.isArray(settings?.zones) && settings.zones.length === 9
      ? settings.zones.map(Boolean)
      : defaultSettings.zones

  return {
    armed: Boolean(settings?.armed ?? defaultSettings.armed),
    motionMode: settings?.motionMode === 'person' ? 'person' : 'motion',
    sensitivity: clampNumber(settings?.sensitivity, 1, 100, defaultSettings.sensitivity),
    cooldownSeconds: clampNumber(
      settings?.cooldownSeconds,
      2,
      120,
      defaultSettings.cooldownSeconds,
    ),
    clipSeconds: clampNumber(settings?.clipSeconds, 3, 30, defaultSettings.clipSeconds),
    loopRecording: Boolean(settings?.loopRecording ?? defaultSettings.loopRecording),
    preRollSeconds: clampNumber(
      settings?.preRollSeconds,
      0,
      60,
      defaultSettings.preRollSeconds,
    ),
    postMotionSeconds: clampNumber(
      settings?.postMotionSeconds,
      2,
      120,
      defaultSettings.postMotionSeconds,
    ),
    maxClipSeconds: clampNumber(
      settings?.maxClipSeconds,
      30,
      600,
      defaultSettings.maxClipSeconds,
    ),
    recordOnMotion: Boolean(settings?.recordOnMotion ?? defaultSettings.recordOnMotion),
    zones,
    facingMode: settings?.facingMode === 'user' ? 'user' : 'environment',
  }
}

export function motionThresholdForSensitivity(sensitivity: number) {
  return 34 - normalizeSettings({ sensitivity }).sensitivity * 0.24
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}
