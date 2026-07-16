// Deterministic global speaker reconciliation — runs once client-side after
// all transcription chunks are combined, BEFORE any language-model stage.
// Pure: no fetch, no model calls, no randomness. Evidence sources, strongest
// first:
//
//   1. Acoustically anchored exact names (mappingSource 'acoustic' — an
//      OpenAI exact match with ACCEPTED reference clips) — the only
//      per-segment source trusted enough to resolve a cluster on its own.
//   2. Stable local identity inside each chunk (identities are the unit of
//      clustering; every segment sharing one moves together).
//   3. Matching overlap segments — the same speech transcribed by two
//      neighboring chunks links their local identities outright.
//   4. Adjacent-chunk continuity — speech continuing across a chunk boundary
//      within a small gap (candidate-level evidence only).
//   5. Short-gap continuity — a slightly larger boundary gap (weaker
//      candidate-level evidence).
//   6. Reference-clip ACCEPTANCE status (not mere attachment — a rejected
//      clip must never be treated as an acoustic anchor; see
//      mappingSource 'acoustic' vs 'provider-exact').
//   7. Speaker notes — supporting evidence only, recorded in the report and
//      passed to the repair stage, never used to assign a name here.
//
// Unverified exact-name guesses (mappingSource 'provider-exact' — no
// accepted clips for OpenAI, or ANY Gemini match) and first-appearance
// positional guesses (mappingSource 'positional', regardless of chunk index)
// are never anchor-grade on their own: they contribute PRIOR-tier evidence
// only, and a cluster can auto-resolve ONLY when its top name's ANCHOR
// evidence (acoustic clip match, a prior repair, an earlier reconciliation
// pass, or a user confirmation) clears SPEAKER_ASSIGN_MIN_CONFIDENCE. This is
// what keeps an unanchored guess from becoming a high-confidence assignment
// without independent corroboration — see lib/constants.ts and the
// per-segment provenance doc in lib/types.ts.
//
// Confidence policy is centralized in lib/constants.ts:
//   >= SPEAKER_ASSIGN_MIN_CONFIDENCE (0.9) of ANCHOR evidence: assign
//   automatically. [SPEAKER_CANDIDATE_MIN_CONFIDENCE, assign) of combined
//   (anchor+prior) evidence: retain candidate, display unresolved — also
//   the state a purely provider-exact/positional recording (no clips) stays
//   in until repair, user confirmation, or a genuine overlap/continuity link
//   to an anchor resolves it. Below: unresolved. Two anchors within
//   SPEAKER_CONFLICT_MARGIN of each other are conflicting evidence — the
//   cluster stays unresolved and is recorded.
//
// The interfaces here (evidence maps keyed by speaker, OverlapLink) are the
// intended attachment point for future acoustic-embedding evidence — an
// embedding comparison would contribute one more score per (identity, name)
// without changing the clustering or thresholding below. Deliberately no
// ONNX/embedding dependency in this iteration.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import {
  ADJACENT_CONTINUITY_CONFIDENCE,
  ADJACENT_CONTINUITY_MAX_GAP_SECONDS,
  MAPPING_ALGORITHM_VERSION,
  POSITIONAL_LATER_CHUNK_CONFIDENCE,
  SHORT_GAP_CONTINUITY_CONFIDENCE,
  SHORT_GAP_CONTINUITY_MAX_GAP_SECONDS,
  SPEAKER_ASSIGN_MIN_CONFIDENCE,
  SPEAKER_CANDIDATE_MIN_CONFIDENCE,
  SPEAKER_CONFLICT_MARGIN,
} from './constants';
import type { TranscriptSegment } from './types';

/** Two chunk-local identities that transcribed the same overlap audio — the
 * strongest cross-chunk link (the audio is literally the same speech). */
export interface OverlapLink {
  localSpeakerIdA: string;
  localSpeakerIdB: string;
}

export interface ReconcileOptions {
  knownNames: string[];
  /** Cross-chunk identity links from overlap-region matching — see matchOverlapLinks. */
  overlapLinks?: OverlapLink[];
  /** Per-speaker notes, parallel to knownNames — supporting evidence only (recorded, never assigns). */
  speakerNotes?: string[];
}

export interface SpeakerReconcileReport {
  algorithmVersion: string;
  identityCount: number;
  clusterCount: number;
  resolvedClusters: number;
  candidateClusters: number;
  conflictClusters: number;
  unresolvedClusters: number;
  /** Positional (first-appearance) assignments in chunks after the first,
   * demoted to candidate strength — the cross-chunk swap risk this stage exists to catch. */
  demotedPositionalIdentities: number;
  overlapLinksUsed: number;
  continuityLinksUsed: number;
  /** How many segments this stage changed (speaker display, resolution, or conflict flag). */
  segmentsChanged: number;
  /** True when per-speaker notes were supplied (supporting evidence only). */
  speakerNotesSupplied: boolean;
}

export interface ReconcileResult<T extends TranscriptSegment> {
  segments: T[];
  report: SpeakerReconcileReport;
}

/* ------------------------------------------------------------ */
/* Overlap matching                                              */
/* ------------------------------------------------------------ */

/** Timestamps of the same speech transcribed by two different chunks can
 * disagree by a little — this is the match tolerance, in seconds. */
const OVERLAP_MATCH_MAX_START_DELTA_SECONDS = 2;
/** Minimum normalized-text length for a prefix (rather than full-equality)
 * match — very short lines ("yeah") are too generic to link identities. */
const OVERLAP_PREFIX_MATCH_MIN_CHARS = 15;

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minimum normalized-text length for ANY overlap match — a time-coincident
 * "yeah" across two chunks is too generic to link identities on. */
const OVERLAP_MATCH_MIN_CHARS = 12;

function textsMatch(a: string, b: string): boolean {
  if (a.length < OVERLAP_MATCH_MIN_CHARS || b.length < OVERLAP_MATCH_MIN_CHARS) return false;
  if (a === b) return true;
  if (a.length < OVERLAP_PREFIX_MATCH_MIN_CHARS || b.length < OVERLAP_PREFIX_MATCH_MIN_CHARS) return false;
  const prefix = Math.min(a.length, b.length, 24);
  return a.slice(0, prefix) === b.slice(0, prefix);
}

/**
 * Matches `duplicates` (overlap-region segments about to be dropped by
 * chunk combination) against `owned` (the segments that keep that region)
 * and returns identity links for pairs that transcribed the same speech:
 * start times within tolerance AND matching normalized text, both carrying a
 * local identity, from different chunks. Deterministic: each duplicate links
 * to the closest-in-time owned match only.
 */
export function matchOverlapLinks(owned: TranscriptSegment[], duplicates: TranscriptSegment[]): OverlapLink[] {
  const links: OverlapLink[] = [];
  const seen = new Set<string>();

  for (const dup of duplicates) {
    if (!dup.localSpeakerId) continue;
    const dupText = normalizeForMatch(dup.text);
    let best: TranscriptSegment | null = null;
    let bestDelta = Infinity;
    for (const own of owned) {
      if (!own.localSpeakerId || own.localSpeakerId === dup.localSpeakerId) continue;
      if (own.chunkIndex === dup.chunkIndex) continue;
      const delta = Math.abs(own.start - dup.start);
      if (delta > OVERLAP_MATCH_MAX_START_DELTA_SECONDS) continue;
      if (!textsMatch(normalizeForMatch(own.text), dupText)) continue;
      if (delta < bestDelta) {
        best = own;
        bestDelta = delta;
      }
    }
    if (best) {
      const key = [dup.localSpeakerId, best.localSpeakerId].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ localSpeakerIdA: dup.localSpeakerId, localSpeakerIdB: best.localSpeakerId! });
      }
    }
  }

  return links;
}

/** Warning appended when an overlap-region segment couldn't be confidently
 * matched to its neighboring chunk/window's version AND genuinely overlapped
 * it in time — retained rather than dropped (see resolveOverlapDuplicates),
 * but worth flagging since it may read as a duplicate line. Shared by the
 * OpenAI chunked path (lib/preprocessAudioPlan.ts) and the Gemini windowed
 * path (lib/providers/geminiProvider.ts via resolveWindowOverlaps below). */
export const POSSIBLE_OVERLAP_DUPLICATE_WARNING =
  'A chunk-boundary segment could not be confidently matched to its neighboring chunk — it was kept rather than discarded, so a line may appear duplicated near a chunk boundary.';

export interface ResolveOverlapDuplicatesResult {
  /** Owned segments, each possibly upgraded (text/span extended) when a
   * matching duplicate turned out to be the more complete version. */
  owned: TranscriptSegment[];
  /** Duplicates that could NOT be reliably matched to an owned segment —
   * retained as their own segments rather than silently discarded. */
  retainedDuplicates: TranscriptSegment[];
  links: OverlapLink[];
  /** True when at least one duplicate temporally overlapped an owned
   * segment but didn't reliably text-match — retained, but worth flagging
   * as a possible (unconfirmed) duplicate line. */
  hasPossibleDuplicate: boolean;
}

/**
 * Resolves chunk-boundary overlap duplicates against the segments that own
 * that region: a duplicate is dropped ONLY when it reliably matches an
 * owned segment — timing tolerance + normalized-text match, from different
 * chunks. Unlike matchOverlapLinks, a local identity on either side is NOT
 * required to match: reliable text+time matching alone is enough to safely
 * drop a duplicate, so a Whisper-fallback segment (no local identity at
 * all) can still be deduplicated instead of always surviving twice. Identity
 * is only required to also record a link — see the link-creation comment
 * below. When two segments match, whichever has the longer trimmed text
 * is treated as the more complete version and is what survives (extending
 * the owned segment's span to cover both, or replacing its text, as
 * needed); a match with equal-length text keeps the owned segment
 * unchanged. A duplicate with NO reliable match is RETAINED rather than
 * dropped — losing speech silently is worse than an occasional duplicate
 * line. `hasPossibleDuplicate` flags a retained duplicate that genuinely
 * overlaps an owned segment's time range without a confident text match,
 * so the caller can surface a warning instead of staying silent about the
 * ambiguity.
 */
export function resolveOverlapDuplicates(
  owned: TranscriptSegment[],
  duplicates: TranscriptSegment[],
): ResolveOverlapDuplicatesResult {
  const ownedOut = owned.slice();
  const retainedDuplicates: TranscriptSegment[] = [];
  const links: OverlapLink[] = [];
  const seenLinkKeys = new Set<string>();
  let hasPossibleDuplicate = false;

  for (const dup of duplicates) {
    const dupText = normalizeForMatch(dup.text);
    let bestIndex = -1;
    let bestDelta = Infinity;
    let sawTemporalOverlap = false;

    for (let i = 0; i < ownedOut.length; i++) {
      const own = ownedOut[i];
      if (own.chunkIndex === dup.chunkIndex) continue;
      // Temporal overlap is tracked independently of identity/text matching
      // — it drives the "possible duplicate" warning even when a confident
      // match can't be established.
      if (own.start < dup.end && own.end > dup.start) sawTemporalOverlap = true;

      // Unlike matchOverlapLinks (which exists to DISCOVER links between
      // DIFFERENT identities), identity is not required to match here at
      // all — a known name's global identity (mapSpeakerLabels.ts's
      // knownNameIdentity) is the SAME localSpeakerId in every chunk, so
      // excluding a shared identity would make this dedup unreachable for
      // named speakers, and Whisper-fallback segments carry NO
      // localSpeakerId at all (whisper has no speaker concept), so
      // requiring one would make this dedup unreachable for every Whisper
      // chunk overlap too — reliable text+time matching alone is enough to
      // safely drop a duplicate; identity only affects whether a link is
      // also worth recording (see below).
      const delta = Math.abs(own.start - dup.start);
      if (delta > OVERLAP_MATCH_MAX_START_DELTA_SECONDS) continue;
      if (!textsMatch(normalizeForMatch(own.text), dupText)) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      const own = ownedOut[bestIndex];
      // Only a genuine link between two DIFFERENT identities is worth
      // recording — a self-link (already the same global name identity)
      // would be a no-op union that just inflates overlapLinksUsed.
      if (own.localSpeakerId && dup.localSpeakerId && own.localSpeakerId !== dup.localSpeakerId) {
        const key = [own.localSpeakerId, dup.localSpeakerId].sort().join('|');
        if (!seenLinkKeys.has(key)) {
          seenLinkKeys.add(key);
          links.push({ localSpeakerIdA: dup.localSpeakerId, localSpeakerIdB: own.localSpeakerId });
        }
      }
      // Deterministically choose the more complete version: strictly
      // longer trimmed text wins (a truncated chunk-boundary segment loses
      // to the neighbor's fuller capture of the same utterance); ties keep
      // the owned segment as-is.
      if (dup.text.trim().length > own.text.trim().length) {
        ownedOut[bestIndex] = {
          ...own,
          text: dup.text,
          start: Math.min(own.start, dup.start),
          end: Math.max(own.end, dup.end),
        };
      }
      // A confidently matched duplicate is dropped — its content survives
      // via the (possibly upgraded) owned segment above.
    } else {
      // No reliable text+time match — retain rather than silently lose
      // speech. Identity-less duplicates (e.g. Whisper fallback, which has
      // no localSpeakerId at all) land here too whenever they don't
      // reliably match — reliable text+time alone is enough to dedupe them
      // above (identity is never required to match, only to also record a
      // link) — as does genuinely new content that merely started a little
      // before the core boundary.
      retainedDuplicates.push(dup);
      if (sawTemporalOverlap) hasPossibleDuplicate = true;
    }
  }

  return { owned: ownedOut, retainedDuplicates, links, hasPossibleDuplicate };
}

/** One transcription window's result — structural type so this file stays
 * free of an import cycle with the callers (geminiProvider.ts,
 * stitchTranscript.ts). Timestamps are absolute recording time in both cores
 * and overlaps (the Gemini windowed path). */
export interface WindowedChunkResult {
  window: { index: number; coreStart: number; coreEnd: number };
  segments: TranscriptSegment[];
}

/** Splits windowed results into segments owned by their window's core vs.
 * overlap duplicates belonging to a neighboring window's core — shared by
 * collectWindowOverlapLinks (which only needs the resulting links) and
 * resolveWindowOverlaps (which also needs the final loss-safe segment list). */
function splitWindowedOwnedAndDuplicates(
  results: WindowedChunkResult[],
): { owned: TranscriptSegment[]; duplicates: TranscriptSegment[] } {
  const lastIndex = results.reduce((max, r) => Math.max(max, r.window.index), 0);
  const owned: TranscriptSegment[] = [];
  const duplicates: TranscriptSegment[] = [];
  for (const { window, segments } of results) {
    const isLastWindow = window.index === lastIndex;
    for (const seg of segments) {
      const inCore = seg.start >= window.coreStart && (isLastWindow || seg.start < window.coreEnd);
      (inCore ? owned : duplicates).push(seg);
    }
  }
  return { owned, duplicates };
}

/**
 * Recovers overlap identity links from windowed results BEFORE core-only
 * stitching discards the overlap segments (lib/stitchTranscript.ts keeps
 * only each window's core).
 */
export function collectWindowOverlapLinks(results: WindowedChunkResult[]): OverlapLink[] {
  const { owned, duplicates } = splitWindowedOwnedAndDuplicates(results);
  return duplicates.length > 0 ? matchOverlapLinks(owned, duplicates) : [];
}

export interface ResolveWindowOverlapsResult {
  /** Final, sorted, loss-safe segment list — the windowed-path replacement
   * for lib/stitchTranscript.ts's unconditional core-only keep. */
  segments: TranscriptSegment[];
  links: OverlapLink[];
  /** True when a retained overlap segment genuinely time-overlapped an owned
   * segment without a confident text match — see POSSIBLE_OVERLAP_DUPLICATE_WARNING. */
  hasPossibleDuplicate: boolean;
}

/**
 * Loss-safe replacement for keeping only each window's [coreStart, coreEnd)
 * region: an overlap segment is only ever DROPPED when it reliably matches
 * an owned neighbor-window segment (lib/reconcileSpeakers.ts's
 * resolveOverlapDuplicates — same rule the OpenAI chunked path uses in
 * lib/preprocessAudioPlan.ts's combineChunkResponses); anything without a
 * reliable match is retained rather than silently discarded, mirroring the
 * OpenAI path's loss-safety for the Gemini windowed path.
 */
export function resolveWindowOverlaps(results: WindowedChunkResult[]): ResolveWindowOverlapsResult {
  const { owned, duplicates } = splitWindowedOwnedAndDuplicates(results);
  if (duplicates.length === 0) {
    return { segments: [...owned].sort((a, b) => a.start - b.start), links: [], hasPossibleDuplicate: false };
  }
  const { owned: resolvedOwned, retainedDuplicates, links, hasPossibleDuplicate } = resolveOverlapDuplicates(
    owned,
    duplicates,
  );
  const segments = [...resolvedOwned, ...retainedDuplicates].sort((a, b) => a.start - b.start);
  return { segments, links, hasPossibleDuplicate };
}

/* ------------------------------------------------------------ */
/* Union-find over local identities                              */
/* ------------------------------------------------------------ */

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Deterministic root selection: lexicographically smaller wins.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

/* ------------------------------------------------------------ */
/* Reconciliation                                                */
/* ------------------------------------------------------------ */

/**
 * Evidence for one (identity/cluster, name) pair, in two tiers:
 * - `anchor`: deterministic assignment-grade evidence (exact provider names,
 *   user confirmations, a recording's first-chunk positional mapping).
 * - `prior`: weak directional evidence (a LATER chunk's demoted positional
 *   guess, boundary-continuity transfers). Priors can make a candidate but
 *   never trigger a conflict against an anchor — a wrong first-appearance
 *   guess in chunk 7 must not veto a solid overlap-derived assignment.
 */
interface EvidenceScore {
  anchor: number;
  prior: number;
}

type EvidenceMap = Map<string, EvidenceScore>;

interface IdentityInfo {
  id: string;
  segmentIndices: number[];
  firstStart: number;
  evidence: EvidenceMap;
  /** Names the user manually confirmed on this identity's segments — the
   * ultimate evidence tier: one confirmed name resolves the cluster
   * outright; two different ones are a recorded conflict. */
  userNames: Set<string>;
  demotedPositional: boolean;
}

interface SoftLink {
  a: string; // identity id
  b: string;
  weight: number;
}

function addEvidence(evidence: EvidenceMap, name: string, score: number, anchored: boolean): void {
  let entry = evidence.get(name);
  if (!entry) {
    entry = { anchor: 0, prior: 0 };
    evidence.set(name, entry);
  }
  if (anchored) entry.anchor = Math.max(entry.anchor, score);
  else entry.prior = Math.max(entry.prior, score);
}

function effectiveScore(entry: EvidenceScore): number {
  return Math.max(entry.anchor, entry.prior);
}

/** Global display label for the n-th unresolved cluster (0-based): Speaker A..Z, then Speaker 27, 28, ... */
export function globalUnresolvedLabel(index: number): string {
  if (index < 26) return `Speaker ${String.fromCharCode(65 + index)}`;
  return `Speaker ${index + 1}`;
}

/**
 * Reconciles chunk-local speaker identities into global speakers. Returns
 * new segment objects (input untouched) plus a text-free report for the
 * debug manifest. Segments without a local identity (Whisper) pass through
 * unchanged. User-confirmed segments are never modified — but their
 * confirmed name contributes full-strength evidence to their identity's
 * cluster.
 */
export function reconcileSpeakers<T extends TranscriptSegment>(
  segments: T[],
  options: ReconcileOptions,
): ReconcileResult<T> {
  const { knownNames, overlapLinks = [], speakerNotes = [] } = options;
  const knownNameSet = new Set(knownNames);

  // --- Gather identities and seed evidence (sources 1, 2, 6, and user confirmations). ---
  const identities = new Map<string, IdentityInfo>();
  let demotedPositional = 0;

  segments.forEach((seg, index) => {
    const id = seg.localSpeakerId;
    if (!id) return;
    let info = identities.get(id);
    if (!info) {
      info = {
        id,
        segmentIndices: [],
        firstStart: seg.start,
        evidence: new Map(),
        userNames: new Set(),
        demotedPositional: false,
      };
      identities.set(id, info);
    }
    info.segmentIndices.push(index);
    if (seg.start < info.firstStart) info.firstStart = seg.start;

    if (seg.userConfirmed && knownNameSet.has(seg.speaker)) {
      info.userNames.add(seg.speaker);
      addEvidence(info.evidence, seg.speaker, 1, true);
      return;
    }

    // ANCHOR-grade: a genuinely resolved per-segment source — a clip-
    // verified exact match, a prior repair, or an earlier reconciliation
    // pass (defensive: reconcileSpeakers runs once per pipeline run today,
    // but this keeps the function correct if ever re-invoked on already-
    // reconciled data). Contributes full anchor evidence.
    if (
      seg.resolvedSpeaker &&
      knownNameSet.has(seg.resolvedSpeaker) &&
      typeof seg.speakerConfidence === 'number' &&
      (seg.mappingSource === 'acoustic' || seg.mappingSource === 'repair' || seg.mappingSource === 'reconciliation')
    ) {
      addEvidence(info.evidence, seg.resolvedSpeaker, seg.speakerConfidence, true);
      return;
    }

    // PRIOR-grade: a real signal, but never sufficient on its own — an
    // unverified exact-name guess (no accepted clips for OpenAI, or any
    // Gemini match) or a first-appearance positional guess. Neither
    // auto-resolves without independent corroboration (an overlap/
    // continuity link to an anchor-bearing identity, a user confirmation,
    // or the repair stage) — see the module header.
    const candidateName = seg.candidateSpeaker ?? seg.resolvedSpeaker;
    if (
      candidateName &&
      knownNameSet.has(candidateName) &&
      typeof seg.speakerConfidence === 'number' &&
      (seg.mappingSource === 'provider-exact' || seg.mappingSource === 'positional')
    ) {
      const score =
        seg.mappingSource === 'positional' && (seg.chunkIndex ?? 0) > 0
          ? Math.min(seg.speakerConfidence, POSITIONAL_LATER_CHUNK_CONFIDENCE)
          : seg.speakerConfidence;
      addEvidence(info.evidence, candidateName, score, false);
      if (seg.mappingSource === 'positional' && !info.demotedPositional) {
        info.demotedPositional = true;
        demotedPositional += 1;
      }
    }
  });

  // --- Source 3: overlap links (same audio, two chunks) — union outright. ---
  const uf = new UnionFind();
  let overlapLinksUsed = 0;
  for (const link of overlapLinks) {
    if (identities.has(link.localSpeakerIdA) && identities.has(link.localSpeakerIdB)) {
      uf.union(link.localSpeakerIdA, link.localSpeakerIdB);
      overlapLinksUsed += 1;
    }
  }

  // --- Sources 4/5: boundary continuity — candidate-level soft links. ---
  const softLinks: SoftLink[] = [];
  const sortedWithIdentity = segments
    .filter((seg) => seg.localSpeakerId)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sortedWithIdentity.length; i++) {
    const prev = sortedWithIdentity[i - 1];
    const next = sortedWithIdentity[i];
    if ((prev.chunkIndex ?? 0) === (next.chunkIndex ?? 0)) continue;
    if (prev.localSpeakerId === next.localSpeakerId) continue;
    const gap = next.start - prev.end;
    if (gap < 0) continue;
    let weight: number | null = null;
    if (gap <= ADJACENT_CONTINUITY_MAX_GAP_SECONDS) weight = ADJACENT_CONTINUITY_CONFIDENCE;
    else if (gap <= SHORT_GAP_CONTINUITY_MAX_GAP_SECONDS) weight = SHORT_GAP_CONTINUITY_CONFIDENCE;
    if (weight !== null) {
      softLinks.push({ a: prev.localSpeakerId!, b: next.localSpeakerId!, weight });
    }
  }

  // --- Build clusters and merge evidence. ---
  interface Cluster {
    root: string;
    identityIds: string[];
    segmentIndices: number[];
    firstStart: number;
    evidence: EvidenceMap;
    userNames: Set<string>;
  }
  const clusters = new Map<string, Cluster>();
  for (const info of identities.values()) {
    const root = uf.find(info.id);
    let cluster = clusters.get(root);
    if (!cluster) {
      cluster = {
        root,
        identityIds: [],
        segmentIndices: [],
        firstStart: info.firstStart,
        evidence: new Map(),
        userNames: new Set(),
      };
      clusters.set(root, cluster);
    }
    cluster.identityIds.push(info.id);
    cluster.segmentIndices.push(...info.segmentIndices);
    if (info.firstStart < cluster.firstStart) cluster.firstStart = info.firstStart;
    for (const name of info.userNames) cluster.userNames.add(name);
    for (const [name, entry] of info.evidence) {
      if (entry.anchor > 0) addEvidence(cluster.evidence, name, entry.anchor, true);
      if (entry.prior > 0) addEvidence(cluster.evidence, name, entry.prior, false);
    }
  }

  // --- Propagate soft-link evidence between clusters (one deterministic round). ---
  // A cluster's pre-propagation best candidate transfers to soft-linked
  // neighbors at min(score, linkWeight), always as a PRIOR — continuity
  // alone can never auto-assign or create a conflict.
  const preBest = new Map<string, { name: string; score: number } | null>();
  for (const [root, cluster] of clusters) {
    let best: { name: string; score: number } | null = null;
    for (const [name, entry] of cluster.evidence) {
      const score = effectiveScore(entry);
      if (!best || score > best.score || (score === best.score && name < best.name)) best = { name, score };
    }
    preBest.set(root, best);
  }
  let continuityLinksUsed = 0;
  for (const link of softLinks) {
    const rootA = uf.find(link.a);
    const rootB = uf.find(link.b);
    if (rootA === rootB) continue;
    const bestA = preBest.get(rootA);
    const bestB = preBest.get(rootB);
    let used = false;
    if (bestA && bestA.score >= SPEAKER_CANDIDATE_MIN_CONFIDENCE) {
      addEvidence(clusters.get(rootB)!.evidence, bestA.name, Math.min(bestA.score, link.weight), false);
      used = true;
    }
    if (bestB && bestB.score >= SPEAKER_CANDIDATE_MIN_CONFIDENCE) {
      addEvidence(clusters.get(rootA)!.evidence, bestB.name, Math.min(bestB.score, link.weight), false);
      used = true;
    }
    if (used) continuityLinksUsed += 1;
  }

  // --- Resolve each cluster against the centralized confidence policy. ---
  type ClusterStatus =
    | { kind: 'resolved'; name: string; score: number }
    | { kind: 'candidate'; name: string; score: number }
    | { kind: 'conflict'; name: string; score: number }
    | { kind: 'unresolved' };
  const statusByRoot = new Map<string, ClusterStatus>();
  let resolvedClusters = 0;
  let candidateClusters = 0;
  let conflictClusters = 0;
  let unresolvedClusters = 0;

  for (const [root, cluster] of clusters) {
    const ranked = [...cluster.evidence.entries()].sort(
      (a, b) => effectiveScore(b[1]) - effectiveScore(a[1]) || (a[0] < b[0] ? -1 : 1),
    );
    const top = ranked[0];
    const topScore = top ? effectiveScore(top[1]) : 0;

    // Conflict detection prefers ANCHOR evidence: two assignment-grade
    // signals for different names within the margin are irreconcilable; a
    // weak prior disagreeing with a solid anchor is not (the anchor simply
    // wins below). But when NEITHER name has any anchor at all, two
    // prior-only claims within the margin are just as irreconcilable — see
    // hasPriorOnlyConflict below.
    const anchorRanked = [...cluster.evidence.entries()]
      .filter(([, entry]) => entry.anchor >= SPEAKER_CANDIDATE_MIN_CONFIDENCE)
      .sort((a, b) => b[1].anchor - a[1].anchor || (a[0] < b[0] ? -1 : 1));
    const hasAnchorConflict =
      anchorRanked.length >= 2 && anchorRanked[0][1].anchor - anchorRanked[1][1].anchor < SPEAKER_CONFLICT_MARGIN;

    // When NO name in the cluster has any anchor-grade evidence at all,
    // there is nothing to arbitrate between two disagreeing prior-tier
    // claims (e.g. two different chunks' unverified exact-name matches for
    // the same overlap-linked speech) — that is just as much a genuine,
    // unresolved conflict as two anchors disagreeing.
    const hasPriorOnlyConflict =
      anchorRanked.length === 0 &&
      ranked.length >= 2 &&
      topScore >= SPEAKER_CANDIDATE_MIN_CONFIDENCE &&
      topScore - effectiveScore(ranked[1][1]) < SPEAKER_CONFLICT_MARGIN;

    if (cluster.userNames.size === 1) {
      // A user confirmation is the ultimate evidence tier — it resolves the
      // cluster outright over any automatic signal (that's the point of a
      // manual confirmation). Two DIFFERENT confirmed names in one cluster
      // are a recorded conflict below.
      const name = [...cluster.userNames][0];
      statusByRoot.set(root, { kind: 'resolved', name, score: 1 });
      resolvedClusters += 1;
    } else if (cluster.userNames.size > 1) {
      const name = [...cluster.userNames].sort()[0];
      statusByRoot.set(root, { kind: 'conflict', name, score: 1 });
      conflictClusters += 1;
    } else if (!top || topScore < SPEAKER_CANDIDATE_MIN_CONFIDENCE) {
      statusByRoot.set(root, { kind: 'unresolved' });
      unresolvedClusters += 1;
    } else if (hasAnchorConflict || hasPriorOnlyConflict) {
      // Directly conflicting evidence — stays unresolved and is recorded.
      statusByRoot.set(root, { kind: 'conflict', name: top[0], score: topScore });
      conflictClusters += 1;
    } else if (anchorRanked.length > 0 && anchorRanked[0][1].anchor >= SPEAKER_ASSIGN_MIN_CONFIDENCE) {
      // Only ANCHOR-grade evidence resolves a cluster automatically — an
      // unverified provider-exact/positional guess can reach this combined
      // (anchor+prior) threshold on its own, but that alone must never
      // auto-resolve (see the module header); it falls to 'candidate' below
      // instead, pending repair, user confirmation, or genuine corroboration.
      statusByRoot.set(root, { kind: 'resolved', name: anchorRanked[0][0], score: anchorRanked[0][1].anchor });
      resolvedClusters += 1;
    } else {
      statusByRoot.set(root, { kind: 'candidate', name: top[0], score: topScore });
      candidateClusters += 1;
    }
  }

  // --- Global display labels for non-resolved clusters, by first appearance. ---
  const unresolvedRoots = [...clusters.values()]
    .filter((c) => statusByRoot.get(c.root)!.kind !== 'resolved')
    .sort((a, b) => a.firstStart - b.firstStart || (a.root < b.root ? -1 : 1))
    .map((c) => c.root);
  const displayByRoot = new Map<string, string>();
  unresolvedRoots.forEach((root, i) => displayByRoot.set(root, globalUnresolvedLabel(i)));

  // --- Apply to segments (copies — input untouched). ---
  let segmentsChanged = 0;
  const out = segments.map((seg) => {
    if (!seg.localSpeakerId || seg.userConfirmed) return seg;
    const root = uf.find(seg.localSpeakerId);
    const status = statusByRoot.get(root);
    if (!status) return seg;

    if (status.kind === 'resolved') {
      // Only a segment whose OWN mapping source was already trustworthy
      // enough to anchor a cluster by itself (acoustic, or — defensively —
      // an earlier repair/reconciliation pass) keeps that source when it
      // resolves to the same name; a provider-exact/positional segment
      // that resolves here did so through reconciliation's corroboration
      // (its own repeated evidence or a union with an anchor elsewhere in
      // the cluster), so its source becomes 'reconciliation'.
      const alreadyTrusted =
        (seg.mappingSource === 'acoustic' || seg.mappingSource === 'repair' || seg.mappingSource === 'reconciliation') &&
        seg.resolvedSpeaker === status.name;
      const unchanged = alreadyTrusted && seg.speaker === status.name && seg.mappingConflict !== true;
      if (unchanged && seg.speakerConfidence === status.score) return seg;
      segmentsChanged += 1;
      const next = { ...seg, speaker: status.name, resolvedSpeaker: status.name, speakerConfidence: status.score };
      delete next.candidateSpeaker;
      delete next.mappingConflict;
      if (!alreadyTrusted) next.mappingSource = 'reconciliation';
      return next;
    }

    // Unlike the resolved branch above, a candidate/conflict/unresolved
    // outcome is NOT reconciliation actually establishing an identity — it's
    // still pending repair, corroboration, or a user confirmation. Overwriting
    // mappingSource here would erase whether the original evidence was
    // provider-exact, positional, or genuinely unresolved, and would corrupt
    // any later reader that inspects mappingSource directly (e.g. the quality
    // gate's mixed-label diagnostics, which look for 'provider-exact').
    // mappingSource is deliberately left untouched (via the spread below).
    const display = displayByRoot.get(root)!;
    const next = { ...seg, speaker: display };
    delete next.resolvedSpeaker;
    if (status.kind === 'candidate' || status.kind === 'conflict') {
      next.candidateSpeaker = status.name;
      next.speakerConfidence = status.score;
    } else {
      delete next.candidateSpeaker;
      next.speakerConfidence = 0;
    }
    if (status.kind === 'conflict') next.mappingConflict = true;
    else delete next.mappingConflict;

    const changed =
      next.speaker !== seg.speaker ||
      next.candidateSpeaker !== seg.candidateSpeaker ||
      next.speakerConfidence !== seg.speakerConfidence ||
      next.mappingConflict !== seg.mappingConflict ||
      seg.resolvedSpeaker !== undefined;
    if (!changed) return seg;
    segmentsChanged += 1;
    return next;
  });

  return {
    segments: out,
    report: {
      algorithmVersion: MAPPING_ALGORITHM_VERSION,
      identityCount: identities.size,
      clusterCount: clusters.size,
      resolvedClusters,
      candidateClusters,
      conflictClusters,
      unresolvedClusters,
      demotedPositionalIdentities: demotedPositional,
      overlapLinksUsed,
      continuityLinksUsed,
      segmentsChanged,
      speakerNotesSupplied: speakerNotes.some((note) => note.trim().length > 0),
    },
  };
}
