'use client';

import React from 'react';
import { Trip, UserProfile } from '../pageTypes';
import Button from '@/components/Button';
import Input from '@/components/Input';

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
    <div className="min-h-screen bg-surface-2">
      <div className="max-w-7xl mx-auto p-4">
        {/* Header */}
        <div className="bg-surface-1 rounded-lg shadow mb-6 p-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-text">Trip Cost Calculator</h1>
            <div className="flex items-center gap-4">
              <span className="text-text">
                {userProfile?.displayName}
                {userProfile?.isAdmin && (
                  <span className="ml-2 text-xs bg-purple/10 text-purple px-2 py-1 rounded">Admin</span>
                )}
              </span>
              <Button
                onClick={onLogout}
                variant="secondary"
                size="sm"
                className="px-4 py-2 text-sm text-text"
              >
                Log out
              </Button>
            </div>
          </div>
        </div>

        {/* Create Trip (Admin) */}
        {userProfile?.isAdmin && (
          <div className="bg-surface-1 rounded-lg shadow mb-6 p-4">
            <div className="flex gap-3">
              <Input
                type="text"
                value={newTripName}
                onChange={(e) => setNewTripName(e.target.value)}
                placeholder="Enter trip name..."
                className="flex-1"
              />
              <Button
                onClick={onCreateTrip}
                disabled={!newTripName.trim()}
                variant="success"
                className="px-6 py-3"
              >
                Create Trip
              </Button>
            </div>
          </div>
        )}

        {/* Trip Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <div key={trip.id} className="bg-surface-1 rounded-lg shadow hover:shadow-lg transition-shadow">
              <div className="p-4">
                <h2 className="text-lg font-semibold text-text mb-2">{trip.name}</h2>
                <div className="space-y-1 text-sm text-text mb-4">
                  <p>{trip.participants.length} participant{trip.participants.length !== 1 && 's'}</p>
                  <p>{trip.expenses.length} expense{trip.expenses.length !== 1 && 's'}</p>
                  <p>{trip.payments.length} payment{trip.payments.length !== 1 && 's'}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => onOpenTrip(trip)}
                    className="flex-1"
                  >
                    Open
                  </Button>
                  {userProfile?.isAdmin && (
                    <Button
                      onClick={() => onDeleteTrip(trip)}
                      variant="danger"
                      className="px-4 py-2"
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {trips.length === 0 && (
            <div className="col-span-full text-center py-12 text-text">
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