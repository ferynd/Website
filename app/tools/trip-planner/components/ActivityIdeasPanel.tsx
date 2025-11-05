'use client';

import { useMemo, useState } from 'react';
import { Image as ImageIcon, Lightbulb, Search, Tag, Plus, X } from 'lucide-react';
import Input from '@/components/Input';
import Button from '@/components/Button';
import type { Idea, Planner } from '../lib/types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: maximum idea results & truncation length       */
/* ------------------------------------------------------------ */
const MAX_RESULTS = 20;
const DESCRIPTION_LENGTH = 160;

interface ActivityIdeasPanelProps {
  ideas: Idea[];
  planner: Planner;
  activeDayId: string | null;
  onSelectDay: (dayId: string) => void;
  onScheduleIdea: (dayId: string, idea: Idea) => void;
}

export default function ActivityIdeasPanel({
  ideas,
  planner,
  activeDayId,
  onSelectDay,
  onScheduleIdea,
}: ActivityIdeasPanelProps) {
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const idea of ideas) {
      if (!idea.tags) continue;
      for (const tag of idea.tags) {
        set.add(tag);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [ideas]);

  const normalizedIdeas = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    return ideas
      .filter((idea) => {
        const matchesQuery =
          !trimmedQuery ||
          idea.title.toLowerCase().includes(trimmedQuery) ||
          idea.description?.toLowerCase().includes(trimmedQuery);
        const matchesTags =
          selectedTags.length === 0 ||
          selectedTags.every((tag) => idea.tags?.some((ideaTag) => ideaTag.toLowerCase() === tag.toLowerCase()));
        return matchesQuery && matchesTags;
      })
      .slice(0, MAX_RESULTS);
  }, [ideas, query, selectedTags]);

  const plannerDays = planner.days ?? {};
  const dayOrder = planner.dayOrder ?? [];
  const activeDay = activeDayId ? plannerDays[activeDayId] : undefined;

  return (
    <aside className="rounded-xl3 border border-border bg-surface-1/80 shadow-md">
      <header className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 text-accent">
            <Lightbulb size={20} />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Activity ideas</h2>
            <p className="text-sm text-text-3">
              Curated suggestions you can drop directly into the timeline.
            </p>
            <p className="mt-1 text-xs text-text-4">
              Uploads reuse matching files per planner, so sharing the same photo never duplicates storage.
            </p>
          </div>
        </div>
      </header>
      <div className="space-y-4 px-5 py-5">
        <label className="flex flex-col text-sm font-medium text-text-2">
          Search
          <div className="relative mt-2">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-3" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search activities"
              className="pl-10"
            />
          </div>
        </label>
        <div className="flex flex-col text-sm font-medium text-text-2">
          Tag filters
          <div className="mt-2 flex flex-wrap gap-2">
            {tagOptions.length === 0 && (
              <span className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-surface-2/70 px-3 py-1 text-xs text-text-3">
                <Tag size={14} /> No tags yet
              </span>
            )}
            {tagOptions.map((tag) => {
              const isActive = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs focus-ring ${
                    isActive
                      ? 'border-accent bg-accent/20 text-accent'
                      : 'border-border/60 bg-surface-2/70 text-text-3 hover:border-accent/40 hover:text-text'
                  }`}
                  onClick={() => {
                    setSelectedTags((current) =>
                      current.includes(tag)
                        ? current.filter((existing) => existing !== tag)
                        : [...current, tag],
                    );
                  }}
                >
                  <Tag size={14} />
                  {tag}
                  {selectedTags.includes(tag) && <X size={12} />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/80 px-3 py-2 text-sm text-text-3">
          <span>
            {activeDay
              ? `Adding to ${activeDay.date} · ${activeDay.headline ?? 'Untitled day'}`
              : 'Select a day to add ideas'}
          </span>
          <select
            value={activeDayId ?? ''}
            onChange={(event) => onSelectDay(event.target.value)}
            className="rounded-md border border-border bg-surface-1 px-3 py-1 text-sm focus-ring"
          >
            <option value="">Choose day</option>
            {dayOrder.map((dayId) => {
              const day = plannerDays[dayId];
              if (!day) {
                return null;
              }
              return (
                <option key={dayId} value={dayId}>
                  {day.date} · {day.headline ?? 'Untitled day'}
                </option>
              );
            })}
          </select>
        </div>

        <div className="space-y-4">
          {normalizedIdeas.length === 0 && (
            <p className="rounded-lg border border-dashed border-border/60 bg-surface-2/80 px-4 py-6 text-center text-sm text-text-3">
              No ideas match your filters yet. Try a different keyword.
            </p>
          )}
          {normalizedIdeas.map((idea) => (
            <div key={idea.id} className="rounded-xl border border-border/60 bg-surface-2/80 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{idea.title}</h3>
                  {idea.tags && (
                    <p className="mt-1 text-xs uppercase tracking-wide text-text-3">
                      {idea.tags.join(' · ')}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!activeDayId}
                  onClick={() => activeDayId && onScheduleIdea(activeDayId, idea)}
                  className="inline-flex items-center gap-2"
                >
                  <Plus size={14} /> Add to day
                </Button>
              </div>
              {idea.description && (
                <p className="mt-3 text-sm text-text-2">
                  {idea.description.length > DESCRIPTION_LENGTH
                    ? `${idea.description.slice(0, DESCRIPTION_LENGTH)}…`
                    : idea.description}
                </p>
              )}
              {idea.address && (
                <p className="mt-2 text-xs text-text-3">Located at {idea.address}</p>
              )}
              {idea.images?.length ? (
                <p className="mt-2 flex items-center gap-2 text-xs text-text-3">
                  <ImageIcon size={14} /> {idea.images.length} {idea.images.length === 1 ? 'deduped image' : 'deduped images'}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
