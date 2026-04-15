import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Button } from './Button'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick?: () => void
    href?: string
  }
  className?: string
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {action &&
        (action.href ? (
          <a href={action.href} className="btn btn-primary">
            {action.label}
          </a>
        ) : (
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  )
}

export function NoDataEmptyState({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon="0"
      title={t('empty.noData.title')}
      description={t('empty.noData.description')}
      action={onAction ? { label: t('empty.noData.action'), onClick: onAction } : undefined}
    />
  )
}

export function NoSearchResultsEmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      icon="?"
      title={t('empty.noResults.title')}
      description={t('empty.noResults.description', { query })}
      action={{ label: t('empty.noResults.action'), onClick: onClear }}
    />
  )
}

export function ErrorEmptyState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="!"
      title={t('empty.error.title')}
      description={message || t('empty.error.description')}
      action={onRetry ? { label: t('empty.error.action'), onClick: onRetry } : undefined}
    />
  )
}
