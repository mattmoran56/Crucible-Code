import { describe, expect, it } from 'vitest'
import {
  isInlineImage,
  MAX_INLINE_IMAGE_BYTES,
  splitAttachmentLines,
  withAttachmentLines,
} from '../../../src/shared/visual-agent'

describe('attachment lines', () => {
  it('appends one line per file after the typed text', () => {
    expect(withAttachmentLines('look at this', ['/tmp/a.png', '/tmp/b.pdf'])).toBe(
      'look at this\n\n[Attached file: /tmp/a.png]\n[Attached file: /tmp/b.pdf]',
    )
    expect(withAttachmentLines('  ', ['/tmp/a.png'])).toBe('[Attached file: /tmp/a.png]')
    expect(withAttachmentLines('plain', [])).toBe('plain')
  })

  it('splits them back off, inverse of withAttachmentLines', () => {
    const sent = withAttachmentLines('look\nhere', ['/tmp/a.png', '/tmp/b c.pdf'])
    expect(splitAttachmentLines(sent)).toEqual({ text: 'look\nhere', files: ['/tmp/a.png', '/tmp/b c.pdf'] })
    expect(splitAttachmentLines('[Attached file: x.png]\n')).toEqual({ text: '', files: ['x.png'] })
  })

  it('only treats trailing lines as attachments', () => {
    const text = '[Attached file: early.png]\nthen some words'
    expect(splitAttachmentLines(text)).toEqual({ text, files: [] })
  })

  it('inlines only the image types and sizes the API takes', () => {
    expect(isInlineImage({ type: 'image/png', size: 10 })).toBe(true)
    expect(isInlineImage({ type: 'image/webp', size: 10 })).toBe(true)
    expect(isInlineImage({ type: 'image/svg+xml', size: 10 })).toBe(false)
    expect(isInlineImage({ type: 'application/pdf', size: 10 })).toBe(false)
    expect(isInlineImage({ type: 'image/png', size: MAX_INLINE_IMAGE_BYTES + 1 })).toBe(false)
  })
})
