// Pure speaker-quality analyzer: measures how well speaker identity resolved
// across a reconciled transcript and decides whether the targeted
// language-model repair stage should run. Everything reported here is
// counts, labels, and durations — NEVER transcript text — so the whole
// report can go straight into the debug manifest.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import {
  QUALITY_WINDOW_SECONDS,
  REPAIR_TRIGGER_OVERALL_UNRESOLVED_PERCENT,
  REPAIR_TRIGGER_UNRESOLVED_RUN_SECONDS,
  REPAIR_TRIGGER_WINDOW_UNRESOLVED_PERCENT,
} from './constants';
import { countWords, isResolvedSegment } from './segmentProvenance';
import type { TranscriptSegment } from './types';

export interface SpeakerQualityOptions {
  /** Known speaker names for "chunks without a recognized known name" accounting. */
  knownNames: string[];
  /** How many language-model speaker repairs have been applied so far (0 before the repair stage). */
  repairsApplied?: number;
}

export interface SpeakerQualityReport {
  totalWords: number;
  namedWords: number;
  unresolvedWords: number;
  /** 0-100. 0 when the transcript is empty. */
  unresolvedPercent: number;
  windowSeconds: number;
  /** Per-QUALITY_WINDOW_SECONDS-window unresolved word percentages, in order. */
  windowUnresolvedPercents: number[];
  maxWindowUnresolvedPercent: number;
  /** Longest contiguous run of unresolved segments. */
  longestUnresolvedRunSeconds: number;
  longestUnresolvedRunWords: number;
  /** Distinct raw provider labels seen (sorted). */
  providerLabels: string[];
  /** Distinct stable local identities seen (count only — ids can embed labels). */
  localIdentityCount: number;
  /** Distinct resolved global speakers (sorted). */
  resolvedSpeakers: string[];
  /** Chunk indices whose provider labels mixed exact known names with anonymous labels (sorted). */
  mixedLabelChunks: number[];
  /** Segments flagged with directly conflicting mapping evidence. */
  mappingConflicts: number;
  /** Chunk boundaries where the speaker identity changed across the boundary. */
  chunkBoundaryIdentityChanges: number;
  /** Chunk indices in which no segment resolved to a known name (sorted). */
  chunksWithoutKnownNames: number[];
  /** Segments with no local identity at all — the Whisper-fallback signature. */
  whisperFallbackSegments: number;
  /** Segment counts by current-assignment confidence band. */
  confidenceDistribution: { high: number; medium: number; low: number; none: number };
  /** Language-model speaker repairs applied (from options; 0 before repair). */
  repairsApplied: number;
  triggers: {
    overallUnresolved: boolean;
    windowUnresolved: boolean;
    longUnresolvedRun: boolean;
    mappingConflict: boolean;
  };
  /** True when any trigger fired — the targeted repair stage should run. */
  needsRepair: boolean;
}

/**
 * Analyzes a reconciled transcript's speaker quality. Pure and text-free.
 * Repair triggers (centralized in lib/constants.ts):
 *   - overall unresolved words > REPAIR_TRIGGER_OVERALL_UNRESOLVED_PERCENT
 *   - any QUALITY_WINDOW_SECONDS window > REPAIR_TRIGGER_WINDOW_UNRESOLVED_PERCENT
 *   - any contiguous unresolved run > REPAIR_TRIGGER_UNRESOLVED_RUN_SECONDS
 *   - any direct mapping conflict
 */
export function analyzeSpeakerQuality(
  segments: TranscriptSegment[],
  options: SpeakerQualityOptions,
): SpeakerQualityReport {
  const knownNameSet = new Set(options.knownNames);
  const repairsApplied = options.repairsApplied ?? 0;

  let totalWords = 0;
  let namedWords = 0;
  let unresolvedWords = 0;
  const providerLabels = new Set<string>();
  const localIdentities = new Set<string>();
  const resolvedSpeakers = new Set<string>();
  let mappingConflicts = 0;
  let whisperFallbackSegments = 0;
  const confidenceDistribution = { high: 0, medium: 0, low: 0, none: 0 };

  // Per-chunk label bookkeeping for mixed-label + no-known-name reporting.
  const chunkHasExact = new Map<number, boolean>();
  const chunkHasAnonymous = new Map<number, boolean>();
  const chunkHasKnownName = new Map<number, boolean>();

  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const totalDuration = sorted.reduce((max, seg) => Math.max(max, seg.end), 0);
  const windowCount = totalDuration > 0 ? Math.ceil(totalDuration / QUALITY_WINDOW_SECONDS) : 0;
  const windowTotals = new Array<number>(windowCount).fill(0);
  const windowUnresolved = new Array<number>(windowCount).fill(0);

  let longestRunSeconds = 0;
  let longestRunWords = 0;
  let runStart: number | null = null;
  let runEnd = 0;
  let runWords = 0;

  let chunkBoundaryIdentityChanges = 0;
  let prev: TranscriptSegment | null = null;

  for (const seg of sorted) {
    const words = countWords(seg.text);
    const resolved = isResolvedSegment(seg);
    totalWords += words;
    if (resolved) namedWords += words;
    else unresolvedWords += words;

    if (seg.providerLabel !== undefined && seg.providerLabel !== '') providerLabels.add(seg.providerLabel);
    if (seg.localSpeakerId) localIdentities.add(seg.localSpeakerId);
    else whisperFallbackSegments += 1;
    if (seg.resolvedSpeaker) resolvedSpeakers.add(seg.resolvedSpeaker);
    else if (seg.userConfirmed && knownNameSet.has(seg.speaker)) resolvedSpeakers.add(seg.speaker);
    if (seg.mappingConflict) mappingConflicts += 1;

    const confidence = seg.speakerConfidence;
    if (confidence === undefined) confidenceDistribution.none += 1;
    else if (confidence >= 0.9) confidenceDistribution.high += 1;
    else if (confidence >= 0.7) confidenceDistribution.medium += 1;
    else confidenceDistribution.low += 1;

    const chunkIndex = seg.chunkIndex;
    if (chunkIndex !== undefined) {
      if (seg.mappingSource === 'provider-exact') chunkHasExact.set(chunkIndex, true);
      else if (seg.localSpeakerId?.includes('label:')) chunkHasAnonymous.set(chunkIndex, true);
      if (
        (seg.resolvedSpeaker && knownNameSet.has(seg.resolvedSpeaker)) ||
        (seg.userConfirmed && knownNameSet.has(seg.speaker))
      ) {
        chunkHasKnownName.set(chunkIndex, true);
      } else if (!chunkHasKnownName.has(chunkIndex)) {
        chunkHasKnownName.set(chunkIndex, false);
      }
    }

    // Window accounting: attribute the segment's words to the window its start falls in.
    if (windowCount > 0) {
      const w = Math.min(windowCount - 1, Math.floor(seg.start / QUALITY_WINDOW_SECONDS));
      windowTotals[w] += words;
      if (!resolved) windowUnresolved[w] += words;
    }

    // Longest unresolved run (contiguous unresolved segments).
    if (!resolved) {
      if (runStart === null) {
        runStart = seg.start;
        runWords = 0;
      }
      runEnd = Math.max(runEnd, seg.end);
      runWords += words;
      const runSeconds = runEnd - runStart;
      if (runSeconds > longestRunSeconds) longestRunSeconds = runSeconds;
      if (runWords > longestRunWords) longestRunWords = runWords;
    } else {
      runStart = null;
      runWords = 0;
    }

    // Chunk-boundary identity change: adjacent segments from different
    // chunks whose merge identity differs (display-string coincidence
    // doesn't count as continuity).
    if (
      prev &&
      prev.chunkIndex !== undefined &&
      seg.chunkIndex !== undefined &&
      prev.chunkIndex !== seg.chunkIndex
    ) {
      const prevKey = prev.userConfirmed
        ? `r:${prev.speaker}`
        : prev.resolvedSpeaker !== undefined
          ? `r:${prev.resolvedSpeaker}`
          : `l:${prev.localSpeakerId ?? ''}`;
      const segKey = seg.userConfirmed
        ? `r:${seg.speaker}`
        : seg.resolvedSpeaker !== undefined
          ? `r:${seg.resolvedSpeaker}`
          : `l:${seg.localSpeakerId ?? ''}`;
      if (prevKey !== segKey) chunkBoundaryIdentityChanges += 1;
    }
    prev = seg;
  }

  const unresolvedPercent = totalWords > 0 ? (unresolvedWords / totalWords) * 100 : 0;
  const windowUnresolvedPercents = windowTotals.map((total, i) =>
    total > 0 ? (windowUnresolved[i] / total) * 100 : 0,
  );
  const maxWindowUnresolvedPercent = windowUnresolvedPercents.reduce((max, p) => Math.max(max, p), 0);

  const mixedLabelChunks = [...chunkHasExact.keys()]
    .filter((chunkIndex) => chunkHasAnonymous.get(chunkIndex) === true)
    .sort((a, b) => a - b);
  const chunksWithoutKnownNames = [...chunkHasKnownName.entries()]
    .filter(([, hasName]) => !hasName)
    .map(([chunkIndex]) => chunkIndex)
    .sort((a, b) => a - b);

  const triggers = {
    overallUnresolved: unresolvedPercent > REPAIR_TRIGGER_OVERALL_UNRESOLVED_PERCENT,
    windowUnresolved: maxWindowUnresolvedPercent > REPAIR_TRIGGER_WINDOW_UNRESOLVED_PERCENT,
    longUnresolvedRun: longestRunSeconds > REPAIR_TRIGGER_UNRESOLVED_RUN_SECONDS,
    mappingConflict: mappingConflicts > 0,
  };

  return {
    totalWords,
    namedWords,
    unresolvedWords,
    unresolvedPercent,
    windowSeconds: QUALITY_WINDOW_SECONDS,
    windowUnresolvedPercents,
    maxWindowUnresolvedPercent,
    longestUnresolvedRunSeconds: longestRunSeconds,
    longestUnresolvedRunWords: longestRunWords,
    providerLabels: [...providerLabels].sort(),
    localIdentityCount: localIdentities.size,
    resolvedSpeakers: [...resolvedSpeakers].sort(),
    mixedLabelChunks,
    mappingConflicts,
    chunkBoundaryIdentityChanges,
    chunksWithoutKnownNames,
    whisperFallbackSegments,
    confidenceDistribution,
    repairsApplied,
    triggers,
    needsRepair:
      triggers.overallUnresolved || triggers.windowUnresolved || triggers.longUnresolvedRun || triggers.mappingConflict,
  };
}

/** One-line, text-free quality warning for the UI — null when quality is fine. */
export function buildQualityWarning(report: SpeakerQualityReport): string | null {
  if (!report.needsRepair) return null;
  const parts: string[] = [];
  if (report.triggers.overallUnresolved || report.triggers.windowUnresolved) {
    parts.push(`${report.unresolvedPercent.toFixed(1)}% of words have no confident speaker`);
  }
  if (report.triggers.longUnresolvedRun) {
    parts.push(`longest unresolved stretch ${Math.round(report.longestUnresolvedRunSeconds)}s`);
  }
  if (report.triggers.mappingConflict) {
    parts.push(`${report.mappingConflicts} segment(s) with conflicting speaker evidence`);
  }
  return `Speaker identification is uncertain in parts of this transcript (${parts.join('; ')}). Unresolved turns are labeled "Speaker A/B/…" — the transcript is still complete and downloadable.`;
}
