import React, { useState } from 'react'
import { Dialog, Input, Button } from '../ui'
// CreateConfigDialog — supports creating commands, CLAUDE.md files

type CreatableType = 'command' | 'claudemd-root' | 'claudemd-claude'

const TYPE_OPTIONS: { value: CreatableType; label: string; description: string }[] = [
  { value: 'command', label: 'Command / Skill', description: 'A slash command (.claude/commands/*.md)' },
  { value: 'claudemd-root', label: 'CLAUDE.md', description: 'Project instructions at repo root' },
  { value: 'claudemd-claude', label: '.claude/CLAUDE.md', description: 'Additional instructions in .claude/' },
]

interface CreateConfigDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (type: CreatableType, name: string, content: string) => void
  existingTypes: Set<string>
}

export function CreateConfigDialog({ open, onClose, onCreate, existingTypes }: CreateConfigDialogProps) {
  const [selectedType, setSelectedType] = useState<CreatableType>('command')
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const needsName = selectedType === 'command'

  const handleSubmit = () => {
    if (needsName && !name.trim()) return
    onCreate(selectedType, name.trim(), content)
    setName('')
    setContent('')
    onClose()
  }

  const handleClose = () => {
    setName('')
    setContent('')
    onClose()
  }

  // Filter out types that already exist (only one CLAUDE.md of each kind)
  const availableOptions = TYPE_OPTIONS.filter((opt) => {
    if (opt.value === 'claudemd-root' && existingTypes.has('claudemd:root')) return false
    if (opt.value === 'claudemd-claude' && existingTypes.has('claudemd:.claude')) return false
    return true
  })

  return (
    <Dialog open={open} onClose={handleClose} title="Add Config Item" width="22rem">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Type selector */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-muted">Type</label>
          <div className="flex flex-col gap-1">
            {availableOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedType(opt.value)}
                className={`text-left rounded px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  selectedType === opt.value
                    ? 'bg-accent/15 border border-accent/30'
                    : 'bg-bg border border-border hover:border-accent/20'
                }`}
              >
                <div className="text-sm text-text font-medium">{opt.label}</div>
                <div className="text-xs text-text-muted">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Name input — only for commands */}
        {needsName && (
          <Input
            label="Command name"
            hint="Used as the slash command name (e.g. 'deploy-check')"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        )}

        {/* Content */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-muted">Content (Markdown)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className="bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder={
              selectedType === 'command'
                ? 'Describe what this command should do...'
                : 'Project instructions for Claude...'
            }
            autoFocus={!needsName}
          />
        </div>

        <div className="flex justify-end gap-2" style={{ marginTop: '4px' }}>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={needsName && !name.trim()}>
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
