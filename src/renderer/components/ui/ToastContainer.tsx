import React from 'react'
import { useToastStore, type ToastType } from '../../stores/toastStore'

const TYPE_STYLES: Record<ToastType, string> = {
  error: 'bg-danger text-white',
  success: 'bg-success text-white',
  info: 'bg-accent text-bg',
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" style={{ maxWidth: '400px' }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-md shadow-lg text-xs flex items-start gap-2 animate-in ${TYPE_STYLES[toast.type]}`}
          style={{ padding: '10px 14px' }}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="opacity-70 hover:opacity-100 shrink-0"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
