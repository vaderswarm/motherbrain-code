import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachmentText, describeFiles, imageBlocks } from '../electron/attachments'

const dir = mkdtempSync(join(tmpdir(), 'mbcode-att-'))
const txt = join(dir, 'notes.md')
const png = join(dir, 'chart.png')
const bin = join(dir, 'blob.dat')
writeFileSync(txt, 'line one\n```\ncode\n```\n')
writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))
writeFileSync(bin, Buffer.from([1, 2, 0, 3]))

describe('attachments', () => {
  const atts = describeFiles([txt, png, bin, join(dir, 'missing.txt'), dir])

  it('classifies files and skips missing paths and folders', () => {
    expect(atts.map((a) => [a.name, a.kind, a.mime])).toEqual([
      ['notes.md', 'text', 'text/plain'],
      ['chart.png', 'image', 'image/png'],
      ['blob.dat', 'binary', 'application/octet-stream'],
    ])
  })

  it('inlines text with a fence longer than any inside, and references the rest by path', () => {
    const t = attachmentText(atts, 'motherbrain')
    expect(t).toContain(`Attached file: ${txt}\n\`\`\`\`\nline one`)
    expect(t).toContain('Motherbrain is text-only')
    expect(t).toContain(`[attached binary file: ${bin} (4 bytes, not inlined)]`)
    expect(attachmentText(atts, 'claude')).toContain('(sent as an image)')
    expect(attachmentText([], 'claude')).toBe('')
  })

  it('makes base64 image blocks for the Claude engine', () => {
    const { blocks, skipped } = imageBlocks(atts)
    expect(skipped).toEqual([])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].source.media_type).toBe('image/png')
    expect(Buffer.from(blocks[0].source.data, 'base64').length).toBe(16)
  })
})
