import React, { useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import type { Project } from '../../../shared/types'

interface Props {
  project: Project
  onClose: () => void
}

export function CreateSessionDialog({ project, onClose }: Props) {
  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { createSession } = useSessionStore()

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createSession(project.id, project.repoPath, name.trim(), baseBranch || undefined)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-border rounded-xl p-8 w-96 shadow-2xl">
        <h3 className="text-sm font-semibold mb-6">New Session</h3>

        <label className="block text-xs text-text-muted mb-2">Session name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="e.g. fix-auth-bug"
          className="w-full bg-bg border border-border rounded-md px-4 py-2.5 text-xs text-text mb-5 focus:outline-none focus:border-accent"
        />

        <label className="block text-xs text-text-muted mb-2">
          Base branch <span className="text-text-muted">(optional, defaults to HEAD)</span>
        </label>
        <input
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          placeholder="main"
          className="w-full bg-bg border border-border rounded-md px-4 py-2.5 text-xs text-text mb-6 focus:outline-none focus:border-accent"
        />

        {error && <p className="text-danger text-xs mb-4">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-text-muted hover:text-text rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="px-5 py-2 text-xs bg-accent text-bg rounded-md hover:bg-accent-hover disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
