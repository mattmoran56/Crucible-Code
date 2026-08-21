import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectStore } from '../../stores/projectStore'
import { useUpdateStore } from '../../stores/updateStore'
import { THEMES, type ThemeName, type ClaudeTheme } from '../../../shared/themes'
import type { ClaudeAccount, Project } from '../../../shared/types'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { ToggleGroup } from '../ui/ToggleGroup'
import { Input } from '../ui/Input'
import { ButtonSettings } from './ButtonSettings'
import { PRListDisplaySettings } from './PRListDisplaySettings'
import { StartupPromptSettings } from './StartupPromptSettings'
import { ReviewLoopSettings } from './ReviewLoopSettings'
import { OverseerSettings } from './OverseerSettings'
import { NotionIntegrationSettings } from './NotionIntegrationSettings'
import { FoundrySettings } from './FoundrySettings'
import { SettingsSidebar, type SettingsSection } from './SettingsSidebar'
import { ProjectPicker } from './ProjectPicker'

const LIGHT_THEMES = THEMES.filter((t) => !t.isDark)
const DARK_THEMES = THEMES.filter((t) => t.isDark)

export function SettingsPage() {
  const {
    theme, setTheme, closeSettings,
    matchSystem, setMatchSystem,
    preferredLight, setPreferredLight,
    preferredDark, setPreferredDark,
    claudeTheme, setClaudeTheme,
    mergedCleanupAction, setMergedCleanupAction,
    mergedCleanupDelay, setMergedCleanupDelay,
    autoQueueContinue, setAutoQueueContinue,
    usageResetDelayMinutes, setUsageResetDelayMinutes,
  } = useSettingsStore()

  const {
    projects,
    activeProjectId,
    claudeAccounts, saveAccounts, updateProject,
  } = useProjectStore()

  const builtCommitFromStatus = useUpdateStore((s) => s.status.builtCommit)
  const [builtCommit, setBuiltCommit] = useState<string | null>(null)
  useEffect(() => {
    if (builtCommitFromStatus) {
      setBuiltCommit(builtCommitFromStatus)
      return
    }
    window.api.update.getBuiltCommit().then(setBuiltCommit).catch(() => setBuiltCommit(null))
  }, [builtCommitFromStatus])

  // Sidebar nav state — always resets to 'appearance' on each open.
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')

  // Per-panel selected project. Defaults to active project; falls back to first.
  const initialProjectId = activeProjectId ?? projects[0]?.id ?? ''
  const [prListProjectId, setPrListProjectId] = useState(initialProjectId)
  const [startupProjectId, setStartupProjectId] = useState(initialProjectId)
  const [notionProjectId, setNotionProjectId] = useState(initialProjectId)
  const [reviewProjectId, setReviewProjectId] = useState(initialProjectId)
  const [defaultsProjectId, setDefaultsProjectId] = useState(initialProjectId)
  const [foundryProjectId, setFoundryProjectId] = useState(initialProjectId)

  // Account management state
  const [showAccountManager, setShowAccountManager] = useState(false)
  const [editingAccount, setEditingAccount] = useState<{ label: string; configDir: string } | null>(null)
  const [authStatuses, setAuthStatuses] = useState<Record<string, { email: string | null; orgName: string | null }>>({})
  const [authStatusVersion, setAuthStatusVersion] = useState(0)

  // Auth terminal state
  const [authTerminalActive, setAuthTerminalActive] = useState(false)
  const [authTerminalDone, setAuthTerminalDone] = useState(false)
  const authTerminalRef = useRef<HTMLDivElement>(null)
  const authTermRef = useRef<Terminal | null>(null)
  const authFitRef = useRef<FitAddon | null>(null)
  const authIdRef = useRef<string | null>(null)

  // Load auth statuses for all accounts
  useEffect(() => {
    const loadStatuses = async () => {
      const statuses: Record<string, { email: string | null; orgName: string | null }> = {}
      for (const account of claudeAccounts) {
        try {
          statuses[account.id] = await window.api.account.authStatus(account.configDir)
        } catch {
          statuses[account.id] = { email: null, orgName: null }
        }
      }
      try {
        statuses['__default__'] = await window.api.account.authStatus('~/.claude')
      } catch {
        statuses['__default__'] = { email: null, orgName: null }
      }
      setAuthStatuses(statuses)
    }
    loadStatuses()
  }, [claudeAccounts, authStatusVersion])

  const handleProjectAccountChange = async (projectId: string, accountId: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    await updateProject({
      ...project,
      claudeAccountId: accountId || undefined,
    })
  }

  const handleClaudeWebEnabledChange = async (projectId: string, enabled: boolean) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    await updateProject({
      ...project,
      claudeWebEnabled: enabled || undefined,
    })
  }

  const handleClaudeWebPrefixChange = async (projectId: string, prefix: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    const trimmed = prefix.trim()
    await updateProject({
      ...project,
      claudeWebBranchPrefix: trimmed || undefined,
    })
  }

  const handleSaveAndLogin = async () => {
    if (!editingAccount?.label || !editingAccount?.configDir) return
    const newAccount: ClaudeAccount = {
      id: crypto.randomUUID(),
      label: editingAccount.label,
      configDir: editingAccount.configDir,
    }
    await saveAccounts([...claudeAccounts, newAccount])

    const authId = `auth-${Date.now()}`
    authIdRef.current = authId
    setAuthTerminalActive(true)
    setAuthTerminalDone(false)

    await window.api.account.authSpawn(authId, editingAccount.configDir)
  }

  // Mount xterm when auth terminal becomes active
  useEffect(() => {
    if (!authTerminalActive || !authTerminalRef.current || authTermRef.current) return

    const terminalTheme = THEMES.find((t) => t.name === theme)?.terminal ?? THEMES[0].terminal
    const term = new Terminal({
      theme: terminalTheme,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 1000,
      rows: 14,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(authTerminalRef.current)
    requestAnimationFrame(() => fitAddon.fit())

    authTermRef.current = term
    authFitRef.current = fitAddon

    const removeData = window.api.account.onAuthData((id, data) => {
      if (id !== authIdRef.current) return
      term.write(data)
    })

    const removeExit = window.api.account.onAuthExit((id) => {
      if (id !== authIdRef.current) return
      setAuthTerminalDone(true)
      setAuthStatusVersion((v) => v + 1)
    })

    return () => {
      removeData()
      removeExit()
    }
  }, [authTerminalActive, theme])

  const handleAuthDone = () => {
    if (authIdRef.current) {
      window.api.account.authKill(authIdRef.current)
    }
    if (authTermRef.current) {
      authTermRef.current.dispose()
      authTermRef.current = null
      authFitRef.current = null
    }
    authIdRef.current = null
    setAuthTerminalActive(false)
    setAuthTerminalDone(false)
    setEditingAccount(null)
    setAuthStatusVersion((v) => v + 1)
  }

  const handleAddAccountCancel = () => {
    if (authIdRef.current) {
      window.api.account.authKill(authIdRef.current)
    }
    if (authTermRef.current) {
      authTermRef.current.dispose()
      authTermRef.current = null
      authFitRef.current = null
    }
    authIdRef.current = null
    setAuthTerminalActive(false)
    setAuthTerminalDone(false)
    setEditingAccount(null)
  }

  const handleRemoveAccount = async (accountId: string) => {
    for (const p of projects) {
      if (p.claudeAccountId === accountId) {
        await updateProject({ ...p, claudeAccountId: undefined })
      }
    }
    await saveAccounts(claudeAccounts.filter((a) => a.id !== accountId))
  }

  const handleLabelChange = (label: string) => {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setEditingAccount({
      label,
      configDir: slug ? `~/.claude-${slug}` : '',
    })
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSettings])

  const activeTheme = THEMES.find((t) => t.name === theme)
  const hasProjects = projects.length > 0

  const selectedDefaultsProject = useMemo(
    () => projects.find((p) => p.id === defaultsProjectId) ?? projects[0],
    [projects, defaultsProjectId],
  )

  const filterProject = (id: string): Project[] => {
    const p = projects.find((x) => x.id === id)
    return p ? [p] : []
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div
        className="titlebar-drag flex items-center h-11 bg-bg-tertiary border-b border-border"
      >
        <div className="w-[78px] shrink-0" />
        <IconButton
          label="Back"
          tooltipSide="bottom"
          onClick={closeSettings}
          className="titlebar-no-drag"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </IconButton>
        <span className="text-sm font-medium text-text ml-2">Settings</span>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex min-h-0">
        <SettingsSidebar
          active={activeSection}
          onChange={setActiveSection}
          hasProjects={hasProjects}
        />

        <div className="flex-1 overflow-y-auto" style={{ padding: '24px 32px' }}>
          <div style={{ maxWidth: 720 }}>
            {/* Appearance */}
            <Panel visible={activeSection === 'appearance'}>
              <SectionHeader
                title="Appearance"
                description="Choose a theme for the interface."
              />

              <div
                className="flex items-center justify-between border border-border rounded-md"
                style={{ padding: '10px 14px', marginBottom: 20 }}
              >
                <div>
                  <p className="text-xs font-medium text-text">Match System</p>
                  <p className="text-[11px] text-text-muted">
                    Automatically switch between light and dark with your OS
                  </p>
                </div>
                <ToggleGroup
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'on', label: 'On' },
                  ]}
                  value={matchSystem ? 'on' : 'off'}
                  onChange={(v) => setMatchSystem(v === 'on')}
                />
              </div>

              {matchSystem && (
                <div className="flex gap-4" style={{ marginBottom: 20 }}>
                  <div className="flex-1 border border-border rounded-md" style={{ padding: '10px 14px' }}>
                    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide" style={{ marginBottom: 8 }}>
                      Light theme
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {LIGHT_THEMES.map((t) => (
                        <Button
                          key={t.name}
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreferredLight(t.name)}
                          className={`border ${preferredLight === t.name ? 'border-accent text-text' : 'border-border'}`}
                          style={{ padding: '4px 10px' }}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              style={{
                                width: 10, height: 10, borderRadius: 2,
                                background: t.colors.bg,
                                border: `1px solid ${t.colors.border}`,
                              }}
                            />
                            {t.label}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 border border-border rounded-md" style={{ padding: '10px 14px' }}>
                    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide" style={{ marginBottom: 8 }}>
                      Dark theme
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {DARK_THEMES.map((t) => (
                        <Button
                          key={t.name}
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreferredDark(t.name)}
                          className={`border ${preferredDark === t.name ? 'border-accent text-text' : 'border-border'}`}
                          style={{ padding: '4px 10px' }}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              style={{
                                width: 10, height: 10, borderRadius: 2,
                                background: t.colors.bg,
                                border: `1px solid ${t.colors.border}`,
                              }}
                            />
                            {t.label}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-4 flex-wrap">
                {THEMES.map((t) => {
                  const isActive = theme === t.name
                  return (
                    <Button
                      key={t.name}
                      variant="ghost"
                      onClick={() => setTheme(t.name)}
                      className={`rounded-lg border-2 text-left ${isActive ? 'border-accent' : 'border-border hover:border-text-muted'}`}
                      style={{ width: 180, padding: 0, background: 'none' }}
                    >
                      <div
                        className="rounded-t-md"
                        style={{
                          background: t.colors.bg,
                          padding: '10px 12px',
                          borderBottom: `1px solid ${t.colors.border}`,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 6, height: 48 }}>
                          <div
                            style={{
                              width: 40,
                              background: t.colors['bg-secondary'],
                              borderRadius: 3,
                              border: `1px solid ${t.colors.border}`,
                            }}
                          />
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ height: 6, width: '70%', background: t.colors.text, borderRadius: 2, opacity: 0.6 }} />
                            <div style={{ height: 6, width: '50%', background: t.colors['text-muted'], borderRadius: 2, opacity: 0.6 }} />
                            <div style={{ flex: 1 }} />
                            <div style={{ display: 'flex', gap: 3 }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.accent }} />
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.success }} />
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.danger }} />
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: t.colors.warning }} />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-b-md" style={{ padding: '8px 12px', background: t.colors['bg-secondary'] }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: t.colors.text }}>
                          {t.label}
                        </span>
                      </div>
                    </Button>
                  )
                })}
              </div>

              <div
                className="flex items-center justify-between border border-border rounded-md"
                style={{ padding: '10px 14px', marginTop: 24 }}
              >
                <div>
                  <p className="text-xs font-medium text-text">Claude Code Theme</p>
                  <p className="text-[11px] text-text-muted">
                    Theme used for Claude Code sessions
                  </p>
                </div>
                <ToggleGroup
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                  value={claudeTheme}
                  onChange={(v) => setClaudeTheme(v as ClaudeTheme)}
                />
              </div>
            </Panel>

            {/* Cleanup & Limits */}
            <Panel visible={activeSection === 'cleanup-limits'}>
              <SectionHeader
                title="Merged PR Cleanup"
                description="Automatically clean up sessions after their PR is merged."
              />

              <div
                className="flex items-center justify-between border border-border rounded-md"
                style={{ padding: '10px 14px', marginBottom: 10 }}
              >
                <div>
                  <p className="text-xs font-medium text-text">Cleanup action</p>
                  <p className="text-[11px] text-text-muted">
                    What to do with a session after its PR is merged
                  </p>
                </div>
                <select
                  value={mergedCleanupAction}
                  onChange={(e) => setMergedCleanupAction(e.target.value as typeof mergedCleanupAction)}
                  className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent shrink-0"
                  style={{ padding: '6px 10px', minWidth: 180 }}
                >
                  <option value="nothing">Do nothing</option>
                  <option value="closeTerminals">Close terminals</option>
                  <option value="deleteSession">Delete session</option>
                </select>
              </div>

              {mergedCleanupAction !== 'nothing' && (
                <div
                  className="flex items-center justify-between border border-border rounded-md"
                  style={{ padding: '10px 14px' }}
                >
                  <div>
                    <p className="text-xs font-medium text-text">Cleanup delay</p>
                    <p className="text-[11px] text-text-muted">
                      How long to wait after merge before cleaning up
                    </p>
                  </div>
                  <select
                    value={mergedCleanupDelay}
                    onChange={(e) => setMergedCleanupDelay(Number(e.target.value) as typeof mergedCleanupDelay)}
                    className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent shrink-0"
                    style={{ padding: '6px 10px', minWidth: 180 }}
                  >
                    <option value={0}>Immediately</option>
                    <option value={15}>After 15 minutes</option>
                    <option value={30}>After 30 minutes</option>
                    <option value={60}>After 1 hour</option>
                    <option value={120}>After 2 hours</option>
                  </select>
                </div>
              )}

              <div style={{ marginTop: 32 }}>
                <SectionHeader
                  title="Usage Limits"
                  description="When a session hits its 5‑hour usage limit, queue a follow‑up prompt to fire after the window resets."
                />

                <div
                  className="flex items-center justify-between border border-border rounded-md"
                  style={{ padding: '10px 14px', marginBottom: 10 }}
                >
                  <div>
                    <p className="text-xs font-medium text-text">Auto‑queue 'continue'</p>
                    <p className="text-[11px] text-text-muted">
                      When the limit is reached, queue 'continue' automatically without confirmation
                    </p>
                  </div>
                  <ToggleGroup
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'on', label: 'On' },
                    ]}
                    value={autoQueueContinue ? 'on' : 'off'}
                    onChange={(v) => setAutoQueueContinue(v === 'on')}
                  />
                </div>

                <div
                  className="flex items-center justify-between border border-border rounded-md"
                  style={{ padding: '10px 14px' }}
                >
                  <div>
                    <p className="text-xs font-medium text-text">Reset delay</p>
                    <p className="text-[11px] text-text-muted">
                      Fire queued continues this many minutes after the window resets (safety margin)
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    value={usageResetDelayMinutes}
                    onChange={(e) => setUsageResetDelayMinutes(Number(e.target.value))}
                    className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent shrink-0"
                    style={{ padding: '6px 10px', width: 80 }}
                  />
                </div>
              </div>
            </Panel>

            {/* Claude Accounts */}
            <Panel visible={activeSection === 'claude-accounts'}>
              <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                <h1 className="text-lg font-semibold text-text">Claude Accounts</h1>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAccountManager(!showAccountManager)}
                  className="border border-border"
                  style={{ padding: '4px 10px' }}
                >
                  {showAccountManager ? 'Done' : 'Manage'}
                </Button>
              </div>
              <p className="text-xs text-text-muted" style={{ marginBottom: 20 }}>
                Named accounts map to separate Claude config directories, each with their own login.
              </p>

              <div className="flex flex-col gap-2">
                <div
                  className="flex items-center justify-between border border-border rounded-md"
                  style={{ padding: '8px 14px' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text">Default</p>
                    <p className="text-[11px] text-text-muted">~/.claude</p>
                  </div>
                  <div className="text-[11px] text-text-muted shrink-0" style={{ marginLeft: 12 }}>
                    {authStatuses['__default__']?.email ?? 'Not logged in'}
                  </div>
                </div>

                {claudeAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between border border-border rounded-md"
                    style={{ padding: '8px 14px' }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text">{account.label}</p>
                      <p className="text-[11px] text-text-muted">{account.configDir}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" style={{ marginLeft: 12 }}>
                      <span className="text-[11px] text-text-muted">
                        {authStatuses[account.id]?.email ?? 'Not logged in'}
                      </span>
                      {showAccountManager && (
                        <IconButton
                          label={`Remove ${account.label}`}
                          onClick={() => handleRemoveAccount(account.id)}
                          className="text-text-muted hover:text-danger"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </IconButton>
                      )}
                    </div>
                  </div>
                ))}

                {showAccountManager && (
                  <div
                    className="border border-border rounded-md"
                    style={{ padding: '10px 14px' }}
                  >
                    {editingAccount ? (
                      <div className="flex flex-col gap-3">
                        {!authTerminalActive && (
                          <>
                            <Input
                              label="Label"
                              placeholder="e.g. Work, Personal"
                              value={editingAccount.label}
                              onChange={(e) => handleLabelChange(e.target.value)}
                            />
                            <Input
                              label="Config directory"
                              placeholder="e.g. ~/.claude-work"
                              hint="Auto-generated from label. Edit if you want a custom path."
                              value={editingAccount.configDir}
                              onChange={(e) => setEditingAccount({ ...editingAccount, configDir: e.target.value })}
                            />
                            <div className="flex gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={handleSaveAndLogin}
                                disabled={!editingAccount.label || !editingAccount.configDir}
                                style={{ padding: '4px 12px' }}
                              >
                                Save &amp; Log In
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleAddAccountCancel}
                                style={{ padding: '4px 12px' }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </>
                        )}

                        {authTerminalActive && (
                          <div>
                            <p className="text-xs font-medium text-text" style={{ marginBottom: 6 }}>
                              Logging in to {editingAccount.label} ({editingAccount.configDir})
                            </p>
                            <div
                              ref={authTerminalRef}
                              className="border border-border rounded"
                              style={{ height: 280, overflow: 'hidden' }}
                            />
                            <div className="flex gap-2" style={{ marginTop: 8 }}>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={handleAuthDone}
                                style={{ padding: '4px 12px' }}
                              >
                                {authTerminalDone ? 'Done' : 'Close'}
                              </Button>
                              {!authTerminalDone && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleAddAccountCancel}
                                  style={{ padding: '4px 12px' }}
                                >
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingAccount({ label: '', configDir: '' })}
                        className="text-accent hover:text-accent-hover w-full"
                        style={{ padding: '4px 12px' }}
                      >
                        + Add Account
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Panel>

            {/* Project Defaults */}
            <Panel visible={activeSection === 'project-defaults'}>
              <SectionHeader
                title="Project Defaults"
                description="Per-project Claude account and Claude Web session settings."
              />

              {hasProjects && (
                <>
                  <ProjectPicker
                    projects={projects}
                    value={defaultsProjectId || initialProjectId}
                    onChange={setDefaultsProjectId}
                  />

                  {selectedDefaultsProject && (
                    <div className="flex flex-col gap-4">
                      <div className="border border-border rounded-md" style={{ padding: '12px 14px' }}>
                        <p className="text-xs font-medium text-text" style={{ marginBottom: 4 }}>
                          Claude account
                        </p>
                        <p className="text-[11px] text-text-muted" style={{ marginBottom: 10 }}>
                          Which Claude account to use for this project.
                        </p>
                        <select
                          value={selectedDefaultsProject.claudeAccountId ?? ''}
                          onChange={(e) => handleProjectAccountChange(selectedDefaultsProject.id, e.target.value)}
                          className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent w-full"
                          style={{ padding: '6px 10px' }}
                        >
                          <option value="">Default (~/.claude)</option>
                          {claudeAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.label}
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const accountId = selectedDefaultsProject.claudeAccountId ?? ''
                          const status = accountId ? authStatuses[accountId] : authStatuses['__default__']
                          return status?.email ? (
                            <p className="text-[11px] text-text-muted" style={{ marginTop: 6 }}>
                              {status.email}
                              {status.orgName && <span> — {status.orgName}</span>}
                            </p>
                          ) : null
                        })()}
                      </div>

                      <div className="border border-border rounded-md" style={{ padding: '12px 14px' }}>
                        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                          <div>
                            <p className="text-xs font-medium text-text">Claude Web sessions</p>
                            <p className="text-[11px] text-text-muted">
                              Surface Claude Code web sessions in the sidebar for this project. Off by default.
                            </p>
                          </div>
                          <label className="flex items-center gap-2 shrink-0 text-xs text-text cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!selectedDefaultsProject.claudeWebEnabled}
                              onChange={(e) => handleClaudeWebEnabledChange(selectedDefaultsProject.id, e.target.checked)}
                              className="cursor-pointer"
                            />
                            Enable
                          </label>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <label
                            htmlFor={`claude-web-prefix-${selectedDefaultsProject.id}`}
                            className={`text-[11px] shrink-0 ${selectedDefaultsProject.claudeWebEnabled ? 'text-text-muted' : 'text-text-muted opacity-50'}`}
                          >
                            Branch prefix
                          </label>
                          <input
                            id={`claude-web-prefix-${selectedDefaultsProject.id}`}
                            type="text"
                            disabled={!selectedDefaultsProject.claudeWebEnabled}
                            defaultValue={selectedDefaultsProject.claudeWebBranchPrefix ?? ''}
                            placeholder="claude/"
                            key={selectedDefaultsProject.id}
                            onBlur={(e) => {
                              const next = e.target.value.trim()
                              const current = selectedDefaultsProject.claudeWebBranchPrefix ?? ''
                              if (next !== current) {
                                handleClaudeWebPrefixChange(selectedDefaultsProject.id, e.target.value)
                              }
                            }}
                            className={`flex-1 bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent ${selectedDefaultsProject.claudeWebEnabled ? '' : 'opacity-50 cursor-not-allowed'}`}
                            style={{ padding: '4px 10px' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Panel>

            {/* PR List Display */}
            <Panel visible={activeSection === 'pr-list'}>
              {hasProjects && (
                <ProjectPicker
                  projects={projects}
                  value={prListProjectId || initialProjectId}
                  onChange={setPrListProjectId}
                />
              )}
              <PRListDisplaySettings projects={filterProject(prListProjectId || initialProjectId)} />
            </Panel>

            {/* Startup Prompts */}
            <Panel visible={activeSection === 'startup-prompts'}>
              {hasProjects && (
                <ProjectPicker
                  projects={projects}
                  value={startupProjectId || initialProjectId}
                  onChange={setStartupProjectId}
                />
              )}
              <StartupPromptSettings projects={filterProject(startupProjectId || initialProjectId)} />
            </Panel>

            {/* Notion */}
            <Panel visible={activeSection === 'notion'}>
              {hasProjects && (
                <ProjectPicker
                  projects={projects}
                  value={notionProjectId || initialProjectId}
                  onChange={setNotionProjectId}
                />
              )}
              <NotionIntegrationSettings projects={filterProject(notionProjectId || initialProjectId)} />
            </Panel>

            {/* Overseer */}
            <Panel visible={activeSection === 'overseer'}>
              <OverseerSettings />
            </Panel>

            {/* Foundry */}
            <Panel visible={activeSection === 'foundry'}>
              {hasProjects && (
                <ProjectPicker
                  projects={projects}
                  value={foundryProjectId || initialProjectId}
                  onChange={setFoundryProjectId}
                />
              )}
              <FoundrySettings projects={filterProject(foundryProjectId || initialProjectId)} />
            </Panel>

            {/* Review Loop */}
            <Panel visible={activeSection === 'review-loop'}>
              {hasProjects && (
                <ProjectPicker
                  projects={projects}
                  value={reviewProjectId || initialProjectId}
                  onChange={setReviewProjectId}
                />
              )}
              <ReviewLoopSettings projects={filterProject(reviewProjectId || initialProjectId)} />
            </Panel>

            {/* Buttons */}
            <Panel visible={activeSection === 'buttons'}>
              <ButtonSettings />
            </Panel>

            {/* About */}
            <Panel visible={activeSection === 'about'}>
              <SectionHeader
                title="About"
                description="Build information and active theme palette."
              />

              <div className="border border-border rounded-md" style={{ padding: '12px 14px', marginBottom: 20 }}>
                <p className="text-xs font-medium text-text" style={{ marginBottom: 4 }}>Build</p>
                <p className="text-[11px] text-text-muted">
                  {builtCommit ? builtCommit.slice(0, 7) : 'unknown'}
                </p>
              </div>

              <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide" style={{ marginBottom: 10 }}>
                Palette — {activeTheme?.label}
              </h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(activeTheme?.colors ?? {}).map(([token, hex]) => (
                  <div
                    key={token}
                    className="flex items-center gap-2 border border-border rounded"
                    style={{ padding: '4px 8px' }}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        background: hex,
                        border: '1px solid var(--color-border)',
                      }}
                    />
                    <span className="text-[11px] text-text-muted">{token}</span>
                    <span className="text-[10px] text-text-muted" style={{ opacity: 0.6 }}>
                      {hex}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return <div style={{ display: visible ? 'block' : 'none' }}>{children}</div>
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <>
      <h1 className="text-lg font-semibold text-text" style={{ marginBottom: 4 }}>{title}</h1>
      <p className="text-xs text-text-muted" style={{ marginBottom: 20 }}>{description}</p>
    </>
  )
}
