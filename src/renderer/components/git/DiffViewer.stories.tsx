import type { Meta, StoryObj } from '@storybook/react'
import { PRDiffViewer } from './DiffViewer'

// A multi-hunk realistic patch with a gap so an in-between expander is
// rendered, plus a tail expander below the last hunk.
const SAMPLE_PATCH = `diff --git a/src/renderer/components/pullrequests/PRReviewPanel.tsx b/src/renderer/components/pullrequests/PRReviewPanel.tsx
index 1111111..2222222 100644
--- a/src/renderer/components/pullrequests/PRReviewPanel.tsx
+++ b/src/renderer/components/pullrequests/PRReviewPanel.tsx
@@ -1,6 +1,9 @@
 import React from 'react'
+import { TabBar, Tab } from '../ui'
+import { PRConversationTab } from './PRConversationTab'
 import { useSessionStore } from '../../stores/sessionStore'
-import { usePRStore } from '../../stores/prStore'
+import { usePRReviewStore } from '../../stores/prReviewStore'
+import type { PullRequest } from '../../../shared/types'

 export function PRReviewPanel() {
   const { activePRNumber } = useSessionStore()
@@ -22,10 +25,18 @@ export function PRReviewPanel() {
   if (!activePRNumber) return null

   return (
-    <div className="p-4">
-      <h2>PR #{activePRNumber}</h2>
+    <div className="flex flex-col h-full">
+      <TabBar>
+        <Tab label="Conversation" />
+        <Tab label="Files" />
+        <Tab label="Checks" />
+        <Tab label="Commits" />
+      </TabBar>
+      <div className="flex-1 min-h-0 flex">
+        <PRConversationTab prNumber={activePRNumber} />
+      </div>
     </div>
   )
 }`

// A blob that extends past the diff hunks so the tail expander has real
// content to splice in, plus a few lines between hunks for the in-between
// expander.
const SAMPLE_BLOB = [
  "import React from 'react'",
  "import { TabBar, Tab } from '../ui'",
  "import { PRConversationTab } from './PRConversationTab'",
  "import { useSessionStore } from '../../stores/sessionStore'",
  "import { usePRReviewStore } from '../../stores/prReviewStore'",
  "import type { PullRequest } from '../../../shared/types'",
  '',
  'export function PRReviewPanel() {',
  '  const { activePRNumber } = useSessionStore()',
  '  const { files, selectedFile, setSelectedFile } = usePRReviewStore()',
  '',
  '  React.useEffect(() => {',
  '    // No-op: loaded via parent panel',
  '  }, [activePRNumber])',
  '',
  '  if (!activePRNumber) return null',
  '',
  '  return (',
  '    <div className="flex flex-col h-full">',
  '      <TabBar>',
  '        <Tab label="Conversation" />',
  '        <Tab label="Files" />',
  '        <Tab label="Checks" />',
  '        <Tab label="Commits" />',
  '      </TabBar>',
  '      <div className="flex-1 min-h-0 flex">',
  '        <PRConversationTab prNumber={activePRNumber} />',
  '      </div>',
  '    </div>',
  '  )',
  '}',
  '',
  '// Default export kept for backwards compatibility with the legacy entry point.',
  'export default PRReviewPanel',
]

const meta: Meta<typeof PRDiffViewer> = {
  title: 'Git/DiffViewer',
  component: PRDiffViewer,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '100vh', width: '100vw' }} className="bg-bg">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof PRDiffViewer>

export const UnifiedView: Story = {
  args: {
    patch: SAMPLE_PATCH,
    filePath: 'src/renderer/components/pullrequests/PRReviewPanel.tsx',
    comments: [],
    threads: [],
    onAddComment: () => {},
    blobLines: SAMPLE_BLOB,
    expandEnabled: true,
    initialMode: 'unified',
  },
}

export const SplitView: Story = {
  args: {
    patch: SAMPLE_PATCH,
    filePath: 'src/renderer/components/pullrequests/PRReviewPanel.tsx',
    comments: [],
    threads: [],
    onAddComment: () => {},
    blobLines: SAMPLE_BLOB,
    expandEnabled: true,
    initialMode: 'split',
  },
}

/**
 * Unified view with the in-between expander already triggered: rows 7–17
 * (the gap between the two hunks in `SAMPLE_PATCH`) are spliced in from
 * the blob.
 */
export const UnifiedWithExpandedContext: Story = {
  args: {
    patch: SAMPLE_PATCH,
    filePath: 'src/renderer/components/pullrequests/PRReviewPanel.tsx',
    comments: [],
    threads: [],
    onAddComment: () => {},
    blobLines: SAMPLE_BLOB,
    expandedNewLines: new Set([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    expandEnabled: true,
    initialMode: 'unified',
  },
}

/**
 * Split view with the in-between expander already triggered. Demonstrates
 * the GitHub-style side-by-side layout with full file context spliced into
 * the gap between hunks.
 */
export const SplitWithExpandedContext: Story = {
  args: {
    patch: SAMPLE_PATCH,
    filePath: 'src/renderer/components/pullrequests/PRReviewPanel.tsx',
    comments: [],
    threads: [],
    onAddComment: () => {},
    blobLines: SAMPLE_BLOB,
    expandedNewLines: new Set([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    expandEnabled: true,
    initialMode: 'split',
  },
}
