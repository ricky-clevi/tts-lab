import type { ReactNode, HTMLAttributes } from 'react'

export type BadgeVariant = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'admin' | 'user'
export type BadgeSize = 'sm' | 'md' | 'lg'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  children: ReactNode
}

export function Badge({ variant = 'primary', size = 'md', children, className = '', ...props }: BadgeProps) {
  const sizeClass = size === 'md' ? '' : `badge-${size}`
  const classes = ['badge', `badge-${variant}`, sizeClass, className].filter(Boolean).join(' ')

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  )
}
