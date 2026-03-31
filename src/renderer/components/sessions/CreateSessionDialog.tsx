import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import type { Project } from '../../../shared/types'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { BranchCombobox } from '../ui/BranchCombobox'
import { Button } from '../ui/Button'

interface Props {
  open: boolean
  project: Project
  onClose: () => void
}

export function CreateSessionDialog({ open, project, onClose }: Props) {
  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { createSession } = useSessionStore()

  // Fetch default branch and branch list when dialog opens
  useEffect(() => {
    if (!open) return
    setName('')
    setError(null)
    setBranchesLoading(true)
    Promise.all([
      window.api.git.defaultBranch(project.repoPath),
      window.api.git.listBranches(project.repoPath),
    ]).then(([defaultBranch, list]) => {
      setBaseBranch(defaultBranch)
      setBranches(list)
      setBranchesLoading(false)
    }).catch(() => setBranchesLoading(false))
  }, [open, project.repoPath])

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createSession(project.id, project.repoPath, name.trim(), baseBranch || undefined)
      setName('')
      setBaseBranch('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Session">
      <Input
        label="Session name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        placeholder="e.g. fix-auth-bug"
        error={error || undefined}
        className="mb-4"
      />

      <BranchCombobox
        label="Base branch"
        hint="Branch to create the new session from"
        value={baseBranch}
        onChange={setBaseBranch}
        onSelect={setBaseBranch}
        branches={branches}
        loading={branchesLoading}
        placeholder="main"
        className="mb-5"
      />

      <div className="flex gap-3 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={!name.trim()}
          loading={creating}
        >
          Create
        </Button>
      </div>
    </Dialog>
  )
}
