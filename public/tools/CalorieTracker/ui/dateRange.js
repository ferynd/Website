/**
 * @file ui/dateRange.js
 * @description Shared chart date-range control — presets + custom From/To.
 * Per-chart state (not synchronized between charts).
 */

import { state } from '../state/store.js';
import { getTodayInTimezone } from '../utils/time.js';

const _rangeStates = new Map();

const PRESETS = [
  { value: '7',     label: '7 d' },
  { value: '30',    label: '30 d' },
  { value: '90',    label: '90 d' },
  { value: 'ytd',   label: 'YTD' },
  { value: '365',   label: '1 yr' },
  { value: 'first', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

function getFirstLoggedDate() {
  let earliest = null;
  for (const dateStr of state.dailyEntries.keys()) {
    if (!earliest || dateStr < earliest) earliest = dateStr;
  }
  for (const [, entry] of state.weightEntries) {
    const d = entry?.date;
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  return earliest;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const _analysisCharts = new Set(['weight-chart', 'eating-chart', 'corrections-chart']);

export function resolveRange(chartId) {
  const s = _rangeStates.get(chartId) || { preset: '30' };
  const endDate = _analysisCharts.has(chartId)
    ? getTodayInTimezone()
    : (state.dom.dateInput?.value || getTodayInTimezone());

  if (s.preset === 'custom') {
    return {
      startDate: s.customFrom || addDays(endDate, -29),
      endDate: s.customTo || endDate,
    };
  }

  let startDate;
  if (s.preset === 'ytd') {
    startDate = endDate.slice(0, 4) + '-01-01';
  } else if (s.preset === 'first') {
    startDate = getFirstLoggedDate() || addDays(endDate, -29);
  } else {
    const days = parseInt(s.preset) || 30;
    startDate = addDays(endDate, -(days - 1));
  }

  return { startDate, endDate };
}

export function renderDateRangeControl(chartId, { defaultPreset = '30' } = {}) {
  if (!_rangeStates.has(chartId)) {
    _rangeStates.set(chartId, { preset: defaultPreset });
  }
  const s = _rangeStates.get(chartId);
  const { startDate, endDate } = resolveRange(chartId);

  const chips = PRESETS.map(p =>
    `<button type="button" class="date-range-chip${s.preset === p.value ? ' active' : ''}" data-chart="${chartId}" data-preset="${p.value}">${p.label}</button>`
  ).join('');

  const customHidden = s.preset === 'custom' ? '' : ' hidden';
  return `
    <div class="date-range-control" data-chart-id="${chartId}">
      <div class="date-range-chips">${chips}</div>
      <div class="date-range-custom${customHidden}" id="date-range-custom-${chartId}">
        <input type="date" class="date-range-from" id="date-range-from-${chartId}" value="${startDate}">
        <span class="text-muted text-xs">to</span>
        <input type="date" class="date-range-to" id="date-range-to-${chartId}" value="${endDate}">
      </div>
    </div>`;
}

export function initDateRangeEvents(chartId, onChange) {
  const container = document.querySelector(`.date-range-control[data-chart-id="${chartId}"]`);
  if (!container) return;

  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.date-range-chip');
    if (!chip || chip.dataset.chart !== chartId) return;

    const s = _rangeStates.get(chartId) || { preset: '30' };
    s.preset = chip.dataset.preset;
    _rangeStates.set(chartId, s);

    container.querySelectorAll('.date-range-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');

    const customRow = document.getElementById(`date-range-custom-${chartId}`);
    if (customRow) customRow.classList.toggle('hidden', s.preset !== 'custom');

    if (s.preset === 'custom') {
      const prevRange = resolveRange(chartId);
      s.customFrom = prevRange.startDate;
      s.customTo = prevRange.endDate;
      const fromEl = document.getElementById(`date-range-from-${chartId}`);
      const toEl = document.getElementById(`date-range-to-${chartId}`);
      if (fromEl) fromEl.value = s.customFrom;
      if (toEl) toEl.value = s.customTo;
    }

    onChange(resolveRange(chartId));
  });

  const fromEl = document.getElementById(`date-range-from-${chartId}`);
  const toEl = document.getElementById(`date-range-to-${chartId}`);
  const onCustomChange = () => {
    const s = _rangeStates.get(chartId);
    if (!s || s.preset !== 'custom') return;
    s.customFrom = fromEl?.value || null;
    s.customTo = toEl?.value || null;
    onChange(resolveRange(chartId));
  };
  fromEl?.addEventListener('change', onCustomChange);
  toEl?.addEventListener('change', onCustomChange);
}

export function daysBetween(startDate, endDate) {
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  return Math.round((e - s) / 86400000) + 1;
}
