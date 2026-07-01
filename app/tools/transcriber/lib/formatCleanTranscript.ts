import { formatTimestamp } from './formatTranscript';
import type { TurnBlock } from './types';

/**
 * Builds the "cleaned" downloadable/copyable transcript text: one block per
 * speaker turn, `[HH:MM:SS] Speaker: text`, timestamp shown only once at the
 * start of each block, with a blank line between blocks. Blocks are rendered
 * in the order given — callers should pass output already sorted by start
 * time (mergeTurns' output is).
 */
export function formatCleanTranscript(blocks: TurnBlock[]): string {
  return blocks.map((block) => `[${formatTimestamp(block.start)}] ${block.speaker}: ${block.text}`).join('\n\n');
}
