'use client';

import { useMemo, useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { useDateNight } from '../DateNightContext';
import type { DateNightFrequency, DateNightPoolItem, DateNightRarity } from '../lib/types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: manage-form defaults and labels                */
/* ------------------------------------------------------------ */

const RARITIES: DateNightRarity[] = ['common', 'uncommon', 'rare', 'veryRare'];
const FREQUENCIES: DateNightFrequency[] = ['anytime', 'biweekly', 'monthly', 'quarterly', 'biannual', 'annual'];
const RARITY_LABELS: Record<DateNightRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  veryRare: 'Very Rare',
};
const FREQUENCY_LABELS: Record<DateNightFrequency, string> = {
  anytime: 'Anytime',
  biweekly: 'Every other week',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Twice a year',
  annual: 'Once a year',
};
const CSV_HEADERS = ['name', 'description', 'rarity', 'frequency', 'baseWeight', 'decayEnabled'] as const;
const CSV_TEMPLATE_ROWS = [
  ['Wine tasting night', 'Try a new local winery or tasting room', 'uncommon', 'monthly', '1.4', 'true'],
  ['Picnic at sunset', 'Pack snacks and watch the sunset together', 'common', 'biweekly', '1.1', 'true'],
];

const parseCsvContent = (raw: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let idx = 0; idx < raw.length; idx += 1) {
    const char = raw[idx];

    if (char === '"') {
      const next = raw[idx + 1];
      if (inQuotes && next === '"') {
        current += '"';
        idx += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && raw[idx + 1] === '\n') idx += 1;
      row.push(current.trim());
      current = '';
      const hasContent = row.some((value) => value.length > 0);
      if (hasContent) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  const hasContent = row.some((value) => value.length > 0);
  if (hasContent) rows.push(row);

  return rows;
};

const parseBoolean = (value: string, fallback = true) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ['true', '1', 'yes', 'y'].includes(normalized);
};

const isRarity = (value: string): value is DateNightRarity => RARITIES.includes(value as DateNightRarity);
const isFrequency = (value: string): value is DateNightFrequency => FREQUENCIES.includes(value as DateNightFrequency);

export default function Manage() {
  const { dates, modifiers, saveItem, deleteItem } = useDateNight();
  const [kind, setKind] = useState<'date' | 'modifier'>('date');
  const [editing, setEditing] = useState<DateNightPoolItem | null>(null);
  const [sort, setSort] = useState<'recent' | 'accepted' | 'dormant'>('recent');
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [batchStatus, setBatchStatus] = useState<'idle' | 'success' | 'warning' | 'error'>('idle');
  const [form, setForm] = useState({
    name: '', description: '', rarity: 'common' as DateNightRarity, frequency: 'anytime' as DateNightFrequency, baseWeight: 1, decayEnabled: true,
  });

  const list = kind === 'date' ? dates : modifiers;
  const sorted = useMemo(() => {
    const rows = [...list];
    if (sort === 'accepted') rows.sort((a, b) => b.timesAccepted - a.timesAccepted);
    if (sort === 'dormant') rows.sort((a, b) => new Date(a.lastAcceptedAt ?? 0).getTime() - new Date(b.lastAcceptedAt ?? 0).getTime());
    return rows;
  }, [list, sort]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveItem(kind, form, editing?.id);
    setEditing(null);
    setForm({ name: '', description: '', rarity: 'common', frequency: 'anytime', baseWeight: 1, decayEnabled: true });
  };

  const downloadTemplate = (downloadKind: 'date' | 'modifier') => {
    const suffix = downloadKind === 'date' ? 'idea' : 'modifier';
    const csvRows = [
      CSV_HEADERS.join(','),
      ...CSV_TEMPLATE_ROWS.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')),
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `date-night-${suffix}-batch-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleBatchUpload = async (event: React.ChangeEvent<HTMLInputElement>, uploadKind: 'date' | 'modifier') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setBatchMessage('');
    setBatchStatus('idle');
    if (!file) return;

    const finish = (msg: string, status: 'success' | 'warning' | 'error') => {
      setBatchMessage(msg);
      setBatchStatus(status);
    };

    try {
      setUploadingBatch(true);
      const raw = await file.text();
      const records = parseCsvContent(raw);

      if (records.length < 2) {
        finish('CSV must include a header row and at least one data row.', 'error');
        return;
      }

      const [header, ...rows] = records;
      const parsedHeader = header.map((column) => column.trim());
      const missingColumns = CSV_HEADERS.filter((column) => !parsedHeader.includes(column));

      if (missingColumns.length > 0) {
        finish(`Missing required columns: ${missingColumns.join(', ')}`, 'error');
        return;
      }

      const existingItems = uploadKind === 'date' ? dates : modifiers;
      const existingNames = new Set(existingItems.map((item) => item.name.trim().toLowerCase()).filter(Boolean));
      const rowErrors: string[] = [];

      type ValidRow = {
        rowIndex: number;
        name: string;
        description: string;
        rarity: DateNightRarity;
        frequency: DateNightFrequency;
        baseWeight: number;
        decayEnabled: boolean;
      };
      const validRows: ValidRow[] = [];

      // First pass: validate all rows and detect duplicates
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const values = rows[rowIndex];
        const rowMap = Object.fromEntries(parsedHeader.map((key, index) => [key, values[index] ?? '']));
        const name = rowMap.name?.trim() ?? '';
        const normalizedName = name.toLowerCase();
        const rarity = (rowMap.rarity ?? '').trim();
        const frequency = (rowMap.frequency ?? '').trim();
        const baseWeight = Number(rowMap.baseWeight);

        if (!name) { rowErrors.push(`Row ${rowIndex + 2}: name is required.`); continue; }
        if (!isRarity(rarity)) { rowErrors.push(`Row ${rowIndex + 2}: invalid rarity "${rarity}".`); continue; }
        if (!isFrequency(frequency)) { rowErrors.push(`Row ${rowIndex + 2}: invalid frequency "${frequency}".`); continue; }
        if (Number.isNaN(baseWeight)) { rowErrors.push(`Row ${rowIndex + 2}: baseWeight must be a number.`); continue; }
        if (existingNames.has(normalizedName)) { rowErrors.push(`Row ${rowIndex + 2}: skipped duplicate "${name}".`); continue; }

        existingNames.add(normalizedName);
        validRows.push({ rowIndex, name, description: rowMap.description ?? '', rarity, frequency, baseWeight, decayEnabled: parseBoolean(rowMap.decayEnabled ?? '', true) });
      }

      if (validRows.length === 0) {
        finish(`No rows imported. ${rowErrors.slice(0, 3).join(' ')}`, 'error');
        return;
      }

      // Second pass: save in parallel batches of 6
      const BATCH_SIZE = 6;
      const savedNames: string[] = [];

      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        setBatchMessage(`Uploading ${Math.min(i + BATCH_SIZE, validRows.length)} of ${validRows.length}…`);
        const batch = validRows.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((row) =>
            saveItem(uploadKind, {
              name: row.name,
              description: row.description,
              rarity: row.rarity,
              frequency: row.frequency,
              baseWeight: row.baseWeight,
              decayEnabled: row.decayEnabled,
            }),
          ),
        );
        for (let j = 0; j < results.length; j += 1) {
          if (results[j].status === 'fulfilled') {
            savedNames.push(batch[j].name);
          } else {
            rowErrors.push(`Row ${batch[j].rowIndex + 2}: failed to save "${batch[j].name}".`);
          }
        }
      }

      const label = uploadKind === 'date' ? 'date idea' : 'modifier';
      if (savedNames.length > 0 && rowErrors.length === 0) {
        finish(`Uploaded ${savedNames.length} ${label} item(s) successfully.`, 'success');
      } else if (savedNames.length > 0) {
        finish(`Uploaded ${savedNames.length} item(s) with ${rowErrors.length} skipped: ${rowErrors.slice(0, 3).join(' ')}`, 'warning');
      } else {
        finish(`No rows imported. ${rowErrors.slice(0, 3).join(' ')}`, 'error');
      }
    } finally {
      setUploadingBatch(false);
    }
  };

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={kind === 'date' ? 'primary' : 'secondary'} onClick={() => setKind('date')}>Date Ideas</Button>
        <Button variant={kind === 'modifier' ? 'primary' : 'secondary'} onClick={() => setKind('modifier')}>Modifiers</Button>
        <Select label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">Recently created</option>
          <option value="accepted">Most accepted</option>
          <option value="dormant">Longest dormant</option>
        </Select>
      </div>

      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
        <Input label="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
        <Select label="Rarity" value={form.rarity} onChange={(e) => setForm((p) => ({ ...p, rarity: e.target.value as DateNightRarity }))}>{RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABELS[r]}</option>)}</Select>
        <Select label="Frequency" value={form.frequency} onChange={(e) => setForm((p) => ({ ...p, frequency: e.target.value as DateNightFrequency }))}>{FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}</Select>
        <Input label="Base Weight (0.1-5)" type="number" min={0.1} max={5} step={0.1} value={form.baseWeight} onChange={(e) => setForm((p) => ({ ...p, baseWeight: Number(e.target.value) }))} />
        <label className="text-sm flex items-center gap-2 mt-7"><input type="checkbox" checked={form.decayEnabled} onChange={(e) => setForm((p) => ({ ...p, decayEnabled: e.target.checked }))} /> Decay enabled</label>
        <div className="sm:col-span-2 flex gap-3">
          <Button type="submit">{editing ? 'Update' : 'Create'}</Button>
          {editing && <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel edit</Button>}
        </div>
      </form>

      <div className="rounded-xl border border-border/60 bg-surface-2/60 p-4 space-y-3">
        <h3 className="text-lg font-semibold">Batch upload</h3>
        <p className="text-sm text-text-2">
          Download a CSV template, fill in each row, then upload to add multiple date ideas or modifiers at once.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button size="sm" variant="secondary" type="button" onClick={() => downloadTemplate('date')}>
            Download date ideas CSV template
          </Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => downloadTemplate('modifier')}>
            Download modifiers CSV template
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-text-2">
            Upload date ideas CSV
            <input
              className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-3 file:px-3 file:py-2 file:text-text"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleBatchUpload(event, 'date')}
              disabled={uploadingBatch}
            />
          </label>
          <label className="text-sm text-text-2">
            Upload modifiers CSV
            <input
              className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-3 file:px-3 file:py-2 file:text-text"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleBatchUpload(event, 'modifier')}
              disabled={uploadingBatch}
            />
          </label>
        </div>
        {(uploadingBatch || batchMessage) && (
          <p className={`text-sm font-medium ${
            uploadingBatch ? 'text-text-2' :
            batchStatus === 'success' ? 'text-success' :
            batchStatus === 'warning' ? 'text-warning' :
            'text-error'
          }`}>
            {uploadingBatch && <span className="mr-2 inline-block animate-spin">⟳</span>}
            {batchMessage}
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {sorted.map((item) => (
          <li key={item.id} className="rounded-xl border border-border/60 bg-surface-2/70 p-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{item.name}</p>
              <p className="text-sm text-text-3">{item.description || 'No description'} · {RARITY_LABELS[item.rarity]} · {FREQUENCY_LABELS[item.frequency]}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setEditing(item); setForm({ name: item.name, description: item.description ?? '', rarity: item.rarity, frequency: item.frequency, baseWeight: item.baseWeight, decayEnabled: item.decayEnabled }); }}>Edit</Button>
              <Button size="sm" variant="danger" onClick={() => deleteItem(kind, item.id)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
