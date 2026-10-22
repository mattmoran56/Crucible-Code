import React, { useEffect, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import type { Project, SandboxerConfigCheck } from '../../../shared/types'
import { ToggleGroup } from '../ui/ToggleGroup'
import { Input } from '../ui/Input'

const GIT_STATE_TEXT: Record<SandboxerConfigCheck['gitState'], string> = {
  tracked: 'Committed to the repo — worktrees use their own copy.',
  ignored: 'Kept out of git — copied into each session worktree before a sandbox starts.',
  untracked: 'Not committed and not ignored — copied into each worktree and excluded there.',
  'outside-repo': 'Outside the repo — copied into each session worktree before a sandbox starts.',
  unknown: '',
}

/**
 * Per-project Sandboxer card for Settings → Sandboxer. Off by default; when on,
 * sessions get a Sandbox panel and the config path below is copied into each
 * worktree that does not track its own `sandboxer.yaml`.
 */
export function SandboxerSettings({ project }: { project: Project }) {
  const updateProject = useProjectStore((s) => s.updateProject)
  const enabled = project.sandboxer?.enabled ?? false
  const [configPath, setConfigPath] = useState(project.sandboxer?.configPath ?? '')
  const [check, setCheck] = useState<SandboxerConfigCheck | null>(null)

  useEffect(() => {
    setConfigPath(project.sandboxer?.configPath ?? '')
  }, [project.id, project.sandboxer?.configPath])

  useEffect(() => {
    if (!enabled) {
      setCheck(null)
      return
    }
    let cancelled = false
    window.api.sandboxer
      .checkConfig(project.repoPath, project.sandboxer?.configPath)
      .then((result) => {
        if (!cancelled) setCheck(result)
      })
      .catch(() => {
        if (!cancelled) setCheck(null)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, project.repoPath, project.sandboxer?.configPath])

  const save = (patch: Partial<NonNullable<Project['sandboxer']>>) =>
    updateProject({ ...project, sandboxer: { enabled, ...project.sandboxer, ...patch } })

  const commitPath = () => {
    const next = configPath.trim()
    if (next === (project.sandboxer?.configPath ?? '')) return
    void save({ configPath: next || undefined })
  }

  return (
    <div className="border border-border rounded-md" style={{ padding: '12px 14px' }}>
      <div className="flex items-center justify-between gap-3" style={{ marginBottom: 6 }}>
        <div>
          <p className="text-xs font-medium text-text">Sandboxer</p>
          <p className="text-[11px] text-text-muted">
            Run each session&apos;s worktree as its own sandbox: one container with its own
            database and storage.
          </p>
        </div>
        <ToggleGroup
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
          ]}
          value={enabled ? 'on' : 'off'}
          onChange={(v) => void save({ enabled: v === 'on' })}
          className="shrink-0"
        />
      </div>

      {enabled && (
        <div className="flex flex-col gap-3" style={{ marginTop: 10 }}>
          <Input
            label="Config file"
            placeholder="sandboxer.yaml"
            value={configPath}
            onChange={(e) => setConfigPath(e.target.value)}
            onBlur={commitPath}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPath()
            }}
            hint="Relative to the repo root, or an absolute path. Defaults to sandboxer.yaml at the repo root."
          />

          {check && (
            <div className="text-[11px] flex flex-col gap-1" data-testid="sandboxer-config-check">
              <p className={check.exists ? 'text-text-muted' : 'text-danger'}>
                {check.exists ? 'Found ' : 'Not found: '}
                <span className="font-mono">{check.path}</span>
              </p>
              {check.exists && GIT_STATE_TEXT[check.gitState] && (
                <p className="text-text-muted">{GIT_STATE_TEXT[check.gitState]}</p>
              )}
              <p className={check.cliVersion ? 'text-text-muted' : 'text-danger'}>
                {check.cliVersion
                  ? `sandboxer ${check.cliVersion} installed.`
                  : 'The sandboxer CLI is not on PATH — install it from sandboxer-core.'}
              </p>
            </div>
          )}

          <p className="text-[11px] text-text-muted">
            Deleting a session — by hand or by cleanup — destroys its sandbox with its database and
            uploads, before the worktree is removed.
          </p>
        </div>
      )}
    </div>
  )
}
