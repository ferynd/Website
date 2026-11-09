import { calculateMeal } from './calculate.js';

/** Deterministic quantity fit. Profiles, known facts, and fixed grams stay put. */
export const FIT_VERSION = 1;
const DEVIATION_WEIGHT = 1e-4;
const CONSTRAINT_WEIGHT = 1e6;
const GRAM_EPSILON = 0.05;

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function parentsOf(lines) {
    return new Set(lines.filter(line => line.parentLineId).map(line => line.parentLineId));
}

function isFree(line, lines, constraints) {
    if (line.basis !== 'estimated') return false;
    if (parentsOf(lines).has(line.lineId)) return false;
    if ((constraints || []).some(item => item?.type === 'fixed' && item.lineIds?.includes(line.lineId))) return false;
    return true;
}

function boundsOf(line, free) {
    if (!free) return { min: line.grams, max: line.grams };
    const min = finite(line.gMin) ? line.gMin : line.grams;
    const max = finite(line.gMax) ? line.gMax : line.grams;
    return { min: Math.min(min, max), max: Math.max(min, max) };
}

function clamp(value, bound) {
    return Math.min(bound.max, Math.max(bound.min, value));
}

function scaleKnown(value, fact, totalGrams, mealServings) {
    if (!finite(value)) return null;
    if (fact.appliesTo?.scope !== 'serving') return value;
    const factServings = fact.basis?.servings;
    if (finite(mealServings) && mealServings > 0 && finite(factServings) && factServings > 0)
        return value * (mealServings / factServings);
    const weight = fact.basis?.servingWeight?.g;
    if (finite(totalGrams) && totalGrams > 0 && finite(weight) && weight > 0)
        return value * (totalGrams / weight);
    return null;
}

function targetFor(fact, key, observed, totalGrams, mealServings) {
    const known = scaleKnown(observed.value, fact, totalGrams, mealServings);
    if (known == null) return { usable: false, reason: fact.appliesTo?.scope === 'serving' ? 'basis_not_comparable' : 'not_numeric' };
    if (observed.qualifier === 'less_than') return { usable: true, kind: 'less_than', bound: known };
    if (observed.rounding && observed.rounding !== 'exact') {
        if (finite(observed.roundingInterval) && observed.roundingInterval >= 0)
            return { usable: true, kind: 'interval', low: Math.max(0, known - observed.roundingInterval), high: known + observed.roundingInterval };
        return { usable: false, reason: 'interval_unspecified', rounding: observed.rounding };
    }
    return { usable: true, kind: 'point', value: known };
}

function mealLines(lines, grams) {
    return lines.map(line => ({ ...line, grams: grams.get(line.lineId), quantityBasis: line.basis }));
}

function totalGrams(lines, grams) {
    const parents = parentsOf(lines);
    return lines.reduce((sum, line) => sum + (parents.has(line.lineId) ? 0 : (grams.get(line.lineId) || 0)), 0);
}

function nutrientTargets(facts, lines, grams, mealServings) {
    const targets = [];
    const notes = [];
    const total = totalGrams(lines, grams);
    for (const fact of facts) {
        for (const [key, observed] of Object.entries(fact.nutrients || {})) {
            const target = targetFor(fact, key, observed, total, mealServings);
            if (!target.usable) {
                notes.push({ factId: fact.factId, key, reason: target.reason, rounding: target.rounding || null });
                continue;
            }
            targets.push({ factId: fact.factId, key, ...target });
        }
    }
    return { targets, notes };
}

function smoothLoss(lines, grams, facts, mealServings, starts) {
    const calculated = calculateMeal({ lines: mealLines(lines, grams) });
    const { targets } = nutrientTargets(facts, lines, grams, mealServings);
    let loss = 0;
    for (const target of targets) {
        const value = calculated.nutrients?.[target.key]?.value;
        if (value == null) continue;
        if (target.kind === 'less_than') {
            if (value > target.bound) loss += (value - target.bound) ** 2;
        } else if (target.kind === 'interval') {
            if (value < target.low) loss += (target.low - value) ** 2;
            else if (value > target.high) loss += (value - target.high) ** 2;
        } else {
            const scale = Math.max(Math.abs(target.value), 1);
            loss += ((value - target.value) / scale) ** 2;
        }
    }
    for (const line of lines) {
        const start = starts.get(line.lineId);
        const next = grams.get(line.lineId);
        if (finite(start) && finite(next)) loss += DEVIATION_WEIGHT * ((next - start) / Math.max(Math.abs(start), 1)) ** 2;
    }
    return loss;
}

function constraintLoss(lines, grams, constraints) {
    const byId = new Map(lines.map(line => [line.lineId, line]));
    let loss = 0;
    const violations = [];
    for (const constraint of constraints || []) {
        if (constraint.type === 'order') {
            const rows = (constraint.lineIds || []).map(id => byId.get(id)).filter(Boolean);
            for (let i = 0; i < rows.length - 1; i++) {
                const left = grams.get(rows[i].lineId);
                const right = grams.get(rows[i + 1].lineId);
                if (finite(left) && finite(right) && left + GRAM_EPSILON < right) {
                    loss += (right - left) ** 2;
                    violations.push({ type: 'order', lineIds: [rows[i].lineId, rows[i + 1].lineId] });
                }
            }
        }
        if (constraint.type === 'ratio') {
            const left = grams.get(constraint.num);
            const right = grams.get(constraint.den);
            if (finite(left) && finite(right) && right > 0) {
                const ratio = left / right;
                if (ratio < constraint.min) loss += (constraint.min - ratio) ** 2;
                if (ratio > constraint.max) loss += (ratio - constraint.max) ** 2;
                if (ratio < constraint.min - 1e-6 || ratio > constraint.max + 1e-6)
                    violations.push({ type: 'ratio', lineIds: [constraint.num, constraint.den] });
            }
        }
        if (constraint.type === 'sum') {
            const rows = (constraint.lineIds || []).map(id => grams.get(id) || 0);
            const sum = rows.reduce((total, value) => total + value, 0);
            if (finite(constraint.gMin) && sum < constraint.gMin) loss += (constraint.gMin - sum) ** 2;
            if (finite(constraint.gMax) && sum > constraint.gMax) loss += (sum - constraint.gMax) ** 2;
            if ((finite(constraint.gMin) && sum + GRAM_EPSILON < constraint.gMin) || (finite(constraint.gMax) && sum > constraint.gMax + GRAM_EPSILON))
                violations.push({ type: 'sum', lineIds: constraint.lineIds });
        }
        if (constraint.type === 'tail_max_percent') {
            const tops = lines.filter(line => !line.parentLineId);
            const total = tops.reduce((sum, line) => sum + (grams.get(line.lineId) || 0), 0);
            const cap = total * (constraint.maxPercent / 100);
            for (const id of constraint.lineIds || []) {
                const value = grams.get(id) || 0;
                if (value > cap + GRAM_EPSILON) {
                    loss += (value - cap) ** 2;
                    violations.push({ type: 'tail_max_percent', lineIds: [id] });
                }
            }
        }
    }
    for (const line of lines) {
        if (!line.order?.tail) continue;
        const tops = lines.filter(item => !item.parentLineId);
        const total = tops.reduce((sum, item) => sum + (grams.get(item.lineId) || 0), 0);
        const cap = total * 0.02;
        const value = grams.get(line.lineId) || 0;
        if (value > cap + GRAM_EPSILON) {
            loss += (value - cap) ** 2;
            violations.push({ type: 'tail', lineIds: [line.lineId] });
        }
    }
    const groups = new Map();
    for (const line of lines) {
        if (!line.order || line.order.tail || !finite(line.order.position)) continue;
        const key = line.order.group || '';
        const rows = groups.get(key) || [];
        rows.push(line);
        groups.set(key, rows);
    }
    for (const rows of groups.values()) {
        const ordered = [...rows].sort((a, b) => a.order.position - b.order.position || a.lineId.localeCompare(b.lineId));
        for (let i = 0; i < ordered.length - 1; i++) {
            const left = grams.get(ordered[i].lineId);
            const right = grams.get(ordered[i + 1].lineId);
            if (finite(left) && finite(right) && left + GRAM_EPSILON < right) {
                loss += (right - left) ** 2;
                violations.push({ type: 'order', lineIds: [ordered[i].lineId, ordered[i + 1].lineId] });
            }
        }
    }
    return { loss, violations };
}

function lossAt(lines, grams, facts, mealServings, starts, constraints) {
    return smoothLoss(lines, grams, facts, mealServings, starts) + CONSTRAINT_WEIGHT * constraintLoss(lines, grams, constraints).loss;
}

function searchVariable(lines, grams, line, bound, facts, mealServings, starts, constraints) {
    const samples = 33;
    let best = grams.get(line.lineId);
    let bestLoss = Infinity;
    for (let step = 0; step < samples; step++) {
        const value = bound.min + (bound.max - bound.min) * (samples === 1 ? 0 : step / (samples - 1));
        grams.set(line.lineId, value);
        const next = lossAt(lines, grams, facts, mealServings, starts, constraints);
        if (next < bestLoss - 1e-12 || (Math.abs(next - bestLoss) <= 1e-12 && Math.abs(value - starts.get(line.lineId)) < Math.abs(best - starts.get(line.lineId)))) {
            best = value;
            bestLoss = next;
        }
    }
    const span = Math.max(bound.max - bound.min, 0) / Math.max(samples - 1, 1);
    const lo = Math.max(bound.min, best - span);
    const hi = Math.min(bound.max, best + span);
    for (let step = 0; step < 17; step++) {
        const value = lo + (hi - lo) * (step / 16);
        grams.set(line.lineId, value);
        const next = lossAt(lines, grams, facts, mealServings, starts, constraints);
        if (next < bestLoss - 1e-12 || (Math.abs(next - bestLoss) <= 1e-12 && Math.abs(value - starts.get(line.lineId)) < Math.abs(best - starts.get(line.lineId)))) {
            best = value;
            bestLoss = next;
        }
    }
    grams.set(line.lineId, best);
}

function optimize(lines, startGrams, bounds, facts, mealServings, constraints) {
    const grams = new Map(startGrams);
    const starts = new Map(startGrams);
    const free = lines.filter(line => bounds.get(line.lineId).min !== bounds.get(line.lineId).max);
    for (let pass = 0; pass < 24; pass++) {
        const before = JSON.stringify([...grams]);
        for (const line of free)
            searchVariable(lines, grams, line, bounds.get(line.lineId), facts, mealServings, starts, constraints);
        if (JSON.stringify([...grams]) === before) break;
    }
    return grams;
}

function residuals(lines, grams, facts, mealServings) {
    const calculated = calculateMeal({ lines: mealLines(lines, grams) });
    const rows = [];
    for (const fact of facts) {
        for (const [key, observed] of Object.entries(fact.nutrients || {})) {
            const target = targetFor(fact, key, observed, totalGrams(lines, grams), mealServings);
            const value = calculated.nutrients?.[key]?.value ?? null;
            if (!target.usable) {
                rows.push({ factId: fact.factId, key, known: observed.value, calculated: value, difference: null, reason: target.reason, rounding: target.rounding || null });
                continue;
            }
            if (target.kind === 'less_than') {
                rows.push({ factId: fact.factId, key, known: target.bound, calculated: value, qualifier: 'less_than', consistent: value == null ? null : value <= target.bound + 1e-6, difference: null });
            } else if (target.kind === 'interval') {
                rows.push({ factId: fact.factId, key, known: observed.value, calculated: value, comparison: 'interval', difference: null, consistent: value == null ? null : value >= target.low - 1e-6 && value <= target.high + 1e-6 });
            } else {
                rows.push({ factId: fact.factId, key, known: target.value, calculated: value, difference: value == null ? null : value - target.value });
            }
        }
    }
    return { calculated, rows };
}

function quantitiesFrom(lines, grams, starts) {
    return lines.map(line => ({
        lineId: line.lineId,
        grams: grams.get(line.lineId),
        gMin: finite(line.gMin) ? line.gMin : null,
        gMax: finite(line.gMax) ? line.gMax : null,
        basis: line.basis,
        changed: Math.abs((grams.get(line.lineId) || 0) - (starts.get(line.lineId) || 0)) > GRAM_EPSILON,
    }));
}

/**
 * Fit estimated grams to eligible known facts. Returns the original grams when there is nothing to fit.
 * The result is one plausible fit, not a claim that the recipe was identified.
 */
export function fitQuantities({ lines = [], constraints = [], facts = [], servings = null } = {}) {
    const starts = new Map(lines.map(line => [line.lineId, finite(line.grams) ? line.grams : 0]));
    const original = quantitiesFrom(lines, starts, starts);
    const preview = nutrientTargets(facts, lines, starts, servings);
    const initial = residuals(lines, starts, facts, servings);
    const evaluable = initial.rows.some(row => row.calculated != null && row.reason == null);
    if (!facts.length || !preview.targets.length || !evaluable) {
        return {
            fitVersion: FIT_VERSION, skipped: true, ran: false, available: true, modelCalls: 0,
            reason: facts.length ? 'no numeric fit target' : 'no eligible known facts',
            quantities: original, residuals: preview.notes, flags: { nonUnique: false, infeasible: false },
            assumptions: ['No numeric known fact was available, so no quantity moved.'],
            weights: { deviation: DEVIATION_WEIGHT, constraint: CONSTRAINT_WEIGHT },
        };
    }
    const bounds = new Map(lines.map(line => [line.lineId, boundsOf(line, isFree(line, lines, constraints))]));
    const chosen = optimize(lines, starts, bounds, facts, servings, constraints);
    const chosenLoss = lossAt(lines, chosen, facts, servings, starts, constraints);
    const free = lines.filter(line => bounds.get(line.lineId).min !== bounds.get(line.lineId).max);
    let nonUnique = false;
    for (let i = 0; i < free.length && !nonUnique; i++) {
        for (let j = i + 1; j < free.length; j++) {
            const trial = new Map(chosen);
            const left = free[i].lineId;
            const right = free[j].lineId;
            const nextLeft = clamp(chosen.get(left) + 10, bounds.get(left));
            const nextRight = clamp(chosen.get(right) - 10, bounds.get(right));
            if (Math.abs(nextLeft - chosen.get(left)) < 5 || Math.abs(nextRight - chosen.get(right)) < 5) continue;
            trial.set(left, nextLeft);
            trial.set(right, nextRight);
            const trialLoss = lossAt(lines, trial, facts, servings, starts, constraints);
            if (Math.abs(trialLoss - chosenLoss) <= Math.max(1e-3, chosenLoss * 0.05) && constraintLoss(lines, trial, constraints).violations.length === 0) {
                nonUnique = true;
                break;
            }
        }
    }
    const constraint = constraintLoss(lines, chosen, constraints);
    const scored = residuals(lines, chosen, facts, servings);
    const unmetPoint = scored.rows.some(row => row.difference != null && Math.abs(row.difference) > Math.max(0.5, Math.abs(row.known) * 0.02));
    const unmetBound = scored.rows.some(row => row.consistent === false);
    const infeasible = constraint.violations.length > 0 || unmetPoint || unmetBound;
    return {
        fitVersion: FIT_VERSION,
        skipped: false,
        ran: true,
        available: true,
        modelCalls: 0,
        quantities: quantitiesFrom(lines, chosen, starts),
        residuals: scored.rows,
        calculation: scored.calculated,
        flags: { nonUnique, infeasible, unique: !nonUnique && !infeasible },
        violations: constraint.violations,
        notes: preview.notes,
        assumptions: [
            'Estimated lines stay inside their stated bounds and start at the assistant estimate.',
            'Measured, label, recipe-stated, and fixed lines do not move.',
            nonUnique ? 'More than one quantity set meets the facts; this is the one closer to the starting estimate.' : 'One quantity set was closer to the facts than the other start.',
        ],
        weights: { deviation: DEVIATION_WEIGHT, constraint: CONSTRAINT_WEIGHT },
    };
}
