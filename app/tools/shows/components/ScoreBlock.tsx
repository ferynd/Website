'use client';

import { type MemberRating, type WouldRewatch } from '../types';
import { memberComposite, formatScore } from '../lib/compositeScore';

interface Props {
  memberName: string;
  rating: MemberRating;
  editable: boolean;
  onChange?: (updated: Partial<MemberRating>) => void;
}

const REWATCH_OPTIONS: { value: WouldRewatch; label: string }[] = [
  { value: 'yes',   label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no',    label: 'No' },
];

function Slider({
  label,
  value,
  editable,
  onChange,
}: {
  label: string;
  value: number | null;
  editable: boolean;
  onChange?: (v: number) => void;
}) {
  const displayVal = value ?? 5;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-text-2">
        <span>{label}</span>
        <span className="font-medium text-text">{value !== null ? value : '—'}</span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={displayVal}
        disabled={!editable}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="w-full h-2 accent-[hsl(var(--color-accent))] disabled:opacity-40 cursor-pointer disabled:cursor-default"
      />
    </div>
  );
}

export default function ScoreBlock({ memberName, rating, editable, onChange }: Props) {
  const composite = memberComposite(rating);

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{memberName}</span>
        <span className="text-xs text-text-2">
          Score: <span className="text-accent font-semibold">{formatScore(composite)}</span>
        </span>
      </div>

      <Slider
        label="Story"
        value={rating.story}
        editable={editable}
        onChange={(v) => onChange?.({ story: v })}
      />
      <Slider
        label="Characters"
        value={rating.characters}
        editable={editable}
        onChange={(v) => onChange?.({ characters: v })}
      />
      <Slider
        label="Vibes"
        value={rating.vibes}
        editable={editable}
        onChange={(v) => onChange?.({ vibes: v })}
      />

      <div className="pt-1">
        <p className="text-xs text-text-2 mb-2">Would rewatch?</p>
        <div className="flex gap-2">
          {REWATCH_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              disabled={!editable}
              onClick={() => onChange?.({ wouldRewatch: value })}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium border transition-colors min-h-[36px] ${
                rating.wouldRewatch === value
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-surface-2 text-text-2 border-border hover:border-accent/30 disabled:opacity-40'
              } disabled:cursor-default`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
