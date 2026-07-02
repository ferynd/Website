import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEAKER_PROFILES, parseStoredProfiles } from '../lib/speakerProfiles';

describe('parseStoredProfiles', () => {
  it('returns the documented defaults for null raw input', () => {
    expect(parseStoredProfiles(null)).toEqual(DEFAULT_SPEAKER_PROFILES);
  });

  it('returns the two seeded defaults with stable ids and empty notes', () => {
    expect(DEFAULT_SPEAKER_PROFILES).toEqual([
      { id: 'speaker-1', name: 'Kait', notes: '' },
      { id: 'speaker-2', name: 'James', notes: '' },
    ]);
  });

  it('returns defaults for unparseable garbage', () => {
    expect(parseStoredProfiles('not json at all {{{')).toEqual(DEFAULT_SPEAKER_PROFILES);
  });

  it('returns defaults when the parsed value is not an array', () => {
    expect(parseStoredProfiles('{"id":"speaker-1","name":"Kait","notes":""}')).toEqual(DEFAULT_SPEAKER_PROFILES);
    expect(parseStoredProfiles('"just a string"')).toEqual(DEFAULT_SPEAKER_PROFILES);
    expect(parseStoredProfiles('42')).toEqual(DEFAULT_SPEAKER_PROFILES);
  });

  it('returns defaults for an empty array', () => {
    expect(parseStoredProfiles('[]')).toEqual(DEFAULT_SPEAKER_PROFILES);
  });

  it('round-trips a valid custom profile list unchanged', () => {
    const profiles = [
      { id: 'speaker-1', name: 'Alex', notes: 'speaks softly' },
      { id: 'speaker-2', name: 'Sam', notes: '' },
      { id: 'speaker-3', name: 'Jo', notes: 'fast talker' },
    ];
    expect(parseStoredProfiles(JSON.stringify(profiles))).toEqual(profiles);
  });

  it('trims whitespace from names', () => {
    const raw = JSON.stringify([{ id: 'speaker-1', name: '  Kait  ', notes: '' }]);
    expect(parseStoredProfiles(raw)).toEqual([{ id: 'speaker-1', name: 'Kait', notes: '' }]);
  });

  it('drops an entry with an empty/whitespace-only name', () => {
    const raw = JSON.stringify([
      { id: 'speaker-1', name: '   ', notes: '' },
      { id: 'speaker-2', name: 'James', notes: '' },
    ]);
    expect(parseStoredProfiles(raw)).toEqual([{ id: 'speaker-2', name: 'James', notes: '' }]);
  });

  it('drops an entry with a missing/blank id', () => {
    const raw = JSON.stringify([
      { id: '', name: 'Kait', notes: '' },
      { id: 'speaker-2', name: 'James', notes: '' },
    ]);
    expect(parseStoredProfiles(raw)).toEqual([{ id: 'speaker-2', name: 'James', notes: '' }]);
  });

  it('drops a non-object entry without rejecting the whole list', () => {
    const raw = JSON.stringify([null, 42, 'oops', { id: 'speaker-1', name: 'Kait', notes: '' }]);
    expect(parseStoredProfiles(raw)).toEqual([{ id: 'speaker-1', name: 'Kait', notes: '' }]);
  });

  it('defaults a missing/non-string notes field to an empty string', () => {
    const raw = JSON.stringify([{ id: 'speaker-1', name: 'Kait', notes: 42 }]);
    expect(parseStoredProfiles(raw)).toEqual([{ id: 'speaker-1', name: 'Kait', notes: '' }]);
  });

  it('drops a duplicate id after the first occurrence', () => {
    const raw = JSON.stringify([
      { id: 'speaker-1', name: 'Kait', notes: '' },
      { id: 'speaker-1', name: 'Duplicate', notes: '' },
    ]);
    expect(parseStoredProfiles(raw)).toEqual([{ id: 'speaker-1', name: 'Kait', notes: '' }]);
  });

  it('falls back to defaults when every entry is invalid', () => {
    const raw = JSON.stringify([{ name: 'no id' }, { id: 'no-name' }, null]);
    expect(parseStoredProfiles(raw)).toEqual(DEFAULT_SPEAKER_PROFILES);
  });
});
