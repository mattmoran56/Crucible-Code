import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

export interface SlackConfig {
  enabled: boolean
  botToken: string
  appToken: string
  channelId: string
}

const CONFIG_FILE = 'slack-config.json'

function getConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

const DEFAULT_CONFIG: SlackConfig = {
  enabled: false,
  botToken: '',
  appToken: '',
  channelId: '',
}

export function loadSlackConfig(): SlackConfig {
  try {
    const raw = readFileSync(getConfigPath(), 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveSlackConfig(config: SlackConfig): void {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export function clearSlackConfig(): void {
  saveSlackConfig({ ...DEFAULT_CONFIG })
}

/** Return config with tokens masked for renderer display */
export function getMaskedConfig(): {
  enabled: boolean
  botTokenHint: string
  appTokenHint: string
  channelId: string
} {
  const config = loadSlackConfig()
  return {
    enabled: config.enabled,
    botTokenHint: config.botToken ? `...${config.botToken.slice(-4)}` : '',
    appTokenHint: config.appToken ? `...${config.appToken.slice(-4)}` : '',
    channelId: config.channelId,
  }
}
