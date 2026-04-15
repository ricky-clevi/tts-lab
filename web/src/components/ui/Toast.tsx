import { useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'
import { createClientId } from '../../lib/clientIds'
import { ToastContext, type Toast, type ToastType } from './toast-context'

const ICON_LABEL_KEYS: Record<ToastType, string> = {
  success: 'toast.label.success',
  error: 'toast.label.error',
  warning: 'toast.label.warning',
  info: 'toast.label.info',
}

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
        {t(ICON_LABEL_KEYS[toast.type])}
      </span>
      <p className="toast-message">{toast.message}</p>
      <button className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label={t('toast.dismiss')}>
        x
      </button>
    </div>
  )
}
