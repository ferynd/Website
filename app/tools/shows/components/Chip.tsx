'use client';

interface Props {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}

export default function Chip({ label, active, onClick, icon }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors min-h-[36px] ${
        active
          ? 'bg-accent/20 text-accent border-accent/40'
          : 'bg-surface-2 text-text-2 border-border hover:border-accent/30'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
