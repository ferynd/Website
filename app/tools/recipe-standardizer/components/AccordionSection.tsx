'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { ChevronDown } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

interface AccordionSectionProps {
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * One top-level accordion panel. The parent owns open state so the sticky
 * top bar can expand + scroll to any panel. `scroll-mt-20` keeps the panel
 * heading visible below the sticky bar after a jump.
 */
const AccordionSection = forwardRef<HTMLElement, AccordionSectionProps>(
  ({ title, icon, subtitle, open, onToggle, children }, ref) => (
    <section ref={ref} className="scroll-mt-20 rounded-xl border border-border bg-surface-1 shadow-md">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left focus-ring rounded-xl"
      >
        {icon && <span className="text-accent flex-shrink-0">{icon}</span>}
        <span className="flex-1">
          <span className="text-lg font-semibold text-text">{title}</span>
          {subtitle && <span className="block text-sm text-text-3">{subtitle}</span>}
        </span>
        <ChevronDown
          size={20}
          className={`text-text-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  ),
);

AccordionSection.displayName = 'AccordionSection';

export default AccordionSection;
