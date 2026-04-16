import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'

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

function findEnabledOptionIndex(options: SelectOption[], startIndex: number, direction: 1 | -1): number {
  if (options.length === 0) {
    return -1
  }

  let index = startIndex
  for (let step = 0; step < options.length; step += 1) {
    if (index < 0) {
      index = options.length - 1
    }

    if (index >= options.length) {
      index = 0
    }

    if (!options[index]?.disabled) {
      return index
    }

    index += direction
  }

  return -1
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      label,
      hint,
      error,
      success,
      required,
      options,
      placeholder,
      className = '',
      id,
      value,
      defaultValue,
      onChange,
      onBlur,
      onFocus,
      disabled,
      name,
    },
    ref,
  ) => {
    const selectId = useStableFieldId(id, 'select')
    const stateClass = error ? 'form-select-error' : success ? 'form-select-success' : ''
    const selectClass = ['form-select', 'form-select-trigger', stateClass, className].filter(Boolean).join(' ')
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
    const [menuPlacement, setMenuPlacement] = useState<'top' | 'bottom'>('bottom')
    const [internalValue, setInternalValue] = useState(() => (typeof defaultValue === 'string' ? defaultValue : ''))

    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement, [])

    const isControlled = value !== undefined
    const currentValue = isControlled ? String(value ?? '') : internalValue
    const selectedOption = options.find((option) => option.value === currentValue) ?? null

    const describedBy = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined

    const syncMenuPosition = useCallback(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }

      const viewportHeight = window.innerHeight
      const viewportWidth = window.innerWidth
      const estimatedMenuHeight = Math.min(Math.max(options.length, 1) * 44 + 16, 320)
      const spaceBelow = viewportHeight - rect.bottom
      const spaceAbove = rect.top
      const shouldOpenUpward = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow
      const longestLabelLength = options.reduce(
        (maxLength, option) => Math.max(maxLength, option.label.trim().length),
        placeholder?.trim().length ?? 0,
      )
      const preferredWidth = Math.max(rect.width, Math.min(560, Math.max(260, longestLabelLength * 8.5 + 84)))
      const width = Math.min(preferredWidth, viewportWidth - 24)
      const left = Math.min(Math.max(12, rect.left), viewportWidth - width - 12)

      setMenuPlacement(shouldOpenUpward ? 'top' : 'bottom')
      setMenuStyle({
        left,
        top: shouldOpenUpward ? Math.max(12, rect.top - 8) : Math.min(viewportHeight - 12, rect.bottom + 8),
        width,
        transform: shouldOpenUpward ? 'translateY(-100%)' : undefined,
      })
    }, [options.length])

    useEffect(() => {
      if (!isOpen) {
        return
      }

      syncMenuPosition()

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node
        if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
          return
        }
        setIsOpen(false)
      }

      const handleViewportChange = () => syncMenuPosition()

      window.addEventListener('pointerdown', handlePointerDown, true)
      window.addEventListener('resize', handleViewportChange)
      window.addEventListener('scroll', handleViewportChange, true)

      return () => {
        window.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('resize', handleViewportChange)
        window.removeEventListener('scroll', handleViewportChange, true)
      }
    }, [isOpen, syncMenuPosition])

    useEffect(() => {
      if (!isOpen) {
        return
      }

      const selectedIndex = options.findIndex((option) => option.value === currentValue && !option.disabled)
      setHighlightedIndex(
        selectedIndex >= 0 ? selectedIndex : findEnabledOptionIndex(options, 0, 1),
      )
    }, [currentValue, isOpen, options])

    const commitValue = useCallback(
      (nextValue: string) => {
        if (!isControlled) {
          setInternalValue(nextValue)
        }

        onChange?.({
          target: { value: nextValue, name } as EventTarget & HTMLSelectElement,
          currentTarget: { value: nextValue, name } as EventTarget & HTMLSelectElement,
        } as ChangeEvent<HTMLSelectElement>)
      },
      [isControlled, name, onChange],
    )

    const openMenu = useCallback((preferredIndex?: number) => {
      if (disabled) {
        return
      }

      const selectedIndex = options.findIndex((option) => option.value === currentValue && !option.disabled)
      setIsOpen(true)
      setHighlightedIndex(
        preferredIndex ?? (selectedIndex >= 0 ? selectedIndex : findEnabledOptionIndex(options, 0, 1)),
      )
    }, [currentValue, disabled, options])

    const closeMenu = useCallback(() => {
      setIsOpen(false)
    }, [])

    const moveHighlight = useCallback((direction: 1 | -1) => {
      setHighlightedIndex((current) => {
        const startIndex = current >= 0 ? current + direction : direction > 0 ? 0 : options.length - 1
        return findEnabledOptionIndex(options, startIndex, direction)
      })
    }, [options])

    const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        return
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          if (!isOpen) {
            openMenu()
            return
          }
          moveHighlight(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          if (!isOpen) {
            openMenu(findEnabledOptionIndex(options, options.length - 1, -1))
            return
          }
          moveHighlight(-1)
          return
        case 'Home':
          if (!isOpen) {
            return
          }
          event.preventDefault()
          setHighlightedIndex(findEnabledOptionIndex(options, 0, 1))
          return
        case 'End':
          if (!isOpen) {
            return
          }
          event.preventDefault()
          setHighlightedIndex(findEnabledOptionIndex(options, options.length - 1, -1))
          return
        case 'Enter':
        case ' ':
          event.preventDefault()
          if (!isOpen) {
            openMenu()
            return
          }

          if (highlightedIndex >= 0 && options[highlightedIndex] && !options[highlightedIndex].disabled) {
            commitValue(options[highlightedIndex].value)
          }
          closeMenu()
          return
        case 'Escape':
          if (!isOpen) {
            return
          }
          event.preventDefault()
          closeMenu()
          return
        case 'Tab':
          closeMenu()
          return
      }
    }

    const menu = isOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            id={`${selectId}-listbox`}
            className="select-menu"
            role="listbox"
            aria-labelledby={label ? `${selectId}-label` : undefined}
            data-placement={menuPlacement}
            style={menuStyle}
          >
            {options.map((option, index) => {
              const isSelected = option.value === currentValue
              const isHighlighted = index === highlightedIndex

              return (
                <button
                  id={`${selectId}-option-${index}`}
                  key={option.value}
                  type="button"
                  role="option"
                  className={`select-option ${isSelected ? 'select-option-selected' : ''} ${isHighlighted ? 'select-option-highlighted' : ''}`}
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (option.disabled) {
                      return
                    }
                    commitValue(option.value)
                    closeMenu()
                    triggerRef.current?.focus()
                  }}
                >
                  <span className="select-option-label">{option.label}</span>
                  <span className="select-option-check" aria-hidden="true">
                    {isSelected ? (
                      <svg viewBox="0 0 16 16" fill="none">
                        <path d="M3 8.5 6.2 11.7 13 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

    return (
      <div className="form-group">
        {label && (
          <label id={`${selectId}-label`} htmlFor={selectId} className={`form-label ${required ? 'form-label-required' : ''}`}>
            {label}
          </label>
        )}
        <button
          ref={triggerRef}
          id={selectId}
          type="button"
          className={selectClass}
          role="combobox"
          aria-controls={`${selectId}-listbox`}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-labelledby={label ? `${selectId}-label ${selectId}-value` : `${selectId}-value`}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          aria-activedescendant={isOpen && highlightedIndex >= 0 ? `${selectId}-option-${highlightedIndex}` : undefined}
          disabled={disabled}
          onClick={() => (isOpen ? closeMenu() : openMenu())}
          onKeyDown={handleTriggerKeyDown}
          onFocus={(event) => onFocus?.(event as unknown as FocusEvent<HTMLSelectElement>)}
          onBlur={(event) => onBlur?.(event as unknown as FocusEvent<HTMLSelectElement>)}
        >
          <span
            id={`${selectId}-value`}
            className={`select-trigger-value ${selectedOption ? '' : 'select-trigger-value-placeholder'}`}
          >
            {selectedOption?.label ?? placeholder ?? ''}
          </span>
          <span className={`select-trigger-indicator ${isOpen ? 'select-trigger-indicator-open' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M3 6.25 8 10.75l5-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        {name ? <input type="hidden" name={name} value={currentValue} /> : null}
        {menu}
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
