/**
 * One text adapter for legacy 24-field pastes and exact v2 labels.
 * The longest registered label that matches at a word boundary wins.
 * A shorter label is never tried, and a label does not absorb a following
 * digit (so "Vitamin B12" cannot be read as B1, and "Vitamin D3" cannot
 * become vitamin D = 3). Subtypes never write their parent.
 */
import {
  V2_KEYS,
  getNutrient,
  lookupLabel,
  mergeObservations,
  normalizeLabel,
  normalizeUnit,
  noteKeepsParent,
  resolveAmount,
  emptyStagedRecord,
} from './nutrientRegistry.js';

function stripDecorations(line) {
  return String(line)
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
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

/** A letter or digit continues the token. "B12", "D3" and "K2" stay one label. */
function isWordBoundary(next) {
  return next == null || !/[A-Za-z0-9]/.test(next);
}

/** The value token: a number, a leading decimal, < / ~ / ≈, or a sign glued to a digit. */
function valueStartsImmediately(valuePart) {
  return /^(?:[<~≈]\s*)?(?:\d|\.\d)/.test(valuePart)
    || /^(?:[<~≈]\s*)?[−–—-](?:\d|\.\d)/.test(valuePart);
}

/** Whole tokens that are units. A longer word ("total", "per", "each") is not a unit. */
const KNOWN_UNIT_TOKENS = new Set([
  'g', 'gram', 'grams',
  'mg', 'milligram', 'milligrams',
  'mcg', 'microgram', 'micrograms', 'µg', 'μg', 'ug',
  'kcal', 'cal', 'calorie', 'calories',
  'kj', 'iu',
]);

const UNIT_PATTERN = [...KNOWN_UNIT_TOKENS].sort((a, b) => b.length - a.length).join('|');

function knownUnitWord(token) {
  const text = String(token ?? '').trim().toLowerCase().replace(/\.$/, '');
  return KNOWN_UNIT_TOKENS.has(text);
}

function leadingUnitToken(inner) {
  const match = String(inner).trim().match(/^([a-zA-Zµμ]+)\b/);
  if (!match || !knownUnitWord(match[1])) return '';
  return match[1];
}

function isApproxNote(inner) {
  return /^(?:approximately|approx|about)\b/i.test(String(inner).trim());
}

function takeParen(rest) {
  if (!rest.startsWith('(')) return null;
  const close = rest.indexOf(')');
  if (close < 0) return null;
  const text = rest.slice(0, close + 1);
  const inner = rest.slice(1, close).trim();
  return {
    text,
    length: text.length,
    unit: leadingUnitToken(inner) || null,
    approximate: isApproxNote(inner),
  };
}

/**
 * Separators between a label and its value.
 * A dash glued to a digit is a sign. Return that split so isNegative can see it.
 */
function takeSeparator(rest) {
  const word = rest.match(/^(?:approximately|approx|about)\.?(?![A-Za-z])/i);
  if (word) return { length: word[0].length, approximate: true };
  if (/^[−–—-](?:\d|\.\d)/.test(rest)) return { length: 0, valueSplit: true };
  if (/^[=:~≈]/.test(rest)) {
    const symbol = rest[0];
    return { length: 1, approximate: symbol === '~' || symbol === '≈' };
  }
  if (/^[−–—-](?=\s)/.test(rest)) return { length: 1, approximate: false };
  return null;
}

/**
 * After the matched label, accept unit/form parentheticals and separators,
 * then require the value. Anything else ( "from fat", "EPA + DHA" ) fails
 * this label instead of falling through to a shorter one.
 */
function parseAfterLabel(line, originalEnd) {
  let rest = line.slice(originalEnd);
  let label = line.slice(0, originalEnd).trim();
  let labelUnit = null;
  let approximate = false;
  while (rest.length) {
    rest = rest.replace(/^\s+/, '');
    if (!rest) break;
    const paren = takeParen(rest);
    if (paren) {
      label = `${label} ${paren.text}`.trim();
      if (paren.unit) labelUnit = paren.unit;
      if (paren.approximate) approximate = true;
      rest = rest.slice(paren.length);
      continue;
    }
    const separator = takeSeparator(rest);
    if (separator?.valueSplit) break;
    if (separator) {
      if (separator.approximate) approximate = true;
      rest = rest.slice(separator.length);
      continue;
    }
    if (valueStartsImmediately(rest)) break;
    return null;
  }
  if (!valueStartsImmediately(rest) || !label) return null;
  return { label, valuePart: rest.trim(), labelUnit, approximate };
}

/** Longest boundary match only. A failed longest match does not try a shorter label. */
function longestLabelSplit(line, text, offset, map) {
  for (const label of LABEL_PREFIXES) {
    if (!text.startsWith(label)) continue;
    const next = text[label.length];
    if (!isWordBoundary(next)) continue;
    const lastCollapsed = offset + label.length - 1;
    if (lastCollapsed < 0 || lastCollapsed >= map.length) return null;
    const originalEnd = map[lastCollapsed] + 1;
    const parsed = parseAfterLabel(line, originalEnd);
    if (!parsed || !lookupLabel(parsed.label)) return null;
    return parsed;
  }
  return null;
}

function matchRegisteredLabel(line) {
  const { collapsed, map } = collapseWithMap(line);
  const texts = [collapsed];
  if (collapsed.startsWith('includes ')) texts.push(collapsed.slice('includes '.length));
  for (const text of texts) {
    const offset = collapsed.length - text.length;
    const matched = longestLabelSplit(line, text, offset, map);
    if (matched) return matched;
  }
  return null;
}

/** Integer, thousands separators, or a leading decimal. The sign is separate. */
const NUMBER_CORE = '(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)';
const SPACED_VALUE = new RegExp(`\\s+([<~≈]?(?:${NUMBER_CORE}))`);
const READ_NUMBER = new RegExp(`(${NUMBER_CORE})`);
const INCLUDES_ADDED_SUGARS = new RegExp(
  `^includes\\s+(?:([<~≈])\\s*)?(${NUMBER_CORE})\\s*(mcg|mg|µg|μg|ug|g)?\\s+added sugars\\b\\s*(.*)$`,
  'i',
);

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
      // Keep B12 / D3 / K2 inside the label. A value digit follows a break.
      if (/[A-Za-z0-9]/.test(prev)) {
        match = re.exec(line);
        continue;
      }
    }
    return { label: line.slice(0, match.index).trim(), valuePart: line.slice(match.index).trim() };
  }
  return null;
}

/** "Protein / Protéines" keeps the registered language and ignores the other tail. */
function peelBilingualLabel(label) {
  const match = String(label).match(/^(.*?)\s+\/\s+\S/);
  if (!match) return label;
  const head = match[1].trim();
  if (!head || !lookupLabel(head)) return label;
  return head;
}

function splitLabelValue(line) {
  const colon = line.indexOf(':');
  if (colon >= 0) {
    return {
      label: peelBilingualLabel(line.slice(0, colon).trim()),
      valuePart: line.slice(colon + 1).trim(),
    };
  }
  const matched = matchRegisteredLabel(line);
  if (matched) return matched;
  const token = splitAtValueToken(line);
  if (!token) return null;
  return { label: peelBilingualLabel(token.label), valuePart: token.valuePart };
}

function isPercentDailyValue(rest) {
  const text = String(rest ?? '').trim();
  if (!text) return true;
  return /^(?:\d+(?:\.\d+)?\s*)?%(?:\s*(?:dv|daily value))?$/i.test(text)
    || /^\d+(?:\.\d+)?(?:\s*%)?\s*(?:dv|daily value)$/i.test(text);
}

/** US Nutrition Facts: "Includes 10g Added Sugars" or the same line with a % DV. */
function matchIncludesAddedSugars(line) {
  const match = String(line).match(INCLUDES_ADDED_SUGARS);
  if (!match || !isPercentDailyValue(match[4])) return null;
  const symbol = match[1] || '';
  const numberText = match[2];
  const unit = match[3] || '';
  const gap = symbol ? ' ' : '';
  const valuePart = `${symbol}${gap}${numberText}${unit ? ` ${unit}` : ''}`.trim();
  return { label: 'Added Sugars', valuePart, labelUnit: null, approximate: symbol === '~' || symbol === '≈' };
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
  if (!match || !knownUnitWord(match[1])) return '';
  return match[1];
}

/** Text after the first amount and its unit, used for notes and a second column. */
function remainderAfterAmount(valuePart, number) {
  const rest = String(valuePart).slice(number.end);
  const unit = readUnit(valuePart, number.end);
  if (!unit) return rest.trim();
  const trimmed = rest.trim();
  if (!trimmed.toLowerCase().startsWith(unit.toLowerCase())) return trimmed;
  return trimmed.slice(unit.length).trim();
}

function trailingApproximate(valuePart, number) {
  const rest = remainderAfterAmount(valuePart, number);
  return /^(?:\(\s*)?(?:approximately|approx|about)\b/i.test(rest);
}

/** A % glued to the amount is % DV, not a quantity in the canonical unit. */
function isBarePercent(valuePart, number) {
  return /^\s*%/.test(String(valuePart).slice(number.end));
}

/**
 * A second amount after the first. "%" is its own unit.
 * A bare second number is the other column of a pair, not a different unit.
 */
function readSecondAmount(valuePart, number) {
  const rest = remainderAfterAmount(valuePart, number);
  const match = rest.match(new RegExp(`^(${NUMBER_CORE})`));
  if (!match) return null;
  const tail = rest.slice(match[1].length).trim();
  if (tail.startsWith('%')) return { kind: 'percent' };
  const unitMatch = tail.match(/^([a-zA-Zµμ]+)\b/);
  if (unitMatch && knownUnitWord(unitMatch[1])) {
    return { kind: 'unit', unit: normalizeUnit(unitMatch[1]) };
  }
  return { kind: 'bare' };
}

function secondAmountUsesDifferentUnit(valuePart, number, second) {
  if (!second || second.kind === 'bare') return false;
  if (second.kind === 'percent') return true;
  const first = readUnit(valuePart, number.end);
  const firstNorm = first ? normalizeUnit(first) : '';
  if (!firstNorm) return true;
  return firstNorm !== second.unit;
}

function isRange(text) {
  const trimmed = String(text).trim().replace(/^[<~≈]\s*/, '');
  // "20g - 25g" and "20 g - 25 g" are ranges. A later "(10-15% DV)" is not.
  return new RegExp(
    `^${NUMBER_CORE}\\s*(?:${UNIT_PATTERN})?\\s*(?:-|–|—|\\bto\\b)\\s*${NUMBER_CORE}`,
    'i',
  ).test(trimmed);
}

function isNegative(text) {
  const trimmed = String(text).trim().replace(/^[<~≈]\s*/, '');
  if (!/^[−–—-]/.test(trimmed)) return false;
  const rest = trimmed.replace(/^[−–—\s-]+/, '');
  return new RegExp(`^${NUMBER_CORE}`).test(rest);
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
 * Folic acid is not DFE, wherever it sits on the line.
 * Keep the amount only when the value itself says DFE.
 */
function folicAcidNeedsReview(label, valuePart) {
  const combined = `${label ?? ''} ${valuePart ?? ''}`;
  if (!/\bfolic\s+acid\b/i.test(combined)) return false;
  return !/\bdfe\b/i.test(String(valuePart ?? ''));
}

/**
 * Footnote sentences and the calorie-needs reference row. A bare "% Daily Value"
 * header is the column title on a product label, not this footer.
 */
const FOOTER_NOTE_RE = /based on an?\s+2,?000\s+calorie\b|daily\s+values?\s+may\s+be\s+higher\s+or\s+lower|%\s*daily\s+value(?:\s*\(\s*dv\s*\))?\s+tells you\b/i;

function amountNumbers(after, skipPercent) {
  const re = new RegExp(NUMBER_CORE, 'g');
  const numbers = [];
  let match = re.exec(after);
  while (match) {
    const tail = after.slice(match.index + match[0].length);
    if (!(skipPercent && /^\s*%/.test(tail))) numbers.push(Number(match[0].replace(/,/g, '')));
    match = re.exec(after);
  }
  return numbers;
}

/** "Less than 65g 80g" is a footer row. A trailing % column is not a second amount. */
function lessThanLine(line) {
  const match = String(line).match(/\bless\s+than\b/i);
  if (!match) return { action: 'none', line };
  const after = String(line).slice(match.index + match[0].length);
  if (amountNumbers(after, true).length >= 2) return { action: 'skip', line };
  return { action: 'rewrite', line: String(line).replace(/\bless\s+than\b/i, '<') };
}

/** Words before the first amount. A sign or "<" is not a word. */
function wordsBeforeNumber(valuePart) {
  let text = String(valuePart ?? '').trim().replace(/^[<~≈]\s*/, '');
  text = text.replace(/^[−–—-]+\s*/, '');
  const match = text.match(new RegExp(NUMBER_CORE));
  if (!match || match.index == null || match.index === 0) return '';
  return text.slice(0, match.index).trim();
}

/** "Calories: 2,000 2,500" is the reference row that opens the footnote block. */
function isCalorieReferenceRow(line) {
  const split = splitLabelValue(line);
  if (!split) return false;
  const hit = lookupLabel(split.label);
  if (hit?.key !== 'calories') return false;
  const numbers = amountNumbers(split.valuePart, false);
  return numbers.length >= 2 && numbers[0] === 2000 && numbers[1] === 2500;
}

function readConverted(hit, valuePart, number, split) {
  const valueUnit = readUnit(valuePart, number.end);
  const fromParen = split.labelUnit ? normalizeUnit(split.labelUnit) : '';
  const fromLookup = hit.unit ? normalizeUnit(hit.unit) : '';
  if (fromParen && fromLookup && fromParen !== fromLookup) return { error: 'unit_mismatch' };
  return resolveAmount(hit.key, number.value, valueUnit, fromLookup || fromParen);
}

function stageAmount(hit, split, number, observations, warnings) {
  const valuePart = split.valuePart;
  const lessThan = /^\s*</.test(valuePart);
  const approximate = Boolean(split.approximate)
    || /^\s*[~≈]/.test(valuePart)
    || trailingApproximate(valuePart, number);
  const converted = readConverted(hit, valuePart, number, split);
  if (converted.error) {
    pushWarning(warnings, {
      level: 'review',
      code: converted.error,
      key: hit.key,
      message: converted.error === 'unit_mismatch'
        ? `${split.label} has a label unit that does not match the value unit.`
        : `${split.label} could not be converted (${converted.error}).`,
    });
    return;
  }
  if (converted.assumed) {
    const def = getNutrient(hit.key);
    pushWarning(warnings, {
      level: 'info',
      code: 'unit_assumed',
      key: hit.key,
      message: `${split.label} has no unit; assumed ${def.unit}.`,
    });
  }
  if (lessThan) {
    observations.push({
      key: hit.key,
      value: null,
      quality: { status: 'label_reported', upperBound: converted.value },
    });
    return;
  }
  if (approximate) {
    observations.push({
      key: hit.key,
      value: converted.value,
      quality: { status: 'estimated_from_comparable' },
    });
    pushWarning(warnings, {
      level: 'review',
      code: 'approximate',
      key: hit.key,
      message: `${split.label} is approximate and needs review.`,
    });
    return;
  }
  const quality = { status: 'label_reported' };
  if (converted.value === 0) {
    quality.roundingInterval = number.decimals === 0 ? 1 : 10 ** -number.decimals;
  }
  observations.push({ key: hit.key, value: converted.value, quality });
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
  let footerContext = false;

  const consumeLine = (line) => {
    const lessThan = lessThanLine(line);
    if (lessThan.action === 'skip') return;
    const source = lessThan.line;
    const split = matchIncludesAddedSugars(source) || splitLabelValue(source);
    if (!split || !split.label) return;
    if (!hasNumber(split.valuePart)) return;

    if (folicAcidNeedsReview(split.label, split.valuePart)) {
      pushWarning(warnings, {
        level: 'review',
        code: 'nondefensible_conversion',
        key: 'folate',
        message: 'Folic acid is not converted to folate DFE.',
      });
      return;
    }

    const hit = lookupLabel(split.label);
    if (!hit) {
      unknownLabels.push(split.label);
      pushWarning(warnings, {
        level: 'review',
        code: 'unknown_label',
        message: `Unknown nutrient label "${split.label}".`,
      });
      return;
    }

    // "Fat: saturated 3g" puts the child word in the value, not the label.
    // That must not fill the parent. A registered "Fat (saturated)" note still maps.
    const prefix = wordsBeforeNumber(split.valuePart);
    if (prefix && !noteKeepsParent(hit.key, prefix)) {
      unknownLabels.push(source);
      pushWarning(warnings, {
        level: 'review',
        code: 'unknown_label',
        message: `Unknown nutrient label "${source}".`,
      });
      return;
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
      return;
    }
    if (isNegative(valuePart)) {
      pushWarning(warnings, {
        level: 'review',
        code: 'negative',
        key: hit.key,
        message: `${split.label} is negative and was not stored.`,
      });
      return;
    }

    const number = readNumber(valuePart);
    if (!number) return;
    if (isBarePercent(valuePart, number)) {
      pushWarning(warnings, {
        level: 'review',
        code: 'percent_daily_value',
        key: hit.key,
        message: `${split.label} is a % daily value, not an amount, and was not stored.`,
      });
      return;
    }
    const second = readSecondAmount(valuePart, number);
    if (second && !secondAmountUsesDifferentUnit(valuePart, number, second)) {
      // Footer rows ("2,000 2,500", "300g 375g") are reference text. Any other
      // second column keeps the first amount and is visible in review.
      if (footerContext) return;
      stageAmount(hit, split, number, observations, warnings);
      pushWarning(warnings, {
        level: 'review',
        code: 'multiple_values',
        key: hit.key,
        message: `${split.label} has more than one amount; stored the first and left the rest for review.`,
      });
      return;
    }
    stageAmount(hit, split, number, observations, warnings);
  };

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = stripDecorations(rawLine);
    if (!line) continue;
    const opensFooter = FOOTER_NOTE_RE.test(line) || isCalorieReferenceRow(line);
    consumeLine(line);
    if (opensFooter) footerContext = true;
  }

  const record = mergeObservations(observations);
  record.unknownLabels = unknownLabels;
  record.warnings = warnings;
  if (fiberMeaning) record.fiberMeaning = fiberMeaning;
  record.carbConvention = 'unknown';
  return record;
}

export { emptyStagedRecord };
