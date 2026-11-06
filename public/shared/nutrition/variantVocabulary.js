import { normalizeVariantDims, VARIANT_ENUMS } from './ingredientVariants.js';

// Version the interpretation of new inputs, never the frozen #61 identity keys.
export const VOCABULARY_VERSION = 1;
const normalizeWord = value => typeof value === 'string'
    ? value.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
const words = new Map();
const scalarWords = new Map();
function term(word, dims, synonyms = []) {
    const entry = Object.freeze({ ...dims });
    for (const alias of [word, ...synonyms]) {
        const key = normalizeWord(alias);
        if (words.has(key)) throw new Error('Duplicate vocabulary word: ' + key);
        words.set(key, entry);
    }
    if (Object.keys(dims).length === 1) {
        const [key, value] = Object.entries(dims)[0];
        scalarWords.set(key + ':' + value, word);
    }
}

export const STATE_SLUGS = Object.freeze([
    'unspecified', 'raw', 'cooked', 'canned', 'dry', 'dried', 'fresh', 'frozen',
    'reconstituted', 'as-sold', 'liquid-as-sold', 'food-grade-dry', 'food-grade-as-sold',
    'food-grade-solution-concentration-needed', 'ready-to-drink', 'ready-to-eat',
    'ready-to-use', 'brined', 'pickled', 'concentrated-dry', 'purified-additive',
]);
const stateSynonyms = {
    raw: ['uncooked'], canned: ['tinned'], dried: ['dehydrated'],
    'as-sold': ['as purchased'], reconstituted: ['rehydrated'],
};
for (const state of STATE_SLUGS) term(state, { state }, stateSynonyms[state] ?? []);
export const PREPARATION_TERMS = Object.freeze([
    'boiled', 'roasted', 'fried', 'grilled', 'braised', 'baked', 'poached', 'steamed',
    'pan-browned', 'pan-fried', 'dry-roasted', 'ground', 'pureed', 'pasteurized-liquid',
    'without-added-fat', 'without-added-sugar', 'in-water-without-added-salt',
    'dry-ground-or-powdered', 'whole-dried-seed', 'in-juice', 'in-heavy-syrup',
    'shelled', 'grilled-without-added-fat', 'roasted-without-added-fat',
    'browned-retained-fat-and-milk-solids', 'oil-packed', 'water-packed',
    'dry-heat-without-added-fat', 'moist-heat', 'baked-without-added-fat', 'not-rinsed',
]);
for (const preparation of PREPARATION_TERMS) term(preparation, { preparation },
    preparation === 'pureed' ? ['puréed'] : preparation === 'ground' ? ['milled'] : []);
// The existing enums own these dimensions; aliases resolve to their exact values.
for (const key of ['drained', 'salt', 'fortification']) {
    for (const value of VARIANT_ENUMS[key].filter(v => v !== 'unspecified')) {
        const word = value === 'not_applicable' ? key + '-not-applicable' : value.replaceAll('_', '-');
        term(word, { [key]: value }, value === 'drained_rinsed' ? ['drained and rinsed', 'rinsed-drained']
            : value === 'unfortified' ? ['plain'] : value === 'unsalted' ? ['without added salt', 'no added salt'] : []);
    }
}
term('sweetened', { sweetening: 'sweetened' });
term('unsweetened', { sweetening: 'unsweetened' });

// Explicit catalog descriptors, not token splitting or substring inference.
// Preparation qualifiers stay intact when VariantDims has no separate axis.
const catalogForms = {
    'brined-drained': ['brined', 'drained'],
    'cooked-without-added-fat': ['cooked', 'without-added-fat'],
    'pasteurized-liquid': ['liquid-as-sold', 'pasteurized-liquid'],
    'cooked-without-added-sugar': ['cooked', 'without-added-sugar'],
    'dried-unsweetened': ['dried', 'unsweetened'],
    'pureed-unsweetened': ['pureed', 'unsweetened'],
    'dried-sweetened': ['dried', 'sweetened'],
    'frozen-unsweetened': ['frozen', 'unsweetened'],
    'canned-in-juice-drained': ['canned', 'in-juice', 'drained'],
    'canned-in-heavy-syrup-drained': ['canned', 'in-heavy-syrup', 'drained'],
    'cooked-in-water-without-added-salt': ['cooked', 'in-water-without-added-salt', 'unsalted'],
    'dry-ground-or-powdered': ['dry', 'dry-ground-or-powdered'],
    'whole-dried-seed': ['dried', 'whole-dried-seed'],
    'boiled-drained-without-added-salt': ['cooked', 'boiled', 'drained', 'unsalted'],
    'canned-drained-not-rinsed': ['canned', 'drained', 'not-rinsed'],
    'canned-drained-rinsed': ['canned', 'drained-rinsed'],
    'frozen-as-sold-shelled': ['frozen', 'shelled'],
    'braised-drained': ['cooked', 'braised', 'drained'],
    'grilled-without-added-fat': ['cooked', 'grilled-without-added-fat'],
    'roasted-without-added-fat': ['cooked', 'roasted-without-added-fat'],
    'grilled-drained': ['cooked', 'grilled', 'drained'],
    'pan-browned-drained': ['cooked', 'pan-browned', 'drained'],
    'pan-fried-drained': ['cooked', 'pan-fried', 'drained'],
    'dry-roasted-salted': ['cooked', 'dry-roasted', 'salted'],
    'raw-unsalted': ['raw', 'unsalted'],
    'roasted': ['cooked', 'roasted'],
    'ground': ['ground'],
    'browned-retained-fat-and-milk-solids': ['cooked', 'browned-retained-fat-and-milk-solids'],
    'cooked-drained-without-added-salt': ['cooked', 'drained', 'unsalted'],
    'ready-to-eat-drained': ['ready-to-eat', 'drained'],
    'poached-without-added-salt': ['cooked', 'poached', 'unsalted'],
    'canned-oil-packed-drained': ['canned', 'oil-packed', 'drained'],
    'cooked-dry-heat-without-added-fat': ['cooked', 'dry-heat-without-added-fat'],
    'cooked-moist-heat': ['cooked', 'moist-heat'],
    'canned-water-packed-drained': ['canned', 'water-packed', 'drained'],
    'rehydrated-drained': ['reconstituted', 'drained'],
    'canned-drained': ['canned', 'drained'],
    'oil-packed-drained': ['oil-packed', 'drained'],
    'pickled-drained': ['pickled', 'drained'],
    'frozen-as-sold-no-added-salt': ['frozen', 'unsalted'],
    'baked-without-added-fat': ['cooked', 'baked-without-added-fat'],
    'canned-no-added-salt': ['canned', 'unsalted'],
    'canned-with-salt': ['canned', 'salted'],
    'boiled': ['cooked', 'boiled'],
    'fried': ['cooked', 'fried'],
    'grilled': ['cooked', 'grilled'],
    'braised': ['cooked', 'braised'],
    'baked': ['cooked', 'baked'],
    'poached': ['cooked', 'poached'],
    'steamed': ['cooked', 'steamed'],
};
const catalog = new Map(STATE_SLUGS.map(state => [state, words.get(state)]));
for (const [descriptor, form] of Object.entries(catalogForms)) {
    const { dims, unknownWords } = parseFormWords(form);
    if (unknownWords.length) throw new Error('Invalid catalog form: ' + descriptor);
    catalog.set(descriptor, Object.freeze(dims));
    // Scalar preparation terms carry only preparation in paste. The catalog
    // explicitly supplies cooking state where its descriptor guarantees it.
    if (!words.has(descriptor)) term(descriptor, dims);
}

const catalogEntry = value => {
    const word = normalizeWord(value), entry = words.get(word);
    return catalog.get(word) ?? (entry && Object.keys(entry).length === 1 && entry.state ? entry : undefined);
};
export const isKnownState = value => !!catalogEntry(value);
export const isKnownPreparation = value => {
    const word = normalizeWord(value), entry = words.get(word);
    return word === 'unspecified' || !!(entry?.preparation && Object.keys(entry).length === 1);
};

/** Unknowns never acquire dimensions. Contradictory known words are rejected. */
export function parseFormWords(input) {
    const tokens = typeof input === 'string' ? input.split(',') : input;
    if (!Array.isArray(tokens) || tokens.some(word => typeof word !== 'string'))
        throw new TypeError('Form words must be text or an array of text');
    const dims = {}, unknownWords = [];
    for (const token of tokens) {
        const word = normalizeWord(token);
        if (!word) continue;
        const entry = words.get(word);
        if (!entry) { unknownWords.push(token.trim()); continue; }
        for (const [key, value] of Object.entries(entry)) {
            if (key in dims && dims[key] !== value) throw new TypeError('Conflicting form dimension: ' + key);
            dims[key] = value;
        }
    }
    return { dims, unknownWords };
}

/** Manifest adapter: callers must retain needsReview before matching/research. */
export function stateToDims(catalogState) {
    const word = normalizeWord(catalogState);
    const entry = catalogEntry(catalogState);
    return { dims: normalizeVariantDims(entry ?? {}), needsReview: !entry || word === 'unspecified',
        unknownWords: entry ? [] : [typeof catalogState === 'string' ? catalogState : ''] };
}

/** Render vocabulary dimensions only; other VariantDims use paste key=value. */
export function formWordsFor(dims = {}) {
    const normalized = normalizeVariantDims(dims), result = [];
    for (const key of ['state', 'preparation', 'drained', 'salt', 'fortification', 'sweetening']) {
        const value = normalized[key];
        if (value === 'unspecified') continue;
        const word = scalarWords.get(key + ':' + value);
        if (!word) throw new TypeError('Unrenderable form dimension: ' + key);
        result.push(word);
    }
    return result;
}
