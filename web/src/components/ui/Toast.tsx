import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

const ICON_LABELS: Record<ToastType, string> = {
  success: 'OK',
  error: 'ERR',
  warning: 'WARN',
  info: 'INFO',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, duration = 5000) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const toast: Toast = { id, type, message, duration }

      setToasts((prev) => [...prev, toast])

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id)
        }, duration)
      }
    },
    [removeToast]
  )

  const success = useCallback((message: string, duration?: number) => addToast('success', message, duration), [addToast])
  const error = useCallback((message: string, duration?: number) => addToast('error', message, duration), [addToast])
  const warning = useCallback((message: string, duration?: number) => addToast('warning', message, duration), [addToast])
  const info = useCallback((message: string, duration?: number) => addToast('info', message, duration), [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  const container = (
    <div className="toast-container" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )

  return createPortal(container, document.body)
}

interface ToastItemProps {
  toast: Toast
  onDismiss: (id: string) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const toneColor =
    toast.type === 'success'
      ? 'var(--color-success-600)'
      : toast.type === 'error'
        ? 'var(--color-error-600)'
        : toast.type === 'warning'
          ? 'var(--color-warning-600)'
          : 'var(--color-info-600)'

  return (
    <div className={`toast toast-${toast.type}`} role="alert">
      <span
        className="toast-icon"
        style={{
          minWidth: '3rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.3rem 0.45rem',
          borderRadius: '9999px',
          fontSize: '0.68rem',
          fontWeight: '700',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          background: 'color-mix(in oklab, currentColor 10%, white)',
          color: toneColor,
        }}
      >
        {ICON_LABELS[toast.type]}
      </span>
      <p className="toast-message">{toast.message}</p>
      <button className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        x
      </button>
    </div>
  )
}
