'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: score labels                                  */
/* ------------------------------------------------------------ */

export const SCORE_LABELS: Record<number, string> = {
  1: 'Skip next time',
  2: 'Meh, not into it',
  3: 'Was OK',
  4: 'Decent',
  5: 'Good',
  6: 'Really enjoyed',
  7: 'Loved it',
  8: 'Awesome, do again soon',
  9: 'Top tier, new favorite',
};

interface ScorePickerProps {
  value: number;
  onChange: (score: number) => void;
}

export default function ScorePicker({ value, onChange }: ScorePickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {Object.keys(SCORE_LABELS).map((entry) => {
          const score = Number(entry);
          return (
            <button
              key={score}
              type="button"
              onClick={() => onChange(score)}
              className={`px-2 py-1 rounded text-sm ${value === score ? 'bg-accent text-black' : 'bg-surface-3 text-text'}`}
            >
              {score}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-text-3">{SCORE_LABELS[value]}</p>
    </div>
  );
}
