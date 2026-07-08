'use client';

import Link from 'next/link';
import Nav from '@/components/Nav';
import { ArrowRight, Calculator, CookingPot, HeartPulse, BarChart, Plane, Dices, Tv, HeartHandshake, LineChart, Mic } from 'lucide-react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: icon size and list of available tools          */
/* ------------------------------------------------------------ */
const cardIconSize = 24;

const toolList = [
  {
    name: 'CIFI - Research Estimator',
    description: 'Estimate CIFI research payout timing with logged rate history, local projections, and interactive SVG model charts.',
    href: '/tools/cifi-research-estimator',
    icon: <LineChart size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Transcriber',
    description: 'Private tool: upload a long recording and get a cleaned, speaker-labeled, timestamped transcript.',
    href: '/tools/transcriber',
    icon: <Mic size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Show Tracker',
    description: 'Track anime, shows, and movies with your group. Rate, score, and get AI-powered mood-based picks.',
    href: '/tools/shows',
    icon: <Tv size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Conflict Tracker',
    description: 'A private place to reflect after conflict, track what each person is owning, and notice patterns over time.',
    href: '/tools/conflict-tracker',
    icon: <HeartHandshake size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Trip Planner',
    description: 'Collaborative itinerary planner with realtime timelines, shared ideas, and map panels.',
    href: '/tools/trip-planner',
    icon: <Plane size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Date Night Roulette',
    description: 'Spin to pick a random date idea and modifier, log how it went.',
    href: '/tools/date-night',
    icon: <Dices size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Trip Cost Calculator',
    description: 'Split expenses and calculate balances for a group trip.',
    href: '/tools/trip-cost',
    icon: <Calculator size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Recipe Standardizer',
    description: 'Paste a ChatGPT-converted recipe as strict JSON, then prep, cook, scale, and save it in a workflow-first format.',
    href: '/tools/recipe-standardizer',
    icon: <CookingPot size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Nutrition Tracker',
    description: 'Log meals, track full nutrition, monitor energy trends, and auto-generate targets from your profile and weight history.',
    href: '/tools/CalorieTracker/index.html',
    icon: <HeartPulse size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Social Security (interactive guide)',
    description: 'Learn how benefits and earnings interact through simulations.',
    href: '/tools/social-security/index.html',
    icon: <BarChart size={cardIconSize} className="text-accent" />,
  },
  {
    name: 'Social Security (calculator)',
    description: 'Visualize the financial impact of different claiming strategies.',
    href: '/tools/social-security-calculator/index.html',
    icon: <BarChart size={cardIconSize} className="text-accent" />,
  },
];

export default function ToolsPage() {
  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-16 sm:py-24">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-semibold bg-gradient-to-r from-accent to-purple text-transparent bg-clip-text">Tools &amp; Utilities</h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-text-2">A collection of useful apps I&apos;ve built.</p>
        </div>

        <div className="space-y-8">
          {toolList.map((tool) => (
            <Link
              href={tool.href}
              key={tool.name}
              className="group block rounded-xl border border-border bg-surface-1 p-6 shadow-md transition-all duration-200 ease-in-out hover:shadow-xl hover:scale-[1.02] focus-ring"
            >
              <div className="flex items-start">
                <div className="mr-6 flex-shrink-0 text-accent">{tool.icon}</div>
                <div>
                  <h2 className="text-xl font-semibold">{tool.name}</h2>
                  <p className="mt-4 text-text-2">{tool.description}</p>
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
