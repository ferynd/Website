'use client';

import { useState } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import { useShows } from '../ShowsContext';

export default function ListSwitcher() {
  const { lists, activeList, setActiveListId, createList } = useShows();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    try {
      await createList(newName.trim());
      setNewName('');
      setCreating(false);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-text border border-border hover:border-accent/40 transition-colors min-h-[44px]"
      >
        <span className="max-w-[160px] truncate">{activeList?.name ?? 'No list'}</span>
        <ChevronDown size={14} className="text-text-3 flex-shrink-0" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => { setOpen(false); setCreating(false); }}
          />
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] rounded-xl border border-border bg-surface-1 shadow-2 overflow-hidden">
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => { setActiveListId(list.id); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-surface-2 transition-colors min-h-[44px]"
              >
                <span className="truncate">{list.name}</span>
                {list.id === activeList?.id && (
                  <Check size={14} className="text-accent flex-shrink-0 ml-2" />
                )}
              </button>
            ))}

            <div className="border-t border-border">
              {creating ? (
                <form onSubmit={handleCreate} className="p-2 flex gap-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="List name"
                    className="flex-1 rounded-lg bg-surface-2 border border-border px-2 py-1.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[36px]"
                  />
                  <button
                    type="submit"
                    disabled={loading || !newName.trim()}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                  >
                    {loading ? '…' : 'Create'}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-text-2 hover:text-accent hover:bg-surface-2 transition-colors min-h-[44px]"
                >
                  <Plus size={14} />
                  New list
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
