'use client';

import Link from 'next/link';
import Nav from '@/components/Nav';
import { ArrowRight, Calculator, HeartPulse, BarChart } from 'lucide-react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: list of available tools                       */
/* ------------------------------------------------------------ */
const toolList = [
  {
    name: 'Trip Cost Calculator',
    description: 'Split expenses and calculate balances for a group trip.',
    href: '/tools/trip-cost',
    icon: <Calculator size={24} className="text-purple" />,
  },
  {
    name: 'Calorie Tracker',
    description: 'A simple tool to track daily calorie intake (Static HTML).',
    href: '/tools/CalorieTracker/index.html',
    icon: <HeartPulse size={24} className="text-error" />,
  },
  {
    name: 'Social Security (interactive guide)',
    description: 'Learn how benefits and earnings interact through simulations.',
    href: '/tools/social-security/index.html',
    icon: <BarChart size={24} className="text-info" />,
  },
  {
    name: 'Social Security (calculator)',
    description: 'Visualize the financial impact of different claiming strategies.',
    href: '/tools/social-security-calculator/index.html',
    icon: <BarChart size={24} className="text-success" />,
  },
];

export default function ToolsPage() {
  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="max-w-content mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-semibold bg-gradient-to-r from-accent to-purple text-transparent bg-clip-text">Tools &amp; Utilities</h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-text-2">A collection of useful apps I&apos;ve built.</p>
        </div>

        <div className="space-y-8">
          {toolList.map((tool) => (
            <Link
              href={tool.href}
              key={tool.name}
              className="group block rounded-xl3 border border-border bg-surface-1 p-6 shadow-1 transition duration-200 ease-linear hover:shadow-2 hover:shadow-glow focus-ring"
            >
              <div className="flex items-start">
                <div className="mr-6 flex-shrink-0">{tool.icon}</div>
                <div>
                  <h2 className="text-xl font-semibold">{tool.name}</h2>
                  <p className="mt-1 text-text-2">{tool.description}</p>
                </div>
                <div className="ml-auto pl-4 flex-shrink-0">
                  <ArrowRight size={24} className="text-text-3 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-accent" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
