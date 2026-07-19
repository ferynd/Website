'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { GraduationCap } from 'lucide-react';
import type { Technique } from '../lib/techniques';

/**
 * Collapsed, keyboard-accessible technique help. Rendered only at the first
 * relevant occurrence (lib/workflow.ts computes the anchors), so a technique
 * used in three steps explains itself once.
 */
export default function TechniqueHelp({ techniques }: { techniques: Technique[] }) {
  if (techniques.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {techniques.map((technique) => (
        <details key={technique.id} className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1.5 rounded text-xs text-text-3 hover:text-text-2 focus-ring">
            <GraduationCap size={12} className="flex-shrink-0" />
            <span className="underline decoration-dotted underline-offset-2">{technique.name}</span>
          </summary>
          <p className="mt-1 ps-5 text-xs text-text-2">{technique.help}</p>
        </details>
      ))}
    </div>
  );
}
