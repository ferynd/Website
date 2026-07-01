// Provider identifiers for the Transcriber pipeline's transcription backends.
//
// Kept minimal for now (Phase 1: settings foundation only needs the id
// union). Phase 2's provider-abstraction rework will extend this file with
// attempt/result types (e.g. TranscriptionAttempt, an attempt-error shape
// wrapping ClassifiedError) as useTranscriberPipeline.ts is restructured
// around swappable providers.

export type TranscriptionProviderId = 'openai-diarized' | 'openai-whisper' | 'gemini';
