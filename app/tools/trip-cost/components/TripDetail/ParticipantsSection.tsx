"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useState, useEffect, useRef } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useTrip } from '../../TripContext';
import type { UserProfile } from '../../pageTypes';
import { query, getDocs, limit } from 'firebase/firestore';
import { usersCol } from '../../db';

interface RegisteredUser {
  uid: string;
  email: string;
  displayName: string;
  firstName: string;
  lastInitial: string;
}

export default function ParticipantsSection({
  userProfile,
  onDeleteParticipant,
}: {
  userProfile: UserProfile | null;
  onDeleteParticipant: (id: string) => void;
}) {
  const { participants, addParticipant, updateParticipant } = useTrip();
  
  // Form state
  const [name, setName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [selectedUser, setSelectedUser] = useState<RegisteredUser | null>(null);
  
  // User search state
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<RegisteredUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');
  
  // Refs for dropdown management
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load registered users when component mounts
  useEffect(() => {
    const loadRegisteredUsers = async () => {
      if (!userProfile) return;
      
      setLoadingUsers(true);
      try {
        // Get all users (you might want to add pagination for large user bases)
        const q = query(usersCol(), limit(100));
        const snapshot = await getDocs(q);
        
        const users: RegisteredUser[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data() as Omit<RegisteredUser, 'uid'>;
          users.push({
            uid: doc.id,
            email: data.email,
            displayName: data.displayName,
            firstName: data.firstName,
            lastInitial: data.lastInitial,
          });
        });
        
        setRegisteredUsers(users);
        console.log('[ParticipantsSection] Loaded registered users:', users);
      } catch (error) {
        console.error('[ParticipantsSection] Error loading users:', error);
      } finally {
        setLoadingUsers(false);
      }
    };

    loadRegisteredUsers();
  }, [userProfile]);

  // Filter users based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredUsers(registeredUsers.slice(0, 10)); // Show first 10 users
      return;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = registeredUsers.filter(user => 
      user.email.toLowerCase().includes(query) ||
      user.displayName.toLowerCase().includes(query) ||
      user.firstName.toLowerCase().includes(query)
    ).slice(0, 10); // Limit to 10 results
    
    setFilteredUsers(filtered);
  }, [searchQuery, registeredUsers]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addManualParticipant = async () => {
    if (!name.trim() || !userProfile) return;
    setError('');
    try {
      await addParticipant(name.trim(), userProfile.uid);
      setName('');
      setIsSearchMode(false);
    } catch (err) {
      setError('Failed to add participant. Please try again.');
      console.error('Error adding participant:', err);
    }
  };

  const addRegisteredUser = async (user: RegisteredUser) => {
    if (!userProfile) return;
    setError('');
    try {
      // Add with userId to mark as registered
      await addParticipant(user.displayName, userProfile.uid, user.uid);
      setSearchQuery('');
      setSelectedUser(null);
      setShowDropdown(false);
      setIsSearchMode(false);
    } catch (err) {
      setError('Failed to add registered user. Please try again.');
      console.error('Error adding registered user:', err);
    }
  };

  const startEdit = (id: string, current: string) => {
    setEditingId(id);
    setEditName(current);
  };

  const saveEdit = async () => {
    if (editingId && editName.trim()) {
      try {
        await updateParticipant(editingId, editName.trim());
        setEditingId(null);
        setEditName('');
      } catch (err) {
        console.error('Error updating participant:', err);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (isSearchMode && selectedUser) {
        addRegisteredUser(selectedUser);
      } else if (!isSearchMode) {
        addManualParticipant();
      }
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && filteredUsers.length > 0) {
      addRegisteredUser(filteredUsers[0]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setSearchQuery('');
    }
  };

  return (
    <section className="bg-surface-1 rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-3 text-text">Participants</h2>
      
      {/* Add Participant Section */}
      {userProfile && (
        <div className="space-y-3 mb-4">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              onClick={() => setIsSearchMode(false)}
              variant="ghost"
              size="sm"
              className={`px-3 py-1 text-sm ${
                !isSearchMode
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-surface-3 text-text-2 border border-border hover:bg-surface-2'
              }`}
            >
              Add by Name
            </Button>
            <Button
              onClick={() => setIsSearchMode(true)}
              variant="ghost"
              size="sm"
              className={`px-3 py-1 text-sm ${
                isSearchMode
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-surface-3 text-text-2 border border-border hover:bg-surface-2'
              }`}
            >
              Add Registered User
            </Button>
          </div>

          {/* Add by Name Mode */}
          {!isSearchMode && (
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter participant name"
                className="flex-1"
              />
              <Button
                onClick={addManualParticipant}
                variant="success"
                className="px-4 py-2"
                disabled={!name.trim()}
              >
                Add
              </Button>
            </div>
          )}

          {/* Search Registered Users Mode */}
          {isSearchMode && (
            <div className="relative" ref={dropdownRef}>
              <div className="flex gap-2">
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onKeyPress={handleSearchKeyPress}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search by email or name..."
                  className="flex-1"
                />
                <Button
                  onClick={() => selectedUser && addRegisteredUser(selectedUser)}
                  variant="success"
                  className="px-4 py-2"
                  disabled={!selectedUser}
                >
                  Add User
                </Button>
              </div>

              {/* Dropdown */}
              {showDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-surface-1 border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {loadingUsers ? (
                    <div className="p-3 text-text-3">Loading users...</div>
                  ) : filteredUsers.length > 0 ? (
                    filteredUsers.map((user) => (
                      <Button
                        key={user.uid}
                        onClick={() => {
                          setSelectedUser(user);
                          setSearchQuery(user.displayName);
                          setShowDropdown(false);
                        }}
                        variant="ghost"
                        size="sm"
                        className="w-full text-left p-3 hover:bg-surface-2 border-b border-border last:border-b-0 focus:bg-accent/10"
                      >
                        <div className="font-medium text-text">{user.displayName}</div>
                        <div className="text-sm text-text-3">{user.email}</div>
                      </Button>
                    ))
                  ) : searchQuery.trim() ? (
                      <div className="p-3 text-text-3">No users found matching &quot;{searchQuery}&quot;</div>
                  ) : (
                    <div className="p-3 text-text-3">Start typing to search users...</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      {error && (
        <div className="text-error text-sm mb-3 bg-error/10 border border-error/20 rounded p-2">
          {error}
        </div>
      )}
      
      {/* Participants List */}
      <ul className="space-y-2">
        {participants.length === 0 ? (
          <li className="text-text-2 italic py-2">No participants yet. Add someone above!</li>
        ) : (
          participants.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              {editingId === p.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="p-1 flex-1"
                    autoFocus
                  />
                  <Button
                    onClick={saveEdit}
                    variant="ghost"
                    size="sm"
                    className="text-accent hover:text-accent/80 px-2 h-auto"
                  >
                    Save
                  </Button>
                  <Button
                    onClick={() => setEditingId(null)}
                    variant="ghost"
                    size="sm"
                    className="text-text-3 hover:text-text-2 px-2 h-auto"
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span
                    className={`flex-1 text-text ${userProfile?.isAdmin ? 'cursor-pointer hover:text-accent' : ''}`}
                    onClick={() =>
                      userProfile?.isAdmin && startEdit(p.id, p.name)
                    }
                  >
                    {p.name}
                    {p.isRegistered && (
                      <span className="ml-2 text-xs bg-success/10 text-success px-2 py-0.5 rounded font-medium">
                        Registered
                      </span>
                    )}
                  </span>
                  {userProfile?.isAdmin && (
                    <Button
                      onClick={() => onDeleteParticipant(p.id)}
                      variant="ghost"
                      size="sm"
                      className="text-error hover:text-error/90 px-2 text-xl font-bold h-auto"
                      aria-label={`Remove ${p.name}`}
                    >
                      ×
                    </Button>
                  )}
                </>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}