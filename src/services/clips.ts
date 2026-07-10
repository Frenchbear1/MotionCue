import type { LocalClip, StorageEstimate } from '../types'

const dbName = 'motioncue-local'
const dbVersion = 1
const clipsStore = 'clips'

export async function saveClip(clip: LocalClip) {
  const db = await openClipDb()
  await writeStore(db, clipsStore, 'readwrite', (store) => store.put(clip))
  db.close()
}

export async function listClips(roomId: string) {
  const db = await openClipDb()
  const clips = await readAll<LocalClip>(db, clipsStore)
  db.close()
  return clips
    .filter((clip) => clip.roomId === roomId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}

export async function deleteClip(id: string) {
  const db = await openClipDb()
  await writeStore(db, clipsStore, 'readwrite', (store) => store.delete(id))
  db.close()
}

export async function estimateClipStorage(): Promise<StorageEstimate> {
  if (!('storage' in navigator) || !navigator.storage.estimate) {
    return { used: 0, quota: 0, percent: 0 }
  }

  const estimate = await navigator.storage.estimate()
  const used = estimate.usage ?? 0
  const quota = estimate.quota ?? 0
  return {
    used,
    quota,
    percent: quota ? Math.round((used / quota) * 100) : 0,
  }
}

export function exportClip(clip: LocalClip) {
  const url = URL.createObjectURL(clip.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `motioncue-${clip.startedAt.replaceAll(':', '-')}.webm`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function openClipDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(clipsStore)) {
        db.createObjectStore(clipsStore, { keyPath: 'id' })
      }
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function readAll<T>(db: IDBDatabase, storeName: string) {
  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).getAll()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result as T[])
  })
}

function writeStore(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const request = action(transaction.objectStore(storeName))
    request.onerror = () => reject(request.error)
    transaction.onerror = () => reject(transaction.error)
    transaction.oncomplete = () => resolve()
  })
}
