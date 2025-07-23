'use client';

import Link from 'next/link';
import { ArrowRight, Calculator, HeartPulse } from 'lucide-react';

// You can add more tools to this list as you create them
const toolList = [
  {
    name: 'Trip Cost Calculator',
    description: 'Split expenses and calculate balances for a group trip.',
    href: '/tools/trip-cost',
    icon: <Calculator size={24} className="text-indigo-500" />,
  },
  {
    name: 'Calorie Tracker',
    description: 'A simple tool to track daily calorie intake (Static HTML).',
    href: '/tools/CalorieTracker/index.html',
    icon: <HeartPulse size={24} className="text-red-500" />,
  },
];

export default function ToolsPage() {
  return (
    <div className="bg-gray-900 text-white min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-teal-500">
            Tools & Utilities
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-gray-400">
            A collection of useful apps I&apos;ve built.
          </p>
        </div>

        <div className="space-y-8">
          {toolList.map((tool) => (
            <Link href={tool.href} key={tool.name}>
              <div className="group relative p-6 rounded-2xl bg-gray-800 border border-gray-700 hover:border-green-500 transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-green-500/10 cursor-pointer">
                <div className="flex items-start">
                  <div className="mr-6 flex-shrink-0">
                    {tool.icon}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-100">{tool.name}</h2>
                    <p className="mt-1 text-gray-400">{tool.description}</p>
                  </div>
                  <div className="ml-auto pl-4 flex-shrink-0">
                    <ArrowRight size={24} className="text-gray-600 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-green-400" />
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
