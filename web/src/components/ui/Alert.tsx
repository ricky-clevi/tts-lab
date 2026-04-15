import type { HTMLAttributes, ReactNode } from 'react'

export type AlertVariant = 'error' | 'success' | 'warning' | 'info'

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  children: ReactNode
  onDismiss?: () => void
}

const LABELS: Record<AlertVariant, string> = {
  error: 'Error',
  success: 'Success',
  warning: 'Warning',
  info: 'Info',
}

export function Alert({ variant = 'info', children, onDismiss, className = '', ...props }: AlertProps) {
  const classes = ['alert', `alert-${variant}`, className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="alert" {...props}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          minWidth: '3.25rem',
          justifyContent: 'center',
          padding: '0.35rem 0.55rem',
          borderRadius: '9999px',
          background: 'color-mix(in oklab, currentColor 8%, white)',
          fontSize: '0.7rem',
          fontWeight: '700',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {LABELS[variant]}
      </span>
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
          x
        </button>
      )}
    </div>
  )
}
