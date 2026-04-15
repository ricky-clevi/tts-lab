import type { ReactNode, HTMLAttributes } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  hoverable?: boolean
}

export function Card({ children, hoverable = false, className = '', ...props }: CardProps) {
  const classes = ['card', hoverable ? 'card-hoverable' : '', className].filter(Boolean).join(' ')

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  )
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  gradient?: boolean
}

export function CardHeader({ children, gradient = false, className = '', ...props }: CardHeaderProps) {
  const classes = ['card-header', gradient ? 'card-header-gradient' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  )
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function CardBody({ children, className = '', ...props }: CardBodyProps) {
  return (
    <div className={`card-body ${className}`} {...props}>
      {children}
    </div>
  )
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function CardFooter({ children, className = '', ...props }: CardFooterProps) {
  return (
    <div className={`card-footer ${className}`} {...props}>
      {children}
    </div>
  )
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode
  as?: 'h1' | 'h2' | 'h3' | 'h4'
}

export function CardTitle({ children, as: Tag = 'h3', className = '', ...props }: CardTitleProps) {
  return (
    <Tag className={`card-title ${className}`} {...props}>
      {children}
    </Tag>
  )
}

export interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode
}

export function CardDescription({ children, className = '', ...props }: CardDescriptionProps) {
  return (
    <p className={`card-description ${className}`} {...props}>
      {children}
    </p>
  )
}
