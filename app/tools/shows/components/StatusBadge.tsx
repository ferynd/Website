import type { ShowStatus } from '../types';

const CONFIG: Record<ShowStatus, { label: string; className: string }> = {
  watching:  { label: 'Watching',   className: 'bg-info/20 text-info border-info/30' },
  completed: { label: 'Completed',  className: 'bg-success/20 text-success border-success/30' },
  dropped:   { label: 'Dropped',    className: 'bg-error/20 text-error border-error/30' },
  on_hold:   { label: 'On Hold',    className: 'bg-warning/20 text-warning border-warning/30' },
  planned:   { label: 'Planned',    className: 'bg-surface-2 text-text-2 border-border' },
};

export default function StatusBadge({ status }: { status: ShowStatus }) {
  const { label, className } = CONFIG[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
