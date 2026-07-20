# T12: Transcriber Deep Dive

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the complete current merged implementation, including:

- Firebase authentication and server-side administrator verification;
- provider selection and fallback behavior;
- OpenAI direct and client-preprocessed transcription paths;
- Gemini direct and windowed transcription paths;
- audio duration probing, decoding, silence removal, speed-up, chunk planning, and timestamp restoration;
- speaker profiles, reference clips, anonymous-label mapping, and prompt-based identity inference;
- raw capture, artifact suppression, Gemini cleanup, correction guardrails, turn merging, and argument tagging;
- parallelism, retries, partial-result caches, error classification, and debug output;
- output download/copy, privacy, retention, browser persistence, and accessibility;
- unit-test coverage and missing live/provider validation.

## Current pipeline trace

### OpenAI diarized or Whisper

1. Validate extension and provider-specific file-size limit.
2. Authenticate and obtain a Firebase ID token.
3. For files over the duration/size threshold when preprocessing is enabled:
   - decode the entire file to mono 16 kHz audio;
   - detect and remove long low-energy periods;
   - optionally speed each planned slice up, default 1.2x;
   - encode all slices as PCM16 WAV files;
   - send up to four chunk requests in parallel;
   - map timestamps back to original-recording time and concatenate results.
4. For smaller files, upload the original directly.
5. The server calls the chosen OpenAI transcription model, retries once without rejected speaker references when applicable, and can optionally fall back to Whisper.
6. The client captures the provider result as the raw transcript.
7. Optional artifact suppression removes selected repeated short phrases from the cleanup input.
8. Gemini cleanup operates over 15-minute cores with 90-second overlap, up to six requests in parallel.
9. Corrected windows are stitched, same-speaker turns are optionally merged, and optional argument tags/filtered output are built.

### Gemini direct transcription

- At or below 20 minutes, the original file is uploaded once to Gemini Files API, polled until active, transcribed, and deleted best-effort.
- Above 20 minutes, the browser decodes the whole recording to mono 16 kHz, creates overlapping 10-minute WAV windows, and sequentially uploads/transcribes/deletes each window.
- Gemini is prompted to return absolute timestamps and known names; response parsing corrects likely window-relative timestamps defensively.
- Completed windows are cached for explicit retry.

## Strong design decisions

- Every Transcriber API route is protected by server-side Firebase ID-token verification, administrator email matching, and verified-email enforcement.
- Provider model IDs, upload caps, reference counts, and clip sizes are revalidated server-side.
- Audio/transcript content is not logged or persisted in Firestore/Storage by the application.
- Upstream error bodies are sanitized and truncated before client exposure.
- Raw provider output is captured before cleanup suppression and model correction.
- Cleanup output is structurally constrained and checked for complete segment-index coverage.
- Text-divergence guardrails preserve original segment text when a correction changes length implausibly.
- Partial transcription and cleanup work is retained in memory and reused after an explicit retry.
- Caches are cleared for fresh submissions and parameterized by provider/model/preprocessing/context inputs.
- Auto-fallback is off by default, preventing silent provider/model degradation unless explicitly enabled.
- Long Gemini audio is sliced into actual window audio rather than repeatedly sending the full recording.
- Argument tagging is folded into the cleanup pass, avoiding a separate model call.
- Settings and speaker-profile metadata use versioned, defensive parsers.
- The pure-logic test suite is extensive and covers chunk math, mapping, stitching, suppression, correction parsing/guards, settings, speaker profiles, concurrency, Gemini parsing, and error sanitization.

These are substantial improvements over a simple upload-and-transcribe implementation. The largest remaining risks occur before the “raw” transcript exists and in speaker-identity inference.

## Findings

### F-056: Default OpenAI preprocessing can permanently remove quiet speech before any transcript is created

- Status: validated source risk; representative-audio severity requires live validation
- Category: transcription fidelity / irreversible preprocessing
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: OpenAI long/large-file path with default preprocessing and silence removal enabled
- Evidence:
  - preprocessing is enabled by default for files exceeding the OpenAI direct duration/size threshold;
  - silence removal is enabled by default;
  - every 20 ms frame below a fixed -45 dBFS threshold participates in a removable run;
  - runs of at least one second can be cut after retaining only 0.25 seconds at each edge;
  - kept intervals are concatenated before ASR, so deleted samples are never sent to OpenAI;
  - the fail-safe protects only a recording where no frame exceeds the threshold; it does not protect isolated quiet speech inside an otherwise louder recording;
  - raw output is captured after transcription of this modified audio, not from an untouched provider pass.
- User impact:
  - quiet speech, trailing statements, whispered responses, crying, distant speakers, or low-gain portions can be removed as “silence”;
  - deleted content cannot appear in either raw or cleaned transcripts;
  - the UI describes raw as unedited and says long silences are removed, but it does not make clear that the source audio itself has been irreversibly filtered before raw transcription;
  - conflict analysis can lose precisely the low-volume content that carries reassurance, withdrawal, fear, or repair attempts.
- Root cause: a fixed global energy threshold is used as speech detection without adaptive noise-floor estimation, speech/VAD classification, preview, or post-run completeness validation.
- Recommendation:
  1. Make source-preserving preprocessing the default: chunk without removing audio.
  2. Treat silence removal as an experimental cost optimization requiring explicit opt-in.
  3. Replace fixed-RMS deletion with a speech-aware/adaptive VAD and conservative hysteresis.
  4. Preserve a low-bitrate source timeline or generate a comparison report identifying every removed interval.
  5. Run completeness sampling around every cut and offer an automatic no-removal retry for suspicious boundaries.
- Acceptance criteria:
  - default long-file processing sends every source sample exactly once or in deliberate overlap;
  - quiet-speech fixtures at multiple gains are never removed as silence;
  - removed intervals, duration, and confidence are visible before committing to the run;
  - “raw” is labelled accurately as source-preserving or preprocessed;
  - a no-silence-removal retry reuses unaffected work where technically possible;
  - golden-audio tests compare word retention before and after optimization.
- Backlog destination: urgent Transcriber fidelity candidate

### F-057: OpenAI audio chunks have no overlap or cross-boundary speech protection

- Status: validated source risk; empirical word-loss rate requires live validation
- Category: transcription fidelity / chunk stitching
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: OpenAI preprocessed/chunked path
- Evidence:
  - chunk planning exactly tiles the final audio timeline with no gap and no overlap;
  - natural removed-silence seams are preferred only when one exists near the byte/duration cap;
  - continuous speech longer than the cap is hard-cut at the cap;
  - each chunk is transcribed as an independent request with no neighboring audio or text context;
  - final combination only remaps and sorts returned segments; it cannot recover a word split at the waveform boundary;
  - the existing warning addresses speaker-name swaps without clips, not missing/truncated boundary speech.
- User impact:
  - a chunk can begin/end inside a word, syllable, interruption, or overlapping speaker turn;
  - independent ASR requests may omit, duplicate, or differently interpret boundary speech;
  - exact timestamp restoration can make the final transcript look continuous even when content is missing.
- Root cause: chunking optimizes request size and cost but lacks acoustic overlap and boundary reconciliation.
- Recommendation:
  - add a small configurable acoustic overlap, such as several seconds, to OpenAI chunks;
  - prefer low-energy/word-boundary cuts even when silence is not removed;
  - reconcile overlapping segment text/timestamps using confidence-aware or sequence-alignment logic;
  - retain the original core/overlap ownership approach already used for Gemini cleanup/window stitching;
  - flag low-confidence seams for targeted review/retry.
- Acceptance criteria:
  - continuous-speech fixtures with words spanning every planned boundary retain each word once;
  - interruptions and simultaneous speakers across seams remain ordered correctly;
  - overlap does not duplicate final transcript content;
  - seam quality metrics and sampled audio are available in debug/review output;
  - additional provider cost is measured and bounded.
- Backlog destination: urgent Transcriber chunk-quality candidate

### F-058: Anonymous speaker labels are assigned by profile order, which can swap identities for an entire recording or chunk

- Status: validated
- Category: speaker mapping correctness
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surfaces:
  - OpenAI diarized responses without accepted reference clips;
  - Gemini responses using generic speaker labels.
- Evidence:
  - OpenAI anonymous labels A/B/C are assigned sequentially to `speakerNames` in profile order;
  - Gemini labels such as Speaker 1/A/S1 are likewise mapped positionally into `speakerNames`;
  - profile order is presented as a list of named identities, not explicitly as “order of first appearance in this recording”;
  - when the first speaker is not the first profile, all anonymous labels can be inverted;
  - multi-chunk OpenAI runs warn about cross-chunk swaps when no clips exist, but a single-request run without clips has no equivalent warning;
  - a rejected/unavailable clip causes the run to continue without acoustic anchoring.
- User impact:
  - a transcript can confidently attribute every statement to the wrong person;
  - the cleanup pass is instructed to correct only clear flips and may reinforce an initially consistent but globally inverted mapping;
  - downstream conflict analysis can assign harmful behavior, intent, or repair attempts to the wrong partner.
- Root cause: anonymous diarization labels encode speaker distinction/appearance, not identity, but the application converts them directly into identity names.
- Recommendation:
  - when accepted acoustic references are absent, keep anonymous stable labels rather than applying names automatically;
  - alternatively require the user to map detected Speaker A/B after hearing short sampled turns;
  - display identity confidence/provenance per run and per chunk;
  - allow global swap/remap without rerunning transcription;
  - use cleanup as a suggestion layer, not the authoritative identity source.
- Acceptance criteria:
  - profile order alone can never silently determine identity;
  - no-reference runs remain Speaker A/B until user confirmation or sufficiently validated identification;
  - rejected/missing clips trigger an explicit identity-confirmation step;
  - users can remap all segments non-destructively;
  - fixtures cover recordings beginning with each possible speaker and chunk windows beginning with alternating speakers.
- Backlog destination: urgent Transcriber speaker-mapping candidate

### F-059: Default context notes can contradict the active speaker profiles and bias both transcription and cleanup

- Status: validated
- Category: speaker mapping / configuration integrity
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - every new page session seeds context notes with hard-coded statements about Kait, James, sex, speaking speed, and Kait speaking first;
  - speaker profiles can be renamed, removed, reordered, or expanded independently;
  - context notes are not regenerated or validated when profiles change;
  - Gemini direct transcription receives both active profile names and the unchanged context;
  - the cleanup pass also receives the same context for every chunk;
  - contradictory context is treated as user-provided authority in model prompts.
- User impact:
  - a recording of different people can still tell Gemini that Kait and James are the speakers;
  - “Kait is first” can reinforce the positional-mapping defect when James or another person speaks first;
  - stale gender/voice assumptions can cause systematic relabelling rather than isolated uncertainty.
- Root cause: personalized defaults were embedded as universal run context rather than derived from the selected recording/profiles.
- Recommendation:
  - default context to blank or neutral instructions;
  - move persistent per-speaker characteristics into each profile only;
  - derive a preview of the exact provider/cleanup context from active profiles;
  - detect names in context that are not active profiles and require review;
  - make first-speaker information an explicit per-run choice only when known.
- Acceptance criteria:
  - a new profile set never inherits unrelated person-specific context;
  - contradictory names/order produce a blocking or prominent warning;
  - context preview shows exactly what will be transmitted;
  - profile changes update derived context without overwriting intentional run notes;
  - tests cover rename/add/remove/reorder and alternate first speakers.
- Backlog destination: Transcriber configuration-integrity candidate

### F-060: The 95 MB input cap does not bound decoded browser memory, and preprocessing retains all encoded chunks simultaneously

- Status: source-supported risk; crash thresholds require browser/device profiling
- Category: performance / reliability / browser memory
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: long OpenAI and Gemini recordings decoded client-side
- Evidence:
  - compressed file size is the admission limit, but decoded PCM memory depends on duration/sample count, not compressed bytes;
  - OpenAI preprocessing decodes the entire recording to float32 mono, creates a concatenated kept buffer, and returns all PCM16 WAV chunk files together before uploads start;
  - the source estimates roughly 350 MB for a three-hour 16 kHz float32 recording plus the encoded chunk set and transient rendering buffers;
  - a low-bitrate file under 95 MB can represent substantially more than three hours and therefore much larger decoded memory;
  - Gemini long-window processing also retains the full decoded recording while slicing sequential windows;
  - no duration-based memory estimate, device-memory check, streaming decoder, worker isolation, or preflight refusal exists.
- User impact:
  - the browser tab can become unresponsive, be killed, or lose the entire run before any provider result exists;
  - memory pressure is especially risky on mobile, Safari, or machines with multiple large tabs;
  - partial resume caches do not survive a tab crash/reload.
- Root cause: whole-file Web Audio decoding and eager chunk materialization were chosen for implementation simplicity while admission control remains based on compressed bytes.
- Recommendation:
  - estimate decoded memory from probed duration before processing and warn/refuse above tested device tiers;
  - encode/upload chunks incrementally and release each Blob after completion rather than retaining the entire set;
  - move CPU-heavy work into a worker where supported;
  - evaluate streaming/server-side preprocessing for very long files;
  - retain a source-file split workflow as a reliable fallback.
- Acceptance criteria:
  - documented maximum duration is based on measured memory, not only file size;
  - peak memory remains bounded as duration grows through incremental processing;
  - 30-minute, 90-minute, 3-hour, and over-limit fixtures are profiled in Chrome/Firefox/Safari on representative hardware;
  - memory-pressure failure produces recovery guidance before provider spending;
  - completed chunks can resume after a recoverable worker/process failure.
- Backlog destination: Transcriber performance architecture candidate

### F-061: Artifact suppression can remove legitimate repeated short statements across speakers

- Status: validated algorithmic risk; false-positive frequency requires transcript corpus testing
- Category: transcript fidelity / semantic filtering
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: cleaned transcript with default suppression enabled
- Evidence:
  - all segments with fewer than four normalized words are grouped solely by normalized text;
  - speaker identity is not part of the group key;
  - a group is removed in full when it meets repeat-count, span, and timing-regularity thresholds;
  - conservative mode removes five or more occurrences over at least 90 seconds with gap coefficient of variation at most 0.4;
  - phrases are not restricted to known ASR artifacts;
  - valid conflict phrases such as “okay,” “I’m sorry,” “I love you,” “please stop,” or “I don’t know” can recur across both speakers with regular pacing;
  - the UI reports removed phrases and retains them in raw output, but the cleaned and argument-tagging paths never see them.
- User impact:
  - acknowledgements, reassurance, repair attempts, boundaries, and repeated distress can disappear from the primary cleaned transcript;
  - because removal happens before cleanup/tagging, the model cannot classify or preserve those moments;
  - downstream conflict analysis can overstate hostility or understate repair.
- Root cause: artifact detection relies on global lexical/timing repetition without speaker, audio-energy, confidence, silence-context, or known-artifact evidence.
- Recommendation:
  - disable suppression by default for preservation-critical recordings until validated;
  - restrict automatic deletion to a high-confidence artifact allowlist or combine text repetition with source-audio silence/low-energy evidence;
  - analyze per speaker and retain cross-speaker repetition;
  - make proposed removals reviewable/restorable before cleanup;
  - send uncertain candidates to cleanup with an artifact-candidate flag rather than deleting them.
- Acceptance criteria:
  - a labelled corpus reports precision/recall and zero unacceptable removals in preservation-critical fixtures;
  - common conflict/repair phrases are never removed solely because they repeat regularly;
  - every removal is reversible without rerunning ASR;
  - cleanup/tagging can still inspect uncertain candidates;
  - regression tests include alternating speakers and repeated reassurance/apology/boundary statements.
- Backlog destination: urgent Transcriber suppression-quality candidate

### F-062: Argument-relevant export can omit conflict or repair segments after majority-tag turn merging

- Status: validated
- Category: analysis-output correctness
- Priority: medium
- Confidence: high
- Applies to: current `main` when argument tagging and turn merging are enabled
- Evidence:
  - cleanup assigns one tag per original segment;
  - same-speaker segments merge regardless of tag differences;
  - the merged block receives only the majority tag, with first-seen tie-breaking;
  - argument filtering then operates on the merged block tag, not the original segment tags;
  - a short `repair_attempt` or `argument_conflict` segment inside a longer same-speaker block dominated by `logistics_or_normal`, `unrelated`, or another category can be excluded entirely;
  - displayed inline tags likewise show only the block majority, masking internal mixed roles.
- User impact:
  - the filtered transcript can omit precisely the brief repair, escalation, or emotional-support line it is intended to isolate;
  - tag counts are segment-level while displayed/filtered blocks are majority-tagged, so the summary and export can appear inconsistent.
- Root cause: text presentation merging and analytical classification aggregation use the same lossy block representation.
- Recommendation:
  - preserve segment-level tags as the analytical source of truth;
  - split merged turns at tag transitions for tagged views, or mark a block with the union/sequence of contained tags;
  - include a block in argument-relevant output when any constituent segment has a core argument tag;
  - preserve exact segment boundaries in the filtered export when mixed tags occur.
- Acceptance criteria:
  - no core-tagged segment is excluded because neighboring same-speaker segments have another tag;
  - tag counts, displayed labels, and filtered output reconcile exactly;
  - mixed-tag turns are visibly represented rather than collapsed to an arbitrary winner;
  - regression tests cover minority and tied core tags.
- Backlog destination: Transcriber argument-export candidate

### F-063: Speaker-clip cache invalidation can reuse stale transcription after a same-sized clip replacement

- Status: validated
- Category: retry correctness / cache identity
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - retry cache keys fingerprint each attached clip only as `name:blob.size`;
  - `SpeakerClipRecord` already has an `updatedAt` value, but that value is omitted from the `SpeakerReferenceClip` passed to the pipeline;
  - two different processed clips commonly have the same duration/PCM format and can therefore have exactly the same byte size;
  - replacing/re-recording a clip with the same profile name and size leaves the attempt key unchanged;
  - an explicit retry after another-stage failure may reuse a whole prior transcription or completed chunks created with the old voice reference.
- User impact:
  - a user can replace a bad reference clip and press Resume/Retry but receive cached speaker mapping that never used the replacement;
  - diagnostics incorrectly imply that the current reference set governed the result.
- Root cause: a cheap size fingerprint was treated as content identity despite existing metadata/hash options.
- Recommendation: include a cryptographic content hash or stable clip revision/updatedAt in the runtime clip type and attempt key; visibly state when retries reuse transcription versus re-transcribe.
- Acceptance criteria:
  - any clip-content replacement invalidates affected transcription caches even when name and size are unchanged;
  - metadata-only changes invalidate only the stages they affect;
  - retry UI identifies which stages/chunks are reused;
  - tests cover same-size replacement, rename, delete, add, and reordered profiles.
- Backlog destination: Transcriber resume-cache candidate

### F-064: Expensive run results and resume state are lost on refresh, navigation, or tab termination

- Status: validated
- Category: reliability / user data loss
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - transcript state, whole-attempt cache, per-chunk caches, cleanup results, and last run options live only in React state/refs;
  - no `beforeunload` protection exists for Transcriber;
  - closing/reloading/navigating resets the run and all recovery progress;
  - a successful multi-hour result is not automatically downloaded or stored;
  - this is intentional from a server-privacy perspective but is not protected against accidental loss.
- User impact:
  - accidental refresh, browser crash, update, sleep eviction, or navigation can discard a long and paid transcription;
  - partial provider work must be purchased/repeated from the beginning;
  - the user may assume in-memory resume survives because the recovery panel says completed chunks are saved.
- Root cause: “no server persistence” was implemented as “no durable recovery anywhere,” without a local privacy-preserving session option.
- Recommendation:
  - add an unload/navigation warning while a run or undownloaded result exists;
  - auto-create a local downloadable recovery artifact on completion/failure;
  - consider opt-in encrypted IndexedDB persistence for chunk results/transcripts with an explicit retention window and purge control;
  - distinguish “saved for this tab” from durable saved state in recovery copy.
- Acceptance criteria:
  - accidental navigation warns before losing running/undownloaded work;
  - users can recover or export completed/raw results before reset;
  - any durable local option is opt-in, encrypted or appropriately protected, clearly disclosed, and user-purgeable;
  - UI accurately states the lifetime of cached chunks;
  - crash/reload tests verify documented behavior.
- Backlog destination: Transcriber local-recovery/privacy candidate

## Additional risks and opportunities

### Reference-clip quality uses energy, not voice identity

The clip processor selects the highest-RMS eight-second window and validation checks only duration and mean loudness. A loud cough, impact, music, or another speaker can be selected and marked usable. The panel gives good recording guidance, but an eventual quality pass should add speech/voice-content checks and playback confirmation before treating the clip as an identity anchor.

### Duplicate profile names are accepted

The profile parser rejects duplicate IDs but not duplicate names. Duplicate known-speaker names make reference association and exact-name normalization ambiguous. Profile names should be unique after trim/case folding, or the UI should explain why duplicates cannot be used.

### Gemini timestamp repair is necessarily heuristic

The parser defensively detects likely window-relative timestamps and allows limited before/after-window slack. This is sensible, but live tests should measure timestamp drift and duplicate/omitted turns around every Gemini overlap boundary.

### Cleanup partial-failure semantics are strong but easy to misread

Non-strict mode completes with failed windows left uncorrected and a warning. The warning is valuable, but exports should optionally mark affected time ranges so a user or downstream analysis can distinguish cleaned from fallback raw segments.

### Cancellation and deadlines

F-030 remains applicable. XHR uploads, OpenAI calls, Gemini transcription calls, and cleanup requests have no user cancellation/operation deadline. Gemini activation polling is the exception with a 120-second deadline. A cancellation architecture should abort in-flight work, stop scheduling new chunks, delete temporary Gemini files, and preserve completed resumable chunks.

## Test assessment

The Transcriber has the strongest unit-test footprint in the repository, covering at least:

- timestamp and text formatting;
- chunk-window planning and stitching;
- OpenAI preprocessing timeline math;
- speaker-label mapping;
- Gemini request construction and response parsing;
- speaker profile parsing and clip analysis;
- correction prompt/response/guardrails;
- suppression and turn merging;
- argument filtering/tag summaries;
- concurrency helpers;
- settings parsing;
- error classification/sanitization;
- debug-log redaction shapes.

Important gaps remain:

- real Web Audio decoding, silence removal, speed rendering, and memory behavior;
- real browser XHR progress/cancel behavior;
- API route authentication and provider-contract tests;
- representative OpenAI/Gemini accuracy comparisons;
- speaker identity with/without clips and alternate first speakers;
- hard-cut and overlap seam accuracy;
- full multi-hour end-to-end runs;
- accessibility and mobile browser behavior;
- tab crash/reload recovery.

## Recommended quality-validation corpus

Build a small private, consented evaluation set with manually verified ground truth containing:

1. each speaker starting first;
2. quiet/whispered/trailing speech mixed with normal speech;
3. crying, laughter, crosstalk, interruptions, and long pauses;
4. repeated short repair/boundary phrases;
5. speech crossing every chunk/window boundary;
6. names, in-jokes, and acoustically similar speakers;
7. 30-minute, 90-minute, and 3-hour recordings;
8. supported phone containers and deliberately malformed files.

Score separately:

- word error/omission rate;
- speaker-attributed word error rate;
- boundary omission/duplication rate;
- timestamp drift;
- cleanup edit distance and unacceptable semantic changes;
- artifact-suppression precision;
- argument-tag segment recall;
- latency, provider requests, token/audio cost, and peak browser memory.

This makes future quality/cost choices auditable rather than based only on anecdotal transcript comparisons.

## Recommended default direction

For preservation-critical argument recordings, the safer default is:

- source-preserving chunking with no silence deletion;
- 1.0x speed until measured accuracy proves a faster setting acceptable;
- acoustic reference clips when available;
- anonymous Speaker A/B plus user confirmation when clips are absent/rejected;
- small acoustic chunk overlap with deduplication;
- suppression off or review-only;
- cleanup enabled with strict structural guardrails;
- segment-level analytical tags preserved through export;
- visible provenance for provider, preprocessing, inferred identity, corrected/fallback ranges, and removed candidates.

Cost optimization should occur after these fidelity guarantees, using measured corpus results to decide whether silence removal, speed-up, parallelism, Gemini direct transcription, or smaller cleanup windows provide acceptable trade-offs.

## Existing findings revalidated

- F-019/F-023: Settings remains a tool-local modal without complete focus management, though it does constrain height and scroll internally.
- F-026: pipeline stages/progress are visual rather than fully announced to assistive technology.
- F-030: most external requests lack deadlines/cancellation.
- F-044: no authenticated/provider-mocked end-to-end workflow exists.
- F-047: diagnostics are local and privacy-conscious, but aggregate production health/cost signals are absent.

## Next task

`T13. Show Tracker and recommender`
