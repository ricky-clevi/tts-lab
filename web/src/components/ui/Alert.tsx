import type { ReactNode, HTMLAttributes } from 'react'

export type AlertVariant = 'error' | 'success' | 'warning' | 'info'

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  children: ReactNode
  onDismiss?: () => void
}

export function Alert({ variant = 'info', children, onDismiss, className = '', ...props }: AlertProps) {
  const classes = ['alert', `alert-${variant}`, className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="alert" {...props}>
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 0 0 var(--space-4)',
            fontSize: 'var(--text-lg)',
            color: 'inherit',
            opacity: 0.7,
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  )
}
