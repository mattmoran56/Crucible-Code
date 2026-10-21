// Assistant markdown rendered from `marked`'s token tree straight into React —
// no HTML string and no dangerouslySetInnerHTML anywhere. Ported from Jef's
// `Markdown.tsx`.
//
// NB: this app's globals.css resets `* { margin: 0; padding: 0 }` outside any
// cascade layer, which beats Tailwind's layered spacing utilities. Spacing in
// this folder therefore uses gap, or the `!` important suffix (`px-3!`).

import React, { useMemo, type ReactNode } from 'react'
import { marked, type Token, type Tokens } from 'marked'
import { cn } from '../../lib/cn'
import { CodeBlock } from './CodeBlock'

const LEX = { gfm: true, breaks: true } as const

/** A link's destination, or null when it must not be one. Allow-list of schemes. */
export const safeHref = (href: unknown): string | null => {
  if (typeof href !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const cleaned = href.replace(/[\u0000- \u007f]/g, '')
  if (!cleaned) return null
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned)
  if (!scheme) return href.trim()
  return ['http', 'https', 'mailto'].includes((scheme[1] ?? '').toLowerCase()) ? href.trim() : null
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** marked leaves entities in text tokens; decoding is safe because the result is a text node. */
export const decodeEntities = (text: string): string =>
  text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      const ok = Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      return ok ? String.fromCodePoint(code) : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })

const CODE_SPAN = 'rounded bg-bg-tertiary border border-border/60 px-1! font-mono text-[0.88em] text-text'

const Inline = ({ tokens }: { tokens: Token[] | undefined }) => (
  <>
    {(tokens ?? []).map((token, index) => (
      <InlineToken key={index} token={token} />
    ))}
  </>
)

const InlineToken = ({ token }: { token: Token }): ReactNode => {
  switch (token.type) {
    case 'text':
    case 'escape': {
      const held = token as Tokens.Text
      return held.tokens?.length ? <Inline tokens={held.tokens} /> : decodeEntities(held.text)
    }
    case 'strong':
      return (
        <strong className="font-semibold">
          <Inline tokens={(token as Tokens.Strong).tokens} />
        </strong>
      )
    case 'em':
      return (
        <em className="italic">
          <Inline tokens={(token as Tokens.Em).tokens} />
        </em>
      )
    case 'del':
      return (
        <del className="text-text-muted line-through">
          <Inline tokens={(token as Tokens.Del).tokens} />
        </del>
      )
    case 'codespan':
      return <code className={CODE_SPAN}>{decodeEntities((token as Tokens.Codespan).text)}</code>
    case 'br':
      return <br />
    case 'link': {
      const held = token as Tokens.Link
      const href = safeHref(held.href)
      if (!href) {
        return (
          <span title="This link points somewhere the app will not follow">
            <Inline tokens={held.tokens} />
          </span>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          {...(held.title ? { title: held.title } : {})}
        >
          <Inline tokens={held.tokens} />
        </a>
      )
    }
    case 'image': {
      const held = token as Tokens.Image
      const href = safeHref(held.href)
      const label = held.text || held.href
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
          {label} (image)
        </a>
      ) : (
        <span>{label}</span>
      )
    }
    case 'html':
      return <span className="font-mono text-[0.88em]">{(token as Tokens.HTML).raw}</span>
    default: {
      const held = token as Tokens.Generic
      return held.tokens?.length ? <Inline tokens={held.tokens} /> : decodeEntities(held.raw ?? '')
    }
  }
}

const HEADINGS: Record<number, string> = {
  1: 'text-[15px] font-semibold text-text',
  2: 'text-[14px] font-semibold text-text',
  3: 'text-[13px] font-semibold text-text',
  4: 'text-[13px] font-semibold text-text',
  5: 'text-[12px] font-semibold text-text-muted',
  6: 'text-[11px] font-semibold uppercase tracking-wider text-text-muted',
}
const HEADING_TAGS: Record<number, 'h3' | 'h4' | 'h5' | 'h6'> = { 1: 'h3', 2: 'h4', 3: 'h5', 4: 'h6', 5: 'h6', 6: 'h6' }
const ALIGN: Record<string, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }

const ListItems = ({ list }: { list: Tokens.List }) => (
  <>
    {list.items.map((item, index) => (
      <li key={index} className={cn(item.task && 'list-none -ml-4! flex gap-2')}>
        {item.task ? (
          <span aria-hidden="true" className="select-none text-text-muted">
            {item.checked ? '☑' : '☐'}
          </span>
        ) : null}
        <span className="min-w-0">
          <Blocks tokens={item.tokens} tight />
        </span>
      </li>
    ))}
  </>
)

const BlockToken = ({ token, tight }: { token: Token; tight: boolean }): ReactNode => {
  switch (token.type) {
    case 'space':
    case 'def':
      return null
    case 'heading': {
      const held = token as Tokens.Heading
      const Tag = HEADING_TAGS[held.depth] ?? 'h6'
      return (
        <Tag className={HEADINGS[held.depth] ?? HEADINGS[6]}>
          <Inline tokens={held.tokens} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="leading-relaxed">
          <Inline tokens={(token as Tokens.Paragraph).tokens} />
        </p>
      )
    case 'text': {
      const held = token as Tokens.Text
      const inner = held.tokens?.length ? <Inline tokens={held.tokens} /> : decodeEntities(held.text)
      return tight ? inner : <p className="leading-relaxed">{inner}</p>
    }
    case 'code': {
      const held = token as Tokens.Code
      return <CodeBlock code={held.text} lang={held.lang || null} />
    }
    case 'blockquote':
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-border pl-3! text-text-muted">
          <Blocks tokens={(token as Tokens.Blockquote).tokens} />
        </blockquote>
      )
    case 'list': {
      const held = token as Tokens.List
      return held.ordered ? (
        <ol
          className="flex list-decimal flex-col gap-1 pl-5! marker:text-text-muted"
          {...(typeof held.start === 'number' && held.start !== 1 ? { start: held.start } : {})}
        >
          <ListItems list={held} />
        </ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5! marker:text-text-muted">
          <ListItems list={held} />
        </ul>
      )
    }
    case 'table': {
      const held = token as Tokens.Table
      return (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {held.header.map((cell, index) => (
                  <th
                    key={index}
                    className={cn(
                      'border-b border-border bg-bg-secondary px-2.5! py-1.5! font-semibold',
                      ALIGN[cell.align ?? 'left'] ?? 'text-left',
                    )}
                  >
                    <Inline tokens={cell.tokens} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {held.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className={cn(
                        'border-b border-border px-2.5! py-1.5! text-text/90',
                        ALIGN[cell.align ?? 'left'] ?? 'text-left',
                      )}
                    >
                      <Inline tokens={cell.tokens} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'hr':
      return <hr className="border-border" />
    case 'html':
      return (
        <p className="whitespace-pre-wrap break-words font-mono text-[11px] text-text-muted">
          {(token as Tokens.HTML).raw}
        </p>
      )
    default:
      return (
        <p className="leading-relaxed">
          <InlineToken token={token} />
        </p>
      )
  }
}

const Blocks = ({ tokens, tight = false }: { tokens: Token[]; tight?: boolean }) => (
  <>
    {tokens.map((token, index) => (
      <BlockToken key={index} token={token} tight={tight} />
    ))}
  </>
)

export function Markdown({ text, className, children }: { text: string; className?: string; children?: ReactNode }) {
  const tokens = useMemo(() => marked.lexer(text, LEX), [text])
  return (
    <div className={cn('flex min-w-0 flex-col gap-2.5 break-words text-[13px] leading-relaxed text-text', className)}>
      <Blocks tokens={tokens} />
      {children}
    </div>
  )
}
