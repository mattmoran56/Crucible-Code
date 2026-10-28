// Turning dropped, pasted or picked files into attachments for the next message.

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type VisualAgentAttachment,
} from '../../../shared/visual-agent'

export interface ReadResult {
  attachments: VisualAgentAttachment[]
  /** One line per file that was turned away, for the composer's notice. */
  problems: string[]
}

const megabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`

/** A file's contents as base64 (no `data:` prefix). */
export const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.onload = () => {
      const url = String(reader.result ?? '')
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })

/** A name for a pasted file that has none (a screenshot from the clipboard). */
const nameOf = (file: File, i: number): string => {
  if (file.name && file.name !== 'image.png') return file.name
  const ext = file.type.startsWith('image/') ? file.type.slice(6).replace('jpeg', 'jpg') : 'bin'
  return `pasted-${i + 1}.${ext}`
}

/**
 * Read `files` into attachments, given how many are already waiting. Folders,
 * files over the size limit and files past the per-message count are left out
 * and named in `problems`.
 */
export async function readAttachments(files: readonly File[], waiting = 0): Promise<ReadResult> {
  const attachments: VisualAgentAttachment[] = []
  const problems: string[] = []
  for (const [i, file] of files.entries()) {
    if (waiting + attachments.length >= MAX_ATTACHMENTS) {
      problems.push(`At most ${MAX_ATTACHMENTS} files per message`)
      break
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      problems.push(`${file.name} is over ${megabytes(MAX_ATTACHMENT_BYTES)}`)
      continue
    }
    try {
      attachments.push({ name: nameOf(file, waiting + i), type: file.type, size: file.size, data: await fileToBase64(file) })
    } catch {
      // A dropped folder reads as an empty, unreadable file.
      problems.push(`Couldn't read ${file.name || 'that file'}`)
    }
  }
  return { attachments, problems }
}

/** Whether a drag carries files (not text or a link). */
export const draggingFiles = (types: readonly string[] | DOMStringList | undefined): boolean =>
  !!types && Array.from(types as ArrayLike<string>).includes('Files')
