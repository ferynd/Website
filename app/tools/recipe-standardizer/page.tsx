'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: page copy                                      */
/* ------------------------------------------------------------ */
const TOOL_NAME = 'Recipe Standardizer';
const TOOL_DESCRIPTION =
  'Paste a ChatGPT-converted recipe as strict JSON, then prep, cook, scale, and save it in a workflow-first format.';

import { CookingPot, LogOut } from 'lucide-react';
import Nav from '@/components/Nav';
import Button from '@/components/Button';
import { RecipeAuthGate, RecipeProvider, useRecipeTool } from './RecipeContext';
import RecipeWorkspace from './components/RecipeWorkspace';

function RecipeShell() {
  const { signOut } = useRecipeTool();
  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-10 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold flex items-center gap-2">
              <CookingPot className="text-accent" /> {TOOL_NAME}
            </h1>
            <p className="text-text-2 mt-1 max-w-2xl">{TOOL_DESCRIPTION}</p>
          </div>
          <Button variant="ghost" onClick={() => signOut()} className="inline-flex items-center gap-2">
            <LogOut size={16} /> Sign out
          </Button>
        </header>

        <RecipeWorkspace />
      </section>
    </main>
  );
}

export default function RecipeStandardizerPage() {
  return (
    <RecipeProvider>
      <RecipeAuthGate>
        <RecipeShell />
      </RecipeAuthGate>
    </RecipeProvider>
  );
}
