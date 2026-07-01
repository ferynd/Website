export interface CorrectionSummary {
  failedChunks: number;
  totalChunks: number;
}

/**
 * Builds the "completed with warnings" message shown when one or more
 * correction chunks failed and fell back to their uncorrected segments.
 * Returns null when nothing failed (no warning to show).
 */
export function buildCorrectionWarning({ failedChunks, totalChunks }: CorrectionSummary): string | null {
  if (failedChunks <= 0) return null;
  const chunkWord = totalChunks === 1 ? 'chunk' : 'chunks';
  const verb = failedChunks === 1 ? 'was' : 'were';
  return `Completed with warnings: ${failedChunks} of ${totalChunks} correction ${chunkWord} failed and ${verb} left uncorrected.`;
}
