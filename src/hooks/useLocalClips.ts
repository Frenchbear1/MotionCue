import { useCallback, useEffect, useState } from 'react'
import { deleteClip, estimateClipStorage, listClips, saveClip } from '../services/clips'
import type { LocalClip, StorageEstimate } from '../types'

export function useLocalClips(roomId: string | null) {
  const [clips, setClips] = useState<LocalClip[]>([])
  const [estimate, setEstimate] = useState<StorageEstimate>({ used: 0, quota: 0, percent: 0 })

  const refresh = useCallback(async () => {
    if (!roomId) {
      setClips([])
      return
    }

    try {
      const [nextClips, nextEstimate] = await Promise.all([
        listClips(roomId),
        estimateClipStorage(),
      ])
      setClips(nextClips)
      setEstimate(nextEstimate)
    } catch {
      setClips([])
      setEstimate({ used: 0, quota: 0, percent: 0 })
    }
  }, [roomId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addClip = useCallback(
    async (clip: LocalClip) => {
      await saveClip(clip)
      await refresh()
    },
    [refresh],
  )

  const removeClip = useCallback(
    async (id: string) => {
      await deleteClip(id)
      await refresh()
    },
    [refresh],
  )

  return {
    clips,
    estimate,
    refresh,
    addClip,
    removeClip,
  }
}
