'use client';

import { useState, useMemo, useEffect } from 'react';
import { Plus, LogOut, LayoutGrid, List as ListIcon, ClipboardCheck, Tv2, CheckSquare } from 'lucide-react';
import Nav from '@/components/Nav';
import { useShows } from './ShowsContext';
import ShowCard from './components/ShowCard';
import ShowRow from './components/ShowRow';
import ShowForm from './components/ShowForm';
import FilterBar from './components/FilterBar';
import ListSwitcher from './components/ListSwitcher';
import Chip from './components/Chip';
import SelectionToolbar from './components/SelectionToolbar';
import BatchUpdateModal from './components/BatchUpdateModal';
import ReviewQueueModal from './components/ReviewQueueModal';
import NewSeasonsModal from './components/NewSeasonsModal';
import { groupComposite } from './lib/compositeScore';
import { showsNeedingReview } from './lib/reviewCompleteness';
import { recordedSeasonCount } from './lib/seasonCheck';
import type { FilterStatus, FilterType, Show, SortOption, ViewMode } from './types';

const VIEW_MODE_STORAGE_KEY = 'shows-view-mode';

export default function WatchlistPage() {
  const { user, userProfile, logOut, shows, showsLoading, activeList } = useShows();

  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [vibeFilter, setVibeFilter] = useState<string | null>(null);
  const [watcherFilter, setWatcherFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>('updated');
  const [selectedShow, setSelectedShow] = useState<Show | null>(null);
  const [showingForm, setShowingForm] = useState(false);

  const [viewMode, setViewModeRaw] = useState<ViewMode>('cards');
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(VIEW_MODE_STORAGE_KEY) : null;
    if (stored === 'cards' || stored === 'list') setViewModeRaw(stored);
  }, []);
  function setViewMode(mode: ViewMode) {
    setViewModeRaw(mode);
    if (typeof window !== 'undefined') localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  }

  // Batch selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);

  // Review-missing workflow
  const [reviewQueue, setReviewQueue] = useState<Show[] | null>(null);

  // New seasons workflow
  const [showNewSeasons, setShowNewSeasons] = useState(false);

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
      return arr.sort((a, b) => (groupComposite(b) ?? -1) - (groupComposite(a) ?? -1));
    }
    if (sort === 'alpha') {
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (sort === 'seasons') {
      return arr.sort((a, b) => (recordedSeasonCount(b) ?? -1) - (recordedSeasonCount(a) ?? -1));
    }
    if (sort === 'incomplete') {
      if (!user) return arr;
      const uid = user.uid;
      const needsReviewIds = new Set(showsNeedingReview(arr, uid).map((s) => s.id));
      return arr.sort((a, b) => Number(needsReviewIds.has(b.id)) - Number(needsReviewIds.has(a.id)));
    }
    // 'updated' — already ordered by Firestore
    return arr;
  }, [filtered, sort, user]);

  const myReviewQueue = useMemo(
    () => (user ? showsNeedingReview(shows, user.uid) : []),
    [shows, user],
  );

  function openAdd() { setSelectedShow(null); setShowingForm(true); }
  function openEdit(show: Show) { setSelectedShow(show); setShowingForm(true); }
  function closeForm() { setShowingForm(false); setSelectedShow(null); }

  function handleCardClick(show: Show) {
    if (selectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(show.id)) next.delete(show.id); else next.add(show.id);
        return next;
      });
      return;
    }
    openEdit(show);
  }

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every((s) => selectedIds.has(s.id));
  function selectAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((s) => s.id)));
    }
  }

  const selectedShows = shows.filter((s) => selectedIds.has(s.id));

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
            Hey {userProfile?.displayName?.split(' ')[0] ?? userProfile?.email ?? user.email}
            {activeList && <> · <span className="text-text">{activeList.name}</span></>}
          </p>
        )}

        {/* Action row: select / review / new seasons / view toggle */}
        {activeList && shows.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <Chip
                label={selectMode ? 'Cancel select' : 'Select'}
                active={selectMode}
                onClick={toggleSelectMode}
                icon={<CheckSquare size={13} />}
              />
              {!selectMode && myReviewQueue.length > 0 && (
                <Chip
                  label={`Review (${myReviewQueue.length})`}
                  active={false}
                  onClick={() => setReviewQueue(myReviewQueue)}
                  icon={<ClipboardCheck size={13} />}
                />
              )}
              {!selectMode && (
                <Chip
                  label="New seasons"
                  active={false}
                  onClick={() => setShowNewSeasons(true)}
                  icon={<Tv2 size={13} />}
                />
              )}
            </div>
            <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5 flex-shrink-0">
              <button
                type="button"
                aria-label="Card view"
                onClick={() => setViewMode('cards')}
                className={`rounded-md p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center transition-colors ${
                  viewMode === 'cards' ? 'bg-accent/20 text-accent' : 'text-text-3 hover:text-text'
                }`}
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                aria-label="List view"
                onClick={() => setViewMode('list')}
                className={`rounded-md p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center transition-colors ${
                  viewMode === 'list' ? 'bg-accent/20 text-accent' : 'text-text-3 hover:text-text'
                }`}
              >
                <ListIcon size={15} />
              </button>
            </div>
          </div>
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
        {viewMode === 'cards' ? (
          <div className="space-y-3 pb-16">
            {sorted.map((show) => (
              <ShowCard
                key={show.id}
                show={show}
                members={members}
                onClick={() => handleCardClick(show)}
                selectMode={selectMode}
                selected={selectedIds.has(show.id)}
                currentUid={user?.uid}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden pb-16">
            {sorted.map((show) => (
              <ShowRow
                key={show.id}
                show={show}
                members={members}
                onClick={() => handleCardClick(show)}
                selectMode={selectMode}
                selected={selectedIds.has(show.id)}
                currentUid={user?.uid}
              />
            ))}
          </div>
        )}
      </section>

      {/* Selection toolbar */}
      {selectMode && (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          visibleCount={sorted.length}
          allVisibleSelected={allVisibleSelected}
          onSelectAllVisible={selectAllVisible}
          onCancel={toggleSelectMode}
          onAiUpdate={() => setShowBatchModal(true)}
        />
      )}

      {/* FAB */}
      {activeList && !selectMode && (
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

      {/* Batch AI update modal */}
      {showBatchModal && (
        <BatchUpdateModal
          shows={selectedShows}
          onClose={() => { setShowBatchModal(false); toggleSelectMode(); }}
        />
      )}

      {/* Review-missing queue */}
      {reviewQueue && user && (
        <ReviewQueueModal
          shows={reviewQueue}
          members={members}
          currentUid={user.uid}
          onClose={() => setReviewQueue(null)}
        />
      )}

      {/* New seasons check */}
      {showNewSeasons && (
        <NewSeasonsModal shows={shows} onClose={() => setShowNewSeasons(false)} />
      )}
    </main>
  );
}
