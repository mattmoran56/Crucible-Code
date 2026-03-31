import React, { useEffect, useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import type { Project } from '../../../shared/types'
import { Dialog } from '../ui/Dialog'
import { BranchCombobox } from '../ui/BranchCombobox'
import { Button } from '../ui/Button'

interface Props {
  open: boolean
  project: Project
  onClose: () => void
}

function branchToSessionName(branch: string): string {
  // Strip common prefixes
  const stripped = branch.replace(
    /^(session|feature|feat|fix|bugfix|hotfix)\//,
    ''
  )
  // Replace remaining slashes with dashes
  return stripped.replace(/\//g, '-')
}

export function OpenBranchDialog({ open, project, onClose }: Props) {
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { sessions, openBranch } = useSessionStore()

  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelectedBranch(null)
    setError(null)
    setLoading(true)
    window.api.git.listBranches(project.repoPath).then((list) => {
      // Filter out branches that already have active sessions
      const activeBranches = new Set(sessions.map((s) => s.branchName))
      setBranches(list.filter((b) => !activeBranches.has(b)))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [open, project.repoPath, sessions])

  const handleSelect = (branch: string) => {
    setSelectedBranch(branch)
    setSearch(branch)
  }

  const handleOpen = async () => {
    if (!selectedBranch) return
    setOpening(true)
    setError(null)
    try {
      const sessionName = branchToSessionName(selectedBranch)
      await openBranch(project.id, project.repoPath, selectedBranch, sessionName)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to open branch')
    } finally {
      setOpening(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Open Existing Branch">
      <BranchCombobox
        label="Branch"
        autoFocus
        value={search}
        onChange={(v) => {
          setSearch(v)
          setSelectedBranch(null)
        }}
        onSelect={handleSelect}
        branches={branches}
        loading={loading}
        placeholder="Search branches..."
        error={error || undefined}
        className="mb-5"
      />

      <div className="flex gap-3 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleOpen}
          disabled={!selectedBranch}
          loading={opening}
        >
          Open
        </Button>
      </div>
    </Dialog>
  )
}
