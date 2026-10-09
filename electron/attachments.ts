// Composer attachments: classify picked files, and turn them into what each engine receives.
// Text files are inlined into the prompt (capped); images become image blocks for the Claude
// engine; anything else is referenced by path. Files are read at send time, never stored.
import { openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Attachment } from '../shared/types.js'
import { truncate } from '../shared/history.js'

export const MAX_TEXT_CHARS = 200_000 // per text file inlined into a turn
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // the Messages API image limit

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

function looksBinary(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(8192)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n).includes(0)
  } finally {
    closeSync(fd)
  }
}

export function describeFiles(paths: string[]): Attachment[] {
  const out: Attachment[] = []
  for (const path of paths) {
    try {
      const st = statSync(path)
      if (!st.isFile()) continue
      const ext = extname(path).toLowerCase()
      const image = IMAGE_MIME[ext]
      const kind: Attachment['kind'] = image ? 'image' : looksBinary(path) ? 'binary' : 'text'
      out.push({ path, name: basename(path), size: st.size, mime: image ?? (kind === 'text' ? 'text/plain' : 'application/octet-stream'), kind })
    } catch {
      /* unreadable: skipped */
    }
  }
  return out
}

function fence(text: string): string {
  // A fence longer than any backtick run inside the file.
  let longest = 2
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  return '`'.repeat(longest + 1)
}

// The text appended to the user's prompt for this turn.
export function attachmentText(atts: Attachment[], engine: 'claude' | 'motherbrain'): string {
  const parts: string[] = []
  for (const a of atts) {
    if (a.kind === 'text') {
      let body: string
      try {
        body = truncate(readFileSync(a.path, 'utf8'), MAX_TEXT_CHARS)
      } catch (e: any) {
        parts.push(`[attached file ${a.path}: could not be read (${e?.code ?? e})]`)
        continue
      }
      const f = fence(body)
      parts.push(`Attached file: ${a.path}\n${f}\n${body}\n${f}`)
    } else if (a.kind === 'image') {
      if (engine === 'claude') parts.push(`[attached image: ${a.path} (sent as an image)]`)
      else parts.push(`[attached image: ${a.path}. Motherbrain is text-only, so the image itself is not sent.]`)
    } else {
      parts.push(`[attached binary file: ${a.path} (${a.size.toLocaleString('en-US')} bytes, not inlined)]`)
    }
  }
  return parts.length ? '\n\n' + parts.join('\n\n') : ''
}

export interface ImageBlock {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

// Image blocks for the Claude engine; oversize images are reported instead of sent.
export function imageBlocks(atts: Attachment[]): { blocks: ImageBlock[]; skipped: string[] } {
  const blocks: ImageBlock[] = []
  const skipped: string[] = []
  for (const a of atts) {
    if (a.kind !== 'image') continue
    try {
      const buf = readFileSync(a.path)
      if (buf.length > MAX_IMAGE_BYTES) {
        skipped.push(`${a.name} is ${(buf.length / 1048576).toFixed(1)} MB (limit 5 MB)`)
        continue
      }
      blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: buf.toString('base64') } })
    } catch (e: any) {
      skipped.push(`${a.name}: ${e?.code ?? e}`)
    }
  }
  return { blocks, skipped }
}
