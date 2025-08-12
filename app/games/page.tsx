'use client';

import Link from 'next/link';
import Nav from '@/components/Nav';
import { ArrowRight, Drama, Swords } from 'lucide-react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: icon size and list of available games          */
/* ------------------------------------------------------------ */
const cardIconSize = 24;

const gameList = [
  {
    name: 'Noir Detective Idea',
    description: 'An interactive detective story concept (Static HTML).',
    href: '/games/noir_detective_idea/index.html',
    icon: <Drama size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Emeril: A World Divided',
    description: 'An interactive lore page for a world of lost magic and warring factions.',
    href: '/games/Emeril_A_World_Divided/index.html',
    icon: <Swords size={cardIconSize} className="text-accent" />,
  },
];

export default function GamesPage() {
  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-16 sm:py-24">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-semibold bg-gradient-to-r from-accent to-purple text-transparent bg-clip-text">Games</h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-text-2">A collection of interactive projects and games.</p>
        </div>

        <div className="space-y-8">
          {gameList.map((game) => (
            <Link
              href={game.href}
              key={game.name}
              className="group block rounded-xl border border-border bg-surface-1 p-6 shadow-md transition-all duration-200 ease-in-out hover:shadow-xl hover:scale-[1.02] focus-ring"
            >
              <div className="flex items-start">
                <div className="mr-6 flex-shrink-0 text-accent">{game.icon}</div>
                <div>
                  <h2 className="text-xl font-semibold">{game.name}</h2>
                  <p className="mt-4 text-text-2">{game.description}</p>
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
