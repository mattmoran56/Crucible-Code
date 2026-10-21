import React, { useEffect, useState } from 'react'
import type { ThemedToken } from 'shiki'
import { highlightCodeTokens } from '../../hooks/useDiffHighlighting'
import { cn } from '../../lib/cn'

/**
 * A fenced code block. Renders plain mono immediately and swaps in shiki
 * tokens once the shared highlighter resolves (spans with inline colour, never
 * HTML strings).
 */
export function CodeBlock({ code, lang, className }: { code: string; lang: string | null; className?: string }) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null)

  useEffect(() => {
    let cancelled = false
    setTokens(null)
    if (!lang) return
    highlightCodeTokens(code, lang).then((result) => {
      if (!cancelled) setTokens(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang])

  return (
    <div className={cn('group relative min-w-0 overflow-hidden rounded-md border border-border bg-bg-tertiary', className)}>
      {lang ? (
        <span className="pointer-events-none absolute right-2 top-1 select-none font-mono text-[10px] text-text-muted">
          {lang}
        </span>
      ) : null}
      <pre className="overflow-x-auto px-3! py-2.5! font-mono text-[11.5px] leading-relaxed text-text">
        <code {...(lang ? { 'data-lang': lang } : {})}>
          {tokens
            ? tokens.map((line, i) => (
                <React.Fragment key={i}>
                  {line.map((token, j) => (
                    <span key={j} style={token.color ? { color: token.color } : undefined}>
                      {token.content}
                    </span>
                  ))}
                  {i < tokens.length - 1 ? '\n' : null}
                </React.Fragment>
              ))
            : code}
        </code>
      </pre>
    </div>
  )
}
