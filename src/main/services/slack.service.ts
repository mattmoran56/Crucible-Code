import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'

let socketClient: SocketModeClient | null = null
let webClient: WebClient | null = null
let channelId: string = ''
let connected = false

// ── Pending permission decisions ────────────────────────────────────────
// Key: requestId, Value: resolve function that the long-poll endpoint awaits

interface PendingPermission {
  resolve: (decision: 'allow' | 'deny') => void
  timer: ReturnType<typeof setTimeout>
}

const pendingPermissions = new Map<string, PendingPermission>()

// ── Lifecycle ───────────────────────────────────────────────────────────

export async function startSlack(
  botToken: string,
  appToken: string,
  channel: string
): Promise<void> {
  await stopSlack()

  channelId = channel
  webClient = new WebClient(botToken)
  socketClient = new SocketModeClient({ appToken })

  // Handle interactive button clicks
  socketClient.on('interactive', async ({ body, ack }) => {
    await ack()
    if (body.type === 'block_actions' && body.actions?.length) {
      for (const action of body.actions) {
        handleButtonAction(action, body)
      }
    }
  })

  await socketClient.start()
  connected = true
  console.log('Slack Socket Mode connected')
}

export async function stopSlack(): Promise<void> {
  // Reject all pending permissions
  for (const [id, pending] of pendingPermissions) {
    clearTimeout(pending.timer)
    pending.resolve('deny')
    pendingPermissions.delete(id)
  }

  if (socketClient) {
    try { await socketClient.disconnect() } catch { /* ignore */ }
    socketClient = null
  }
  webClient = null
  connected = false
  channelId = ''
}

export function isConnected(): boolean {
  return connected && socketClient !== null && webClient !== null
}

// ── Permission request flow ─────────────────────────────────────────────

export interface PermissionRequest {
  requestId: string
  sessionId: string
  sessionName: string
  toolName: string
  toolInput: Record<string, unknown>
}

/**
 * Send a permission request to Slack and return a promise that resolves
 * when the user clicks Allow or Deny. Called by the notification server's
 * long-poll endpoint.
 */
export function sendPermissionRequest(req: PermissionRequest): Promise<'allow' | 'deny'> {
  return new Promise((resolve) => {
    // Timeout: if no response in 9 minutes, deny (hook timeout is 10 min)
    const timer = setTimeout(() => {
      pendingPermissions.delete(req.requestId)
      resolve('deny')
    }, 9 * 60 * 1000)

    pendingPermissions.set(req.requestId, { resolve, timer })

    // Fire and forget — don't block on Slack API
    postPermissionMessage(req).catch((err) => {
      console.error('Failed to send Slack permission message:', err)
      clearTimeout(timer)
      pendingPermissions.delete(req.requestId)
      resolve('deny')
    })
  })
}

async function postPermissionMessage(req: PermissionRequest): Promise<void> {
  if (!webClient || !channelId) return

  const toolSummary = formatToolInput(req.toolName, req.toolInput)

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${req.sessionName} — permission needed`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${req.toolName}*\n\`\`\`${toolSummary}\`\`\``,
      },
    },
    {
      type: 'actions',
      block_id: `perm_${req.requestId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Allow' },
          action_id: `perm_allow_${req.requestId}`,
          value: 'allow',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Deny' },
          action_id: `perm_deny_${req.requestId}`,
          value: 'deny',
          style: 'danger',
        },
      ],
    },
  ]

  await webClient.chat.postMessage({
    channel: channelId,
    text: `${req.sessionName} needs permission for ${req.toolName}`,
    blocks,
  })
}

// ── Notification messages (informational, no response needed) ───────────

export async function sendNotificationMessage(
  sessionName: string,
  message: string,
  title?: string
): Promise<void> {
  if (!webClient || !channelId) return

  const headerText = title
    ? `${sessionName} — ${title}`
    : `${sessionName}`

  try {
    await webClient.chat.postMessage({
      channel: channelId,
      text: `${sessionName}: ${message}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: headerText },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: message },
        },
      ],
    })
  } catch (err) {
    console.error('Failed to send Slack notification:', err)
  }
}

/** Send a simple test message to verify configuration */
export async function sendTestMessage(): Promise<void> {
  if (!webClient || !channelId) {
    throw new Error('Slack is not connected')
  }

  await webClient.chat.postMessage({
    channel: channelId,
    text: 'CodeCrucible Slack integration is working!',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'CodeCrucible Slack integration is working! You will receive permission prompts here.',
        },
      },
    ],
  })
}

// ── Handle button clicks ────────────────────────────────────────────────

async function handleButtonAction(action: any, body: any): Promise<void> {
  const actionId: string = action.action_id ?? ''

  // Permission responses: perm_allow_{requestId} or perm_deny_{requestId}
  const permMatch = actionId.match(/^perm_(allow|deny)_(.+)$/)
  if (permMatch) {
    const decision = permMatch[1] as 'allow' | 'deny'
    const requestId = permMatch[2]

    const pending = pendingPermissions.get(requestId)
    if (pending) {
      clearTimeout(pending.timer)
      pending.resolve(decision)
      pendingPermissions.delete(requestId)
    }

    // Update the Slack message to show the decision
    const label = decision === 'allow' ? 'Allowed' : 'Denied'
    const emoji = decision === 'allow' ? ':white_check_mark:' : ':x:'
    try {
      if (webClient && body.channel?.id && body.message?.ts) {
        await webClient.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: `${label}`,
          blocks: [
            ...(body.message.blocks?.slice(0, 2) ?? []),
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `${emoji} *${label}*` },
              ],
            },
          ],
        })
      }
    } catch (err) {
      console.error('Failed to update Slack message:', err)
    }
    return
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatToolInput(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    return toolInput.command
  }
  if (toolName === 'Edit' && typeof toolInput.file_path === 'string') {
    return `Edit: ${toolInput.file_path}`
  }
  if (toolName === 'Write' && typeof toolInput.file_path === 'string') {
    return `Write: ${toolInput.file_path}`
  }
  if (toolName === 'Read' && typeof toolInput.file_path === 'string') {
    return `Read: ${toolInput.file_path}`
  }
  // Generic fallback
  let text = JSON.stringify(toolInput, null, 2)
  if (text.length > 2800) text = text.slice(0, 2800) + '...'
  return text
}
