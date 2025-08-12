"use client";

// ===============================
// CONFIGURATION
// ===============================
// None

import React, { useState } from 'react';
import { useTrip } from '../../TripContext';
import type { UserProfile } from '../../pageTypes';

export default function ParticipantsSection({
  userProfile,
  onDeleteParticipant,
}: {
  userProfile: UserProfile | null;
  onDeleteParticipant: (id: string) => void;
}) {
  const { participants, addParticipant, updateParticipant } = useTrip();
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');

  const add = async () => {
    if (!name.trim() || !userProfile) return;
    setError('');
    try {
      await addParticipant(name.trim(), userProfile.uid);
      setName('');
    } catch (err) {
      setError('Failed to add participant. Please try again.');
      console.error('Error adding participant:', err);
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
      add();
    }
  };

  return (
    <section className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-3 text-gray-800">Participants</h2>
      
      {/* Allow all users to add participants, not just admins */}
      {userProfile && (
        <div className="flex gap-2 mb-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={handleKeyPress}
            className="border border-gray-300 p-2 flex-1 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter participant name"
          />
          <button
            onClick={add}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!name.trim()}
          >
            Add
          </button>
        </div>
      )}
      
      {error && (
        <div className="text-red-600 text-sm mb-2">{error}</div>
      )}
      
      <ul className="space-y-2">
        {participants.length === 0 ? (
          <li className="text-gray-500 italic py-2">No participants yet. Add someone above!</li>
        ) : (
          participants.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1">
              {editingId === p.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="border border-gray-300 p-1 flex-1 rounded"
                    autoFocus
                  />
                  <button onClick={saveEdit} className="text-blue-600 hover:text-blue-700 px-2">
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-gray-600 hover:text-gray-700 px-2"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span
                    className={`flex-1 ${userProfile?.isAdmin ? 'cursor-pointer hover:text-blue-600' : ''}`}
                    onClick={() =>
                      userProfile?.isAdmin && startEdit(p.id, p.name)
                    }
                  >
                    {p.name}
                    {p.isRegistered && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        Registered
                      </span>
                    )}
                  </span>
                  {userProfile?.isAdmin && (
                    <button
                      onClick={() => onDeleteParticipant(p.id)}
                      className="text-red-600 hover:text-red-700 px-2 text-xl"
                      aria-label={`Remove ${p.name}`}
                    >
                      ×
                    </button>
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