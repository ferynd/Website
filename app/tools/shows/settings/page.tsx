'use client';

import { useState, useEffect } from 'react';
import { Shield, Trash2, UserMinus, CrownIcon, LogOut, UserPlus } from 'lucide-react';
import { getDocs, collection } from 'firebase/firestore';
import Nav from '@/components/Nav';
import { useShows } from '../ShowsContext';
import { db } from '../lib/db';

interface KnownUser { uid: string; email: string; displayName: string; }

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-6 space-y-4">
        <p className="text-sm text-text-2">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border bg-surface-2 py-3 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-error py-3 text-sm font-semibold text-white"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const {
    user,
    lists,
    activeList,
    logOut,
    renameList,
    deleteList,
    addMember,
    addKnownMember,
    removeMember,
    promoteToAdmin,
    leaveList,
    createList,
  } = useShows();

  const [newListName, setNewListName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [newName, setNewName] = useState(activeList?.name ?? '');
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  const [selectedUid, setSelectedUid] = useState('');

  const isAdmin = activeList?.adminUids?.includes(user?.uid ?? '') ?? false;

  useEffect(() => {
    if (!isAdmin) return;
    getDocs(collection(db, 'artifacts', 'trip-cost', 'users'))
      .then((snap) => {
        const users = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            uid: d.id,
            email: typeof data.email === 'string' ? data.email : '',
            displayName: typeof data.displayName === 'string' ? data.displayName : d.id,
          };
        }).filter((u) => u.email);
        setKnownUsers(users);
      })
      .catch(() => {});
  }, [isAdmin]);
  const members = activeList?.members ?? [];

  async function withFeedback(key: string, fn: () => Promise<void>, msg: string) {
    setSaving(key);
    try {
      await fn();
      setFeedback(msg);
      setTimeout(() => setFeedback(''), 3000);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Error. Try again.');
    } finally {
      setSaving(null);
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!activeList || !newName.trim()) return;
    await withFeedback('rename', () => renameList(activeList.id, newName.trim()), 'List renamed.');
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!activeList || !inviteEmail.trim()) return;
    await withFeedback(
      'invite',
      () => addMember(activeList.id, inviteEmail.trim()),
      `Invite queued for ${inviteEmail.trim()}. They'll see this list next time they open the app.`,
    );
    setInviteEmail('');
  }

  async function handleAddKnown(e: React.FormEvent) {
    e.preventDefault();
    if (!activeList || !selectedUid) return;
    const ku = knownUsers.find((u) => u.uid === selectedUid);
    if (!ku) return;
    await withFeedback(
      'addKnown',
      () => addKnownMember(activeList.id, ku.uid, ku.email, ku.displayName),
      `${ku.displayName} added to the list.`,
    );
    setSelectedUid('');
  }

  async function handleCreateList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    await withFeedback('create', () => createList(newListName.trim()).then(() => {}), 'New list created.');
    setNewListName('');
  }

  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="px-4 py-6 space-y-5 max-w-lg mx-auto">
        <h1 className="text-2xl font-semibold">Settings</h1>

        {!activeList && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-text-2">No list selected. Create one below.</p>
          </div>
        )}

        {feedback && (
          <p className="rounded-lg bg-success/15 border border-success/30 px-3 py-2 text-sm text-success">
            {feedback}
          </p>
        )}

        {/* Rename list */}
        {activeList && isAdmin && (
          <div className="rounded-xl border border-border bg-surface-1 p-4 space-y-3">
            <h2 className="font-semibold text-sm">List name</h2>
            <form onSubmit={handleRename} className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]"
              />
              <button
                type="submit"
                disabled={saving === 'rename'}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-50 min-h-[44px]"
              >
                {saving === 'rename' ? '…' : 'Save'}
              </button>
            </form>
          </div>
        )}

        {/* Members */}
        {activeList && (
          <div className="rounded-xl border border-border bg-surface-1 p-4 space-y-3">
            <h2 className="font-semibold text-sm">Members</h2>
            <ul className="space-y-2">
              {members.map((m) => {
                const isMe = m.uid === user?.uid;
                const mIsAdmin = activeList.adminUids?.includes(m.uid);
                return (
                  <li key={m.uid} className="flex items-center gap-3 py-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.displayName}</p>
                      <p className="text-xs text-text-3 truncate">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {mIsAdmin && (
                        <span className="flex items-center gap-1 text-xs text-accent font-medium">
                          <Shield size={12} /> Admin
                        </span>
                      )}
                      {isMe && <span className="text-xs text-text-3">(you)</span>}
                      {isAdmin && !isMe && (
                        <div className="flex gap-1">
                          {!mIsAdmin && (
                            <button
                              type="button"
                              title="Promote to admin"
                              onClick={() =>
                                setConfirm({
                                  message: `Make ${m.displayName} an admin of this list?`,
                                  action: () => promoteToAdmin(activeList.id, m.uid),
                                })
                              }
                              className="rounded-lg p-2 text-text-3 hover:text-accent hover:bg-surface-2 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                            >
                              <CrownIcon size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Remove member"
                            onClick={() =>
                              setConfirm({
                                message: `Remove ${m.displayName} from this list?`,
                                action: () => removeMember(activeList.id, m.uid),
                              })
                            }
                            className="rounded-lg p-2 text-text-3 hover:text-error hover:bg-surface-2 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                          >
                            <UserMinus size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Add member */}
            {isAdmin && (() => {
              const alreadyMemberUids = new Set(activeList.memberUids ?? []);
              const eligible = knownUsers.filter((u) => !alreadyMemberUids.has(u.uid));
              return (
                <div className="space-y-2 pt-1">
                  {/* Picker: users who already have accounts */}
                  {eligible.length > 0 && (
                    <form onSubmit={handleAddKnown} className="flex gap-2">
                      <select
                        value={selectedUid}
                        onChange={(e) => setSelectedUid(e.target.value)}
                        className="flex-1 rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent min-h-[44px]"
                      >
                        <option value="">Add existing account…</option>
                        {eligible.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.displayName} ({u.email})
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={saving === 'addKnown' || !selectedUid}
                        className="rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-bg disabled:opacity-50 min-h-[44px] flex items-center gap-1"
                      >
                        <UserPlus size={15} />
                        {saving === 'addKnown' ? '…' : 'Add'}
                      </button>
                    </form>
                  )}
                  {/* Fallback: email invite for accounts not yet on the site */}
                  <form onSubmit={handleInvite} className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Or invite by email (no account yet)"
                      className="flex-1 rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
                    />
                    <button
                      type="submit"
                      disabled={saving === 'invite' || !inviteEmail.trim()}
                      className="rounded-xl bg-surface-2 border border-border px-4 py-2.5 text-sm font-semibold text-text disabled:opacity-50 min-h-[44px]"
                    >
                      {saving === 'invite' ? '…' : 'Invite'}
                    </button>
                  </form>
                </div>
              );
            })()}
          </div>
        )}

        {/* All lists */}
        {lists.length > 0 && (
          <div className="rounded-xl border border-border bg-surface-1 p-4 space-y-2">
            <h2 className="font-semibold text-sm">All your lists</h2>
            {lists.map((list) => (
              <div key={list.id} className="flex items-center justify-between py-1">
                <span className={`text-sm ${list.id === activeList?.id ? 'font-semibold text-accent' : 'text-text-2'}`}>
                  {list.name}
                </span>
                <span className="text-xs text-text-3">{list.members.length} member{list.members.length !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* Danger zone */}
        {activeList && (
          <div className="rounded-xl border border-error/30 bg-surface-1 p-4 space-y-3">
            <h2 className="font-semibold text-sm text-error">Danger zone</h2>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    message: `Leave "${activeList.name}"? You'll need to be re-invited.`,
                    action: () => leaveList(activeList.id),
                  })
                }
                className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-medium text-text-2 hover:text-error hover:border-error/40 transition-colors min-h-[48px]"
              >
                <LogOut size={16} /> Leave list
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      message: `Delete "${activeList.name}" and all its shows permanently?`,
                      action: () => deleteList(activeList.id),
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm font-medium text-error hover:bg-error/20 transition-colors min-h-[48px]"
                >
                  <Trash2 size={16} /> Delete list
                </button>
              )}
            </div>
          </div>
        )}

        {/* Create new list */}
        <div className="rounded-xl border border-border bg-surface-1 p-4 space-y-3">
          <h2 className="font-semibold text-sm">Create a new list</h2>
          <form onSubmit={handleCreateList} className="flex gap-2">
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="e.g. Anime with Kait"
              className="flex-1 rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
            />
            <button
              type="submit"
              disabled={saving === 'create' || !newListName.trim()}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-50 min-h-[44px]"
            >
              {saving === 'create' ? '…' : 'Create'}
            </button>
          </form>
        </div>

        {/* Sign out */}
        <button
          type="button"
          onClick={logOut}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium text-text-2 hover:text-text transition-colors min-h-[48px]"
        >
          <LogOut size={16} /> Sign out
        </button>
      </section>

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={async () => { await confirm.action(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </main>
  );
}
