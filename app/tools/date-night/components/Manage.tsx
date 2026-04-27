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

export default function Manage() {
  const { dates, modifiers, saveItem, deleteItem } = useDateNight();
  const [kind, setKind] = useState<'date' | 'modifier'>('date');
  const [editing, setEditing] = useState<DateNightPoolItem | null>(null);
  const [sort, setSort] = useState<'recent' | 'accepted' | 'dormant'>('recent');
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
