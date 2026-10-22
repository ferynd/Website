"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { getDocs, limit, query } from 'firebase/firestore';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { usersCol } from '../../db';
import { useTrip } from '../../TripContext';
import type { UserProfile } from '../../pageTypes';
import { newTravelerNotice } from '../../utils/tripSettings';

interface RegisteredUser {
  uid: string;
  email: string;
  displayName: string;
  firstName: string;
  lastInitial: string;
}

interface ParticipantsSectionProps {
  userProfile: UserProfile | null;
  onDeleteParticipant: (id: string) => void;
}

function accountLabel(user: RegisteredUser | undefined): string {
  if (!user) return 'a registered account';
  if (user.displayName && user.email) return `${user.displayName} · ${user.email}`;
  return user.displayName || user.email || 'a registered account';
}

/**
 * Travelers on the trip. Accounts are linked onto an existing name-only
 * traveler; this section never creates a second participant for a registration.
 */
export default function ParticipantsSection({
  userProfile,
  onDeleteParticipant,
}: ParticipantsSectionProps) {
  const { trip, participants, addParticipant, updateParticipant, linkParticipantAccount } = useTrip();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<RegisteredUser | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');

  const admin = Boolean(userProfile?.isAdmin);
  const notice = trip && name.trim() ? newTravelerNotice(trip, name) : null;

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    const loadRegisteredUsers = async () => {
      setLoadingUsers(true);
      setUsersError('');
      try {
        const snapshot = await getDocs(query(usersCol(), limit(100)));
        if (cancelled) return;
        const users: RegisteredUser[] = [];
        snapshot.forEach((entry) => {
          const data = entry.data() as Omit<RegisteredUser, 'uid'>;
          users.push({
            uid: entry.id,
            email: data.email ?? '',
            displayName: data.displayName ?? '',
            firstName: data.firstName ?? '',
            lastInitial: data.lastInitial ?? '',
          });
        });
        setRegisteredUsers(users);
      } catch {
        if (!cancelled) setUsersError('Could not load registered accounts.');
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    };
    void loadRegisteredUsers();
    return () => {
      cancelled = true;
    };
  }, [admin]);

  const usersById = useMemo(
    () => new Map(registeredUsers.map((user) => [user.uid, user])),
    [registeredUsers],
  );

  const filteredUsers = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const source = needle
      ? registeredUsers.filter((user) =>
        [user.email, user.displayName, user.firstName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
      : registeredUsers;
    return source.slice(0, 10);
  }, [registeredUsers, searchQuery]);

  const linkedUid = (uid: string) => participants.some((person) => person.userId === uid);

  const addByName = async () => {
    if (!name.trim() || !userProfile || adding) return;
    setAdding(true);
    setError('');
    try {
      await addParticipant(name.trim(), userProfile.uid);
      setName('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to add traveler. Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const saveRename = async () => {
    if (!editingId || !editName.trim()) return;
    setError('');
    try {
      await updateParticipant(editingId, editName.trim());
      setEditingId(null);
      setEditName('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to rename traveler.');
    }
  };

  const confirmLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!linkingId || !selectedUser || linkBusy) return;
    setLinkBusy(true);
    setError('');
    try {
      await linkParticipantAccount(linkingId, selectedUser.uid);
      setLinkingId(null);
      setSelectedUser(null);
      setSearchQuery('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to link that account.');
    } finally {
      setLinkBusy(false);
    }
  };

  const startLink = (id: string) => {
    setLinkingId(id);
    setSelectedUser(null);
    setSearchQuery('');
    setEditingId(null);
    setError('');
  };

  return (
    <section className="w-full min-w-0 overflow-x-clip rounded-lg bg-surface-1 p-4 shadow">
      <h2 className="mb-3 text-lg font-semibold text-text">Travelers</h2>
      {userProfile && (
        <form
          className="mb-4 min-w-0 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void addByName();
          }}
        >
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-full text-sm text-text-2 sm:basis-48">
              Traveler name
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-describedby={notice ? 'add-traveler-notice' : undefined}
                className="mt-1 w-full min-w-0"
              />
            </label>
            <Button type="submit" variant="success" className="shrink-0 px-4 py-2" disabled={!name.trim() || adding}>
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </div>
          {notice && (
            <div id="add-traveler-notice" aria-live="polite" className="min-w-0 space-y-1 text-sm">
              <p className="break-words text-text-2 [overflow-wrap:anywhere]">{notice.resplit}</p>
              {notice.overage && (
                <p className="break-words text-warning [overflow-wrap:anywhere]">{notice.overage}</p>
              )}
            </div>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="mb-3 break-words rounded border border-error/20 bg-error/10 p-2 text-sm text-error [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      <ul className="min-w-0 space-y-1">
        {participants.length === 0 ? (
          <li className="py-2 text-text-2">No travelers yet. Add someone above.</li>
        ) : (
          participants.map((person) => (
            <li key={person.id} className="min-w-0 border-b border-border py-3 last:border-b-0">
              {editingId === person.id ? (
                <form
                  className="flex min-w-0 flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename();
                  }}
                >
                  <label className="min-w-0 flex-1 basis-full text-sm text-text-2 sm:basis-48">
                    Name for {person.name}
                    <Input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      aria-label={`Name for ${person.name}`}
                      className="mt-1 w-full min-w-0"
                      autoFocus
                    />
                  </label>
                  <Button type="submit" variant="ghost" size="sm" className="h-auto shrink-0 px-2">Save</Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto shrink-0 px-2"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="break-words font-medium text-text [overflow-wrap:anywhere]">{person.name}</p>
                    {person.userId && (
                      <span className="mt-1 inline-block max-w-full break-words rounded bg-success/10 px-2 py-0.5 text-xs text-success [overflow-wrap:anywhere]">
                        Linked to {accountLabel(usersById.get(person.userId))}
                      </span>
                    )}
                  </div>
                  {admin && (
                    <div className="flex min-w-0 max-w-full flex-wrap gap-2">
                      {!person.userId && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto shrink-0 px-2"
                          onClick={() => startLink(person.id)}
                        >
                          Link account
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto shrink-0 px-2"
                        onClick={() => {
                          setEditingId(person.id);
                          setEditName(person.name);
                          setLinkingId(null);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto shrink-0 px-2 text-error"
                        aria-label={`Remove ${person.name}`}
                        onClick={() => onDeleteParticipant(person.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {admin && linkingId === person.id && (
                <form className="mt-3 min-w-0 space-y-2" onSubmit={(event) => void confirmLink(event)}>
                  <label className="block min-w-0 text-sm text-text-2">
                    Search registered accounts for {person.name}
                    <Input
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setSelectedUser(null);
                      }}
                      className="mt-1 w-full min-w-0"
                      aria-describedby={`${person.id}-link-help`}
                    />
                  </label>
                  <p
                    id={`${person.id}-link-help`}
                    aria-live="polite"
                    className="break-words text-sm text-text-3 [overflow-wrap:anywhere]"
                  >
                    {selectedUser
                      ? `Link ${person.name} to ${accountLabel(selectedUser)}. The trip name stays ${person.name}.`
                      : 'Choose an existing account. This keeps the same traveler and their expense history.'}
                  </p>
                  <ul className="max-h-60 min-w-0 overflow-y-auto rounded-md border border-border" aria-label="Registered accounts">
                    {loadingUsers ? (
                      <li className="p-3 text-sm text-text-3">Loading accounts…</li>
                    ) : usersError ? (
                      <li className="p-3 text-sm text-error">{usersError}</li>
                    ) : filteredUsers.length > 0 ? (
                      filteredUsers.map((user) => {
                        const taken = linkedUid(user.uid);
                        return (
                          <li key={user.uid} className="border-b border-border last:border-b-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={taken}
                              aria-pressed={selectedUser?.uid === user.uid}
                              className="h-auto w-full min-w-0 justify-start border border-transparent px-3 py-2 text-left aria-pressed:border-accent aria-pressed:bg-accent/10"
                              onClick={() => {
                                setSelectedUser(user);
                                setSearchQuery(user.displayName || user.email);
                              }}
                            >
                              <span className="block w-full min-w-0 break-words text-left [overflow-wrap:anywhere]">
                                <span className="block font-medium text-text">{user.displayName || user.email}</span>
                                <span className="block text-sm text-text-3">
                                  {user.email}
                                  {taken ? ' · Already on this trip' : ''}
                                </span>
                              </span>
                            </Button>
                          </li>
                        );
                      })
                    ) : (
                      <li className="p-3 text-sm text-text-3">
                        {searchQuery.trim() ? `No accounts found matching "${searchQuery}".` : 'No accounts to show.'}
                      </li>
                    )}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="success" className="shrink-0 px-4 py-2" disabled={!selectedUser || linkBusy}>
                      {linkBusy ? 'Linking…' : 'Link'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto shrink-0 px-2"
                      onClick={() => {
                        setLinkingId(null);
                        setSelectedUser(null);
                        setSearchQuery('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
