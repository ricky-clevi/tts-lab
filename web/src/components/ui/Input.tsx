import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react'

function useStableFieldId(id: string | undefined, prefix: string): string {
  const generatedId = useId().replace(/:/g, '')
  return id ?? `${prefix}-${generatedId}`
}

// ============ Input ============

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  success?: boolean
  required?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, success, required, leftIcon, rightIcon, className = '', id, ...props }, ref) => {
    const inputId = useStableFieldId(id, 'input')
    const stateClass = error ? 'form-input-error' : success ? 'form-input-success' : ''
    const inputClass = ['form-input', stateClass, className].filter(Boolean).join(' ')

    return (
      <div className="form-group">
        {label && (
          <label htmlFor={inputId} className={`form-label ${required ? 'form-label-required' : ''}`}>
            {label}
          </label>
        )}
        <div className={`input-wrapper ${leftIcon ? 'input-wrapper--with-left-icon' : ''} ${rightIcon ? 'input-wrapper--with-right-icon' : ''}`}>
          {leftIcon && (
            <span className="input-icon input-icon--left" aria-hidden="true">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`${inputClass} ${leftIcon ? 'form-input--with-left-icon' : ''}`}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
          {rightIcon && (
            <span className="input-icon input-icon--right" aria-hidden="true">
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
  success?: boolean
  required?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, success, required, className = '', id, ...props }, ref) => {
    const textareaId = useStableFieldId(id, 'textarea')
    const stateClass = error ? 'form-textarea-error' : success ? 'form-textarea-success' : ''
    const textareaClass = ['form-textarea', stateClass, className].filter(Boolean).join(' ')

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
  success?: boolean
  required?: boolean
  options: SelectOption[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, success, required, options, placeholder, className = '', id, ...props }, ref) => {
    const selectId = useStableFieldId(id, 'select')
    const stateClass = error ? 'form-select-error' : success ? 'form-select-success' : ''
    const selectClass = ['form-select', stateClass, className].filter(Boolean).join(' ')

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
    const checkboxId = useStableFieldId(id, 'checkbox')

    return (
      <label htmlFor={checkboxId} className={`form-checkbox ${className}`}>
        <input ref={ref} type="checkbox" id={checkboxId} {...props} />
        <span>{label}</span>
      </label>
    )
  }
)

Checkbox.displayName = 'Checkbox'
