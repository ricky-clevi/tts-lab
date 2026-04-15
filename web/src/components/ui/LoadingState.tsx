import '../../styles/ui/loading-state.css'

export type LoadingStateVariant = 'default' | 'compact' | 'inline'

export interface LoadingStateProps {
  message?: string
  variant?: LoadingStateVariant
  className?: string
}

export function LoadingState({ message, variant = 'default', className = '' }: LoadingStateProps) {
  const variantClass = variant === 'default' ? '' : `loading-state-${variant}`
  const classes = ['loading-state', variantClass, className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      {message && <p>{message}</p>}
    </div>
  )
}
