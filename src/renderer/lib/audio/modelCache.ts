// Where the downloaded voice model lives: an IndexedDB store plugged into
// transformers.js as its custom cache. The Cache Storage API transformers.js
// uses by default is not reliably available to an Electron page loaded from
// file://, IndexedDB is, and owning the store lets Settings show its size and
// remove it. Works in both the page and the TTS worker (same origin).

const DB_NAME = 'crucible-tts'
const STORE = 'files'
const VERSION = 1

interface CachedFile {
  key: string
  blob: Blob
  size: number
  type: string
  savedAt: number
}

export interface ModelCacheSummary {
  /** Whether a model weights file (.onnx) is stored. */
  downloaded: boolean
  /** Total bytes stored. */
  bytes: number
  /** Which model files are stored (file names). */
  files: string[]
}

const idb = (): IDBFactory | null => (typeof indexedDB === 'undefined' ? null : indexedDB)

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = idb()
    if (!factory) return reject(new Error('IndexedDB is not available'))
    const req = factory.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the model cache'))
  })
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(req.result)
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error ?? req.error ?? new Error('Model cache error'))
        }
        tx.onabort = tx.onerror
      }),
  )
}

const keyOf = (request: string | Request | URL): string =>
  typeof request === 'string' ? request : request instanceof URL ? request.href : request.url

/**
 * The `match`/`put` pair transformers.js calls when `env.useCustomCache` is
 * on. A miss resolves to undefined, as the Cache API's does.
 */
export const modelCache = {
  async match(request: string | Request | URL): Promise<Response | undefined> {
    try {
      const hit = await run<CachedFile | undefined>('readonly', (s) => s.get(keyOf(request)))
      if (!hit) return undefined
      return new Response(hit.blob, {
        headers: { 'content-type': hit.type || 'application/octet-stream', 'content-length': String(hit.size) },
      })
    } catch {
      return undefined
    }
  },

  async put(request: string | Request | URL, response: Response): Promise<void> {
    const blob = await response.blob()
    const file: CachedFile = {
      key: keyOf(request),
      blob,
      size: blob.size,
      type: response.headers.get('content-type') ?? blob.type,
      savedAt: Date.now(),
    }
    await run('readwrite', (s) => s.put(file))
  },
}

const fileName = (key: string): string => key.split(/[?#]/)[0].split('/').slice(-2).join('/')

/** What is stored, without loading anything else. */
export async function summariseModelCache(): Promise<ModelCacheSummary> {
  try {
    const all = await run<CachedFile[]>('readonly', (s) => s.getAll())
    const files = all.map((f) => fileName(f.key))
    return {
      downloaded: all.some((f) => /\.onnx(?:$|[?#])/.test(f.key)),
      bytes: all.reduce((sum, f) => sum + f.size, 0),
      files,
    }
  } catch {
    return { downloaded: false, bytes: 0, files: [] }
  }
}

/** Remove the model and any cached voices. */
export async function clearModelCache(): Promise<void> {
  try {
    await run('readwrite', (s) => s.clear())
  } catch {
    /* nothing stored */
  }
  // kokoro-js keeps voice files in Cache Storage when it can.
  try {
    if (typeof caches !== 'undefined') await caches.delete('kokoro-voices')
  } catch {
    /* not available */
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
