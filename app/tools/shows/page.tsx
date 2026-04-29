'use client';

import { useState, useMemo } from 'react';
import { Plus, LogOut } from 'lucide-react';
import Nav from '@/components/Nav';
import { useShows } from './ShowsContext';
import ShowCard from './components/ShowCard';
import ShowForm from './components/ShowForm';
import FilterBar from './components/FilterBar';
import ListSwitcher from './components/ListSwitcher';
import { groupComposite } from './lib/compositeScore';
import type { FilterStatus, FilterType, Show, SortOption } from './types';

export default function WatchlistPage() {
  const { user, logOut, shows, showsLoading, activeList } = useShows();

  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [vibeFilter, setVibeFilter] = useState<string | null>(null);
  const [watcherFilter, setWatcherFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>('updated');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showingForm, setShowingForm] = useState(false);

  const members = activeList?.members ?? [];

  const filtered = useMemo(() => {
    let result = shows;
    if (statusFilter !== 'all') result = result.filter((s) => s.status === statusFilter);
    if (typeFilter !== 'all') result = result.filter((s) => s.type === typeFilter);
    if (vibeFilter) result = result.filter((s) => s.vibeTags.includes(vibeFilter));
    if (watcherFilter) result = result.filter((s) => s.watchers.includes(watcherFilter));
    return result;
  }, [shows, statusFilter, typeFilter, vibeFilter, watcherFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === 'score') {
      return arr.sort((a, b) => {
        const sa = groupComposite(a) ?? -1;
        const sb = groupComposite(b) ?? -1;
        return sb - sa;
      });
    }
    if (sort === 'alpha') {
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    }
    // 'updated' — already ordered by Firestore
    return arr;
  }, [filtered, sort]);

  function openAdd() { setSelectedShow(null); setShowingForm(true); }
  function openEdit(show: Show) { setSelectedShow(show); setShowingForm(true); }
  function closeForm() { setShowingForm(false); setSelectedShow(null); }

  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />

      {/* Subheader */}
      <div className="border-b border-border bg-surface-1 px-4 py-3 flex items-center justify-between gap-3">
        <ListSwitcher />
        <button
          type="button"
          onClick={logOut}
          title="Sign out"
          className="rounded-lg p-2.5 text-text-3 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <LogOut size={18} />
        </button>
      </div>

      <section className="px-4 py-4 space-y-4 max-w-2xl mx-auto">
        {/* Greeting */}
        {user && (
          <p className="text-sm text-text-2">
            Hey {user.displayName?.split(' ')[0] ?? user.email}
            {activeList && <> · <span className="text-text">{activeList.name}</span></>}
          </p>
        )}

        {/* Filters */}
        {members.length > 0 && (
          <FilterBar
            statusFilter={statusFilter}
            typeFilter={typeFilter}
            vibeFilter={vibeFilter}
            watcherFilter={watcherFilter}
            sort={sort}
            members={members}
            onStatusFilter={setStatusFilter}
            onTypeFilter={setTypeFilter}
            onVibeFilter={setVibeFilter}
            onWatcherFilter={setWatcherFilter}
            onSort={setSort}
          />
        )}

        {/* No list state */}
        {!activeList && !showsLoading && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2">
            <p className="text-text-2">No watchlist yet.</p>
            <p className="text-sm text-text-3">Create one using the switcher above.</p>
          </div>
        )}

        {/* Loading */}
        {showsLoading && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!showsLoading && activeList && sorted.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2">
            <p className="text-text-2">
              {shows.length === 0 ? 'No shows yet.' : 'Nothing matches those filters.'}
            </p>
            {shows.length === 0 && (
              <p className="text-sm text-text-3">Tap the + button to add your first show.</p>
            )}
          </div>
        )}

        {/* Show list */}
        <div className="space-y-3">
          {sorted.map((show) => (
            <ShowCard
              key={show.id}
              show={show}
              members={members}
              onClick={() => openEdit(show)}
            />
          ))}
        </div>
      </section>

      {/* FAB */}
      {activeList && (
        <button
          type="button"
          onClick={openAdd}
          className="fixed bottom-20 right-4 z-30 w-14 h-14 rounded-full bg-accent shadow-glow flex items-center justify-center text-bg hover:scale-105 active:scale-95 transition-transform"
          aria-label="Add show"
        >
          <Plus size={24} />
        </button>
      )}

      {/* Form modal */}
      {showingForm && activeList && (
        <ShowForm
          show={selectedShow ?? undefined}
          listId={activeList.id}
          members={members}
          onClose={closeForm}
        />
      )}
    </main>
  );
}
