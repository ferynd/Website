'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// This is the Client Component, so using ssr: false is allowed here.
const TripCostClientComponent = dynamic(() => import('./trip-cost-client'), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-lg">Loading Calculator...</p>,
});

export default function TripCostLoader() {
  return <TripCostClientComponent />;
}
