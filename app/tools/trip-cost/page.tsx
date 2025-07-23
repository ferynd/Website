import dynamic from 'next/dynamic';
import React from 'react';

// Dynamically import the main client component.
// This tells Next.js to load it as a separate chunk.
// ssr: false means it will only render on the client-side.
const TripCostClientComponent = dynamic(() => import('./trip-cost-client'), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-lg">Loading Calculator...</p>,
});

// The actual page component is now very simple.
// IMPORTANT: This file should NOT have 'use client' at the top.
export default function TripCostPage() {
  return <TripCostClientComponent />;
}
