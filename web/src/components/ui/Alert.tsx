import type { HTMLAttributes, ReactNode } from 'react'
import { t } from '../../i18n'

export type AlertVariant = 'error' | 'success' | 'warning' | 'info'

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  children: ReactNode
  onDismiss?: () => void
}

const LABEL_KEYS: Record<AlertVariant, string> = {
  error: 'alert.error',
  success: 'alert.success',
  warning: 'alert.warning',
  info: 'alert.info',
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
        {t(LABEL_KEYS[variant])}
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
          aria-label={t('button.dismissMessage')}
        >
          x
        </button>
      )}
    </div>
  )
}
