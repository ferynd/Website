'use client';

/* Nutrition Tracker intake prompt, review, and commit dialog. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Link2,
  PackagePlus,
  RefreshCw,
  SkipForward,
  TriangleAlert,
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { buildNutritionPrompt, MAX_INTAKE_ITEMS, NUTRIENT_INTAKE_SPEC, parseNutritionJson } from '../lib/nutritionIntake';
import {
  buildIntakeCommitPlan,
  canCommitIntake,
  evaluateIntakeRows,
  initialIntakeRows,
  limitIntakeGroups,
  reassignRow,
  selectIntakeGroups,
  type IntakeCommitOutcome,
  type IntakeCommitPlan,
  type IntakeRow,
  type RowEvaluation,
} from '../lib/nutritionIntakeReview';
import type { LinkAssessment } from '../lib/nutritionLink';
import type { IntakeGroup } from '../lib/nutritionIntake';
import type { Recipe } from '../lib/types';
import { TRACKER_NUTRIENT_KEYS, type FoodsState } from '../lib/trackerFoods';

/* CONFIGURATION: prompt and review copy */
const hint = 'Ingredients with a suggested match, confirmed link, or “no match” are excluded. Use Clear link on an ingredient badge to include it.';

interface Props {
  recipe: Recipe;
  linkAssessments: Map<string, LinkAssessment>;
  foods: FoodsState;
  onRetryFoods: () => void;
  onCommit: (plan: IntakeCommitPlan) => Promise<IntakeCommitOutcome>;
  onClose: () => void;
}

interface PromptStepProps {
  foods: FoodsState;
  groups: IntakeGroup[];
  prompt: string;
  offset: number;
  total: number;
  remaining: number;
  raw: string;
  errors: string[];
  copyError: string;
  copied: boolean;
  onRawChange: (value: string) => void;
  onRetryFoods: () => void;
  onCopyPrompt: () => void;
  onReview: () => void;
  onNextBatch: () => void;
  onPreviousBatch: () => void;
}

interface ReviewRowCardProps {
  row: IntakeRow;
  evaluation: RowEvaluation;
  index: number;
  groups: IntakeGroup[];
  disabled: boolean;
  onChange: (index: number, update: (row: IntakeRow) => IntakeRow) => void;
}

interface ReviewFooterProps {
  rows: IntakeRow[];
  evaluations: RowEvaluation[];
  committing: boolean;
  onClose: () => void;
  onCommit: () => void;
}

interface DoneStepProps {
  outcome: IntakeCommitOutcome | null;
  onClose: () => void;
}

/** Render the prompt instructions, eligible ingredients, and JSON input. */
function PromptStep({
  foods,
  groups,
  prompt,
  offset,
  total,
  remaining,
  raw,
  errors,
  copyError,
  copied,
  onRawChange,
  onRetryFoods,
  onCopyPrompt,
  onReview,
  onNextBatch,
  onPreviousBatch,
}: PromptStepProps) {
  return (
    <>
      {foods.status === 'loading' && (
        <p className="text-sm text-text-2">Loading Nutrition Tracker foods…</p>
      )}

      {(foods.status === 'error' || foods.status === 'idle') && (
        <div className="space-y-2">
          <p className="text-sm text-error">
            {foods.error || 'Load Nutrition Tracker foods before generating a prompt.'}
          </p>
          <Button variant="secondary" onClick={onRetryFoods}>
            <RefreshCw size={14} /> Retry
          </Button>
        </div>
      )}

      {foods.status === 'ready' && !groups.length && (
        <p className="text-sm text-text-2">
          No ingredients need a new Nutrition Tracker food. {hint}
        </p>
      )}

      {foods.status === 'ready' && groups.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-warning">
              This prompt covers ingredients {offset + 1}–{offset + groups.length} of {total}.
              {remaining > 0 && ` Use Next batch for the remaining ${remaining}.`}
            </p>
            {offset > 0 && (
              <Button variant="secondary" onClick={onPreviousBatch}>Previous batch</Button>
            )}
            {remaining > 0 && (
              <Button variant="secondary" onClick={onNextBatch}>Next batch</Button>
            )}
          </div>
          <p className="text-sm text-text-2">
            {groups.length} ingredient(s) without a Nutrition Tracker food:
          </p>
          <ul className="list-disc pl-5 text-sm text-text-2">
            {groups.map((group) => (
              <li key={group.key}>
                {group.displayName}
                {group.ingredientIds.length > 1 ? ` ×${group.ingredientIds.length}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-3">{hint}</p>
          <Button variant="secondary" onClick={onCopyPrompt}>
            {copied ? <Check size={15} /> : <ClipboardCopy size={15} />}
            {copied ? 'Prompt copied' : 'Copy prompt'}
          </Button>
          <details>
            <summary className="cursor-pointer text-sm text-text-2">View prompt text</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-surface-2 p-3 text-xs text-text-2">
              {prompt}
            </pre>
          </details>
          <label className="block text-sm text-text-2">
            Paste nutrition JSON
            <textarea
              value={raw}
              onChange={(event) => onRawChange(event.target.value)}
              spellCheck={false}
              className="mt-1 min-h-36 w-full rounded-lg border border-border bg-surface-2 p-3 text-sm text-text focus-ring"
            />
          </label>
          <Button disabled={!raw.trim()} onClick={onReview}>
            <ClipboardPaste size={15} /> Review nutrition
          </Button>
        </div>
      )}

      {copyError && <p className="text-sm text-error">{copyError}</p>}
      {errors.length > 0 && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          <p className="font-medium">Couldn&apos;t read the nutrition JSON — fix these and paste again:</p>
          <ul className="list-disc pl-5">
            {errors.map((error, index) => <li key={index}>{error}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

/** Render one editable nutrition row in the review step. */
function ReviewRowCard({ row, evaluation, index, groups, disabled, onChange }: ReviewRowCardProps) {
  const change = (update: (current: IntakeRow) => IntakeRow) => onChange(index, update);

  return (
    <article className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <h3 className="font-medium text-text">
        Row {index + 1}: {row.item.name || '(no name)'}
      </h3>
      <p className="text-xs text-text-3">{row.item.assumptions}</p>
      {row.matchedBy === 'name' && (
        <p className="text-xs text-warning">Matched by name — check the ingredient.</p>
      )}

      <label className="block text-sm text-text-2">
        Ingredient
        <select
          disabled={disabled}
          value={row.targetKey ?? ''}
          onChange={(event) => change((current) => reassignRow(
            current,
            event.target.value || null,
            groups,
          ))}
          className="mt-1 w-full rounded-lg border border-border bg-surface-1 p-2 text-text focus-ring"
        >
          <option value="">— Not assigned —</option>
          {groups.map((group) => (
            <option key={group.key} value={group.key}>
              {group.displayName}{group.prepNote ? ` — ${group.prepNote}` : ''}
              {group.ingredientIds.length > 1 ? ` ×${group.ingredientIds.length}` : ''}
            </option>
          ))}
        </select>
      </label>

      <p className="text-xs text-text-2">
        {row.item.nutrients.calories ?? '—'} kcal · {row.item.nutrients.protein ?? '—'} g protein ·{' '}
        {row.item.nutrients.carbs ?? '—'} g carbs · {row.item.nutrients.fat ?? '—'} g fat per 100 g
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-text-2">All 24 nutrients per 100 g</summary>
        <table className="w-full text-sm">
          <tbody>
            {TRACKER_NUTRIENT_KEYS.map((key) => (
              <tr key={key}>
                <th className="text-left font-normal text-text-2">
                  {NUTRIENT_INTAKE_SPEC[key].label} ({NUTRIENT_INTAKE_SPEC[key].unit})
                </th>
                <td className="text-right text-text">{row.item.nutrients[key] ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {row.item.warnings.map((warning, warningIndex) => (
        <p key={warningIndex} className="text-xs text-warning">{warning}</p>
      ))}
      {row.item.errors.map((error, errorIndex) => (
        <p key={errorIndex} className="text-xs text-error">{error}</p>
      ))}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={row.decision === 'create' ? 'primary' : 'secondary'}
          disabled={disabled || row.item.errors.length > 0 || !row.targetKey}
          onClick={() => change((current) => ({ ...current, decision: 'create' }))}
        >
          <PackagePlus size={14} /> Create food
        </Button>
        {evaluation.linkAvailable && (
          <Button
            size="sm"
            variant={row.decision === 'link-existing' ? 'primary' : 'secondary'}
            disabled={disabled}
            onClick={() => change((current) => ({ ...current, decision: 'link-existing' }))}
          >
            <Link2 size={14} /> Link existing
          </Button>
        )}
        <Button
          size="sm"
          variant={row.decision === 'skip' ? 'primary' : 'ghost'}
          disabled={disabled}
          onClick={() => change((current) => ({ ...current, decision: 'skip' }))}
        >
          <SkipForward size={14} /> Skip
        </Button>
      </div>

      {row.decision === 'create' && (
        <>
          <Input
            label="Nutrition Tracker food name"
            value={row.foodName}
            onChange={(event) => change((current) => ({
              ...current,
              foodName: event.target.value,
              nameEdited: true,
            }))}
            error={evaluation.nameError ?? undefined}
            disabled={disabled}
          />
          <p className="text-xs text-text-3">ID: {evaluation.slug ?? '—'}</p>
          {evaluation.baseBlockers.map((blocker, blockerIndex) => (
            <p key={blockerIndex} className="text-xs text-error">{blocker}</p>
          ))}
          {evaluation.createBlockers.map((blocker, blockerIndex) => (
            <p key={blockerIndex} className="text-xs text-error">{blocker}</p>
          ))}
          {evaluation.batchConflictRow !== null && (
            <p className="text-xs text-error">
              Row {evaluation.batchConflictRow + 1} already creates a food with ID {evaluation.slug} — rename one of them.
            </p>
          )}
        </>
      )}

      {evaluation.collision && (
        <p className="text-xs text-warning">
          {evaluation.collision.food
            ? `A Nutrition Tracker food “${evaluation.collision.food.name}” already uses ID ${evaluation.collision.foodId}. Link this ingredient to it, or rename the new food.`
            : `A Nutrition Tracker document with ID ${evaluation.collision.foodId} already exists but isn't a readable food. Rename the new food.`}
        </p>
      )}

      {row.decision === 'link-existing' && evaluation.collision?.food && (
        <>
          <p className="text-xs text-text-2">
            {evaluation.collision.food.nutrients.calories ?? '—'} kcal ·{' '}
            {evaluation.collision.food.nutrients.protein ?? '—'} g protein per unit
          </p>
          <Input
            label={`Grams in one unit of “${evaluation.collision.food.name}”`}
            type="number"
            min={0}
            value={row.linkGrams}
            disabled={disabled}
            onChange={(event) => change((current) => ({ ...current, linkGrams: event.target.value }))}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => change((current) => ({ ...current, linkGrams: '100' }))}
          >
            Per 100 g
          </Button>
          <p className="text-xs text-text-3">Use 100 only if that food&apos;s values are per 100 g.</p>
        </>
      )}
    </article>
  );
}

/** Render action counts and commit controls for the review step. */
function ReviewFooter({ rows, evaluations, committing, onClose, onCommit }: ReviewFooterProps) {
  return (
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-1 pt-3">
      <span className="text-xs text-text-2">
        Create {rows.filter((row) => row.decision === 'create').length} ·{' '}
        Link {rows.filter((row) => row.decision === 'link-existing').length} ·{' '}
        Skip {rows.filter((row) => row.decision === 'skip').length}
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={committing} onClick={onClose}>Cancel</Button>
        <Button
          disabled={committing || !canCommitIntake(rows, evaluations)}
          loading={committing}
          onClick={onCommit}
        >
          <BadgeCheck size={15} />
          {rows.every((row) => row.decision !== 'create')
            ? 'Confirm links'
            : 'Create foods & confirm links'}
        </Button>
      </div>
    </div>
  );
}

/** Show the result of a successful intake commit. */
function DoneStep({ outcome, onClose }: DoneStepProps) {
  return (
    <div className="space-y-3 text-sm text-success">
      <p>
        <BadgeCheck className="inline" size={16} />{' '}
        {outcome?.status === 'created-unlinked'
          ? `Created ${outcome.created} food(s), but the open recipe changed before links could be applied — link them from the ingredient badges (use 100 g per unit).`
          : `Created ${outcome?.status === 'done' ? outcome.created : 0} food(s) in the Nutrition Tracker (per 100 g, quantity 1) and confirmed ${outcome?.status === 'done' ? outcome.linked : 0} link(s). Save the recipe to keep the links. Reload the Nutrition Tracker to see the new foods in its search.`}
      </p>
      <Button onClick={onClose}>Close</Button>
    </div>
  );
}

/** Nutrition intake dialog for generating and reviewing tracker foods. */
export default function NutritionIntakeModal({
  recipe,
  linkAssessments,
  foods,
  onRetryFoods,
  onCommit,
  onClose,
}: Props) {
  const selectedGroups = useMemo(
    () => selectIntakeGroups(recipe, linkAssessments),
    [recipe, linkAssessments],
  );
  const [batchOffset, setBatchOffset] = useState(0);
  const { batch, remaining, offset } = useMemo(
    () => limitIntakeGroups(selectedGroups, batchOffset),
    [selectedGroups, batchOffset],
  );
  const [step, setStep] = useState<'prompt' | 'review' | 'done'>('prompt');
  const [raw, setRaw] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [unreadableIds, setUnreadableIds] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [banner, setBanner] = useState('');
  const [copyError, setCopyError] = useState('');
  const [outcome, setOutcome] = useState<IntakeCommitOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(
    () => buildNutritionPrompt(recipe.name, batch),
    [recipe.name, batch],
  );
  const evaluations = useMemo(
    () => evaluateIntakeRows(rows, batch, foods.items, unreadableIds),
    [rows, batch, foods.items, unreadableIds],
  );

  const close = useCallback(() => {
    if (committing) return;
    if (step === 'review' && !window.confirm('Discard this nutrition review?')) return;
    onClose();
  }, [committing, step, onClose]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !committing) close();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [committing, close]);

  const review = () => {
    const result = parseNutritionJson(raw);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setWarnings(result.warnings);
    setErrors([]);
    setRows(initialIntakeRows(result.items, batch, foods.items, unreadableIds, recipe));
    setStep('review');
  };

  const commit = async () => {
    setCommitting(true);
    setBanner('');
    try {
      const result = await onCommit(buildIntakeCommitPlan(rows, evaluations, batch, recipe));
      setOutcome(result);
      if (result.status === 'conflict') {
        setUnreadableIds((previous) => new Set([...previous, ...result.unreadableIds]));
        setBanner('Some names now match existing Nutrition Tracker foods — nothing was written. Choose Link existing or rename the highlighted rows.');
      } else if (result.status === 'error') {
        setBanner(result.message);
      } else {
        setStep('done');
      }
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Could not create foods — nothing was written.');
    } finally {
      setCommitting(false);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Could not access the clipboard — copy the prompt from the expanded view below.');
    }
  };

  const updateRow = (index: number, update: (row: IntakeRow) => IntakeRow) => {
    setRows((previous) => previous.map((row, rowIndex) => (
      rowIndex === index ? update(row) : row
    )));
  };

  const changeBatch = (nextOffset: number) => {
    setBatchOffset(nextOffset);
    setRaw('');
    setErrors([]);
    setWarnings([]);
    setRows([]);
    setBanner('');
    setStep('prompt');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nutrition-intake-title"
    >
      <div className="w-full max-w-2xl space-y-4 overflow-y-auto max-h-[90dvh] rounded-xl border border-border bg-surface-1 p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="nutrition-intake-title" className="text-lg font-semibold text-text">
            Create Nutrition Tracker foods
          </h2>
          <Button variant="ghost" disabled={committing} onClick={close}>Close</Button>
        </div>

        {step === 'prompt' && (
          <PromptStep
            foods={foods}
            groups={batch}
            prompt={prompt}
            offset={offset}
            total={selectedGroups.length}
            remaining={remaining}
            raw={raw}
            errors={errors}
            copyError={copyError}
            copied={copied}
            onRawChange={setRaw}
            onRetryFoods={onRetryFoods}
            onCopyPrompt={copyPrompt}
            onReview={review}
            onNextBatch={() => changeBatch(offset + MAX_INTAKE_ITEMS)}
            onPreviousBatch={() => changeBatch(Math.max(0, offset - MAX_INTAKE_ITEMS))}
          />
        )}

        {step === 'review' && (
          <>
            <div className="flex justify-between">
              <Button variant="ghost" disabled={committing} onClick={() => setStep('prompt')}>Back to prompt</Button>
            </div>
            {warnings.length > 0 && (
              <div className="rounded bg-warning/10 p-3 text-sm text-warning">
                {warnings.map((warning, index) => <p key={index}>{warning}</p>)}
              </div>
            )}
            {banner && (
              <p className="flex gap-2 rounded bg-error/10 p-3 text-sm text-error">
                <TriangleAlert size={16} />{banner}
              </p>
            )}
            <fieldset disabled={committing} className="min-w-0 border-0 p-0">
              <div className="space-y-3">
                {rows.map((row, index) => (
                  <ReviewRowCard
                    key={row.rowId}
                    row={row}
                    evaluation={evaluations[index]}
                    index={index}
                    groups={batch}
                    disabled={committing}
                    onChange={updateRow}
                  />
                ))}
              </div>
            </fieldset>
            <ReviewFooter
              rows={rows}
              evaluations={evaluations}
              committing={committing}
              onClose={close}
              onCommit={commit}
            />
          </>
        )}

        {step === 'done' && <DoneStep outcome={outcome} onClose={onClose} />}
      </div>
    </div>
  );
}
