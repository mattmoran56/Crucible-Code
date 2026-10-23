import React, { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { useAgentBrowserStore } from '../../stores/agentBrowserStore'
import { useVisualAgentStore } from '../../stores/visualAgentStore'
import { AsideSplit } from '../visual-agent/AsidePanel'
import { VisualAgentPanel } from '../visual-agent/VisualAgentPanel'
import { DEMO_CWD, demoSnapshot } from '../visual-agent/__fixtures__/demo'
import { AgentBrowserSplit } from './AgentBrowserSplit'

const SESSION = 'story-browser-session'

/**
 * The Agent tab with its link browser. Storybook has no Electron <webview>,
 * so the page itself is a stub; the split, divider and toolbar are real.
 */
function AgentTab({ url, title, asideId = null }: { url: string | null; title?: string; asideId?: string | null }) {
  const snapshot = demoSnapshot('story-agent-browser')
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    useVisualAgentStore.getState().seed(snapshot, { draft: '', openForkId: asideId, asideDrafts: {}, subagentPath: [], answering: null })
    useAgentBrowserStore.setState({ pages: {}, claims: {} })
    if (url) {
      useAgentBrowserStore.getState().open(SESSION, url)
      useAgentBrowserStore.getState().setNav(SESSION, { loading: false, title: title ?? '', canGoBack: true })
    }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, title, asideId])
  if (!ready) return null
  return (
    <div className="flex h-screen w-full flex-col bg-bg">
      <AsideSplit agentId={snapshot.agentId} visible>
        <AgentBrowserSplit sessionId={SESSION} visible embed={false}>
          <VisualAgentPanel
            agentId={snapshot.agentId}
            startOptions={{ agentId: snapshot.agentId, sessionId: SESSION, cwd: DEMO_CWD }}
            visible
          />
        </AgentBrowserSplit>
      </AsideSplit>
    </div>
  )
}

const meta: Meta<typeof AgentTab> = {
  title: 'Agent Browser/AgentBrowserSplit',
  component: AgentTab,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof AgentTab>

/** A link opened from the conversation: half and half, with the browser toolbar. */
export const LinkOpen: Story = {
  args: { url: 'https://github.com/acme/widgets/pull/42', title: 'Add retry to the upload worker · Pull Request #42' },
}

/** No link open: the conversation has the whole tab. */
export const Closed: Story = {
  args: { url: null },
}

/** A link open and a /btw aside open: the browser sits between the main chat and the aside. */
export const LinkOpenWithAside: Story = {
  args: {
    url: 'https://github.com/acme/widgets/pull/42',
    title: 'Add retry to the upload worker · Pull Request #42',
    asideId: 'fork-demo-01',
  },
}
