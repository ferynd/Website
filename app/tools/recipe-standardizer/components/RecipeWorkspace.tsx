/* --- CONFIGURATION: workspace copy and accordion panels --- */
/** Owns recipe baseline, editable draft, render-time scale, bake review, and revision conflict resolution. */
'use client';

const COPY_FEEDBACK_MS = 2000;
const VIEW_COPY = {
  discardChanges: 'You have unsaved changes on the current recipe. Discard them?',
  saveSummary: 'You have unsaved edits (ingredients, nutrition links, name, or baked-in scaling).',
  droppedExports:
    'Tracker export links in the pasted JSON were dropped — export again from ' +
    'this recipe.',
  unknownError: 'unknown error',
  skippedIngredients: (count: number) =>
    ` ${count} ingredient(s) changed meanwhile and were left as they are.`,
  nutritionMatchSummary: (candidates: number, unlinked: number) =>
    `Nutrition match: ${candidates} candidate(s) to confirm, ${unlinked} unlinked ` +
    `(see Ingredients).`,
  couldNotLoadRecipe: (detail: string) => `Could not load recipe: ${detail}`,
  deletedFromLibrary: 'This recipe was deleted from the library — it is now unsaved.',
  deleteFailed: (detail: string) => `Delete failed: ${detail}`,
  saved: (name: string) => `Saved “${name}”.`,
  nameRequired: 'Give the recipe a name before saving.',
  noChangesToSave: 'No changes to save.',
  saveFailed: (detail: string) => `Save failed: ${detail}`,
  updated: (name: string) => `Updated “${name}”.`,
  updateFailed: (detail: string) => `Update failed: ${detail}`,
  noRecipeOpen: 'No recipe open.',
  couldNotLoadNutritionTrackerFoods: 'Could not load Nutrition Tracker foods — try again.',
  recipeChangedWhileMatching: 'The open recipe changed while matching — run it again.',
  foodsUnavailableNothingWritten:
    'Could not load Nutrition Tracker foods — nothing was written. Try again.',
  recipeChangedNothingWritten: 'The open recipe changed — nothing was written.',
  ingredientsLinkedDuringReview:
    'Some ingredients were linked to a Nutrition Tracker food while you were ' +
    'reviewing — nothing was written. Close and reopen this dialog to review ' +
    'again.',
  linkExistingDeleted:
    'A Nutrition Tracker food chosen for "Link existing" was deleted — nothing ' +
    'was written. Review the highlighted rows again.',
  linkExistingChanged:
    'A Nutrition Tracker food chosen for "Link existing" changed or was deleted ' +
    '— nothing was written. Review the highlighted rows again.',
  replacedFoodRestored:
    'A Nutrition Tracker food this review replaces was restored meanwhile — ' +
    'nothing was written. Close and reopen this dialog to review again.',
  createFoodsFailed: (detail: string) => `Could not create foods — nothing was written: ${detail}`,
  foodsCreatedRecipeChanged:
    'Nutrition Tracker foods were created, but the open recipe changed before ' +
    'links could be applied.',
  intakeApplied: (created: number, linked: number, skippedNote: string) =>
    `Created ${created} Nutrition Tracker food(s) and confirmed ${linked} ` +
    `link(s) — save the recipe to keep the links.${skippedNote}`,
  nothingWasWritten: (detail: string) => `Nothing was written: ${detail}`,
  couldNotAccessTheClipboard: 'Could not access the clipboard.',
  recipeLibraryImport: 'Recipe library & import',
  savedLabel: 'saved',
  unsavedChanges: 'Unsaved changes',
  unsaved: '● unsaved',
  save: 'Save',
  closeRecipe: 'Close recipe',
  staleNutritionLinks:
    'nutrition link(s) point at deleted, renamed, or changed Nutrition Tracker ' +
    'foods.',
  review: 'Review',
  importNotes: 'Import notes:',
  recipeName: 'Recipe name',
  servingsYield: 'Servings & yield',
  baselineServings: 'Baseline servings: ',
  estimatedFinalWeight: 'Estimated final weight: ',
  actualWeightLabel: 'Actual final weight (g) — weigh the finished batch to improve scaling',
  source: 'Source',
  timeline: 'Timeline',
  recipeNotes: 'Recipe notes',
  noPrepGroups: 'This recipe has no prep groups.',
  noExecutionSteps: 'This recipe has no execution steps.',
  copied: 'Copied',
  copyJson: 'Copy JSON',
  emptyState: 'Open a saved recipe or import a new one above to get cooking.',
} as const;

const PANEL_KEYS = ['overview', 'ingredients', 'prep', 'execution', 'nutrition', 'scaling', 'json'] as const;
type PanelKey = (typeof PANEL_KEYS)[number];

const PANEL_LABELS: Record<PanelKey, string> = {
  overview: 'Overview',
  ingredients: 'Ingredients',
  prep: 'Prep',
  execution: 'Execution',
  nutrition: 'Nutrition',
  scaling: 'Scaling',
  json: 'JSON',
};

const CONFLICT_WORKSPACE_COPY = {
  bannerChanged: 'This recipe was changed in another tab or device.',
  bannerDeleted: 'This recipe was deleted in another tab or device. Your copy here is not saved.',
  bannerReload: 'Reload',
  bannerReview: 'Review options',
  saveChanged: 'Not saved — this recipe changed in another tab or device.',
  saveDeleted: 'Not saved — this recipe was deleted in another tab or device.',
  reloaded: 'Reloaded the saved version.',
  reloadFailed: 'Could not reload the recipe:',
} as const;

const BAKE_STATUS = {
  base: (label: string) => `Baked ${label} into the working copy — save to keep it.`,
  review: (annotated: number, cleared: number) =>
    ` ${annotated} equivalent(s) marked “not rescaled”; ${cleared} removed.`,
} as const;

const EXPORT_WORKSPACE_COPY = {
  revisionChanged:
    'This recipe changed in another tab — nothing was written. Reload it before ' +
    'exporting.',
  unsaved: 'Save the recipe before exporting.',
  dirty: 'Save your changes before exporting.',
  foodsUnavailable: 'Could not load Nutrition Tracker foods — nothing was written.',
  changedRecipe: 'The open recipe changed — nothing was written.',
  missingRecipe: 'No recipe open.',
  nutritionChanged: 'Nutrition changed while you were reviewing — nothing was written. Review again.',
  targetChanged: 'The Nutrition Tracker target changed while you were reviewing — review again.',
  verifyFailed: 'Could not verify the export status.',
  reviewChanged: 'Could not prepare the export.',
  targetEdited: 'The food was edited in the tracker meanwhile — review again.',
  targetDeleted: 'The food was deleted meanwhile — you can create it again.',
  sourceChanged: 'An ingredient’s tracker food changed — review again.',
  refChanged: 'This export was changed in another tab — reload this recipe.',
  recipeDeleted: 'This recipe was deleted.',
  exportedDuringChange: 'Exported, but the open recipe changed — reopen it to see the export.',
} as const;

import {
  deriveRemoteRecipeState,
  identityAfterDeleting,
  INITIAL_RECIPE_REVISION,
  LEGACY_RECIPE_REVISION,
  loadedRecipeBlockReason,
  loadedRecipeOverlapError,
  RecipeRevisionConflictError,
  remoteConflictToShow,
  SAVING_LOAD_REASON,
  saveBlockedWhileWriting,
  shouldRestoreDeletedIdentity,
  type RecipeConflict,
} from '../lib/recipeRevision';
import RecipeConflictModal from './RecipeConflictModal';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BookOpen,
  Apple,
  ChefHat,
  Check,
  ClipboardCopy,
  ClipboardList,
  FileJson,
  Info,
  ListChecks,
  Save,
  Scale,
  UtensilsCrossed,
  TriangleAlert,
  X,
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useRecipeTool } from '../RecipeContext';
import { applyNutritionMatches, type MatchSummary } from '../lib/nutritionMatch';
import { assessNutritionLink, confirmNutritionLink, summarizeLinkReview } from '../lib/nutritionLink';
import {
  applyIntakeLinks,
  collectGuardFoodIds,
  collectLinkTargets,
  findNoLongerEligible,
  findPlanCollisions,
  refreshPlanLinkTargets,
  type IntakeCommitOutcome,
  type IntakeCommitPlan,
} from '../lib/nutritionIntakeReview';
import {
  buildTrackerFoodDoc,
  FoodIdCollisionError,
  FoodLinkTargetChangedError,
  FoodTargetReappearedError,
  parseTrackerFood,
  trackerFoodId,
} from '../lib/trackerFoods';
import { suggestVersionName } from '../lib/naming';
import {
  applyScaleToRecipe,
  findUnscalableEquivalents,
  type BakeEquivalentIssue,
  type EquivalentBakeChoice,
  type ScaleResult,
} from '../lib/scaling';
import { calculateRecipeNutrition } from '../lib/nutritionCalc';
import {
  buildExportCommitRequest,
  buildExportPayload,
  calculateExportNutrition,
  collectExportSourceTargets,
  deriveExportStatuses,
  exportAction,
  exportTargetChangedSinceReview,
  findExportCollision,
  ExportRequestError,
  type ExportCommitInput,
  type ExportCommitOutcome,
  type ExportCommitRequest,
} from '../lib/nutritionExport';
import { withoutNutritionExports } from '../lib/nutritionExportRef';
import {
  ExportRecipeMissingError,
  ExportRefChangedError,
  ExportTargetChangedError,
  ExportTargetMissingError,
} from '../lib/nutritionExportTx';
import { nutritionPanelSubtitle } from '../lib/nutritionFormat';
import { exportSubtitleSuffix } from '../lib/nutritionExportFormat';
import { removeChecklist, saveChecklist } from '../lib/checklistStore';
import {
  applyStepTextUpdates,
  findAffectedSteps,
  type AffectedStep,
  type StepTextUpdate,
} from '../lib/stepTextUpdate';
import { resolveTechnique, type Technique } from '../lib/techniques';
import type { NutritionLink, Recipe, RecipeIngredient } from '../lib/types';
import type { FoodsState } from '../lib/trackerFoods';
import { groupAnchor, normalizeRecipeWorkflow, stepAnchor } from '../lib/workflow';
import AccordionSection from './AccordionSection';
import ExecutionSectionCard from './ExecutionSectionCard';
import ImportPanel from './ImportPanel';
import IngredientsView from './IngredientsView';
import PrepGroupCard from './PrepGroupCard';
import RecipeLibrary from './RecipeLibrary';
import BakeReviewModal from './BakeReviewModal';
import SaveChoiceModal from './SaveChoiceModal';
import ScalingPanel from './ScalingPanel';
import StepTextReviewModal from './StepTextReviewModal';
import WorkflowTimeline from './WorkflowTimeline';
import NutritionPanel from './NutritionPanel';

const PANEL_ICONS: Record<PanelKey, React.ReactNode> = {
  overview: <Info size={18} />,
  ingredients: <ListChecks size={18} />,
  prep: <ClipboardList size={18} />,
  execution: <ChefHat size={18} />,
  nutrition: <Apple size={18} />,
  scaling: <Scale size={18} />,
  json: <FileJson size={18} />,
};

interface StepReviewState {
  oldName: string;
  newName: string;
  items: AffectedStep[];
}

const NO_SCALE: ScaleResult = { factor: 1, label: 'baseline' };

/**
 * Owns the working state for one open recipe:
 * - `baseline` mirrors what is saved (or was just imported);
 * - `draft` is the editable working copy;
 * - `scale` is a render-time multiplier that never mutates the draft.
 * Saving a modified, already-saved recipe always routes through
 * SaveChoiceModal (update / save-as-new / cancel).
 */
export default function RecipeWorkspace() {
  const {
    savedRecipes,
    listError,
    listLoaded,
    loadSavedRecipe,
    saveNew,
    update,
    remove,
    loadFoodItems,
    createFoodItems,
    exportFood,
  } = useRecipeTool();

  const [bakeReview, setBakeReview] = useState<{
    scale: ScaleResult;
    issues: BakeEquivalentIssue[];
  } | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [writeInFlight, setWriteInFlight] = useState(false);
  const [listSeenId, setListSeenId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<RecipeConflict | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [baseline, setBaseline] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const baseRevisionRef = useRef<number | null>(null);
  const writeInFlightRef = useRef(false);
  const writeEpochRef = useRef(0);
  currentIdRef.current = currentId;
  baseRevisionRef.current = baseRevision;
  writeInFlightRef.current = writeInFlight;
  const [scale, setScale] = useState<ScaleResult>(NO_SCALE);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saveModalSummary, setSaveModalSummary] = useState<string | null>(null);
  const [stepReview, setStepReview] = useState<StepReviewState | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [foods, setFoods] = useState<FoodsState>({
    status: 'idle',
    items: [],
    error: '',
  });
  // Only Overview (and its timeline) starts open — the working panels are a
  // tap away via the sticky nav, keeping the default view phone-concise.
  const [open, setOpen] = useState<Record<PanelKey, boolean>>({
    overview: true,
    ingredients: false,
    prep: false,
    execution: false,
    nutrition: false,
    scaling: false,
    json: false,
  });
  const panelRefs = useRef<Partial<Record<PanelKey, HTMLElement | null>>>({});
  // Latest committed draft, for async flows that must not act on a stale closure.
  const draftRef = useRef<Recipe | null>(null);
  draftRef.current = draft;
  // Bumped whenever a different recipe (or none) becomes current, so an
  // in-flight nutrition match can detect that its result no longer applies.
  const recipeSessionRef = useRef(0);
  const [recipeSession, setRecipeSession] = useState(0);
  const [checklistKey, setChecklistKey] = useState(0);
  const checklistTicksRef = useRef<string[]>([]);
  const foodsRequestRef = useRef(0);

  const handleChecklistChange = (keys: string[]) => {
    checklistTicksRef.current = keys;
  };

  const refreshFoods = async (): Promise<import('../lib/trackerFoods').TrackerFood[] | null> => {
    const request = ++foodsRequestRef.current;
    const session = recipeSessionRef.current;
    setFoods((prev) => ({
      ...prev,
      status: 'loading',
      error: '',
    }));
    try {
      const items = await loadFoodItems();
      if (request !== foodsRequestRef.current || session !== recipeSessionRef.current) return null;
      setFoods({
        status: 'ready',
        items,
        error: '',
      });
      return items;
    } catch (err) {
      if (request === foodsRequestRef.current && session === recipeSessionRef.current) {
        setFoods({
          status: 'error',
          items: [],
          error: err instanceof Error ? err.message : VIEW_COPY.unknownError,
        });
      }
      return null;
    }
  };

  /** Refresh tracker foods after a conflict without setting status to loading, which replaced the open review. */
  const reloadFoodsWithoutLoading = async (): Promise<void> => {
    const request = ++foodsRequestRef.current;
    const session = recipeSessionRef.current;
    try {
      const items = await loadFoodItems();
      if (request !== foodsRequestRef.current || session !== recipeSessionRef.current) return;
      setFoods({
        status: 'ready',
        items,
        error: '',
      });
    } catch {
      /* Keep the conflict outcome visible when the refresh fails. */
    }
  };

  const dirty = useMemo(
    () => Boolean(draft && (!currentId || JSON.stringify(draft) !== JSON.stringify(baseline))),
    [draft, baseline, currentId],
  );

  useEffect(() => {
    if (currentId && savedRecipes.some((meta) => meta.id === currentId)) setListSeenId(currentId);
  }, [currentId, savedRecipes]);

  const remoteState = useMemo(() => deriveRemoteRecipeState({
    currentId,
    baseRevision,
    metas: savedRecipes,
    listLoaded,
    listError: listError !== null,
    writeInFlight,
    seenInList: listSeenId === currentId,
  }), [currentId, baseRevision, savedRecipes, listLoaded, listError, writeInFlight, listSeenId]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const confirmDiscard = (): boolean => !dirty || window.confirm(VIEW_COPY.discardChanges);

  const openRecipe = (
    recipe: Recipe,
    id: string | null,
    importWarnings: string[],
    revision: number | null,
  ) => {
    checklistTicksRef.current = [];
    currentIdRef.current = id;
    baseRevisionRef.current = revision;
    setBaseRevision(revision);
    setConflict(null);
    setListSeenId(id !== null && savedRecipes.some((meta) => meta.id === id) ? id : null);
    setBakeReview(null);
    recipeSessionRef.current += 1;
    setRecipeSession(recipeSessionRef.current);
    setChecklistKey((key) => key + 1);
    setBaseline(recipe);
    setDraft(recipe);
    setCurrentId(id);
    setScale(NO_SCALE);
    setWarnings(importWarnings);
    setStatus('');
    setLoadError('');
    setLibraryOpen(false);
  };

  /** Returns false when the user keeps their unsaved recipe (so the import
   *  panel can preserve the pasted JSON for another attempt). */
  const handleImport = (recipe: Recipe, importWarnings: string[]): boolean => {
    if (!confirmDiscard()) return false;
    const stripped = withoutNutritionExports(recipe);
    const warningsWithExportNotice = stripped.removed
      ? [
        ...importWarnings,
        VIEW_COPY.droppedExports,
      ]
      : importWarnings;
    openRecipe(stripped.recipe, null, warningsWithExportNotice, null);
    // Best-effort auto-match against Nutrition Tracker foods on import; the
    // recipe stays fully usable when this fails (offline, no foods, etc.).
    // Only the draft is updated — never the baseline — so matches found after
    // a quick save still read as unsaved changes instead of silently looking
    // clean while Firestore holds the unmatched version. The session token +
    // draftRef keep a slow result from clobbering a newer recipe or edit.
    const session = recipeSessionRef.current;
    void (async () => {
      try {
        const items = await refreshFoods();
        if (!items || items.length === 0 || session !== recipeSessionRef.current) return;
        const current = draftRef.current;
        if (!current) return;
        const { recipe: matched, summary } = applyNutritionMatches(current, items);
        setDraft(matched);
        setStatus(VIEW_COPY.nutritionMatchSummary(summary.candidates, summary.unlinked));
      } catch {
        /* matching is optional — never block import */
      }
    })();
    return true;
  };

  const handleLoad = async (recipeId: string) => {
    const blockReason = (epochAtStart: number): string | null => loadedRecipeBlockReason(
      writeInFlightRef.current,
      epochAtStart,
      writeEpochRef.current,
      recipeId,
      currentIdRef.current,
    );
    const initialReason = blockReason(writeEpochRef.current);
    if (initialReason !== null) {
      setLoadError(initialReason);
      return;
    }
    if (!confirmDiscard()) return;
    setLoadError('');
    const epochAtStart = writeEpochRef.current;
    const result = await loadSavedRecipe(recipeId);
    const overlappedReason = blockReason(epochAtStart);
    if (overlappedReason !== null) {
      setLoadError(loadedRecipeOverlapError(overlappedReason));
      return;
    }
    if (!result.ok) {
      setLoadError(VIEW_COPY.couldNotLoadRecipe(result.errors.join(' ')));
      return;
    }
    openRecipe(result.recipe, recipeId, result.warnings, result.revision);
    void refreshFoods();
  };

  const handleDelete = async (recipeId: string) => {
    const deletingOpen = recipeId === currentId;
    const previousId = currentId;
    const previousRevision = baseRevision;
    const deleteSession = recipeSessionRef.current;
    if (deletingOpen) {
      const next = identityAfterDeleting(currentId, baseRevision, recipeId);
      currentIdRef.current = next.currentId;
      baseRevisionRef.current = next.baseRevision;
      setCurrentId(next.currentId);
      setBaseRevision(next.baseRevision);
    }
    try {
      await remove(recipeId);
    } catch (error) {
      // A rejected delete leaves the document in place: restore the open
      // recipe's identity so Save keeps updating it instead of duplicating it.
      if (deletingOpen && shouldRestoreDeletedIdentity(
        deleteSession,
        recipeSessionRef.current,
        currentIdRef.current,
      )) {
        currentIdRef.current = previousId;
        baseRevisionRef.current = previousRevision;
        setCurrentId(previousId);
        setBaseRevision(previousRevision);
      }
      setStatus(VIEW_COPY.deleteFailed(error instanceof Error ? error.message : VIEW_COPY.unknownError));
      return;
    }
    removeChecklist(recipeId);
    if (deletingOpen) {
      setStatus(VIEW_COPY.deletedFromLibrary);
    }
  };

  const closeRecipe = () => {
    currentIdRef.current = null;
    baseRevisionRef.current = null;
    setBaseRevision(null);
    setConflict(null);
    setBakeReview(null);
    recipeSessionRef.current += 1;
    foodsRequestRef.current += 1;
    setRecipeSession(recipeSessionRef.current);
    setChecklistKey((key) => key + 1);
    setFoods({
      status: 'idle',
      items: [],
      error: '',
    });
    setBaseline(null);
    setDraft(null);
    setCurrentId(null);
    setScale(NO_SCALE);
    setWarnings([]);
    setStatus('');
    setLibraryOpen(true);
  };

  const handleClose = () => {
    if (!confirmDiscard()) return;
    closeRecipe();
  };

  const handleIngredientChange = (updated: RecipeIngredient) => {
    const previous = draft?.ingredients.find((ing) => ing.id === updated.id);
    setDraft((prev) =>
      prev
        ? {
          ...prev,
          ingredients: prev.ingredients.map((ing) => (ing.id === updated.id ? updated : ing)),
        }
        : prev,
    );
    // A rename updates every structured display, but step text is free prose —
    // offer a review of affected steps so instructions can't contradict chips.
    if (
      draft &&
      previous &&
      previous.displayName.trim().toLowerCase() !== updated.displayName.trim().toLowerCase()
    ) {
      const items = findAffectedSteps(draft, updated.id, previous.displayName, updated.displayName);
      if (items.length > 0) {
        setStepReview({
          oldName: previous.displayName,
          newName: updated.displayName,
          items,
        });
      }
    }
  };

  const handleStepReviewApply = (updates: StepTextUpdate[]) => {
    setStepReview(null);
    if (updates.length === 0) return;
    setDraft((prev) => (prev ? applyStepTextUpdates(prev, updates) : prev));
  };

  const handleNameChange = (name: string) => {
    setDraft((prev) => (prev ? { ...prev, name } : prev));
  };

  const handleActualWeightChange = (raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    setDraft((prev) => (prev ? { ...prev, yield: { ...prev.yield, actualFinalWeightG: value } } : prev));
  };

  const persistNew = async (recipe: Recipe, carryChecklist: boolean): Promise<boolean> => {
    // A double click must not create two documents for one unsaved recipe.
    if (writeInFlightRef.current) return false;
    writeInFlightRef.current = true;
    setWriteInFlight(true);
    const cleanRecipe = withoutNutritionExports(recipe).recipe;
    let id: string;
    try {
      id = await saveNew(cleanRecipe);
    } finally {
      writeInFlightRef.current = false;
      setWriteInFlight(false);
      setLoadError((current) => (current === SAVING_LOAD_REASON ? '' : current));
    }
    if (carryChecklist) saveChecklist(id, checklistTicksRef.current);
    currentIdRef.current = id;
    baseRevisionRef.current = INITIAL_RECIPE_REVISION;
    setBaseline(cleanRecipe);
    setDraft(cleanRecipe);
    setChecklistKey((key) => key + 1);
    setCurrentId(id);
    setBaseRevision(INITIAL_RECIPE_REVISION);
    setConflict(null);
    setStatus(VIEW_COPY.saved(recipe.name));
    return true;
  };

  const handleSaveClick = async () => {
    if (saveBlockedWhileWriting(writeInFlightRef.current)) return;
    if (!draft) return;
    if (!draft.name.trim()) {
      setStatus(VIEW_COPY.nameRequired);
      return;
    }
    try {
      if (!currentId) {
        await persistNew(draft, true);
        return;
      }
      if (remoteState.kind !== 'none') {
        setConflict(remoteState);
        return;
      }
      if (!dirty) {
        setStatus(VIEW_COPY.noChangesToSave);
        return;
      }
      setSaveModalSummary(VIEW_COPY.saveSummary);
    } catch (err) {
      setStatus(VIEW_COPY.saveFailed(err instanceof Error ? err.message : VIEW_COPY.unknownError));
    }
  };

  const updateWithRevision = async (expected: number) => {
    if (!draft || !currentId) return;
    if (saveBlockedWhileWriting(writeInFlightRef.current)) return;
    const writtenId = currentId;
    const saved = draft;
    setSaveModalSummary(null);
    writeEpochRef.current += 1;
    writeInFlightRef.current = true;
    setWriteInFlight(true);
    setConflictBusy(true);
    try {
      const result = await update(writtenId, saved, expected);
      if (currentIdRef.current !== writtenId) return;
      setBaseline({ ...saved, nutritionExports: result.nutritionExports });
      setDraft((previous) => previous ? { ...previous, nutritionExports: result.nutritionExports } : previous);
      baseRevisionRef.current = result.revision;
      setBaseRevision(result.revision);
      setConflict(null);
      setStatus(VIEW_COPY.updated(saved.name));
    } catch (err) {
      if (currentIdRef.current !== writtenId) return;
      if (err instanceof RecipeRevisionConflictError) {
        const surfaced = remoteConflictToShow(err.conflict, baseRevisionRef.current);
        if (surfaced !== null) {
          setConflict(surfaced);
          setStatus(surfaced.kind === 'changed'
            ? CONFLICT_WORKSPACE_COPY.saveChanged
            : CONFLICT_WORKSPACE_COPY.saveDeleted);
        }
      } else {
        setStatus(VIEW_COPY.updateFailed(err instanceof Error ? err.message : VIEW_COPY.unknownError));
      }
    } finally {
      writeInFlightRef.current = false;
      setWriteInFlight(false);
      setConflictBusy(false);
      setLoadError((current) => (current === SAVING_LOAD_REASON ? '' : current));
    }
  };

  const handleUpdateExisting = () => {
    if (saveBlockedWhileWriting(writeInFlightRef.current)) return;
    void updateWithRevision(baseRevision ?? LEGACY_RECIPE_REVISION);
  };

  const reloadRecipe = async () => {
    if (!currentId) return;
    const session = recipeSessionRef.current;
    setConflictBusy(true);
    try {
      const result = await loadSavedRecipe(currentId);
      if (session !== recipeSessionRef.current) return;
      if (result.ok) {
        openRecipe(result.recipe, currentId, result.warnings, result.revision);
        setStatus(CONFLICT_WORKSPACE_COPY.reloaded);
        void refreshFoods();
      } else if (result.missing) {
        setConflict({ kind: 'deleted' });
      } else {
        setStatus(`${CONFLICT_WORKSPACE_COPY.reloadFailed} ${result.errors.join(' ')}`);
      }
    } catch (err) {
      setStatus(`${CONFLICT_WORKSPACE_COPY.reloadFailed} ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setConflictBusy(false);
    }
  };

  const handleSaveAsNew = async (name: string, carryChecklist = false): Promise<boolean> => {
    if (!draft) return false;
    try {
      const saved = await persistNew(withoutNutritionExports({ ...draft, name }).recipe, carryChecklist);
      if (saved) setSaveModalSummary(null);
      return saved;
    } catch (err) {
      setStatus(VIEW_COPY.saveFailed(err instanceof Error ? err.message : VIEW_COPY.unknownError));
      return false;
    }
  };

  const bake = (target: ScaleResult, choices: Record<string, EquivalentBakeChoice>) => {
    const issues = draft ? findUnscalableEquivalents(draft, target.factor) : [];
    const cleared = issues.filter((issue) => choices[issue.ingredientId] === 'clear').length;
    const annotated = issues.length - cleared;
    setDraft((previous) => previous
      ? applyScaleToRecipe(previous, target.factor, target.portionOverride, choices)
      : previous);
    setScale(NO_SCALE);
    setBakeReview(null);
    setStatus(BAKE_STATUS.base(target.label) + (issues.length ? BAKE_STATUS.review(annotated, cleared) : ''));
  };

  const handleBakeScale = () => {
    if (!draft || (scale.factor === 1 && !scale.portionOverride)) return;
    const issues = findUnscalableEquivalents(draft, scale.factor);
    if (issues.length === 0) {
      bake(scale, {});
    } else {
      setBakeReview({ scale, issues });
    }
  };

  const runNutritionMatch = async (): Promise<MatchSummary> => {
    if (!draft) throw new Error(VIEW_COPY.noRecipeOpen);
    const session = recipeSessionRef.current;
    const foods = await refreshFoods();
    if (!foods) throw new Error(VIEW_COPY.couldNotLoadNutritionTrackerFoods);
    // Apply against the *latest* draft, not the click-time closure — and bail
    // out entirely if a different recipe was opened while the read ran.
    if (session !== recipeSessionRef.current) {
      throw new Error(VIEW_COPY.recipeChangedWhileMatching);
    }
    const current = draftRef.current;
    if (!current) throw new Error(VIEW_COPY.noRecipeOpen);
    const { recipe: matched, summary } = applyNutritionMatches(current, foods);
    setDraft(matched);
    return summary;
  };

  const commitIntake = async (plan: IntakeCommitPlan): Promise<IntakeCommitOutcome> => {
    const session = recipeSessionRef.current;
    if (!draftRef.current) return { status: 'error', message: VIEW_COPY.noRecipeOpen };
    const fresh = await refreshFoods();
    if (!fresh) {
      return {
        status: 'error',
        message: VIEW_COPY.foodsUnavailableNothingWritten,
      };
    }
    if (session !== recipeSessionRef.current) {
      return { status: 'error', message: VIEW_COPY.recipeChangedNothingWritten };
    }
    const refreshed = refreshPlanLinkTargets(plan, fresh);
    const currentRecipe = draftRef.current;
    if (!currentRecipe) return { status: 'error', message: VIEW_COPY.noRecipeOpen };
    if (findNoLongerEligible(refreshed.plan, currentRecipe, fresh).length) {
      return {
        status: 'error',
        message: VIEW_COPY.ingredientsLinkedDuringReview,
      };
    }
    if (refreshed.missingIds.length) {
      return {
        status: 'error',
        message: VIEW_COPY.linkExistingDeleted,
      };
    }
    const currentPlan = refreshed.plan;
    const guardIds = collectGuardFoodIds(currentPlan, currentRecipe);
    const linkTargets = collectLinkTargets(currentPlan);
    const collisions = findPlanCollisions(currentPlan, fresh);
    if (collisions.length) {
      return {
        status: 'conflict',
        foodIds: collisions,
        unreadableIds: [],
      };
    }
    const nowIso = new Date().toISOString();
    const docs = currentPlan.creates.map((create) => ({
      id: create.foodId,
      data: buildTrackerFoodDoc(create.name, create.nutrients, nowIso),
    }));
    try {
      await createFoodItems(docs, guardIds, linkTargets);
    } catch (err) {
      if (err instanceof FoodLinkTargetChangedError) {
        void refreshFoods();
        return {
          status: 'error',
          message: VIEW_COPY.linkExistingChanged,
        };
      }
      if (err instanceof FoodTargetReappearedError) {
        void refreshFoods();
        return {
          status: 'error',
          message: VIEW_COPY.replacedFoodRestored,
        };
      }
      if (err instanceof FoodIdCollisionError) {
        void refreshFoods();
        return {
          status: 'conflict',
          foodIds: err.foodIds,
          unreadableIds: err.foodIds.filter((id) => !fresh.some((food) => food.id === id)),
        };
      }
      return {
        status: 'error',
        message: VIEW_COPY.createFoodsFailed(err instanceof Error ? err.message : VIEW_COPY.unknownError),
      };
    }
    const created = docs
      .map((doc) => parseTrackerFood(doc.id, doc.data))
      .filter((food): food is NonNullable<typeof food> => food !== null);
    setFoods((prev) => ({
      status: 'ready',
      error: '',
      items: [...prev.items.filter((food) => !created.some((item) => item.id === food.id)), ...created],
    }));
    if (session !== recipeSessionRef.current) {
      setStatus(VIEW_COPY.foodsCreatedRecipeChanged);
      return { status: 'created-unlinked', created: created.length };
    }
    const current = draftRef.current;
    if (!current) {
      return { status: 'created-unlinked', created: created.length };
    }
    const nowMs = Date.now();
    const entries: {
      expected: IntakeCommitPlan['creates'][number]['ingredients'][number];
      link: NutritionLink;
    }[] = [];
    const currentLink = (id: string) => current.ingredients.find((ingredient) => ingredient.id === id)?.nutritionLink;
    currentPlan.creates.forEach((create) => {
      const food = created.find((item) => item.id === create.foodId);
      if (!food) return;
      create.ingredients.forEach((expected) => {
        const previous = currentLink(expected.ingredientId);
        if (previous) {
          entries.push({
            expected,
            link: confirmNutritionLink(food, 100, nowMs, previous),
          });
        }
      });
    });
    currentPlan.links.forEach((link) => {
      link.ingredients.forEach((expected) => {
        const previous = currentLink(expected.ingredientId);
        if (previous) {
          entries.push({
            expected,
            link: confirmNutritionLink(link.food, link.gramsPerUnit, nowMs, previous),
          });
        }
      });
    });
    const applied = applyIntakeLinks(current, entries);
    setDraft(applied.recipe);
    setStatus(
      VIEW_COPY.intakeApplied(
        created.length,
        applied.applied.length,
        applied.skipped.length ? VIEW_COPY.skippedIngredients(applied.skipped.length) : '',
      ),
    );
    return {
      status: 'done',
      created: created.length,
      linked: applied.applied.length,
      skippedIngredients: applied.skipped.length,
    };
  };

  const commitExport = async (input: ExportCommitInput): Promise<ExportCommitOutcome> => {
    const session = recipeSessionRef.current;
    const current = draftRef.current;
    if (!current || !currentId || baseRevision === null) return { status: 'error', message: EXPORT_WORKSPACE_COPY.unsaved };
    if (dirty) return { status: 'error', message: EXPORT_WORKSPACE_COPY.dirty };
    let freshFoods: import('../lib/trackerFoods').TrackerFood[];
    try {
      freshFoods = await loadFoodItems();
    } catch {
      return { status: 'error', message: EXPORT_WORKSPACE_COPY.foodsUnavailable };
    }
    if (session !== recipeSessionRef.current) {
      return { status: 'error', message: EXPORT_WORKSPACE_COPY.changedRecipe };
    }
    const latestRecipe = draftRef.current;
    if (latestRecipe === null) return { status: 'error', message: EXPORT_WORKSPACE_COPY.missingRecipe };
    if (JSON.stringify(latestRecipe) !== JSON.stringify(baseline)) {
      return { status: 'error', message: EXPORT_WORKSPACE_COPY.dirty };
    }
    const readyFoods: FoodsState = {
      status: 'ready',
      items: freshFoods,
      error: '',
    };
    foodsRequestRef.current += 1;
    setFoods(readyFoods);
    const freshResult = calculateExportNutrition(latestRecipe, readyFoods);
    const payloadResult = buildExportPayload(latestRecipe, freshResult, input.basis);
    if (!payloadResult.ok || payloadResult.payload.fingerprint !== input.reviewedFingerprint) {
      return { status: 'review-changed', message: EXPORT_WORKSPACE_COPY.nutritionChanged };
    }
    const freshStatuses = deriveExportStatuses(latestRecipe, currentId, freshResult, readyFoods);
    const freshStatus = freshStatuses.find((item) => item.basis === input.basis);
    if (freshStatus === undefined) return { status: 'error', message: EXPORT_WORKSPACE_COPY.verifyFailed };
    if (
      input.reviewedAction === 'update-overwrite-tracker-edits' &&
      exportTargetChangedSinceReview(freshStatus, input.reviewedTarget)
    ) {
      return { status: 'review-changed', message: EXPORT_WORKSPACE_COPY.targetChanged };
    }
    const freshAction = exportAction(freshStatus, payloadResult);
    if (freshAction !== input.reviewedAction) {
      return { status: 'review-changed', message: EXPORT_WORKSPACE_COPY.targetChanged };
    }
    if (freshAction === 'create' || freshAction === 'recreate') {
      const collision = findExportCollision(trackerFoodId(input.chosenName), freshFoods, freshStatus);
      if (collision !== null) return { status: 'collision', foodId: collision.id };
    }
    let request: ExportCommitRequest;
    try {
      request = buildExportCommitRequest({
        recipeRevision: baseRevision ?? LEGACY_RECIPE_REVISION,
        recipe: latestRecipe,
        recipeId: currentId,
        basis: input.basis,
        status: freshStatus,
        payload: payloadResult.payload,
        sourceTargets: collectExportSourceTargets(freshResult, freshFoods),
        chosenName: input.chosenName,
        overwriteTrackerEdits: input.overwriteTrackerEdits,
        reviewedTarget: input.reviewedTarget,
        partialConfirmed: input.partialConfirmed,
        nowIso: new Date().toISOString(),
        nowMs: Date.now(),
      });
    } catch (error) {
      const message =
        error instanceof ExportRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : EXPORT_WORKSPACE_COPY.reviewChanged;
      return { status: 'error', message };
    }
    writeEpochRef.current += 1;
    writeInFlightRef.current = true;
    setWriteInFlight(true);
    try {
      await exportFood(request);
    } catch (error) {
      if (error instanceof RecipeRevisionConflictError) {
        return {
          status: 'error',
          message: error.conflict.kind === 'deleted'
            ? EXPORT_WORKSPACE_COPY.recipeDeleted
            : EXPORT_WORKSPACE_COPY.revisionChanged,
        };
      }
      if (
        error instanceof FoodIdCollisionError ||
        error instanceof ExportTargetChangedError ||
        error instanceof ExportTargetMissingError ||
        error instanceof FoodLinkTargetChangedError
      ) {
        await reloadFoodsWithoutLoading();
      }
      if (error instanceof FoodIdCollisionError) return { status: 'collision', foodId: request.foodId };
      if (error instanceof ExportTargetChangedError)
        return { status: 'review-changed', message: EXPORT_WORKSPACE_COPY.targetEdited };
      if (error instanceof ExportTargetMissingError)
        return { status: 'review-changed', message: EXPORT_WORKSPACE_COPY.targetDeleted };
      if (error instanceof FoodLinkTargetChangedError)
        return { status: 'review-changed', message: EXPORT_WORKSPACE_COPY.sourceChanged };
      if (error instanceof ExportRefChangedError)
        return { status: 'error', message: EXPORT_WORKSPACE_COPY.refChanged };
      if (error instanceof ExportRecipeMissingError)
        return { status: 'error', message: EXPORT_WORKSPACE_COPY.recipeDeleted };
      return {
        status: 'error',
        message: VIEW_COPY.nothingWasWritten(error instanceof Error ? error.message : VIEW_COPY.unknownError),
      };
    } finally {
      writeInFlightRef.current = false;
      setWriteInFlight(false);
      setLoadError((current) => (current === SAVING_LOAD_REASON ? '' : current));
    }
    const parsedFood = parseTrackerFood(request.foodId, request.doc);
    if (parsedFood !== null) {
      setFoods((previous) => ({
        status: 'ready',
        error: '',
        items: [...previous.items.filter((food) => food.id !== parsedFood.id), parsedFood],
      }));
    }
    if (session === recipeSessionRef.current) {
      setBaseRevision((previous) => previous === request.expectedRecipeRevision ? previous + 1 : previous);
      setBaseline((previous) =>
        session === recipeSessionRef.current && previous
          ? {
            ...previous,
            nutritionExports: { ...previous.nutritionExports, [input.basis]: request.nextRef },
          }
          : previous,
      );
      setDraft((previous) =>
        session === recipeSessionRef.current && previous
          ? {
            ...previous,
            nutritionExports: { ...previous.nutritionExports, [input.basis]: request.nextRef },
          }
          : previous,
      );
    } else {
      setStatus(EXPORT_WORKSPACE_COPY.exportedDuringChange);
    }
    return {
      status: 'done',
      mode: request.mode,
      foodName: request.doc.name,
    };
  };

  const jumpTo = (key: PanelKey) => {
    setOpen((prev) => ({ ...prev, [key]: true }));
    requestAnimationFrame(() => {
      panelRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const togglePanel = (key: PanelKey) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const copyJson = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
      setJsonCopied(true);
      setTimeout(() => setJsonCopied(false), COPY_FEEDBACK_MS);
    } catch {
      setStatus(VIEW_COPY.couldNotAccessTheClipboard);
    }
  };

  // One normalized workflow view model drives the Timeline, Prep,
  // Execution, and Ingredients displays for both v1 and v2 recipes.
  const workflow = useMemo(() => (draft ? normalizeRecipeWorkflow(draft) : null), [draft]);
  const foodsById = useMemo(() => foods.status === 'ready' ? new Map(foods.items.map((food) => [food.id, food])) : null, [foods]);
  const linkAssessments = useMemo(() => new Map((draft?.ingredients ?? []).map((ingredient) => [
    ingredient.id, assessNutritionLink(ingredient.nutritionLink, foodsById),
  ])), [draft, foodsById]);
  const linkSummary = useMemo(() => summarizeLinkReview(linkAssessments.values()), [linkAssessments]);
  const nutrition = useMemo(
    () => (draft ? calculateRecipeNutrition({
      recipe: draft,
      foods,
      scale,
    }) : null),
    [draft, foods, scale],
  );
  const exportResult = useMemo(() => (draft ? calculateExportNutrition(draft, foods) : null), [draft, foods]);
  const exportStatuses = useMemo(
    () => (draft && exportResult ? deriveExportStatuses(draft, currentId, exportResult, foods) : []),
    [draft, currentId, exportResult, foods],
  );
  const handleNutritionLinkChange = (ingredientId: string, link: NutritionLink) => setDraft((prev) => prev ? {
    ...prev,
    ingredients: prev.ingredients.map((ingredient) => ingredient.id === ingredientId ? { ...ingredient, nutritionLink: link } : ingredient),
  } : prev);
  const techniquesByAnchor = useMemo(() => {
    const map = new Map<string, Technique[]>();
    if (!draft || !workflow) return map;
    workflow.techniqueAnchors.forEach((ids, anchor) => {
      const resolved = ids
        .map((id) => resolveTechnique(id, draft.techniqueOverrides))
        .filter((t): t is Technique => t !== null);
      if (resolved.length > 0) map.set(anchor, resolved);
    });
    return map;
  }, [draft, workflow]);

  return (
    <div className="space-y-6">
      {/* Library + import */}
      <div className="rounded-xl border border-border bg-surface-1 shadow-md">
        <button
          type="button"
          onClick={() => setLibraryOpen((v) => !v)}
          aria-expanded={libraryOpen}
          className="w-full flex items-center gap-3 px-5 py-4 text-left focus-ring rounded-xl"
        >
          <BookOpen size={18} className="text-accent" />
          <span className="flex-1 text-lg font-semibold text-text">{VIEW_COPY.recipeLibraryImport}</span>
          <span className="text-sm text-text-3">{savedRecipes.length} {VIEW_COPY.savedLabel}</span>
        </button>
        {libraryOpen && (
          <div className="px-5 pb-5 space-y-5">
            <RecipeLibrary
              recipes={savedRecipes}
              currentId={currentId}
              listError={listError}
              onLoad={handleLoad}
              onDelete={handleDelete}
            />
            {loadError && <p className="text-sm text-error">{loadError}</p>}
            <ImportPanel onImport={handleImport} />
          </div>
        )}
      </div>
      {draft && (
        <>
          {/* Sticky jump bar — nav stays one line and scrolls horizontally
              on narrow screens; save/close never scroll out of reach. */}
          <div className="sticky top-0 z-30 -mx-1 px-1 py-2 bg-bg/95 backdrop-blur border-b border-border">
            <div className="flex items-center gap-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                {PANEL_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => jumpTo(key)}
                    className="flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-text-2 hover:text-text hover:bg-surface-2 focus-ring"
                  >
                    {PANEL_LABELS[key]}
                  </button>
                ))}
              </div>
              <span className="flex flex-shrink-0 items-center gap-2">
                {dirty && <span className="text-xs text-warning" title={VIEW_COPY.unsavedChanges}>{VIEW_COPY.unsaved}</span>}
                <Button
                  size="sm"
                  onClick={handleSaveClick}
                  disabled={saveBlockedWhileWriting(writeInFlight)}
                  className="inline-flex items-center gap-1.5"
                >
                  <Save size={14} /> {VIEW_COPY.save}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClose}
                  aria-label={VIEW_COPY.closeRecipe}
                >
                  <X size={16} />
                </Button>
              </span>
            </div>
          </div>
          {status && <p className="text-sm text-text-2">{status}</p>}
          {remoteState.kind !== 'none' && conflict === null && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <TriangleAlert size={14} />
              <p>
                {remoteState.kind === 'changed'
                  ? CONFLICT_WORKSPACE_COPY.bannerChanged
                  : CONFLICT_WORKSPACE_COPY.bannerDeleted}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (remoteState.kind === 'changed' && !dirty) {
                    void reloadRecipe();
                  } else {
                    setConflict(remoteState);
                  }
                }}
              >
                {remoteState.kind === 'changed' && !dirty
                  ? CONFLICT_WORKSPACE_COPY.bannerReload
                  : CONFLICT_WORKSPACE_COPY.bannerReview}
              </Button>
            </div>
          )}
          {linkSummary.stale > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            <TriangleAlert size={14} /> {linkSummary.stale} {VIEW_COPY.staleNutritionLinks}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => jumpTo('ingredients')}
            >{VIEW_COPY.review}</Button>
          </div>}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <p className="font-medium">{VIEW_COPY.importNotes}</p>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div className="space-y-4">
            <AccordionSection
              ref={(el) => {
                panelRefs.current.overview = el;
              }}
              title={PANEL_LABELS.overview}
              icon={PANEL_ICONS.overview}
              open={open.overview}
              onToggle={() => togglePanel('overview')}
            >
              <div className="space-y-4">
                <Input
                  label={VIEW_COPY.recipeName}
                  value={draft.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-1">
                    <p className="font-medium text-text">{VIEW_COPY.servingsYield}</p>
                    <p className="text-text-2">{VIEW_COPY.baselineServings}{draft.servings.baselineServings ?? '—'}</p>
                    <p className="text-text-2">{VIEW_COPY.estimatedFinalWeight}{draft.yield.estimatedFinalWeightG !== null ? `${draft.yield.estimatedFinalWeightG} g` : '—'}</p>
                    <Input
                      label={VIEW_COPY.actualWeightLabel}
                      type="number"
                      min={0}
                      step="any"
                      value={draft.yield.actualFinalWeightG ?? ''}
                      onChange={(e) => handleActualWeightChange(e.target.value)}
                    />
                    {draft.yield.yieldNotes && <p className="text-text-3">{draft.yield.yieldNotes}</p>}
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-1">
                    <p className="font-medium text-text">{VIEW_COPY.source}</p>
                    <p className="text-text-2">{draft.source.type || '—'}</p>
                    {draft.source.url && (
                      <a
                        href={draft.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline break-all"
                      >
                        {draft.source.url}
                      </a>
                    )}
                    {draft.source.notes && <p className="text-text-3">{draft.source.notes}</p>}
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-3">{VIEW_COPY.timeline}</p>
                  {workflow && <WorkflowTimeline timeline={workflow.timeline} />}
                </div>
                {draft.notes.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-3">{VIEW_COPY.recipeNotes}</p>
                    <ul className="list-disc pl-5 text-sm text-text-2 space-y-1">
                      {draft.notes.map((note, i) => <li key={i}>{note}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </AccordionSection>
            <AccordionSection
              ref={(el) => {
                panelRefs.current.ingredients = el;
              }}
              title={PANEL_LABELS.ingredients}
              icon={PANEL_ICONS.ingredients}
              subtitle="Workflow, shopping/pantry, and grocery views — grams first, with editing and nutrition links"
              open={open.ingredients}
              onToggle={() => togglePanel('ingredients')}
            >
              {workflow && (
                <IngredientsView
                  key={checklistKey}
                  recipeId={currentId}
                  recipe={draft}
                  baselineRecipe={baseline}
                  workflow={workflow}
                  factor={scale.factor}
                  onIngredientChange={handleIngredientChange}
                  onRunNutritionMatch={runNutritionMatch}
                  onCommitIntake={commitIntake}
                  onChecklistChange={handleChecklistChange}
                  linkAssessments={linkAssessments}
                  foods={foods}
                  linkSummary={linkSummary}
                  onNutritionLinkChange={handleNutritionLinkChange}
                  onRefreshFoods={() => {
                    void refreshFoods();
                  }}
                />
              )}
            </AccordionSection>
            <AccordionSection
              ref={(el) => {
                panelRefs.current.prep = el;
              }}
              title={PANEL_LABELS.prep}
              icon={PANEL_ICONS.prep}
              subtitle="Named prepared inputs — what to stage, when, and how to hold it"
              open={open.prep}
              onToggle={() => togglePanel('prep')}
            >
              <div className="space-y-3">
                {workflow && workflow.prepGroups.length === 0 && workflow.residualPrepSections.length === 0 && (
                  <p className="text-sm text-text-3">{VIEW_COPY.noPrepGroups}</p>
                )}
                {workflow?.prepGroups.map((group) => (
                  <PrepGroupCard
                    key={group.id}
                    group={group}
                    factor={scale.factor}
                    techniques={techniquesByAnchor.get(groupAnchor(group.id)) ?? []}
                  />
                ))}
                {/* v2 prep steps not owned by a group still render — imported
                    data is never silently hidden. */}
                {workflow?.residualPrepSections.map(({ section, steps }) => (
                  <div key={section.id} className="rounded-lg border border-border bg-surface-2 p-4 space-y-2">
                    <h3 className="font-semibold text-text">{section.name}</h3>
                    <ol className="space-y-1.5">
                      {steps.map((step, i) => (
                        <li key={step.id} className="flex gap-2 text-sm text-text">
                          <span className="flex-shrink-0 tabular-nums text-text-3">{i + 1}.</span>
                          <p>{step.text}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </AccordionSection>
            <AccordionSection
              ref={(el) => {
                panelRefs.current.execution = el;
              }}
              title={PANEL_LABELS.execution}
              icon={PANEL_ICONS.execution}
              subtitle="Steps that consume named prepared inputs and prior results"
              open={open.execution}
              onToggle={() => togglePanel('execution')}
            >
              <div className="space-y-3">
                {workflow && workflow.executionSections.length === 0 && (
                  <p className="text-sm text-text-3">{VIEW_COPY.noExecutionSteps}</p>
                )}
                {workflow?.executionSections.map((data) => (
                  <ExecutionSectionCard
                    key={data.section.id}
                    data={data}
                    recipe={draft}
                    factor={scale.factor}
                    techniquesForStep={(stepId) => techniquesByAnchor.get(stepAnchor(stepId)) ?? []}
                  />
                ))}
              </div>
            </AccordionSection>
            <AccordionSection
              ref={(el) => {
                panelRefs.current.nutrition = el;
              }}
              title={PANEL_LABELS.nutrition}
              icon={PANEL_ICONS.nutrition}
              subtitle={
                nutrition
                  ? `${nutritionPanelSubtitle(nutrition)}${exportSubtitleSuffix(exportStatuses)}`
                  : undefined
              }
              open={open.nutrition}
              onToggle={() => togglePanel('nutrition')}
            >
              {/* Session key resets panel-local choices only when a recipe is opened or imported. */}
              {nutrition && exportResult && (
                <NutritionPanel
                  key={recipeSession}
                  recipe={draft}
                  result={nutrition}
                  scale={scale}
                  foods={foods}
                  linkAssessments={linkAssessments}
                  onNutritionLinkChange={handleNutritionLinkChange}
                  onIngredientChange={handleIngredientChange}
                  onCommitIntake={commitIntake}
                  onRefreshFoods={() => {
                    void refreshFoods();
                  }}
                  onReviewIngredients={() => jumpTo('ingredients')}
                  recipeId={currentId}
                  dirty={dirty}
                  exportResult={exportResult}
                  exportStatuses={exportStatuses}
                  onCommitExport={commitExport}
                />
              )}
            </AccordionSection>
            <AccordionSection
              ref={(el) => {
                panelRefs.current.scaling = el;
              }}
              title={PANEL_LABELS.scaling}
              icon={PANEL_ICONS.scaling}
              subtitle="Scale a working copy — grams are the source of truth"
              open={open.scaling}
              onToggle={() => togglePanel('scaling')}
            >
              <ScalingPanel
                recipe={draft}
                scale={scale}
                onScaleChange={setScale}
                onBakeScale={handleBakeScale}
              />
            </AccordionSection>
            <AccordionSection
              ref={(el) => {
                panelRefs.current.json = el;
              }}
              title={PANEL_LABELS.json}
              icon={PANEL_ICONS.json}
              subtitle="Current recipe data (baseline quantities, live scaling not included)"
              open={open.json}
              onToggle={() => togglePanel('json')}
            >
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={copyJson}
                  className="inline-flex items-center gap-2"
                >
                  {jsonCopied ? <Check size={16} className="text-success" /> : <ClipboardCopy size={16} />}
                  {jsonCopied ? VIEW_COPY.copied : VIEW_COPY.copyJson}
                </Button>
                <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-xs text-text-2">
                  {JSON.stringify(draft, null, 2)}
                </pre>
              </div>
            </AccordionSection>
          </div>
        </>
      )}
      {!draft && (
        <div className="rounded-xl border border-border bg-surface-1 p-8 text-center text-text-3">
          <UtensilsCrossed size={32} className="mx-auto mb-3 text-accent" />
          <p>{VIEW_COPY.emptyState}</p>
        </div>
      )}
      {stepReview && draft && (
        <StepTextReviewModal
          oldName={stepReview.oldName}
          newName={stepReview.newName}
          recipe={draft}
          items={stepReview.items}
          onApply={handleStepReviewApply}
          onSkip={() => setStepReview(null)}
        />
      )}
      {bakeReview && (
        <BakeReviewModal
          scaleLabel={bakeReview.scale.label}
          issues={bakeReview.issues}
          onConfirm={(choices) => bake(bakeReview.scale, choices)}
          onCancel={() => setBakeReview(null)}
        />
      )}
      {saveModalSummary && draft && (
        <SaveChoiceModal
          recipeName={baseline?.name ?? draft.name}
          suggestedNewName={suggestVersionName(draft.name, savedRecipes.map((r) => r.name))}
          changeSummary={saveModalSummary}
          updateDisabled={saveBlockedWhileWriting(writeInFlight)}
          saveAsNewDisabled={saveBlockedWhileWriting(writeInFlight)}
          onUpdate={handleUpdateExisting}
          onSaveAsNew={handleSaveAsNew}
          onCancel={() => setSaveModalSummary(null)}
        />
      )}
      {conflict && draft && (
        <RecipeConflictModal
          conflict={conflict}
          recipeName={draft.name}
          dirty={dirty}
          suggestedNewName={suggestVersionName(draft.name, savedRecipes.map((recipe) => recipe.name))}
          busy={conflictBusy || writeInFlight}
          onReload={() => {
            void reloadRecipe();
          }}
          onOverwrite={() => {
            if (conflict.kind === 'changed') void updateWithRevision(conflict.remoteRevision);
          }}
          onSaveAsNew={async (name) => {
            if (saveBlockedWhileWriting(writeInFlightRef.current)) return;
            setConflictBusy(true);
            // A remotely deleted source is re-saved, not forked, so its ticks carry over.
            const sourceDeleted = conflict.kind === 'deleted';
            const sourceId = currentIdRef.current;
            const saved = await handleSaveAsNew(name, sourceDeleted);
            if (saved && sourceDeleted && sourceId) removeChecklist(sourceId);
            if (saved) setConflict(null);
            setConflictBusy(false);
          }}
          onClose={() => {
            if (conflict.kind === 'deleted') {
              const deletedRecipeId = currentIdRef.current;
              if (deletedRecipeId !== null) removeChecklist(deletedRecipeId);
            }
            closeRecipe();
          }}
          onKeepEditing={() => setConflict(null)}
        />
      )}
    </div>
  );
}
