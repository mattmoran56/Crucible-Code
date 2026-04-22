import React from 'react'
import { Button } from './Button'

interface Props {
  children: React.ReactNode
  filePath?: string
}

interface State {
  hasError: boolean
}

export class DiffErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('DiffErrorBoundary caught error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center" style={{ maxWidth: 320 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-danger">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="text-text text-xs font-medium mb-1">Failed to render diff</p>
              {this.props.filePath && (
                <p className="text-text-muted text-xs mb-1">{this.props.filePath}</p>
              )}
              <p className="text-text-muted text-xs">
                Something went wrong while rendering this diff.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => this.setState({ hasError: false })}>
              Retry
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
