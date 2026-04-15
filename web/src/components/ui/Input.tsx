import React, { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'

// ============ Input ============

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, required, leftIcon, rightIcon, className = '', id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`
    const inputClass = ['form-input', error ? 'form-input-error' : '', className].filter(Boolean).join(' ')

    return (
      <div className="form-group">
        {label && (
          <label htmlFor={inputId} className={`form-label ${required ? 'form-label-required' : ''}`}>
            {label}
          </label>
        )}
        <div className="input-wrapper" style={{ position: 'relative' }}>
          {leftIcon && (
            <span className="input-icon-left" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }}>
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={inputClass}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            style={leftIcon ? { paddingLeft: '40px' } : undefined}
            {...props}
          />
          {rightIcon && (
            <span className="input-icon-right" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }}>
              {rightIcon}
            </span>
          )}
        </div>
        {hint && !error && (
          <p id={`${inputId}-hint`} className="form-hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${inputId}-error`} className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

// ============ Textarea ============

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
  required?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, required, className = '', id, ...props }, ref) => {
    const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`
    const textareaClass = ['form-textarea', error ? 'form-textarea-error' : '', className].filter(Boolean).join(' ')

    return (
      <div className="form-group">
        {label && (
          <label htmlFor={textareaId} className={`form-label ${required ? 'form-label-required' : ''}`}>
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={textareaClass}
          aria-invalid={!!error}
          aria-describedby={error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined}
          {...props}
        />
        {hint && !error && (
          <p id={`${textareaId}-hint`} className="form-hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${textareaId}-error`} className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'

// ============ Select ============

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, required, options, placeholder, className = '', id, ...props }, ref) => {
    const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`
    const selectClass = ['form-select', error ? 'form-select-error' : '', className].filter(Boolean).join(' ')

    return (
      <div className="form-group">
        {label && (
          <label htmlFor={selectId} className={`form-label ${required ? 'form-label-required' : ''}`}>
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={selectClass}
          aria-invalid={!!error}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {hint && !error && (
          <p id={`${selectId}-hint`} className="form-hint">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${selectId}-error`} className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }
)

Select.displayName = 'Select'

// ============ Checkbox ============

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, className = '', id, ...props }, ref) => {
    const checkboxId = id || `checkbox-${Math.random().toString(36).substr(2, 9)}`

    return (
      <label htmlFor={checkboxId} className={`form-checkbox ${className}`}>
        <input ref={ref} type="checkbox" id={checkboxId} {...props} />
        <span>{label}</span>
      </label>
    )
  }
)

Checkbox.displayName = 'Checkbox'
