'use client';

import { Dices, LogOut } from 'lucide-react';
import Nav from '@/components/Nav';
import Button from '@/components/Button';
import { DateNightAuthGate, DateNightProvider, useDateNight } from './DateNightContext';
import Roller from './components/Roller';
import PendingDate from './components/PendingDate';
import Manage from './components/Manage';
import History from './components/History';
import AdminSettings from './components/AdminSettings';

/* ------------------------------------------------------------ */
/* CONFIGURATION: page title + description copy                 */
/* ------------------------------------------------------------ */
const TOOL_NAME = 'Date Night Roulette';
const TOOL_DESCRIPTION = 'Spin to pick a random date idea and modifier, log how it went.';

function DateNightShell() {
  const { signOut } = useDateNight();
  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-10 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold flex items-center gap-2"><Dices className="text-accent" /> {TOOL_NAME}</h1>
            <p className="text-text-2 mt-1">{TOOL_DESCRIPTION}</p>
          </div>
          <Button variant="ghost" onClick={() => signOut()} className="inline-flex items-center gap-2"><LogOut size={16} /> Sign out</Button>
        </header>

        <Roller />
        <PendingDate />
        <Manage />
        <History />
        <AdminSettings />
      </section>
    </main>
  );
}

export default function DateNightPage() {
  return (
    <DateNightProvider>
      <DateNightAuthGate>
        <DateNightShell />
      </DateNightAuthGate>
    </DateNightProvider>
  );
}
