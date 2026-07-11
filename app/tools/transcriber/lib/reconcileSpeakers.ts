// Deterministic global speaker reconciliation — runs once client-side after
// all transcription chunks are combined, BEFORE any language-model stage.
// Pure: no fetch, no model calls, no randomness. Evidence sources, strongest
// first:
//
//   1. Exact provider-known names (already resolved by the chunk-local
//      mapper — they seed cluster evidence).
//   2. Stable local identity inside each chunk (identities are the unit of
//      clustering; every segment sharing one moves together).
//   3. Matching overlap segments — the same speech transcribed by two
//      neighboring chunks links their local identities outright.
//   4. Adjacent-chunk continuity — speech continuing across a chunk boundary
//      within a small gap (candidate-level evidence only).
//   5. Short-gap continuity — a slightly larger boundary gap (weaker
//      candidate-level evidence).
//   6. Reference-clip attachment status (raises exact-name confidence in the
//      chunk-local mapper; recorded here).
//   7. Speaker notes — supporting evidence only, recorded in the report and
//      passed to the repair stage, never used to assign a name here.
//
// Confidence policy is centralized in lib/constants.ts:
//   >= SPEAKER_ASSIGN_MIN_CONFIDENCE (0.9): assign automatically.
//   [SPEAKER_CANDIDATE_MIN_CONFIDENCE, assign): retain candidate, display
//   unresolved. Below: unresolved. Two candidates within
//   SPEAKER_CONFLICT_MARGIN of each other (both in/above the candidate band)
//   are conflicting evidence — the cluster stays unresolved and is recorded.
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

/**
 * Recovers overlap identity links from windowed results BEFORE core-only
 * stitching discards the overlap segments (lib/stitchTranscript.ts keeps
 * only each window's core). Structural window type so this stays free of an
 * import cycle with stitchTranscript.ts. Timestamps here are absolute
 * recording time in both cores and overlaps (the Gemini windowed path).
 */
export function collectWindowOverlapLinks(
  results: { window: { index: number; coreStart: number; coreEnd: number }; segments: TranscriptSegment[] }[],
): OverlapLink[] {
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
  return duplicates.length > 0 ? matchOverlapLinks(owned, duplicates) : [];
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
    }
    if (seg.resolvedSpeaker && knownNameSet.has(seg.resolvedSpeaker) && typeof seg.speakerConfidence === 'number') {
      if (seg.mappingSource === 'positional' && (seg.chunkIndex ?? 0) > 0) {
        // First-appearance order inside a later chunk is exactly the signal
        // that swaps speakers at chunk boundaries — demote to a weak prior
        // unless corroborated by overlap/continuity evidence.
        addEvidence(
          info.evidence,
          seg.resolvedSpeaker,
          Math.min(seg.speakerConfidence, POSITIONAL_LATER_CHUNK_CONFIDENCE),
          false,
        );
        if (!info.demotedPositional) {
          info.demotedPositional = true;
          demotedPositional += 1;
        }
      } else {
        addEvidence(info.evidence, seg.resolvedSpeaker, seg.speakerConfidence, true);
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

    // Conflict detection considers ANCHOR evidence only: two assignment-grade
    // signals for different names within the margin are irreconcilable; a
    // weak prior disagreeing with a solid anchor is not.
    const anchorRanked = [...cluster.evidence.entries()]
      .filter(([, entry]) => entry.anchor >= SPEAKER_CANDIDATE_MIN_CONFIDENCE)
      .sort((a, b) => b[1].anchor - a[1].anchor || (a[0] < b[0] ? -1 : 1));
    const hasAnchorConflict =
      anchorRanked.length >= 2 && anchorRanked[0][1].anchor - anchorRanked[1][1].anchor < SPEAKER_CONFLICT_MARGIN;

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
    } else if (hasAnchorConflict) {
      // Directly conflicting evidence — stays unresolved and is recorded.
      statusByRoot.set(root, { kind: 'conflict', name: top[0], score: topScore });
      conflictClusters += 1;
    } else if (topScore >= SPEAKER_ASSIGN_MIN_CONFIDENCE) {
      statusByRoot.set(root, { kind: 'resolved', name: top[0], score: topScore });
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
      const unchanged =
        seg.speaker === status.name && seg.resolvedSpeaker === status.name && seg.mappingConflict !== true;
      if (unchanged && seg.speakerConfidence === status.score) return seg;
      segmentsChanged += 1;
      const next = { ...seg, speaker: status.name, resolvedSpeaker: status.name, speakerConfidence: status.score };
      delete next.candidateSpeaker;
      delete next.mappingConflict;
      // Provider-exact segments already carrying this name keep their source
      // — everything else was decided here.
      if (!(seg.mappingSource === 'provider-exact' && seg.resolvedSpeaker === status.name)) {
        next.mappingSource = 'reconciliation';
      }
      return next;
    }

    const display = displayByRoot.get(root)!;
    const next = { ...seg, speaker: display, mappingSource: 'reconciliation' as const };
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
