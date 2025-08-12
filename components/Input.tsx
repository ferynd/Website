import * as React from 'react';

// ===============================
// CONFIGURATION
// ===============================
// None

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  wrapperClassName?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, wrapperClassName = '', ...props }, ref) => {
    const autoId = React.useId();
    const inputId = id ?? autoId;

    const baseClasses = `bg-surface-1 border ${error ? 'border-error' : 'border-border'} text-text placeholder:text-text-3 rounded-lg px-3 py-2 focus:border-accent focus:ring-2 focus:ring-accent`;

    const inputElement = (
      <input
        id={inputId}
        ref={ref}
        className={`${baseClasses} ${className}`.trim()}
        {...props}
      />
    );

    if (!label && !error) {
      return inputElement;
    }

    return (
      <div className={wrapperClassName ? wrapperClassName : 'flex flex-col'}>
        {label && (
          <label htmlFor={inputId} className="text-text-2 text-sm font-medium mb-1">
            {label}
          </label>
        )}
        {inputElement}
        {error && <p className="text-error text-sm mt-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;
