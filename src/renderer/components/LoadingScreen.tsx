import React, { useEffect, useRef, useState } from 'react'

const PHRASES = [
  // agentic / AI dev vibes
  'Spawning agents…',
  'Bribing the compiler…',
  'Convincing the LLM…',
  'Negotiating with tokens…',
  'Hallucinating a fix…',
  'Asking nicely…',
  'Prompting the void…',
  'Reading tea leaves…',
  'Consulting the oracle…',
  'Summoning context…',
  'Warming up the GPU…',
  'Counting parameters…',
  'Loading embeddings…',
  'Indexing the repo…',
  'Vectorising everything…',
  'Fetching the right branch…',
  'Checking out worktrees…',
  'Resolving merge conflicts…',
  'Rebasing on main…',
  'Squashing commits…',
  'Cherry-picking history…',
  'Blaming git…',
  'Diffing the diff…',
  'Patching the patch…',
  'Rolling back regrets…',
  'Stashing anxiety…',
  'Popping the stash…',
  'Force-pushing boldly…',
  'Tagging the release…',
  'Versioning carefully…',

  // dev humour
  'It works on my machine…',
  'Shipping anyway…',
  'Deploying on a Friday…',
  'Closing the last tab…',
  'Opening 47 new tabs…',
  'Googling the error…',
  'Copying from Stack Overflow…',
  'Reading the docs (briefly)…',
  'Ignoring the docs…',
  'Writing the docs (never)…',
  'Deleting node_modules…',
  'Reinstalling node_modules…',
  'Waiting for npm install…',
  'Updating dependencies…',
  'Breaking changes incoming…',
  'Semver is a suggestion…',
  'Deprecation warnings: 47…',
  'TypeScript is mad…',
  'ESLint has opinions…',
  'Prettier disagreed…',
  'Tests are failing…',
  'Writing tests to fix tests…',
  'Mocking everything…',
  'Coverage at 12%…',
  'Marking as TODO…',
  'FIXME: fix this later…',
  'HACK: it works tho…',
  'Commenting out the problem…',
  'Uncommenting the problem…',
  'Blaming the intern…',
  'Blaming the senior…',
  'Blaming the framework…',
  'Blaming the cloud…',
  'Blaming cosmic rays…',
  'Restarting fixes it…',
  'Have you tried turning it off?…',
  'Have you tried turning it on?…',

  // terminal / shell
  'Allocating pseudo-terminals…',
  'Forking processes…',
  'Spawning shells…',
  'Piping stderr to /dev/null…',
  'sudo make me a sandwich…',
  'chmod 777-ing everything…',
  'rm -rf node_modules…',
  'kill -9 2147483647…',
  'grep-ing for bugs…',
  'awk-wardly processing…',
  'sed-ing the world…',
  'tail -f the logs…',
  'cat-ting files together…',
  'less is more…',
  'more is less…',
  'vi-ing the config…',
  'emacs-ing the universe…',
  'nano: saving bravely…',
  ':wq for now…',
  ':q!-ing regrets…',
  'sourcing .zshrc…',
  'exporting PATH…',
  'unaliasing rm…',
  'brew updating…',
  'brew cleaning up…',
  'updating homebrew (takes a while)…',

  // git lore
  'Amending the past…',
  'Rewriting history…',
  'Hard-resetting to yesterday…',
  'Fast-forwarding to tomorrow…',
  'Detaching HEAD…',
  'Reattaching HEAD…',
  'Fetching origin…',
  'Pruning stale branches…',
  'Pushing to main…',
  'Reverting the revert…',
  'Bisecting the blame…',
  'Submoduling responsibly…',
  'Reflogs for the win…',
  'Packing objects…',
  'Counting objects…',
  'Compressing deltas…',
  'Writing objects…',
  'Enumerating objects…',
  'Resolving deltas…',
  'Updating the index…',

  // code concepts
  'Untangling spaghetti…',
  'Boiling the ocean…',
  'Yak shaving in progress…',
  'Abstracting the abstractions…',
  'Refactoring the refactor…',
  'Over-engineering slightly…',
  'Under-engineering slightly…',
  'Adding indirection…',
  'Removing indirection…',
  'Inlining for clarity…',
  'Extracting for clarity…',
  'Premature optimisation detected…',
  'Late optimisation detected…',
  'Bikeshedding colours…',
  'Naming things (hardest part)…',
  'Cache invalidating…',
  'Off-by-one adjustments…',
  'Null-checking nulls…',
  'Undefined by design…',
  'NaN is a number, actually…',
  'Coercing types gently…',
  'Casting shadows…',
  'Boxing and unboxing…',
  'Garbage collecting…',
  'Reference counting…',
  'Weak-referenceing memories…',
  'Stack-overflowing…',
  'Heap-allocating hope…',
  'Segfaulting gracefully…',

  // process / velocity speak (lightly satirical)
  'Synergising codebases…',
  'Moving fast, not breaking things…',
  'Breaking things, moving fast…',
  'Pivoting slightly…',
  'Aligning stakeholders…',
  'Grooming the backlog…',
  'Estimating in story points…',
  'Velocity: immeasurable…',
  'Retrospecting…',
  'Standups have been had…',
  'Roadmap updated…',
  'Scope creeping…',
  'Feature-flagging everything…',
  'Rolling out to 1%…',
  'Rolling back the 1%…',
  'A/B testing the logo…',
  'Shipping an MVP…',
  'Declaring MVP done…',
  'Polishing the MVP…',

  // existential
  'Questioning existence…',
  'Pondering the heat death…',
  'Counting electrons…',
  'Awaiting a response…',
  'Patience is a virtue…',
  'The cake is loading…',
  'All your base…',
  'There is no spoon…',
  'Loading…loading…loading…',
  'Almost there…probably…',
  'Just a moment…',
  'Any second now…',
  'Definitely not stuck…',
  'Performance is a feature…',
  'Latency is temporary…',
  'This is fine…',
  'Everything is fine…',
  'Nothing to worry about…',
  'Strictly necessary…',
  'We have it under control…',
  'Optimistically loading…',
  'Deterministically random…',
  'Atomically committing…',
  'Eventually consistent…',
  'Strongly consistent-ish…',
  'CAP theorem: pick two…',
  'ACID compliant (emotionally)…',

  // Electron / app specific
  'Bridging IPC channels…',
  'Preloading context…',
  'Isolating contexts…',
  'Registering IPC handlers…',
  'Wiring up the preload…',
  'Launching renderer…',
  'Mounting React…',
  'Hydrating the store…',
  'Subscribing to events…',
  'Diffing the virtual DOM…',
  'Reconciling components…',
  'Flushing effect queue…',
  'Batching state updates…',
  'Scheduling microtasks…',
  'Yielding to the event loop…',
  'Draining the queue…',
  'Rerendering one more time…',
  'Memo-ising aggressively…',
  'useEffect: firing once…',
  'useEffect: firing twice…',

  // worktree / session
  'Creating worktree…',
  'Cloning branches…',
  'Linking working trees…',
  'Preparing sandbox…',
  'Isolating your work…',
  'Spinning up sessions…',
  'Attaching terminals…',
  'Watching for changes…',
  'Scanning the filesystem…',
  'Loading project config…',
  'Reading .gitconfig…',
  'Detecting remote…',
  'Fetching upstream…',
  'Syncing refs…',
  'Mapping file history…',

  // fun one-liners
  'Making it worse before better…',
  'The bug is a feature now…',
  'Documenting the bug…',
  'Promoting bug to backlog…',
  'Closing as won\'t fix…',
  'Works as designed™…',
  'User error suspected…',
  'Reproducible on Tuesdays…',
  'Intermittent, therefore real…',
  'Cannot reproduce…',
  'Needs more logging…',
  'Needs less logging…',
  'Adding a print statement…',
  'Removing print statements…',
  'Console.log to the rescue…',
  'debugger; // whoops…',
  'alert("here")…',
  'Infinite loop: maybe…',
  'Recursion: see recursion…',
  'Tail-call optimising…',
  'Memoising fibonacci…',
  'O(n²) is fine for small n…',
  'The data fits in RAM…',
  'Probably fits in RAM…',
  'Swapping to disk…',
  'SSD writes are cheap, right?…',
  'This only runs once…',
  'Famous last words…',
]

interface LoadingScreenProps {
  visible: boolean
}

export function LoadingScreen({ visible }: LoadingScreenProps) {
  const [phraseIndex, setPhraseIndex] = useState(() => Math.floor(Math.random() * PHRASES.length))
  const [phraseVisible, setPhraseVisible] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Rotate phrases
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setPhraseVisible(false)
      setTimeout(() => {
        setPhraseIndex((i) => (i + 1) % PHRASES.length)
        setPhraseVisible(true)
      }, 200)
    }, 1800)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Trigger fade-out when visibility changes to false
  useEffect(() => {
    if (!visible) {
      setFadeOut(true)
    }
  }, [visible])

  if (!visible && fadeOut) {
    // Keep rendered during fade, then unmount handled by parent
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#faf6f1',
        transition: 'opacity 0.5s ease',
        opacity: fadeOut ? 0 : 1,
        pointerEvents: fadeOut ? 'none' : 'auto',
        gap: 0,
      }}
    >
      {/* Logo mark */}
      <div
        style={{
          marginBottom: 28,
          animation: 'cc-pulse 2.8s ease-in-out infinite',
        }}
      >
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Outer ring */}
          <circle cx="24" cy="24" r="22" stroke="#ddd5ca" strokeWidth="1.5" />
          {/* CC monogram */}
          <text
            x="50%"
            y="50%"
            dominantBaseline="central"
            textAnchor="middle"
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
              fontSize: '16px',
              fontWeight: 600,
              fill: '#7c6f9b',
              letterSpacing: '-0.5px',
            }}
          >
            CC
          </text>
        </svg>
      </div>

      {/* App name */}
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: '#3d3229',
          letterSpacing: '-0.3px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          marginBottom: 6,
        }}
      >
        Crucible Code
      </div>

      <div
        style={{
          fontSize: 11,
          color: '#8c7e72',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 40,
        }}
      >
        Agentic Development
      </div>

      {/* Spinner */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: '2.5px solid #ddd5ca',
            borderTopColor: '#7c6f9b',
            animation: 'cc-spin 0.8s linear infinite',
          }}
        />
      </div>

      {/* Rotating phrase */}
      <div
        style={{
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: '#8c7e72',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
            transition: 'opacity 0.2s ease',
            opacity: phraseVisible ? 1 : 0,
          }}
        >
          {PHRASES[phraseIndex]}
        </span>
      </div>
    </div>
  )
}
