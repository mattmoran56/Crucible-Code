import { describe, expect, it } from 'vitest'
import {
  AccumulatedTextFeed,
  HARD_MAX_CHARS,
  SOFT_MAX_CHARS,
  SentenceChunker,
  chunkSentences,
} from '../../../../src/renderer/lib/audio/sentences'

/** Feed text a few characters at a time, as the stream does, collecting every chunk. */
function streamed(text: string, step = 3): { live: string[]; all: string[] } {
  const c = new SentenceChunker()
  const live: string[] = []
  for (let i = 0; i < text.length; i += step) live.push(...c.push(text.slice(i, i + step)))
  return { live, all: [...live, ...c.flush()] }
}

describe('SentenceChunker — sentence ends', () => {
  it('splits on full stops, question and exclamation marks', () => {
    expect(chunkSentences('One thing. Another thing? Yes! Done.')).toEqual(['One thing.', 'Another thing?', 'Yes!', 'Done.'])
  })

  it('emits a sentence only once the next one has begun', () => {
    const c = new SentenceChunker()
    expect(c.push('Hello there.')).toEqual([])
    expect(c.push(' ')).toEqual([])
    expect(c.push('N')).toEqual(['Hello there.'])
    expect(c.pending).toBe('N')
    expect(c.flush()).toEqual(['N'])
  })

  it('gives the same chunks however the text is streamed', () => {
    const text = 'I looked at the failing test. It was a race in the setup! Fixed now. Want me to push?'
    const whole = chunkSentences(text)
    for (const step of [1, 2, 5, 17, 1000]) expect(streamed(text, step).all).toEqual(whole)
  })

  it('emits complete sentences while streaming, before the end', () => {
    const { live } = streamed('First sentence here. Second one follows. Third')
    expect(live).toEqual(['First sentence here.', 'Second one follows.'])
  })

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(chunkSentences('He said "stop." Then left. (It worked.) Fine.')).toEqual([
      'He said "stop."',
      'Then left.',
      '(It worked.)',
      'Fine.',
    ])
  })

  it('treats an ellipsis as a sentence end', () => {
    expect(chunkSentences('Well... Maybe not.')).toEqual(['Well...', 'Maybe not.'])
  })
})

describe('SentenceChunker — things that are not sentence ends', () => {
  it('does not split decimals, versions or file names', () => {
    expect(chunkSentences('Version 3.5.1 of app.ts is 2.5x faster. Next.')).toEqual([
      'Version 3.5.1 of app.ts is 2.5x faster.',
      'Next.',
    ])
  })

  it('does not split common abbreviations', () => {
    expect(chunkSentences('Use a tool, e.g. Vitest, i.e. The fast one. Dr. Smith agrees. Etc.')).toEqual([
      'Use a tool, e.g. Vitest, i.e. The fast one.',
      'Dr. Smith agrees.',
      'Etc.',
    ])
  })

  it('does not split on single initials', () => {
    expect(chunkSentences('Ask J. Smith about it. Then go.')).toEqual(['Ask J. Smith about it.', 'Then go.'])
  })

  it('does not split before a lower-case word', () => {
    expect(chunkSentences('The count is 3. then it resets. Done.')).toEqual(['The count is 3. then it resets.', 'Done.'])
  })
})

describe('SentenceChunker — lines and blocks', () => {
  it('splits on paragraph breaks even without punctuation', () => {
    expect(chunkSentences('A heading of sorts\n\nThen prose.')).toEqual(['A heading of sorts', 'Then prose.'])
  })

  it('joins a soft-wrapped sentence', () => {
    expect(chunkSentences('This sentence wraps\nonto a second line. Next.')).toEqual([
      'This sentence wraps\nonto a second line.',
      'Next.',
    ])
  })

  it('makes each list item its own chunk', () => {
    expect(chunkSentences('Three things:\n- add tests\n- fix lint\n1. ship it')).toEqual([
      'Three things:',
      '- add tests',
      '- fix lint',
      '1. ship it',
    ])
  })

  it('makes headings and table rows their own chunks', () => {
    expect(chunkSentences('# Title\nBody text\n| a | b |\n| 1 | 2 |')).toEqual(['# Title', 'Body text', '| a | b |', '| 1 | 2 |'])
  })

  it('waits on a newline until it can tell a wrap from a new block', () => {
    const c = new SentenceChunker()
    expect(c.push('no punctuation here\n')).toEqual([])
    expect(c.push('-')).toEqual([])
    expect(c.push(' item')).toEqual(['no punctuation here'])
  })
})

describe('SentenceChunker — code fences', () => {
  it('keeps a fenced block in one chunk', () => {
    expect(chunkSentences('Here it is:\n```ts\nconst a = 1. Not a sentence.\n\nstill code\n```\nAfter.')).toEqual([
      'Here it is:',
      '```ts\nconst a = 1. Not a sentence.\n\nstill code\n```',
      'After.',
    ])
  })

  it('holds a block back until it closes', () => {
    const c = new SentenceChunker()
    expect(c.push('Look.\n```\nline one. Line two.\n')).toEqual(['Look.'])
    expect(c.push('more. More.\n``')).toEqual([])
    expect(c.push('`\nDone')).toEqual(['```\nline one. Line two.\nmore. More.\n```'])
    expect(c.flush()).toEqual(['Done'])
  })

  it('does not close a fence with a shorter one', () => {
    expect(chunkSentences('````\n```\ninner\n```\n````\nOut.')).toEqual(['````\n```\ninner\n```\n````', 'Out.'])
  })

  it('flushes an unclosed fence at the end', () => {
    expect(chunkSentences('Start.\n```py\nprint(1)')).toEqual(['Start.', '```py\nprint(1)'])
  })

  it('streams the same as a whole message', () => {
    const text = 'Try this.\n\n```bash\nnpm test. npm run build.\n```\n\nThen tell me. Thanks!'
    for (const step of [1, 4, 9]) expect(streamed(text, step).all).toEqual(chunkSentences(text))
  })
})

describe('SentenceChunker — long sentences', () => {
  it('splits a run-on sentence at a clause once it gets long', () => {
    const clause = 'this clause goes on for quite a while without stopping'
    const text = `${clause}, ${clause}, ${clause}, ${clause}, ${clause}, ${clause}.`
    const chunks = chunkSentences(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(SOFT_MAX_CHARS)
    expect(chunks.join(' ')).toBe(text)
  })

  it('splits at a space when there is no clause', () => {
    const text = `${'word '.repeat(120).trim()}.`
    const chunks = chunkSentences(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(HARD_MAX_CHARS)
    expect(chunks.join(' ')).toBe(text)
  })
})

describe('SentenceChunker — housekeeping', () => {
  it('reset drops what was buffered', () => {
    const c = new SentenceChunker()
    c.push('Half a sent')
    c.reset()
    expect(c.flush()).toEqual([])
  })

  it('ignores leading whitespace and empty input', () => {
    expect(chunkSentences('\n\n   Hi.   ')).toEqual(['Hi.'])
    expect(chunkSentences('')).toEqual([])
  })
})

describe('AccumulatedTextFeed', () => {
  it('turns accumulated updates into new chunks only', () => {
    const feed = new AccumulatedTextFeed()
    expect(feed.update('Hello')).toEqual([])
    expect(feed.update('Hello there. ')).toEqual([])
    expect(feed.update('Hello there. How')).toEqual(['Hello there.'])
    expect(feed.update('Hello there. How')).toEqual([])
    expect(feed.update('Hello there. How are you?')).toEqual([])
    expect(feed.end()).toEqual(['How are you?'])
  })

  it('flushes the old block when a new one starts', () => {
    const feed = new AccumulatedTextFeed()
    feed.update('First block, unfinished')
    expect(feed.update('Second block. More')).toEqual(['First block, unfinished', 'Second block.'])
    expect(feed.text).toBe('Second block. More')
    expect(feed.end()).toEqual(['More'])
  })

  it('reset forgets everything', () => {
    const feed = new AccumulatedTextFeed()
    feed.update('Some text. And')
    feed.reset()
    expect(feed.text).toBe('')
    expect(feed.end()).toEqual([])
  })
})
