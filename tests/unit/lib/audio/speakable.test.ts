import { describe, expect, it } from 'vitest'
import {
  CODE_BLOCK_OMITTED,
  pathToSpeech,
  toSpeakableText,
  urlToSpeech,
} from '../../../../src/renderer/lib/audio/speakable'

const say = (md: string, codeBlocks: 'skip' | 'announce' = 'skip') => toSpeakableText(md, { codeBlocks })

describe('toSpeakableText — plain prose', () => {
  it('leaves ordinary sentences alone', () => {
    expect(say('I fixed the bug. The tests pass now.')).toBe('I fixed the bug. The tests pass now.')
  })

  it('handles empty and whitespace-only input', () => {
    expect(say('')).toBe('')
    expect(say('   \n\n  ')).toBe('')
  })

  it('joins soft-wrapped lines and keeps paragraphs apart', () => {
    expect(say('First line\ncontinues here.\n\nSecond paragraph.')).toBe('First line continues here.\n\nSecond paragraph.')
  })

  it('normalises Windows newlines', () => {
    expect(say('One.\r\n\r\nTwo.')).toBe('One.\n\nTwo.')
  })

  it('keeps apostrophes, contractions and decimals', () => {
    expect(say("It's 3.5 times faster, isn't it?")).toBe("It's 3.5 times faster, isn't it?")
  })
})

describe('toSpeakableText — Markdown syntax', () => {
  it('strips headings and ends them as sentences', () => {
    expect(say('# Summary\nAll good.')).toBe('Summary. All good.')
    expect(say('### What changed?\n')).toBe('What changed?')
    expect(say('## Done ##')).toBe('Done.')
  })

  it('strips bold, italic, and strikethrough', () => {
    expect(say('This is **very** important and *quite* _subtle_, not ~~wrong~~.')).toBe(
      'This is very important and quite subtle, not wrong.',
    )
    expect(say('__Bold__ start')).toBe('Bold start')
  })

  it('does not eat underscores inside identifiers or lone asterisks in maths', () => {
    expect(say('Set max_retries to 2 * 3 now.')).toBe('Set max_retries to 2 times 3 now.')
  })

  it('removes stray markers from an unbalanced span', () => {
    expect(say('This is **unfinished bold')).toBe('This is unfinished bold')
    expect(say('Cut `mid code')).toBe('Cut mid code')
  })

  it('turns bullet and numbered lists into sentences', () => {
    expect(say('Three things:\n- add tests\n- fix lint\n* ship it')).toBe('Three things: add tests. fix lint. ship it.')
    expect(say('1. First step\n2) Second step!')).toBe('First step. Second step!')
    expect(say('- [x] done item\n- [ ] open item')).toBe('done item. open item.')
  })

  it('strips blockquote markers', () => {
    expect(say('> Quoted wisdom.\n> > Nested.')).toBe('Quoted wisdom. Nested.')
  })

  it('drops horizontal rules and link reference definitions', () => {
    expect(say('Above.\n\n---\n\nBelow.')).toBe('Above.\n\nBelow.')
    expect(say('See [docs][1].\n\n[1]: https://example.com/docs')).toBe('See docs.')
    expect(say('***')).toBe('')
  })

  it('keeps link text and image alt text', () => {
    expect(say('Read [the guide](https://example.com/guide) first.')).toBe('Read the guide first.')
    expect(say('![a cat](cat.png) here')).toBe('a cat here')
    expect(say('![](x.png)Done.')).toBe('Done.')
  })

  it('strips HTML tags but not less-than comparisons', () => {
    expect(say('Line<br>break and <details>more</details>')).toBe('Line break and more')
    expect(say('Use it when a < b and c > d.')).toBe('Use it when a < b and c > d.')
  })

  it('speaks short inline code and summarises long snippets', () => {
    expect(say('Run `npm test` again.')).toBe('Run npm test again.')
    expect(say('It was `const x = computeSomethingVeryLong(alpha, beta, gamma, delta)` there.')).toBe(
      'It was a code snippet there.',
    )
  })
})

describe('toSpeakableText — code blocks', () => {
  const md = 'Here is the fix:\n\n```ts\nconst a = 1\nconsole.log(a)\n```\n\nThat should do it.'

  it('drops fenced code silently', () => {
    expect(say(md, 'skip')).toBe('Here is the fix:\n\nThat should do it.')
  })

  it('announces fenced code when asked', () => {
    expect(say(md, 'announce')).toBe(`Here is the fix:\n\n${CODE_BLOCK_OMITTED}\n\nThat should do it.`)
  })

  it('defaults to skipping', () => {
    expect(toSpeakableText(md)).toBe('Here is the fix:\n\nThat should do it.')
  })

  it('handles tilde fences, longer fences and nested backticks', () => {
    expect(say('~~~\nrm -rf /\n~~~\nok.')).toBe('ok.')
    expect(say('````md\n```js\ninner\n```\n````\nAfter.')).toBe('After.')
  })

  it('drops an unclosed fence to the end', () => {
    expect(say('Start.\n```py\nprint(1)\n# not a heading', 'announce')).toBe(`Start.\n\n${CODE_BLOCK_OMITTED}`)
  })

  it('handles indented fences and several blocks', () => {
    expect(say('A.\n  ```\n  x\n  ```\nB.\n```\ny\n```\nC.', 'announce')).toBe(
      `A.\n\n${CODE_BLOCK_OMITTED}\n\nB.\n\n${CODE_BLOCK_OMITTED}\n\nC.`,
    )
  })
})

describe('toSpeakableText — tables', () => {
  it('drops every table row, header and separator included', () => {
    const md = 'Results:\n\n| Name | Score |\n|------|------:|\n| a | 1 |\n| b | 2 |\n\nAll green.'
    expect(say(md)).toBe('Results:\n\nAll green.')
  })

  it('drops tables without outer pipes on the separator', () => {
    expect(say('Before.\n| a | b |\n--- | ---\n| 1 | 2 |\nAfter.')).toBe('Before.\n\nAfter.')
  })

  it('keeps a sentence with a single pipe', () => {
    expect(say('Pipe it | grep foo.')).toBe('Pipe it | grep foo.')
  })
})

describe('toSpeakableText — URLs', () => {
  it('shortens bare URLs to their domain', () => {
    expect(say('See https://github.com/mattmoran56/crucible-code/pull/12 for details.')).toBe(
      'See github.com for details.',
    )
    expect(say('Docs at https://www.example.co.uk/a?b=c#d.')).toBe('Docs at example.co.uk.')
    expect(say('Try www.python.org today')).toBe('Try python.org today')
  })

  it('shortens a link whose text is itself the URL', () => {
    expect(say('[https://foo.dev/x](https://foo.dev/x)')).toBe('foo.dev')
  })

  it('shortens autolinks', () => {
    expect(say('Open <https://news.ycombinator.com/item?id=1>.')).toBe('Open news.ycombinator.com.')
  })

  it('reads local servers as a port', () => {
    expect(say('Running on http://localhost:5173/app')).toBe('Running on localhost port 5173')
  })

  it('urlToSpeech falls back to "a link"', () => {
    expect(urlToSpeech('http://')).toBe('a link')
    expect(urlToSpeech('not a url')).toBe('a link')
    expect(urlToSpeech('https://www.anthropic.com/')).toBe('anthropic.com')
  })
})

describe('toSpeakableText — paths', () => {
  it('turns long paths into their file name', () => {
    expect(say('I updated src/renderer/components/settings/SettingsPage.tsx today.')).toBe(
      'I updated SettingsPage.tsx today.',
    )
    expect(say('Logs are in /var/log/app/server.log now')).toBe('Logs are in server.log now')
    expect(say('Open ~/projects/crucible/README.md.')).toBe('Open README.md.')
    expect(say('Check ./scripts/build.sh and ../other/file.json')).toBe('Check build.sh and file.json')
  })

  it('handles Windows paths', () => {
    expect(say('Saved to C:\\Users\\matt\\Documents\\notes.txt')).toBe('Saved to notes.txt')
  })

  it('shortens a path in inline code', () => {
    expect(say('Edit `src/main/services/visual-agent/launch.ts` first.')).toBe('Edit launch.ts first.')
  })

  it('reads a line number after a file name', () => {
    expect(say('See src/main/launch.ts:88 for it.')).toBe('See launch.ts line 88 for it.')
  })

  it('names the last folder of a directory path', () => {
    expect(say('Look in src/renderer/components/ please')).toBe('Look in components please')
  })

  it('leaves slash words, fractions and dates alone', () => {
    expect(say('Use and/or here, about 1/2 of it, on 12/10/2026.')).toBe('Use and/or here, about 1/2 of it, on 12/10/2026.')
    expect(say('TCP/IP and input/output')).toBe('TCP/IP and input/output')
  })

  it('pathToSpeech', () => {
    expect(pathToSpeech('a/b/c.ts')).toBe('c.ts')
    expect(pathToSpeech('a/b/')).toBe('b')
    expect(pathToSpeech('~/x')).toBe('x')
  })
})

describe('toSpeakableText — emoji, hashes and symbols', () => {
  it('removes emoji, including joined sequences, skin tones and flags', () => {
    expect(say('Done ✅ and shipped 🚀!')).toBe('Done and shipped!')
    expect(say('Team 👨‍👩‍👧 waves 👋🏽 from 🇬🇧.')).toBe('Team waves from.')
    expect(say('❤️ it')).toBe('it')
  })

  it('drops a line that was only emoji or symbols', () => {
    expect(say('🎉🎉🎉\n\nGreat.')).toBe('Great.')
  })

  it('replaces commit hashes', () => {
    expect(say('Pushed 3436d4e to the branch.')).toBe('Pushed a hash to the branch.')
    expect(say('Commit 9fceb02d0ae598e95dc970b74767f19372d61af8 landed')).toBe('Commit a hash landed')
  })

  it('does not treat ordinary words or numbers as hashes', () => {
    expect(say('A decade of 1234567 facades.')).toBe('A decade of 1234567 facades.')
  })

  it('reads arrows and ampersands', () => {
    expect(say('Settings -> Audio & voice')).toBe('Settings to Audio and voice')
    expect(say('A → B')).toBe('A to B')
  })
})

describe('toSpeakableText — a realistic slip', () => {
  it('reduces a Markdown-heavy reply to speakable prose', () => {
    const md = [
      '## Summary',
      '',
      "I've made **three** changes 🎯:",
      '',
      '1. Updated `src/renderer/components/settings/SettingsPage.tsx`',
      '2. Added tests in [the test file](https://github.com/o/r/blob/main/tests/a.test.ts)',
      '3. Fixed the bug in commit `a1b2c3d4`',
      '',
      '```diff',
      '- old',
      '+ new',
      '```',
      '',
      '| File | Lines |',
      '| --- | --- |',
      '| a.ts | 10 |',
      '',
      'Let me know if you want more!',
    ].join('\n')
    expect(say(md, 'announce')).toBe(
      [
        "Summary.\n\nI've made three changes:",
        'Updated SettingsPage.tsx. Added tests in the test file. Fixed the bug in commit a hash.',
        CODE_BLOCK_OMITTED,
        'Let me know if you want more!',
      ].join('\n\n'),
    )
  })
})
