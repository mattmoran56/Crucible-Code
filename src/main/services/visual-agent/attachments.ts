/**
 * Files attached to a visual agent's message: checked, saved under the
 * agent's own attachments folder (outside the worktree, so nothing lands in
 * git) and turned into what the user message carries — a line naming each
 * saved path, plus an image block for each image Claude can take inline.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  isInlineImage,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type VisualAgentAttachment,
} from '../../../shared/visual-agent'

export interface ImageBlock {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

export interface SavedAttachments {
  paths: string[]
  images: ImageBlock[]
}

/** Where an agent's attachments are saved. Passed to Claude with `--add-dir` so it can read them. */
export const attachmentsDir = (agentId: string): string =>
  join(tmpdir(), 'crucible-code-attachments', agentId.replace(/[^A-Za-z0-9._-]/g, '_') || 'agent')

/** A file name safe to write: no directories, no control or reserved characters. */
export const safeFileName = (name: string): string => {
  const cleaned = basename(String(name).replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f<>:"/\\|?*\]\[]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return (cleaned || 'attachment').slice(0, 120)
}

/** The attachments a message may carry, or a reason it can't. Never trusts the renderer's size. */
export const checkAttachments = (value: unknown): VisualAgentAttachment[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('Attachments must be a list')
  if (value.length > MAX_ATTACHMENTS) throw new Error(`Attach at most ${MAX_ATTACHMENTS} files to one message`)
  return value.map((raw) => {
    const held = raw as Partial<VisualAgentAttachment> | null
    if (!held || typeof held.name !== 'string' || typeof held.data !== 'string') {
      throw new Error('An attachment is missing its name or contents')
    }
    const size = Buffer.byteLength(held.data, 'base64')
    if (size > MAX_ATTACHMENT_BYTES) throw new Error(`${held.name} is too large to attach`)
    return { name: held.name, type: typeof held.type === 'string' ? held.type : '', size, data: held.data }
  })
}

/** Save each file (uniquely named) under `dir` and build the message's image blocks. */
export const saveAttachments = (
  dir: string,
  attachments: readonly VisualAgentAttachment[],
  stamp: string = Date.now().toString(36),
): SavedAttachments => {
  if (attachments.length === 0) return { paths: [], images: [] }
  mkdirSync(dir, { recursive: true })
  const paths: string[] = []
  const images: ImageBlock[] = []
  attachments.forEach((attachment, i) => {
    const path = join(dir, `${stamp}-${i}-${safeFileName(attachment.name)}`)
    writeFileSync(path, Buffer.from(attachment.data, 'base64'))
    paths.push(path)
    if (isInlineImage(attachment)) {
      images.push({ type: 'image', source: { type: 'base64', media_type: attachment.type, data: attachment.data } })
    }
  })
  return { paths, images }
}
