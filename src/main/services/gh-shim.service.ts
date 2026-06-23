import { app } from 'electron'
import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The local-PR `gh` shim. Prepended to a capture-mode session's PATH so the
 * agent's `gh pr create` is turned into a local PR instead of opening a real
 * GitHub PR. Every other `gh` invocation execs the real `gh` further down PATH.
 *
 * POSIX `sh` only (the PTY's $SHELL varies). Title/body are base64-encoded over
 * the wire so multi-line markdown bodies survive without fragile JSON escaping.
 *
 * Bump SHIM_VERSION whenever this script changes so installed copies refresh.
 */
const SHIM_VERSION = 1

const SHIM_SCRIPT = `#!/bin/sh
# Crucible local-PR gh shim (v${SHIM_VERSION}). Managed by gh-shim.service.ts.

# Exec the real gh with our shim dir stripped from PATH (avoids recursion).
real_gh() {
  _newpath=""
  _oldifs="$IFS"
  IFS=":"
  for _d in $PATH; do
    [ "$_d" = "$CRUCIBLE_GH_SHIM_DIR" ] && continue
    if [ -z "$_newpath" ]; then _newpath="$_d"; else _newpath="$_newpath:$_d"; fi
  done
  IFS="$_oldifs"
  PATH="$_newpath"
  export PATH
  exec gh "$@"
}

# Pass through unless capture is on AND this is \`gh pr create\`.
[ "$CRUCIBLE_LOCAL_PR" = "1" ] || real_gh "$@"
[ "$1" = "pr" ] && [ "$2" = "create" ] || real_gh "$@"

shift 2
TITLE=""; BODY=""; BASE=""; HEAD=""; DRAFT=0; FILL=0
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--title) TITLE="$2"; shift 2 ;;
    --title=*) TITLE="\${1#*=}"; shift ;;
    -b|--body) BODY="$2"; shift 2 ;;
    --body=*) BODY="\${1#*=}"; shift ;;
    -F|--body-file) BODY="$(cat "$2" 2>/dev/null)"; shift 2 ;;
    --body-file=*) BODY="$(cat "\${1#*=}" 2>/dev/null)"; shift ;;
    -B|--base) BASE="$2"; shift 2 ;;
    --base=*) BASE="\${1#*=}"; shift ;;
    -H|--head) HEAD="$2"; shift 2 ;;
    --head=*) HEAD="\${1#*=}"; shift ;;
    --draft) DRAFT=1; shift ;;
    -f|--fill) FILL=1; shift ;;
    *) shift ;;
  esac
done

[ -z "$HEAD" ] && HEAD="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
SHA="$(git rev-parse HEAD 2>/dev/null)"
if [ "$FILL" = "1" ] && [ -z "$TITLE" ]; then
  TITLE="$(git log -1 --pretty=format:%s 2>/dev/null)"
fi

b64() { printf '%s' "$1" | base64 | tr -d '\\n'; }
TITLE_B64="$(b64 "$TITLE")"
BODY_B64="$(b64 "$BODY")"
if [ "$DRAFT" = "1" ]; then DRAFT_JSON=true; else DRAFT_JSON=false; fi

PAYLOAD="{\\"title_b64\\":\\"$TITLE_B64\\",\\"body_b64\\":\\"$BODY_B64\\",\\"base\\":\\"$BASE\\",\\"head\\":\\"$HEAD\\",\\"sha\\":\\"$SHA\\",\\"draft\\":$DRAFT_JSON,\\"cwd\\":\\"$(pwd)\\"}"

RESP="$(curl -s -X POST \\
  "http://127.0.0.1:\${CRUCIBLE_NOTIFY_PORT}/local-pr?context=\${CRUCIBLE_CONTEXT_ID}&tab=\${CRUCIBLE_TAB_ID}" \\
  -H "Content-Type: application/json" \\
  --data-binary "$PAYLOAD" 2>/dev/null)"

URL="$(printf '%s' "$RESP" | sed -n 's/.*"url":"\\([^"]*\\)".*/\\1/p')"
if [ -z "$URL" ]; then
  echo "Crucible: failed to capture local PR (is the app running?)" >&2
  exit 1
fi
echo "$URL"
exit 0
`

let installedDir: string | null = null

/**
 * Ensure the shim is on disk (it must be a real executable — PATH entries can't
 * live inside an asar) and return the directory to prepend to PATH. Idempotent;
 * rewrites when the embedded script version changes.
 */
export function ensureGhShimInstalled(): string {
  if (installedDir) return installedDir
  const dir = join(app.getPath('userData'), 'gh-shim')
  const ghPath = join(dir, 'gh')
  const versionPath = join(dir, '.version')

  const needsWrite =
    !existsSync(ghPath) ||
    !existsSync(versionPath) ||
    safeRead(versionPath) !== String(SHIM_VERSION)

  if (needsWrite) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(ghPath, SHIM_SCRIPT, { mode: 0o755 })
    chmodSync(ghPath, 0o755)
    writeFileSync(versionPath, String(SHIM_VERSION))
  }
  installedDir = dir
  return dir
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}
