import * as React from 'react';

// ===============================
// CONFIGURATION
// ===============================
// None

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  wrapperClassName?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className = '', id, wrapperClassName = '', children, ...props }, ref) => {
    const autoId = React.useId();
    const selectId = id ?? autoId;

    const baseClasses = `bg-surface-1 border ${error ? 'border-error' : 'border-border'} text-text placeholder:text-text-3 rounded-lg px-3 py-2 focus:border-accent focus:ring-2 focus:ring-accent`;

    const selectElement = (
      <select
        id={selectId}
        ref={ref}
        className={`${baseClasses} ${className}`.trim()}
        {...props}
      >
        {children}
      </select>
    );

    if (!label && !error) {
      return selectElement;
    }

    return (
      <div className={wrapperClassName ? wrapperClassName : 'flex flex-col'}>
        {label && (
          <label htmlFor={selectId} className="text-text-2 text-sm font-medium mb-1">
            {label}
          </label>
        )}
        {selectElement}
        {error && <p className="text-error text-sm mt-1">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
