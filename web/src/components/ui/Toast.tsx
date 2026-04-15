import { useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'
import { createClientId } from '../../lib/clientIds'
import { ToastContext, type Toast, type ToastType } from './toast-context'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback(
    (type: ToastType, message: string, duration = 5000) => {
      const id = createClientId('toast')
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

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  const container = (
    <div className="toast-container" role="region" aria-label={t('toast.regionLabel')}>
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

const TOAST_ICONS: Record<ToastType, string> = {
  success: '\u2713',
  error: '!',
  warning: '!',
  info: 'i',
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div className={`toast toast-${toast.type}`} role="alert">
      <span className={`toast-icon toast-icon-${toast.type}`} aria-hidden="true">
        {TOAST_ICONS[toast.type]}
      </span>
      <p className="toast-message">{toast.message}</p>
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(toast.id)}
        type="button"
        aria-label={t('toast.dismiss')}
      >
        <span aria-hidden="true">{'\u00D7'}</span>
      </button>
    </div>
  )
}
