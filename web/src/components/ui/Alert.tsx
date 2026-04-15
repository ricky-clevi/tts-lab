import type { HTMLAttributes, ReactNode } from 'react'
import { t } from '../../i18n'

export type AlertVariant = 'error' | 'success' | 'warning' | 'info'

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant
  title?: string
  children: ReactNode
  onDismiss?: () => void
}

const ICON_CHARS: Record<AlertVariant, string> = {
  error: '!',
  success: '\u2713',
  warning: '!',
  info: 'i',
}

export function Alert({ variant = 'info', title, children, onDismiss, className = '', ...props }: AlertProps) {
  const classes = ['alert', `alert-${variant}`, className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="alert" {...props}>
      <span className="alert-icon" aria-hidden="true">
        {ICON_CHARS[variant]}
      </span>
      <div className="alert-content">
        {title && <p className="alert-title">{title}</p>}
        <div>{children}</div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="alert-dismiss"
          type="button"
          aria-label={t('button.dismissMessage')}
        >
          <span aria-hidden="true">{'\u00D7'}</span>
        </button>
      )}
    </div>
  )
}
