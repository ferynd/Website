/**
 * One text adapter for legacy 24-field pastes and exact v2 labels.
 * Matching is whole-label only. Subtypes never write their parent.
 */
import {
  V2_KEYS,
  convertUnit,
  emptyStagedRecord,
  getNutrient,
  lookupLabel,
  mergeObservations,
  normalizeLabel,
} from './nutrientRegistry.js';

function stripDecorations(line) {
  return String(line)
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

function registeredLabelPrefixes() {
  const labels = [];
  for (const key of V2_KEYS) {
    const def = getNutrient(key);
    if (!def) continue;
    for (const raw of [...(def.labels || []), ...(def.legacyAliases || [])]) {
      const norm = normalizeLabel(raw);
      if (norm) labels.push(norm);
    }
  }
  return [...new Set(labels)].sort((a, b) => b.length - a.length);
}

const LABEL_PREFIXES = registeredLabelPrefixes();

/** Lowercase and collapse whitespace, keeping each collapsed character's original index. */
function collapseWithMap(line) {
  const lower = String(line).toLowerCase();
  let collapsed = '';
  const map = [];
  let pendingSpace = false;
  for (let index = 0; index < lower.length; index += 1) {
    if (/\s/.test(lower[index])) {
      if (collapsed.length) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      collapsed += ' ';
      map.push(index);
      pendingSpace = false;
    }
    collapsed += lower[index];
    map.push(index);
  }
  return { collapsed, map };
}

function labelBoundary(next) {
  return next == null || /[\s<~≈\d]/.test(next);
}

/** Match the longest registered label, then take the value after that whole label. */
function matchRegisteredLabel(line) {
  const { collapsed, map } = collapseWithMap(line);
  const candidates = [collapsed];
  if (collapsed.startsWith('includes ')) candidates.push(collapsed.slice('includes '.length));
  for (const text of candidates) {
    const offset = collapsed.length - text.length;
    for (const label of LABEL_PREFIXES) {
      if (!text.startsWith(label) || !labelBoundary(text[label.length])) continue;
      const lastCollapsed = offset + label.length - 1;
      if (lastCollapsed < 0 || lastCollapsed >= map.length) continue;
      const originalEnd = map[lastCollapsed] + 1;
      const labelText = line.slice(0, originalEnd).trim();
      if (!labelText) continue;
      return { label: labelText, valuePart: line.slice(originalEnd).trim() };
    }
  }
  return null;
}

/** Integer, thousands separators, or a leading decimal. The sign is separate. */
const NUMBER_CORE = '(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)';
const SPACED_VALUE = new RegExp(`\\s+([<~≈]?(?:${NUMBER_CORE}))`);
const READ_NUMBER = new RegExp(`(${NUMBER_CORE})`);
const RANGE_NUMBER = new RegExp(`${NUMBER_CORE}\\s*(?:-|–|—|\\bto\\b)\\s*${NUMBER_CORE}`);
const NEGATIVE_NUMBER = new RegExp(`(?:^|[^\\d.])-(?:${NUMBER_CORE})`);

function splitAtValueToken(line) {
  const spaced = line.match(SPACED_VALUE);
  if (spaced && spaced.index != null) {
    return { label: line.slice(0, spaced.index).trim(), valuePart: line.slice(spaced.index).trim() };
  }
  const re = new RegExp(`[<~≈]|\\.(?=\\d)|\\d`, 'g');
  let match = re.exec(line);
  while (match) {
    if (match.index !== 0) {
      const prev = line[match.index - 1];
      const digitInsideWord = /[A-Za-z]/.test(prev) && /\d/.test(match[0]);
      if (!digitInsideWord) {
        return { label: line.slice(0, match.index).trim(), valuePart: line.slice(match.index).trim() };
      }
    }
    match = re.exec(line);
  }
  return null;
}

function splitLabelValue(line) {
  const colon = line.indexOf(':');
  if (colon >= 0) {
    return { label: line.slice(0, colon).trim(), valuePart: line.slice(colon + 1).trim() };
  }
  return matchRegisteredLabel(line) || splitAtValueToken(line);
}

function hasNumber(text) {
  return /\d/.test(text);
}

function decimalCount(token) {
  const fraction = token.includes('.') ? token.split('.')[1].replace(/,/g, '') : '';
  return fraction.length;
}

function readNumber(text) {
  const match = String(text).match(READ_NUMBER);
  if (!match) return null;
  const token = match[1];
  const value = Number(token.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return {
    value,
    decimals: decimalCount(token),
    end: match.index + token.length,
  };
}

function readUnit(text, start) {
  const rest = String(text).slice(start).trim();
  const match = rest.match(/^([a-zA-Zµμ]+)/);
  return match ? match[1] : '';
}

function isRange(text) {
  return RANGE_NUMBER.test(String(text));
}

function isNegative(text) {
  return NEGATIVE_NUMBER.test(String(text));
}

function pushWarning(warnings, warning) {
  warnings.push(warning);
}

function fiberMeaningFor(key) {
  if (key === 'fiberTotal') return 'total';
  if (key === 'fiberWeightedLegacy') return 'weighted_legacy';
  return null;
}

/**
 * @param {string} text
 * @returns {import('./nutrientRegistry.js').StagedNutrientRecord}
 */
export function parseNutritionText(text) {
  const observations = [];
  const warnings = [];
  const unknownLabels = [];
  let fiberMeaning = null;

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = stripDecorations(rawLine);
    if (!line) continue;
    const split = splitLabelValue(line);
    if (!split || !split.label) continue;
    if (!hasNumber(split.valuePart)) continue;

    if (normalizeLabel(split.label) === 'folic acid') {
      pushWarning(warnings, {
        level: 'review',
        code: 'nondefensible_conversion',
        key: 'folate',
        message: 'Folic acid is not converted to folate DFE.',
      });
      continue;
    }

    const hit = lookupLabel(split.label);
    if (!hit) {
      unknownLabels.push(split.label);
      pushWarning(warnings, {
        level: 'review',
        code: 'unknown_label',
        message: `Unknown nutrient label "${split.label}".`,
      });
      continue;
    }

    const explicitFiber = fiberMeaningFor(hit.key);
    if (explicitFiber) {
      if (fiberMeaning && fiberMeaning !== explicitFiber) {
        pushWarning(warnings, {
          level: 'review',
          code: 'fiber_meaning',
          key: 'fiber',
          message: 'Conflicting explicit fiber meanings.',
        });
      } else {
        fiberMeaning = explicitFiber;
      }
    }

    const valuePart = split.valuePart;
    if (isRange(valuePart)) {
      pushWarning(warnings, {
        level: 'review',
        code: 'range',
        key: hit.key,
        message: `${split.label} is a range and was not stored.`,
      });
      continue;
    }
    if (isNegative(valuePart)) {
      pushWarning(warnings, {
        level: 'review',
        code: 'negative',
        key: hit.key,
        message: `${split.label} is negative and was not stored.`,
      });
      continue;
    }

    const lessThan = /^\s*</.test(valuePart);
    const approximate = /^\s*[~≈]/.test(valuePart);
    const number = readNumber(valuePart);
    if (!number) continue;
    const unit = readUnit(valuePart, number.end);
    const def = getNutrient(hit.key);

    if (lessThan) {
      let upperBound = number.value;
      if (unit) {
        const converted = convertUnit(hit.key, number.value, unit);
        if (converted.error) {
          pushWarning(warnings, {
            level: 'review',
            code: converted.error,
            key: hit.key,
            message: `${split.label} could not be converted (${converted.error}).`,
          });
          continue;
        }
        upperBound = converted.value;
      } else {
        pushWarning(warnings, {
          level: 'info',
          code: 'unit_assumed',
          key: hit.key,
          message: `${split.label} has no unit; assumed ${def.unit}.`,
        });
      }
      observations.push({
        key: hit.key,
        value: null,
        quality: { status: 'label_reported', upperBound },
      });
      continue;
    }

    let stored = number.value;
    if (unit) {
      const converted = convertUnit(hit.key, number.value, unit);
      if (converted.error) {
        pushWarning(warnings, {
          level: 'review',
          code: converted.error,
          key: hit.key,
          message: `${split.label} could not be converted (${converted.error}).`,
        });
        continue;
      }
      stored = converted.value;
    } else {
      pushWarning(warnings, {
        level: 'info',
        code: 'unit_assumed',
        key: hit.key,
        message: `${split.label} has no unit; assumed ${def.unit}.`,
      });
    }

    if (approximate) {
      observations.push({
        key: hit.key,
        value: stored,
        quality: { status: 'estimated_from_comparable' },
      });
      pushWarning(warnings, {
        level: 'review',
        code: 'approximate',
        key: hit.key,
        message: `${split.label} is approximate and needs review.`,
      });
      continue;
    }

    const quality = { status: 'label_reported' };
    if (stored === 0) {
      quality.roundingInterval = number.decimals === 0 ? 1 : 10 ** -number.decimals;
    }
    observations.push({ key: hit.key, value: stored, quality });
  }

  const record = mergeObservations(observations);
  record.unknownLabels = unknownLabels;
  record.warnings = warnings;
  if (fiberMeaning) record.fiberMeaning = fiberMeaning;
  record.carbConvention = 'unknown';
  return record;
}

export { emptyStagedRecord };
