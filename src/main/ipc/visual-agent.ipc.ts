import { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { VisualAgentAskDecision, VisualAgentStartOptions } from '../../shared/visual-agent'
import {
  answerVisualAgent,
  forkVisualAgent,
  getVisualAgentState,
  interruptVisualAgent,
  sendVisualAgentFork,
  sendVisualAgentMessage,
  setVisualAgentModel,
  setVisualAgentWindow,
  startVisualAgent,
  stopVisualAgent,
  stopVisualAgentFork,
} from '../services/visual-agent/visual-agent.service'

export function registerVisualAgentHandlers(window: BrowserWindow): void {
  setVisualAgentWindow(window)

  handle(IPC.VISUAL_AGENT_START, async (_e, opts: VisualAgentStartOptions) => startVisualAgent(opts))
  handle(IPC.VISUAL_AGENT_SEND, async (_e, agentId: string, text: string) =>
    sendVisualAgentMessage(agentId, text)
  )
  handle(IPC.VISUAL_AGENT_INTERRUPT, async (_e, agentId: string) => interruptVisualAgent(agentId))
  handle(IPC.VISUAL_AGENT_STOP, async (_e, agentId: string) => stopVisualAgent(agentId))
  handle(
    IPC.VISUAL_AGENT_ANSWER,
    async (
      _e,
      agentId: string,
      requestId: string,
      decision: VisualAgentAskDecision,
      answers?: Record<string, string>
    ) => answerVisualAgent(agentId, requestId, decision, answers)
  )
  handle(IPC.VISUAL_AGENT_SET_MODEL, async (_e, agentId: string, model: string) =>
    setVisualAgentModel(agentId, model)
  )
  handle(IPC.VISUAL_AGENT_FORK, async (_e, agentId: string, question: string) =>
    forkVisualAgent(agentId, question)
  )
  handle(IPC.VISUAL_AGENT_FORK_SEND, async (_e, agentId: string, forkId: string, text: string) =>
    sendVisualAgentFork(agentId, forkId, text)
  )
  handle(IPC.VISUAL_AGENT_FORK_STOP, async (_e, agentId: string, forkId: string) =>
    stopVisualAgentFork(agentId, forkId)
  )
  handle(IPC.VISUAL_AGENT_GET_STATE, async (_e, agentId: string) => getVisualAgentState(agentId))
}
