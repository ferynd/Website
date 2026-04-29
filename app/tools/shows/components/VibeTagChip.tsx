interface Props {
  tag: string;
  onRemove?: () => void;
  selected?: boolean;
  onClick?: () => void;
}

export default function VibeTagChip({ tag, onRemove, selected, onClick }: Props) {
  const base =
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors';
  const style = selected
    ? 'bg-accent/20 text-accent border-accent/40'
    : 'bg-surface-2 text-text-2 border-border hover:border-accent/40 hover:text-accent';

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} ${style} cursor-pointer`}>
        {tag}
      </button>
    );
  }

  return (
    <span className={`${base} ${selected ? style : 'bg-surface-2 text-text-2 border-border'}`}>
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 hover:text-error transition-colors"
          aria-label={`Remove ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
