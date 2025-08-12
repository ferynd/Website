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

  const add = () => {
    if (!name.trim() || !userProfile) return;
    addParticipant(name, userProfile.uid);
    setName('');
  };

  const startEdit = (id: string, current: string) => {
    setEditingId(id);
    setEditName(current);
  };

  const saveEdit = () => {
    if (editingId) {
      updateParticipant(editingId, editName);
      setEditingId(null);
      setEditName('');
    }
  };

  return (
    <section className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold mb-2">Participants</h2>
      {userProfile?.isAdmin && (
        <div className="flex gap-2 mb-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border p-1 flex-1"
            placeholder="Name"
          />
          <button
            onClick={add}
            className="bg-green-600 text-white px-3 py-1 rounded disabled:opacity-50"
            disabled={!name.trim()}
          >
            Add
          </button>
        </div>
      )}
      <ul className="space-y-1 text-gray-800">
        {participants.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            {editingId === p.id ? (
              <>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="border p-1 flex-1"
                />
                <button onClick={saveEdit} className="text-blue-600 px-2">
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="text-gray-600 px-2"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span
                  className="flex-1 cursor-pointer hover:text-blue-600"
                  onClick={() =>
                    userProfile?.isAdmin && startEdit(p.id, p.name)
                  }
                >
                  {p.name}
                </span>
                {userProfile?.isAdmin && (
                  <button
                    onClick={() => onDeleteParticipant(p.id)}
                    className="text-red-600 px-2"
                    aria-label="Remove participant"
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
