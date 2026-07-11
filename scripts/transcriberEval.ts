// Local-only transcriber evaluation harness. Runs the deterministic speaker
// pipeline stages (reconciliation + quality gate) over a segments JSON file
// and prints text-free metrics — no model calls, no network, nothing leaves
// this machine.
//
//   npm run transcriber:eval -- path/to/segments.json
//   npm run transcriber:eval                      (runs the committed synthetic fixture)
//
// Input file shapes accepted:
//   - an array of TranscriptSegment objects (with or without provenance), or
//   - { "segments": [...], "knownNames": ["Kait", "James"], "blocks": [...] }
//
// PRIVATE DATA: keep personal transcript exports in eval-data/ (gitignored)
// and pass them by path. Never commit personal audio or transcripts — the
// committed fixture (scripts/fixtures/transcriber-eval-sample.json) is
// synthetic.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SPEAKER_NAMES } from '../app/tools/transcriber/lib/constants';
import { buildTagSummary } from '../app/tools/transcriber/lib/argumentTags';
import { reconcileSpeakers } from '../app/tools/transcriber/lib/reconcileSpeakers';
import { analyzeSpeakerQuality } from '../app/tools/transcriber/lib/speakerQuality';
import type { TranscriptSegment, TurnBlock } from '../app/tools/transcriber/lib/types';

interface EvalInput {
  segments: TranscriptSegment[];
  knownNames: string[];
  blocks?: TurnBlock[];
}

function loadInput(path: string): EvalInput {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) {
    return { segments: raw as TranscriptSegment[], knownNames: [...DEFAULT_SPEAKER_NAMES] };
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.segments)) {
    return {
      segments: raw.segments as TranscriptSegment[],
      knownNames: Array.isArray(raw.knownNames) && raw.knownNames.length > 0 ? raw.knownNames : [...DEFAULT_SPEAKER_NAMES],
      blocks: Array.isArray(raw.blocks) ? (raw.blocks as TurnBlock[]) : undefined,
    };
  }
  throw new Error('Input must be a JSON array of segments or an object with a "segments" array.');
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function main(): void {
  const arg = process.argv[2];
  const path = resolve(arg ?? resolve(__dirname, 'fixtures/transcriber-eval-sample.json'));
  const input = loadInput(path);

  console.log(`transcriber eval — ${path}`);
  console.log(`segments: ${input.segments.length} · known names: ${input.knownNames.join(', ')}`);
  console.log('');

  const { segments: reconciled, report } = reconcileSpeakers(input.segments, { knownNames: input.knownNames });

  console.log('— reconciliation —');
  console.log(`  algorithm: ${report.algorithmVersion}`);
  console.log(`  identities: ${report.identityCount} · clusters: ${report.clusterCount}`);
  console.log(
    `  resolved: ${report.resolvedClusters} · candidate: ${report.candidateClusters} · conflict: ${report.conflictClusters} · unresolved: ${report.unresolvedClusters}`,
  );
  console.log(`  demoted later-chunk positional identities: ${report.demotedPositionalIdentities}`);
  console.log(`  overlap links used: ${report.overlapLinksUsed} · continuity links used: ${report.continuityLinksUsed}`);
  console.log(`  label changes (segments changed by reconciliation): ${report.segmentsChanged}`);
  console.log('');

  const quality = analyzeSpeakerQuality(reconciled, { knownNames: input.knownNames });

  console.log('— quality —');
  console.log(
    `  words: ${quality.totalWords} total · ${quality.namedWords} named · ${quality.unresolvedWords} unresolved (${pct(quality.unresolvedPercent)})`,
  );
  console.log(
    `  worst ${quality.windowSeconds / 60}-minute window: ${pct(quality.maxWindowUnresolvedPercent)} · windows: [${quality.windowUnresolvedPercents.map((p) => p.toFixed(0)).join(', ')}]`,
  );
  console.log(
    `  longest unresolved run: ${quality.longestUnresolvedRunSeconds.toFixed(0)}s / ${quality.longestUnresolvedRunWords} words`,
  );
  console.log(`  provider labels: ${quality.providerLabels.join(', ') || '(none recorded)'}`);
  console.log(`  local identities: ${quality.localIdentityCount} · resolved speakers: ${quality.resolvedSpeakers.join(', ') || '(none)'}`);
  console.log(`  mixed named/anonymous chunks: [${quality.mixedLabelChunks.join(', ')}]`);
  console.log(`  chunks without a known name: [${quality.chunksWithoutKnownNames.join(', ')}]`);
  console.log(`  chunk-boundary identity changes: ${quality.chunkBoundaryIdentityChanges}`);
  console.log(`  mapping conflicts: ${quality.mappingConflicts} · whisper (identity-less) segments: ${quality.whisperFallbackSegments}`);
  console.log(
    `  confidence bands: high ${quality.confidenceDistribution.high} · medium ${quality.confidenceDistribution.medium} · low ${quality.confidenceDistribution.low} · none ${quality.confidenceDistribution.none}`,
  );
  console.log('');

  console.log('— warnings —');
  const triggers = Object.entries(quality.triggers).filter(([, fired]) => fired);
  if (triggers.length === 0) console.log('  none — repair would not trigger');
  else triggers.forEach(([name]) => console.log(`  TRIGGER: ${name}`));
  console.log('');

  if (input.blocks) {
    const tagged = input.blocks.filter((b) => b.tag !== undefined).length;
    const summary = buildTagSummary(input.blocks);
    console.log('— argument classification coverage —');
    console.log(`  blocks: ${input.blocks.length} · tagged: ${tagged} (${pct(input.blocks.length > 0 ? (tagged / input.blocks.length) * 100 : 0)})`);
    console.log(
      `  tags: ${Object.entries(summary)
        .map(([tag, count]) => `${tag}: ${count}`)
        .join(' · ')}`,
    );
  }
}

main();
