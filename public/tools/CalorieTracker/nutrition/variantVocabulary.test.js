import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as vocabulary from '../../../shared/nutrition/variantVocabulary.js';
import { compareVariants, normalizeVariantDims } from '../../../shared/nutrition/ingredientVariants.js';
import { variantKeyV1 } from '../../../shared/nutrition/ingredientIds.js';

const { VOCABULARY_VERSION, STATE_SLUGS, PREPARATION_TERMS, isKnownState, isKnownPreparation,
    parseFormWords, stateToDims, formWordsFor } = vocabulary;
const catalog = JSON.parse(readFileSync(new URL('../../../../docs/nutrition/ingredient-catalog.json', import.meta.url), 'utf8'));
const catalogStates = [...new Set(catalog.entries.map(entry => entry.state))].sort();
const formDims = words => parseFormWords(words).dims;

describe('shared variant vocabulary v1', () => {
    it('pins its version, freezes term lists, and declares every ESM export', () => {
        expect(VOCABULARY_VERSION).toBe(1);
        expect(Object.isFrozen(STATE_SLUGS)).toBe(true);
        expect(Object.isFrozen(PREPARATION_TERMS)).toBe(true);
        const declarations = readFileSync(new URL('../../../shared/nutrition/variantVocabulary.d.ts', import.meta.url), 'utf8');
        for (const name of Object.keys(vocabulary)) expect(declarations).toMatch(new RegExp('\\b' + name + '\\b'));
    });
    it.each(catalogStates)('maps catalog state %s and round trips exact dimensions', state => {
        const result = stateToDims(state);
        expect(isKnownState(state)).toBe(true);
        expect(result.needsReview).toBe(false);
        expect(result.unknownWords).toEqual([]);
        expect(result.dims).toEqual(normalizeVariantDims(result.dims));
        const words = formWordsFor(result.dims), parsed = parseFormWords(words);
        expect(parsed.unknownWords).toEqual([]);
        expect(compareVariants(result.dims, parsed.dims)).toBe('exact');
        expect(formWordsFor(parsed.dims)).toEqual(words);
        expect(variantKeyV1(parsed.dims)).toBe(variantKeyV1(result.dims));
    });
    it('does not collapse distinct catalog descriptors', () => {
        expect(new Set(catalogStates.map(state => variantKeyV1(stateToDims(state).dims))).size).toBe(catalogStates.length);
    });
    it('round trips every canonical scalar state and preparation term', () => {
        for (const state of STATE_SLUGS) {
            expect(isKnownState(state)).toBe(true);
            expect(compareVariants(formDims(formWordsFor({ state })), { state })).toBe('exact');
        }
        for (const preparation of PREPARATION_TERMS) {
            expect(isKnownPreparation(preparation)).toBe(true);
            expect(compareVariants(formDims(formWordsFor({ preparation })), { preparation })).toBe('exact');
        }
        expect(isKnownPreparation('boiled-drained-without-added-salt')).toBe(false);
    });
    it.each([
        [' ＲＡＷ ', { state: 'raw' }], ['Uncooked', { state: 'raw' }],
        ['tinned', { state: 'canned' }], ['Dehydrated', { state: 'dried' }],
        ['as purchased', { state: 'as-sold' }], ['rehydrated', { state: 'reconstituted' }],
        ['puréed', { preparation: 'pureed' }], ['milled', { preparation: 'ground' }],
        ['drained and rinsed', { drained: 'drained_rinsed' }],
        ['DRAINED_RINSED', { drained: 'drained_rinsed' }],
        ['without added salt', { salt: 'unsalted' }], ['no added salt', { salt: 'unsalted' }],
        ['plain', { fortification: 'unfortified' }], ['low sodium', { salt: 'low_sodium' }],
    ])('normalizes exact synonym %s', (word, dims) => {
        expect(parseFormWords([word])).toEqual({ dims, unknownWords: [] });
        const rendered = formWordsFor(dims);
        expect(compareVariants(formDims(rendered), dims)).toBe('exact');
        expect(formWordsFor(formDims(rendered))).toEqual(rendered);
    });
    it.each(['raw-ish', 'not cooked', 'unfortified extra', 'salted caramel', 'not-drained', 'boiled-drained-without-added-salt-extra'])('never recognizes substrings in %s', word => {
        expect(parseFormWords([word])).toEqual({ dims: {}, unknownWords: [word] });
        expect(isKnownState(word)).toBe(false);
        expect(isKnownPreparation(word)).toBe(false);
        expect(stateToDims(word)).toEqual({ dims: normalizeVariantDims(), needsReview: true, unknownWords: [word] });
    });
    it('parses compounds and comma separated forms, retaining preparation qualifiers', () => {
        expect(formDims('boiled drained without added salt')).toEqual({ state: 'cooked', preparation: 'boiled', drained: 'drained', salt: 'unsalted' });
        expect(parseFormWords('canned, drained, unknown term')).toEqual({ dims: { state: 'canned', drained: 'drained' }, unknownWords: ['unknown term'] });
        expect(stateToDims('canned-in-heavy-syrup-drained').dims.preparation).toBe('in-heavy-syrup');
        expect(stateToDims('canned-oil-packed-drained').dims.preparation).toBe('oil-packed');
        expect(stateToDims('canned-drained-not-rinsed').dims.preparation).toBe('not-rinsed');
    });
    it('keeps preparation-only paste input underspecified; catalog mappings supply explicit state', () => {
        expect(formDims('grilled')).toEqual({ preparation: 'grilled' });
        expect(stateToDims('grilled').dims).toMatchObject({ state: 'cooked', preparation: 'grilled' });
        expect(isKnownPreparation('puréed')).toBe(true);
        expect(isKnownPreparation('unspecified')).toBe(true);
        expect(isKnownState('rehydrated')).toBe(true);
        expect(stateToDims('as purchased').dims.state).toBe('as-sold');
        expect(stateToDims('ground').dims.state).toBe('unspecified');
    });
    it.each([null, undefined, '', ' ', 123, {}, 'unknown new state'])('flags missing/unknown manifest state %j without guessing', value => {
        expect(stateToDims(value).needsReview).toBe(true);
        expect(stateToDims(value).dims).toEqual(normalizeVariantDims());
        expect(isKnownState(value)).toBe(false);
    });
    it('handles empty/unspecified forms and dimension-specific not-applicable words', () => {
        expect(parseFormWords('')).toEqual({ dims: {}, unknownWords: [] });
        expect(parseFormWords([])).toEqual({ dims: {}, unknownWords: [] });
        expect(formWordsFor()).toEqual([]);
        expect(formWordsFor(formDims('unspecified'))).toEqual([]);
        expect(stateToDims('unspecified').needsReview).toBe(true);
        const dims = { drained: 'not_applicable', salt: 'not_applicable', fortification: 'not_applicable' };
        expect(formDims(formWordsFor(dims))).toEqual(dims);
    });
    it.each(['raw, cooked', 'drained, undrained', 'salted, unsalted', 'fortified, plain', 'boiled, roasted', 'unspecified, raw', 'raw, cooked-drained-without-added-salt'])('rejects conflicting words %s', words => {
        expect(() => parseFormWords(words)).toThrow('Conflicting form dimension');
    });
    it('deduplicates synonyms and rejects malformed tokens and unrenderable forms', () => {
        expect(formDims('raw, uncooked, RAW')).toEqual({ state: 'raw' });
        expect(() => parseFormWords(null)).toThrow(TypeError);
        expect(() => parseFormWords(['raw', 5])).toThrow(TypeError);
        expect(() => formWordsFor({ preparation: 'unknown method' })).toThrow('Unrenderable');
        expect(() => formWordsFor({ state: 'unknown state' })).toThrow('Unrenderable');
        expect(() => formWordsFor({ salt: 'invalid' })).toThrow(TypeError);
    });
    it.each([
        ['raw', 'cooked'], ['drained', 'undrained'], ['drained', 'drained-rinsed'],
        ['salted', 'unsalted'], ['fortified', 'plain'], ['dry', 'reconstituted'],
        ['boiled', 'roasted'], ['canned-in-juice-drained', 'canned-in-heavy-syrup-drained'],
    ])('retains compareVariants conflicts: %s versus %s', (a, b) => {
        expect(compareVariants(formDims(a), formDims(b))).toBe('conflict');
        expect(variantKeyV1(formDims(a))).not.toBe(variantKeyV1(formDims(b)));
    });
    it.each(['raw', 'cooked', 'drained', 'salted', 'fortified', 'roasted'])('never matches unspecified with specified %s', word => {
        expect(compareVariants(formDims('unspecified'), formDims(word))).toBe('underspecified');
    });
    it('preserves the frozen #61 free-text normalizer and a fixed deterministic key', () => {
        expect(variantKeyV1({ state: ' RAW ', preparation: 'Grilled', fatPercent: 10 })).toBe('{"brand":null,"drained":"unspecified","ediblePortion":"unspecified","fatPercent":10,"fortification":"unspecified","fortificationDetail":"unspecified","leanPercent":null,"preparation":"grilled","salt":"unspecified","state":"raw","sweetening":"unspecified"}');
        expect(normalizeVariantDims({ state: 'Uncooked', preparation: 'Old custom method' })).toMatchObject({ state: 'uncooked', preparation: 'old custom method' });
    });
});
