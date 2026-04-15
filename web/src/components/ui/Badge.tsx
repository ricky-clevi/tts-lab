import React, { ReactNode, HTMLAttributes } from 'react'

export type BadgeVariant = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'admin' | 'user'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  children: ReactNode
}

export function Badge({ variant = 'primary', children, className = '', ...props }: BadgeProps) {
  const classes = ['badge', `badge-${variant}`, className].filter(Boolean).join(' ')

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  )
}
