'use client';

import Link from 'next/link';
import Nav from '@/components/Nav';
import { ArrowRight, Map } from 'lucide-react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: icon size and list of trips                    */
/* ------------------------------------------------------------ */
const cardIconSize = 24;

const tripList = [
  {
    name: 'Chicago Trip Itinerary',
    description: 'An itinerary for a trip to Chicago (Static HTML).',
    href: '/trips/ChicagoTripItinerary/index.html',
    icon: <Map size={cardIconSize} className="text-accent" />,
  },
];

export default function TripsPage() {
  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-16 sm:py-24">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-semibold bg-gradient-to-r from-accent to-purple text-transparent bg-clip-text">Trips</h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-text-2">A collection of travel logs and itineraries.</p>
        </div>

        <div className="space-y-8">
          {tripList.map((trip) => (
            <Link
              href={trip.href}
              key={trip.name}
              className="group block rounded-xl border border-border bg-surface-1 p-6 shadow-md transition-all duration-200 ease-in-out hover:shadow-xl hover:scale-[1.02] focus-ring"
            >
              <div className="flex items-start">
                <div className="mr-6 flex-shrink-0 text-accent">{trip.icon}</div>
                <div>
                  <h2 className="text-xl font-semibold">{trip.name}</h2>
                  <p className="mt-4 text-text-2">{trip.description}</p>
                </div>
                <div className="ml-auto pl-4 flex-shrink-0">
                  <ArrowRight size={24} className="text-text-3 transition-all duration-200 ease-in-out group-hover:translate-x-1 group-hover:text-accent" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
