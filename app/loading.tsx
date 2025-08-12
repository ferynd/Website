import type { CSSProperties } from 'react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: progress bar width (px) and animation duration */
/* ------------------------------------------------------------ */
const BAR_WIDTH = 256;
const ANIMATION_DURATION = 1500; // ms

export default function Loading() {
  const barStyle = { '--duration': `${ANIMATION_DURATION}ms` } as CSSProperties;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg text-text min-h-dvh">
      <div
        className="overflow-hidden rounded-full bg-surface-2"
        style={{ width: BAR_WIDTH, height: 4 }}
      >
        <div
          className="h-full w-full animate-[progress_var(--duration)_ease-in-out_infinite] bg-gradient-to-r from-accent via-purple to-magenta"
          style={barStyle}
        />
      </div>
    </div>
  );
}
