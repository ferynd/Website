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

    const baseClasses = `bg-surface-1 border ${error ? 'border-error' : 'border-border'} text-text placeholder:text-text-3 rounded-lg px-4 py-4 transition-all duration-200 ease-in-out hover:border-accent focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2`;

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
          <label htmlFor={selectId} className="text-text-2 text-sm font-medium mb-4">
            {label}
          </label>
        )}
        {selectElement}
        {error && <p className="text-error text-sm mt-4">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;
