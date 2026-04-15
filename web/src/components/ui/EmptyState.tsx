import type { ReactNode } from 'react'
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
      {action && (
        action.href ? (
          <a href={action.href} className="btn btn-primary">
            {action.label}
          </a>
        ) : (
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      )}
    </div>
  )
}

// Pre-built empty states for common scenarios

export function NoDataEmptyState({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon="📭"
      title="No data yet"
      description="There's nothing here at the moment. Create something new to get started."
      action={onAction ? { label: 'Create New', onClick: onAction } : undefined}
    />
  )
}

export function NoSearchResultsEmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      icon="🔍"
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try adjusting your search.`}
      action={{ label: 'Clear Search', onClick: onClear }}
    />
  )
}

export function ErrorEmptyState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="⚠️"
      title="Something went wrong"
      description={message || 'An error occurred while loading data. Please try again.'}
      action={onRetry ? { label: 'Try Again', onClick: onRetry } : undefined}
    />
  )
}
