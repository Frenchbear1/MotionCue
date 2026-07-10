import { useMemo } from 'react'
import { createId } from '../lib/ids'

const key = 'motioncue.deviceId'

export function useDeviceId() {
  return useMemo(() => {
    const stored = window.localStorage.getItem(key)

    if (stored) {
      return stored
    }

    const next = createId('dev')
    window.localStorage.setItem(key, next)
    return next
  }, [])
}
