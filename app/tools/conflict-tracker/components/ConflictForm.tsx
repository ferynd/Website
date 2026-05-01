"use client";

import { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { allTags, parseTags } from '../lib/tags';
import type { Conflict, Tracker } from '../lib/types';

interface Props {
  tracker: Tracker;
  initial?: Partial<Conflict>;
  onSubmit: (data: {
    title: string;
    date: string;
    severity: Conflict['severity'];
    tags: string[];
    summary?: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export default function ConflictForm({ tracker, initial, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [severity, setSeverity] = useState<Conflict['severity']>(initial?.severity ?? 3);
  const [selectedTags, setSelectedTags] = useState<string[]>(initial?.tags ?? []);
  const [customTagInput, setCustomTagInput] = useState('');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const available = allTags(tracker.customTags ?? []);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const addCustomTags = () => {
    const parsed = parseTags(customTagInput);
    const next = [...selectedTags];
    for (const t of parsed) {
      if (!next.includes(t)) next.push(t);
    }
    setSelectedTags(next);
    setCustomTagInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        title: title.trim(),
        date,
        severity,
        tags: selectedTags,
        summary: summary.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h2 className="text-xl font-semibold">
        {initial?.id ? 'Edit conflict' : 'Log a conflict'}
      </h2>

      {error && (
        <p className="text-sm text-error bg-error/10 border border-error/20 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What was the conflict about?"
        required
      />

      <Input
        label="Date of conflict"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />

      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">Severity</label>
        <div className="flex gap-2">
          {([1, 2, 3, 4, 5] as Conflict['severity'][]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors focus-ring ${
                severity === s
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-border bg-surface-2 text-text-2 hover:border-accent/50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-3">1 = very low tension &nbsp;·&nbsp; 5 = very high tension</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">Tags</label>
        <div className="flex flex-wrap gap-2">
          {available.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors focus-ring ${
                selectedTags.includes(tag)
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-border bg-surface-2 text-text-2 hover:border-accent/40'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring"
            placeholder="Add custom tags (comma-separated)"
            value={customTagInput}
            onChange={(e) => setCustomTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTags(); } }}
          />
          <Button type="button" variant="secondary" onClick={addCustomTags}>
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">
          Brief summary <span className="text-text-3 font-normal">(optional)</span>
        </label>
        <textarea
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring resize-y min-h-[80px]"
          placeholder="A few sentences for context — this is visible to both people."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Log conflict'}
        </Button>
      </div>
    </form>
  );
}
