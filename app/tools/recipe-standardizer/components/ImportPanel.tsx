'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useState } from 'react';
import { AlertTriangle, Check, ClipboardCopy, FileJson } from 'lucide-react';
import Button from '@/components/Button';
import { CHATGPT_CONVERSION_PROMPT } from '../lib/prompt';
import { parseRecipeJson } from '../lib/schema';
import type { Recipe } from '../lib/types';

interface ImportPanelProps {
  /** Returns false when the import was declined (e.g. the user kept an
   *  unsaved recipe) — the pasted JSON is preserved in that case. */
  onImport: (recipe: Recipe, warnings: string[]) => boolean;
}

/**
 * Step 1 of the workflow: copy the conversion prompt for ChatGPT, paste the
 * strict-JSON result back, and validate. All validation errors render with
 * exact JSON paths so a bad paste is fixable in one round trip.
 */
export default function ImportPanel({ onImport }: ImportPanelProps) {
  const [rawJson, setRawJson] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CHATGPT_CONVERSION_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrors(['Could not access the clipboard — copy the prompt from the expanded view below.']);
    }
  };

  const handleImport = () => {
    const result = parseRecipeJson(rawJson);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    // Clear the paste box only once the workspace accepts the import — a
    // declined discard-confirmation must not cost the user their paste.
    if (onImport(result.recipe, result.warnings)) {
      setRawJson('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-2 p-4 space-y-2">
        <p className="text-sm text-text-2">
          <span className="font-medium text-text">How it works:</span> copy the conversion prompt,
          paste it into ChatGPT together with any recipe, then paste the JSON it returns below.
          This site never calls an AI API itself.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={copyPrompt} className="inline-flex items-center gap-2">
            {copied ? <Check size={16} className="text-success" /> : <ClipboardCopy size={16} />}
            {copied ? 'Prompt copied' : 'Copy ChatGPT conversion prompt'}
          </Button>
        </div>
        <details className="text-xs text-text-3">
          <summary className="cursor-pointer hover:text-text-2">View prompt text</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface-1 border border-border p-3">
            {CHATGPT_CONVERSION_PROMPT}
          </pre>
        </details>
      </div>

      <div className="space-y-2">
        <label htmlFor="recipe-json-input" className="text-sm font-medium text-text-2">
          Paste recipe JSON
        </label>
        <textarea
          id="recipe-json-input"
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder='{"schemaVersion": 1, "name": "…", …}'
          className="w-full rounded-lg bg-surface-2 border border-border text-text placeholder:text-text-3 p-3 font-mono text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <Button size="sm" onClick={handleImport} disabled={!rawJson.trim()} className="inline-flex items-center gap-2">
          <FileJson size={16} /> Import recipe
        </Button>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-4">
          <p className="flex items-center gap-2 font-medium text-error">
            <AlertTriangle size={16} /> Import failed — fix these and paste again:
          </p>
          <ul className="mt-2 list-disc pl-6 space-y-1 text-sm text-error">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
