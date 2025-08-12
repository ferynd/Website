import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: button variant and size classes               */
/* ------------------------------------------------------------ */
const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium rounded-lg focus-ring transition disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-black hover:bg-accent-600',
        secondary: 'bg-surface-2 text-text hover:bg-surface-3',
        danger: 'bg-error text-white hover:bg-error/90',
        success: 'bg-success text-white hover:bg-success/90',
        ghost: 'bg-transparent text-text hover:bg-surface-2',
      },
      size: {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2',
        lg: 'px-6 py-3 rounded-xl text-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={buttonVariants({ variant, size, className })}
        {...props}
      >
        {loading && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button, buttonVariants };
export default Button;

