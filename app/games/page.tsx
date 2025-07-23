'use client';

import Link from 'next/link';
import { ArrowRight, Drama } from 'lucide-react';

const gameList = [
  {
    name: 'Noir Detective Idea',
    description: 'An interactive detective story concept (Static HTML).',
    href: '/games/noir_detective_idea/index.html',
    icon: <Drama size={24} className="text-purple-500" />,
  },
];

export default function GamesPage() {
  return (
    <div className="bg-gray-900 text-white min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-600">
            Games
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-gray-400">
            A collection of interactive projects and games.
          </p>
        </div>

        <div className="space-y-8">
          {gameList.map((game) => (
            <Link href={game.href} key={game.name}>
              <div className="group relative p-6 rounded-2xl bg-gray-800 border border-gray-700 hover:border-purple-500 transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-purple-500/10 cursor-pointer">
                <div className="flex items-start">
                  <div className="mr-6 flex-shrink-0">
                    {game.icon}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-100">{game.name}</h2>
                    <p className="mt-1 text-gray-400">{game.description}</p>
                  </div>
                  <div className="ml-auto pl-4 flex-shrink-0">
                    <ArrowRight size={24} className="text-gray-600 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-purple-400" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
