/* --- CONFIGURATION: ingredient display modes --- */
/** Ingredient views share equivalent caveats; saved recipes restore device-local checklist ticks. */
'use client';

const VIEW_COPY = {
  confirmCandidate: (name: string) => `confirm? ${name}`,
  suggestion: 'suggestion',
  badgeLabel: (name: string, label: string) => `Nutrition link for ${name}: ${label}. Edit link`,
  notesLabel: (action: string, name: string) => `${action} notes for ${name}`,
  unlinkedNote:
    ' For unlinked ingredients, add a matching saved food in the Nutrition ' +
    'Tracker and re-run matching.',
  unknownError: 'unknown error',

  notYetChecked: 'Not yet checked',
  matchSummary: (
    candidates: number,
    unlinked: number,
    confirmed: number,
    noMatch: number,
    unlinkedNote: string,
  ) =>
    `Matched against Nutrition Tracker foods: ${candidates} candidate(s) to ` +
    `confirm, ${unlinked} unlinked; ${confirmed} confirmed and ${noMatch} no-match ` +
    `links kept. Tap a badge to confirm or change a link.${unlinkedNote}`,
  matchingFailed: (detail: string) => `Matching failed: ${detail}`,
  optional: 'optional',
  hide: 'Hide',
  show: 'Show',
  prep: 'Prep: ',
  substitution: 'Substitution: ',
  conversion: 'Conversion: ',
  ingredientViewMode: 'Ingredient view mode',
  matchAgainstNutritionTrackerFoods: 'Match against Nutrition Tracker foods',
  createFoodsWithChatgpt: 'Create foods with ChatGPT',
  confirmed: 'confirmed',
  toConfirm: 'to confirm',
  needReview: 'need review',
  unlinked: 'unlinked',
  noMatch: 'no match',
  foodsUnverified: 'Couldn\'t check Nutrition Tracker foods — confirmed links are unverified.',
  retry: 'Retry',
} as const;

const BADGE_STYLES: Record<LinkAssessment['state'], string> = {
  confirmed: 'bg-success/10 text-success',
  'confirmed-unverified': 'bg-surface-1 border border-border text-text-2',
  candidate: 'bg-warning/10 text-warning',
  'candidate-missing': 'bg-warning/10 text-warning',
  'stale-missing': 'bg-error/10 text-error',
  'stale-renamed': 'bg-error/10 text-error',
  'stale-revised': 'bg-error/10 text-error',
  'no-match': 'bg-surface-1 border border-border text-text-3',
  unlinked: 'bg-surface-1 border border-border text-text-3',
};
const BADGE_LABELS = {
  'candidate-missing': 'candidate missing',
  'stale-missing': 'review: deleted',
  'stale-renamed': 'review: renamed',
  'stale-revised': 'review: changed',
  'no-match': 'no match',
  unlinked: 'unlinked',
} as const;

const MODES = [
  { key: 'workflow', label: 'Recipe Workflow' },
  { key: 'shopping', label: 'Shopping / Pantry' },
  { key: 'grocery', label: 'Grocery Category' },
] as const;
type IngredientMode = (typeof MODES)[number]['key'];

import EquivalentText from './EquivalentText';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  CircleSlash,
  Clock,
  HeartPulse,
  Link2,
  MapPin,
  PackagePlus,
  Pencil,
  TriangleAlert,
} from 'lucide-react';
import Button from '@/components/Button';
import { formatAmount } from '../lib/display';
import type { MatchSummary } from '../lib/nutritionMatch';
import { assessNutritionLink, type LinkAssessment, type LinkReviewSummary } from '../lib/nutritionLink';
import type { NutritionLink, Recipe, RecipeIngredient } from '../lib/types';
import type { FoodsState } from '../lib/trackerFoods';
import { selectIntakeGroups, type IntakeCommitOutcome, type IntakeCommitPlan } from '../lib/nutritionIntakeReview';
import { groupIngredientsForDisplay, type NormalizedWorkflow } from '../lib/workflow';
import { pruneChecklistKeys, readChecklist, saveChecklist } from '../lib/checklistStore';
import { normalizeIngredientName } from '../lib/shoppingList';
import ConsolidatedList from './ConsolidatedList';
import IngredientEditModal from './IngredientEditModal';
import NutritionLinkEditor from './NutritionLinkEditor';
import NutritionIntakeModal from './NutritionIntakeModal';

interface IngredientsViewProps {
  recipeId: string | null;
  recipe: Recipe;
  workflow: NormalizedWorkflow;
  factor: number;
  onIngredientChange: (updated: RecipeIngredient) => void;
  onRunNutritionMatch: () => Promise<MatchSummary>;
  linkAssessments: Map<string, LinkAssessment>;
  linkSummary: LinkReviewSummary;
  foods: FoodsState;
  onNutritionLinkChange: (id: string, link: NutritionLink) => void;
  onRefreshFoods: () => void;
  onCommitIntake: (plan: IntakeCommitPlan) => Promise<IntakeCommitOutcome>;
}

function nutritionBadgeLabel(state: LinkAssessment['state'], matchedName: string | null): string {
  if (state === 'confirmed' || state === 'confirmed-unverified') return matchedName ?? VIEW_COPY.confirmed;
  if (state === 'candidate') return VIEW_COPY.confirmCandidate(matchedName ?? VIEW_COPY.suggestion);
  return BADGE_LABELS[state];
}

function NutritionBadgeIcon({ state }: { state: LinkAssessment['state']; }) {
  switch (state) {
    case 'confirmed':
    case 'confirmed-unverified':
      return <BadgeCheck size={11} />;
    case 'stale-missing':
    case 'stale-renamed':
    case 'stale-revised':
    case 'candidate-missing':
      return <TriangleAlert size={11} />;
    case 'no-match':
      return <CircleSlash size={11} />;
    case 'candidate':
    case 'unlinked':
      return <Link2 size={11} />;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function NutritionBadge({ ingredient, assessment, onOpen }: {
  ingredient: RecipeIngredient;
  assessment: LinkAssessment;
  onOpen: () => void;
}) {
  const link = ingredient.nutritionLink;
  const label = nutritionBadgeLabel(assessment.state, link.matchedName);
  const styles = BADGE_STYLES[assessment.state];
  return <button
    type="button"
    onClick={onOpen}
    title={assessment.state === 'confirmed-unverified' ? VIEW_COPY.notYetChecked : undefined}
    aria-label={VIEW_COPY.badgeLabel(ingredient.displayName, label)}
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs focus-ring max-w-[12rem] truncate ${styles}`}
  >
    <NutritionBadgeIcon state={assessment.state} />
    <span className="truncate">{label}</span>
  </button>;
}

/**
 * The single hub for all ingredient views, switched by a compact segmented
 * control:
 * - Recipe Workflow: ingredients grouped by their prep group (imported or
 *   derived), with each group's destination, schedule, and holding note in
 *   the header; rows stay phone-narrow — prep/substitution/conversion notes
 *   sit behind a per-row disclosure. Inline editing and badge-opened
 *   Nutrition Tracker link editor stay on every row.
 * - Shopping / Pantry: consolidated checklist grouped by first-use section.
 * - Grocery Category: the same consolidated checklist grouped by category.
 * Checkbox ticks are shared between the two consolidated modes and survive
 * mode switches; saved recipe ticks hydrate from device-local storage.
 */
export default function IngredientsView({
  recipeId,
  recipe,
  workflow,
  factor,
  onIngredientChange,
  onRunNutritionMatch,
  linkAssessments,
  linkSummary,
  foods,
  onNutritionLinkChange,
  onRefreshFoods,
  onCommitIntake,
}: IngredientsViewProps) {
  const [mode, setMode] = useState<IngredientMode>('workflow');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [checklistHydrated, setChecklistHydrated] = useState(false);
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<RecipeIngredient | null>(null);
  const intakeGroupCount = useMemo(
    () => selectIntakeGroups(recipe, linkAssessments).length,
    [recipe, linkAssessments],
  );
  const [linkEditing, setLinkEditing] = useState<RecipeIngredient | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchMessage, setMatchMessage] = useState('');
  const [intakeOpen, setIntakeOpen] = useState(false);
  const currentShoppingKeys = useMemo(
    () => recipe.ingredients.map((ingredient) => (
      normalizeIngredientName(ingredient.displayName) || ingredient.id
    )),
    [recipe.ingredients],
  );

  useEffect(() => {
    setChecklistHydrated(false);
    setChecked(new Set(recipeId ? readChecklist(recipeId) : []));
    setChecklistHydrated(true);
  }, [recipeId]);

  useEffect(() => {
    if (!checklistHydrated) return;
    const pruned = pruneChecklistKeys(Array.from(checked), currentShoppingKeys);
    if (pruned.length !== checked.size) {
      setChecked(new Set(pruned));
      return;
    }
    if (recipeId) saveChecklist(recipeId, pruned);
  }, [checked, checklistHydrated, currentShoppingKeys, recipeId]);

  const toggleChecked = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleNotes = (id: string) => {
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runMatch = async () => {
    setMatching(true);
    setMatchMessage('');
    try {
      const summary = await onRunNutritionMatch();
      const unlinkedNote = summary.unlinked > 0
        ? VIEW_COPY.unlinkedNote
        : '';
      setMatchMessage(
        VIEW_COPY.matchSummary(
          summary.candidates,
          summary.unlinked,
          summary.confirmed,
          summary.noMatch,
          unlinkedNote,
        ),
      );
    } catch (err) {
      setMatchMessage(VIEW_COPY.matchingFailed(err instanceof Error ? err.message : VIEW_COPY.unknownError));
    } finally {
      setMatching(false);
    }
  };

  const renderRow = (ing: RecipeIngredient) => {
    const latestIngredient = recipe.ingredients.find((candidate) => candidate.id === ing.id) ?? ing;
    const assessment = linkAssessments.get(ing.id) ?? assessNutritionLink(latestIngredient.nutritionLink, null);
    const amount = formatAmount(ing, factor);
    const hasNotes = Boolean(ing.prepNote || ing.substitutionNotes || ing.conversionNotes);
    const notesOpen = openNotes.has(ing.id);
    return (
      <li key={ing.id} className="rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium tabular-nums text-text">{amount.grams}</span>
          {amount.equivalent && (
            <span className="text-text-3">
              <EquivalentText text={amount.equivalent} note={amount.equivalentNote} />
            </span>
          )}
          <span className="text-text">{ing.displayName}</span>
          {ing.optional && <span className="text-xs italic text-text-3">{VIEW_COPY.optional}</span>}
          <span className="ml-auto flex items-center gap-1.5">
            <NutritionBadge
              ingredient={latestIngredient}
              assessment={assessment}
              onOpen={() => setLinkEditing(latestIngredient)}
            />
            {hasNotes && (
              <button
                type="button"
                onClick={() => toggleNotes(ing.id)}
                aria-expanded={notesOpen}
                aria-label={VIEW_COPY.notesLabel(notesOpen ? VIEW_COPY.hide : VIEW_COPY.show, ing.displayName)}
                className="rounded p-1 text-text-3 hover:text-accent hover:bg-surface-1 focus-ring"
              >
                <ChevronDown size={14} className={`transition-transform ${notesOpen ? 'rotate-180' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(ing)}
              aria-label={`Edit ${ing.displayName}`}
              className="rounded p-1 text-text-3 hover:text-accent hover:bg-surface-1 focus-ring"
            >
              <Pencil size={14} />
            </button>
          </span>
        </div>
        {hasNotes && notesOpen && (
          <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5 text-xs text-text-2">
            {ing.prepNote && <p>{VIEW_COPY.prep}{ing.prepNote}</p>}
            {ing.substitutionNotes && <p>{VIEW_COPY.substitution}{ing.substitutionNotes}</p>}
            {ing.conversionNotes && <p>{VIEW_COPY.conversion}{ing.conversionNotes}</p>}
          </div>
        )}
      </li>
    );
  };

  const displayGroups = groupIngredientsForDisplay(recipe, workflow);

  return (
    <div className="space-y-4">
      {/* Segmented mode control — wraps on narrow screens */}
      <div
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit max-w-full"
        role="group"
        aria-label={VIEW_COPY.ingredientViewMode}
      >
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            aria-pressed={mode === key}
            className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-ring ${mode === key ? 'bg-accent text-black' : 'text-text-2 hover:text-text hover:bg-surface-1'
              }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'workflow' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={runMatch}
              loading={matching}
              className="inline-flex items-center gap-2"
            >
              <HeartPulse size={16} /> {VIEW_COPY.matchAgainstNutritionTrackerFoods}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setIntakeOpen(true);
                if (foods.status !== 'ready') onRefreshFoods();
              }}
              className="inline-flex items-center gap-2"
            >
              <PackagePlus size={16} /> {VIEW_COPY.createFoodsWithChatgpt}{foods.status === 'ready' ? ` (${intakeGroupCount})` : ''}
            </Button>
            {matchMessage && <p className="text-xs text-text-2">{matchMessage}</p>}
          </div>
          <p className="flex flex-wrap gap-x-2 text-xs text-text-3">
            {linkSummary.confirmed > 0 && <span>{linkSummary.confirmed} {VIEW_COPY.confirmed}</span>}
            {linkSummary.candidates > 0 && <span>{linkSummary.candidates} {VIEW_COPY.toConfirm}</span>}
            {linkSummary.stale > 0 && <span className="text-error">{linkSummary.stale} {VIEW_COPY.needReview}</span>}
            {linkSummary.unlinked > 0 && <span>{linkSummary.unlinked} {VIEW_COPY.unlinked}</span>}
            {linkSummary.noMatch > 0 && <span>{linkSummary.noMatch} {VIEW_COPY.noMatch}</span>}
          </p>
          {foods.status === 'error' && <p className="flex flex-wrap items-center gap-2 text-xs text-warning">
            {VIEW_COPY.foodsUnverified}
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefreshFoods}
            >{VIEW_COPY.retry}</Button>
          </p>}
          {displayGroups.map((group) => (
            <div key={group.key}>
              <div className="mb-2 space-y-0.5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-3">{group.title}</h3>
                {(group.destination || group.timingLabel) && (
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-3">
                    {group.timingLabel && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} /> {group.timingLabel}
                      </span>
                    )}
                    {group.destination && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={11} /> {group.destination}
                      </span>
                    )}
                  </p>
                )}
                {group.holdNote && (
                  <p className="flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle size={11} /> {group.holdNote}
                  </p>
                )}
              </div>
              <ul className="space-y-1">{group.ingredients.map(renderRow)}</ul>
            </div>
          ))}
        </>
      )}
      {mode !== 'workflow' && (
        <ConsolidatedList
          recipe={recipe}
          factor={factor}
          order={mode === 'shopping' ? 'workflow' : 'grocery'}
          checked={checked}
          onToggle={toggleChecked}
        />
      )}
      {editing && (
        <IngredientEditModal
          ingredient={editing}
          onSave={(updated) => {
            setEditing(null);
            onIngredientChange(updated);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {linkEditing && (() => {
        const latestIngredient = recipe.ingredients.find((candidate) => candidate.id === linkEditing.id) ?? linkEditing;
        const assessment = linkAssessments.get(latestIngredient.id) ?? assessNutritionLink(latestIngredient.nutritionLink, null);
        return <NutritionLinkEditor
          ingredient={latestIngredient}
          assessment={assessment}
          foods={foods}
          onApply={(link) => {
            setLinkEditing(null);
            onNutritionLinkChange(latestIngredient.id, link);
          }}
          onCancel={() => setLinkEditing(null)}
          onRetryFoods={onRefreshFoods}
        />;
      })()}
      {intakeOpen && <NutritionIntakeModal
        recipe={recipe}
        linkAssessments={linkAssessments}
        foods={foods}
        onRetryFoods={onRefreshFoods}
        onCommit={onCommitIntake}
        onClose={() => setIntakeOpen(false)}
      />}
    </div>
  );
}
