import { describe, expect, it } from 'vitest';
import { formatCleanTranscript } from '../lib/formatCleanTranscript';
import type { TurnBlock } from '../lib/types';

function block(start: number, end: number, speaker: string, text: string, segmentCount = 1): TurnBlock {
  return { start, end, speaker, text, segmentCount };
}

describe('formatCleanTranscript', () => {
  it('returns an empty string for no blocks', () => {
    expect(formatCleanTranscript([])).toBe('');
  });

  it('formats a single block as [HH:MM:SS] Speaker: text', () => {
    const result = formatCleanTranscript([block(75, 80, 'Kait', 'Hello there.')]);
    expect(result).toBe('[00:01:15] Kait: Hello there.');
  });

  it('separates multiple blocks with a blank line and shows the timestamp only at each block start', () => {
    const result = formatCleanTranscript([
      block(0, 5, 'Kait', 'Hi James.'),
      block(6, 10, 'James', 'Hey, what is going on?'),
    ]);
    expect(result).toBe('[00:00:00] Kait: Hi James.\n\n[00:00:06] James: Hey, what is going on?');
    // No second timestamp embedded inside either single-line block's text.
    expect(result.match(/\[00:/g)).toHaveLength(2);
  });

  it('preserves block order as given (does not re-sort)', () => {
    const result = formatCleanTranscript([block(10, 12, 'James', 'Second.'), block(0, 2, 'Kait', 'First.')]);
    expect(result).toBe('[00:00:10] James: Second.\n\n[00:00:00] Kait: First.');
  });
});
