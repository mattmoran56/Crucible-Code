/**
 * Turns on Claude in Chrome (the Chrome connector) for the agents a user works
 * in: the visual agent (Agent tab) and interactive `claude` terminals.
 *
 * Without the flag the CLI decides at startup from the "Enabled by default"
 * setting, and it applies extra gates to that setting: it is ignored for a
 * non-interactive process (the visual agent runs `claude -p`), and when the
 * environment carries remote/Cowork markers. A session the app started then
 * comes up without the Chrome tools even though Chrome works in a plain
 * `claude`. `--chrome` connects it regardless, the same way `/chrome` would.
 * Not added to one-off runs (review loop, `/btw` forks with no tools).
 */
export const CHROME_ARGS: string[] = ['--chrome']

/** `args` plus CHROME_ARGS, unless `args` already turn Chrome on or off. */
export function withChromeArgs(args: string[] = []): string[] {
  if (args.includes('--chrome') || args.includes('--no-chrome')) return args
  return [...args, ...CHROME_ARGS]
}
