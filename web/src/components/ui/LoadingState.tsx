import '../../styles/ui/loading-state.css'

export interface LoadingStateProps {
  message: string
  className?: string
}

export function LoadingState({ message, className = '' }: LoadingStateProps) {
  const classes = ['loading-state', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div className="spinner" />
      <p>{message}</p>
    </div>
  )
}
