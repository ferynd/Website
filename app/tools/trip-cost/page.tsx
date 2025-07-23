import React from 'react';
import TripCostLoader from './trip-cost-loader';

// This is the main page (Server Component).
// It's very simple and just imports the loader.
// This file should NOT have 'use client' at the top.
export default function TripCostPage() {
  return <TripCostLoader />;
}
