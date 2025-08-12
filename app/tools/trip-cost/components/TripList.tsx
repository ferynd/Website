'use client';

import React from 'react';
import { Trip, UserProfile } from '../pageTypes';

// ===============================
// CONFIGURATION (manual inputs)
// ===============================
// none for this component

interface TripListProps {
  trips: Trip[];
  userProfile: UserProfile | null;
  newTripName: string;
  setNewTripName: (v: string) => void;
  onCreateTrip: () => void;
  onOpenTrip: (trip: Trip) => void;
  onDeleteTrip: (trip: Trip) => void;
  onLogout: () => void;
}

export default function TripList({
  trips,
  userProfile,
  newTripName,
  setNewTripName,
  onCreateTrip,
  onOpenTrip,
  onDeleteTrip,
  onLogout,
}: TripListProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Trip Cost Calculator</h1>
            <div className="flex items-center gap-4">
              <span className="text-gray-900">
                {userProfile?.displayName}
                {userProfile?.isAdmin && (
                  <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Admin</span>
                )}
              </span>
              <button
                onClick={onLogout}
                className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 transition-colors text-sm text-gray-900"
              >
                Log out
              </button>
            </div>
          </div>
        </div>

        {/* Create Trip (Admin) */}
        {userProfile?.isAdmin && (
          <div className="bg-white rounded-lg shadow mb-6 p-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={newTripName}
                onChange={(e) => setNewTripName(e.target.value)}
                placeholder="Enter trip name..."
                className="flex-1 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
              />
              <button
                onClick={onCreateTrip}
                disabled={!newTripName.trim()}
                className="bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
              >
                Create Trip
              </button>
            </div>
          </div>
        )}

        {/* Trip Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <div key={trip.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
              <div className="p-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">{trip.name}</h2>
                <div className="space-y-1 text-sm text-gray-800 mb-4">
                  <p>{trip.participants.length} participant{trip.participants.length !== 1 && 's'}</p>
                  <p>{trip.expenses.length} expense{trip.expenses.length !== 1 && 's'}</p>
                  <p>{trip.payments.length} payment{trip.payments.length !== 1 && 's'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onOpenTrip(trip)}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                  >
                    Open
                  </button>
                  {userProfile?.isAdmin && (
                    <button
                      onClick={() => onDeleteTrip(trip)}
                      className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {trips.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-800">
              {userProfile?.isAdmin
                ? 'No trips yet. Create your first trip above!'
                : 'No trips available. Ask an admin to add you to a trip.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}