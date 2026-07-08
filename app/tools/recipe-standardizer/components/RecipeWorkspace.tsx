'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: accordion panel registry                       */
/* ------------------------------------------------------------ */
const PANEL_KEYS = ['overview', 'ingredients', 'prep', 'cook', 'shopping', 'scaling', 'json'] as const;
type PanelKey = (typeof PANEL_KEYS)[number];

const PANEL_LABELS: Record<PanelKey, string> = {
  overview: 'Overview',
  ingredients: 'Ingredients',
  prep: 'Prep',
  cook: 'Cook',
  shopping: 'Shopping',
  scaling: 'Scaling',
  json: 'JSON',
};

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChefHat,
  Check,
  ClipboardCopy,
  ClipboardList,
  FileJson,
  Info,
  ListChecks,
  Save,
  Scale,
  ShoppingCart,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useRecipeTool } from '../RecipeContext';
import { applyNutritionMatches, type MatchSummary } from '../lib/nutritionMatch';
import { suggestVersionName } from '../lib/naming';
import { applyScaleToRecipe, type ScaleResult } from '../lib/scaling';
import type { Recipe, RecipeIngredient } from '../lib/types';
import AccordionSection from './AccordionSection';
import ImportPanel from './ImportPanel';
import IngredientsView from './IngredientsView';
import RecipeLibrary from './RecipeLibrary';
import SaveChoiceModal from './SaveChoiceModal';
import ScalingPanel from './ScalingPanel';
import SectionCard from './SectionCard';
import ShoppingListView from './ShoppingListView';

const PANEL_ICONS: Record<PanelKey, React.ReactNode> = {
  overview: <Info size={18} />,
  ingredients: <ListChecks size={18} />,
  prep: <ClipboardList size={18} />,
  cook: <ChefHat size={18} />,
  shopping: <ShoppingCart size={18} />,
  scaling: <Scale size={18} />,
  json: <FileJson size={18} />,
};

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
  const { savedRecipes, listError, loadSavedRecipe, saveNew, update, remove, loadFoodItems } = useRecipeTool();

  const [baseline, setBaseline] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [scale, setScale] = useState<ScaleResult>(NO_SCALE);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState('');
  const [saveModalSummary, setSaveModalSummary] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [jsonCopied, setJsonCopied] = useState(false);
  const [open, setOpen] = useState<Record<PanelKey, boolean>>({
    overview: true, ingredients: true, prep: true, cook: true, shopping: false, scaling: false, json: false,
  });
  const panelRefs = useRef<Partial<Record<PanelKey, HTMLElement | null>>>({});

  const dirty = useMemo(
    () => Boolean(draft && (!currentId || JSON.stringify(draft) !== JSON.stringify(baseline))),
    [draft, baseline, currentId],
  );

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const confirmDiscard = (): boolean =>
    !dirty || window.confirm('You have unsaved changes on the current recipe. Discard them?');

  const openRecipe = (recipe: Recipe, id: string | null, importWarnings: string[]) => {
    setBaseline(recipe);
    setDraft(recipe);
    setCurrentId(id);
    setScale(NO_SCALE);
    setWarnings(importWarnings);
    setStatus('');
    setLoadError('');
    setLibraryOpen(false);
  };

  const handleImport = async (recipe: Recipe, importWarnings: string[]) => {
    if (!confirmDiscard()) return;
    openRecipe(recipe, null, importWarnings);
    // Best-effort auto-match against Nutrition Tracker foods on import; the
    // recipe stays fully usable when this fails (offline, no foods, etc.).
    // Functional updates so a quick user edit is never clobbered by the
    // async match result.
    try {
      const foods = await loadFoodItems();
      if (foods.length > 0) {
        const { summary } = applyNutritionMatches(recipe, foods);
        setBaseline((prev) => (prev ? applyNutritionMatches(prev, foods).recipe : prev));
        setDraft((prev) => (prev ? applyNutritionMatches(prev, foods).recipe : prev));
        setStatus(`Nutrition match: ${summary.linked} linked, ${summary.likely} likely, ${summary.unlinked} unlinked (see Ingredients).`);
      }
    } catch {
      /* matching is optional — never block import */
    }
  };

  const handleLoad = async (recipeId: string) => {
    if (!confirmDiscard()) return;
    setLoadError('');
    const result = await loadSavedRecipe(recipeId);
    if (!result.ok) {
      setLoadError(`Could not load recipe: ${result.errors.join(' ')}`);
      return;
    }
    openRecipe(result.recipe, recipeId, result.warnings);
  };

  const handleDelete = async (recipeId: string) => {
    await remove(recipeId);
    if (recipeId === currentId) {
      setCurrentId(null);
      setStatus('This recipe was deleted from the library — it is now unsaved.');
    }
  };

  const handleClose = () => {
    if (!confirmDiscard()) return;
    setBaseline(null);
    setDraft(null);
    setCurrentId(null);
    setScale(NO_SCALE);
    setWarnings([]);
    setStatus('');
    setLibraryOpen(true);
  };

  const handleIngredientChange = (updated: RecipeIngredient) => {
    setDraft((prev) =>
      prev
        ? { ...prev, ingredients: prev.ingredients.map((ing) => (ing.id === updated.id ? updated : ing)) }
        : prev,
    );
  };

  const handleNameChange = (name: string) => {
    setDraft((prev) => (prev ? { ...prev, name } : prev));
  };

  const handleActualWeightChange = (raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    setDraft((prev) => (prev ? { ...prev, yield: { ...prev.yield, actualFinalWeightG: value } } : prev));
  };

  const persistNew = async (recipe: Recipe) => {
    const id = await saveNew(recipe);
    setBaseline(recipe);
    setDraft(recipe);
    setCurrentId(id);
    setStatus(`Saved “${recipe.name}”.`);
  };

  const handleSaveClick = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setStatus('Give the recipe a name before saving.');
      return;
    }
    try {
      if (!currentId) {
        await persistNew(draft);
        return;
      }
      if (!dirty) {
        setStatus('No changes to save.');
        return;
      }
      setSaveModalSummary('You have unsaved edits (ingredients, name, or baked-in scaling).');
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const handleUpdateExisting = async () => {
    if (!draft || !currentId) return;
    setSaveModalSummary(null);
    try {
      await update(currentId, draft);
      setBaseline(draft);
      setStatus(`Updated “${draft.name}”.`);
    } catch (err) {
      setStatus(`Update failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const handleSaveAsNew = async (name: string) => {
    if (!draft) return;
    setSaveModalSummary(null);
    try {
      await persistNew({ ...draft, name });
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const handleBakeScale = () => {
    if (!draft || scale.factor === 1) return;
    setDraft(applyScaleToRecipe(draft, scale.factor));
    setScale(NO_SCALE);
    setStatus(`Baked ${scale.label} into the working copy — save to keep it.`);
  };

  const runNutritionMatch = async (): Promise<MatchSummary> => {
    if (!draft) throw new Error('No recipe open.');
    const foods = await loadFoodItems();
    const { recipe: matched, summary } = applyNutritionMatches(draft, foods);
    setDraft(matched);
    return summary;
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
      setTimeout(() => setJsonCopied(false), 2000);
    } catch {
      setStatus('Could not access the clipboard.');
    }
  };

  const orderedSections = useMemo(
    () => (draft ? [...draft.sections].sort((a, b) => a.order - b.order) : []),
    [draft],
  );
  const prepStepsBySection = useMemo(() => {
    const map = new Map<string, Recipe['prepSteps']>();
    draft?.prepSteps.forEach((step) => {
      map.set(step.sectionId, [...(map.get(step.sectionId) ?? []), step]);
    });
    return map;
  }, [draft]);
  const activeStepsBySection = useMemo(() => {
    const map = new Map<string, Recipe['activeSteps']>();
    draft?.activeSteps.forEach((step) => {
      map.set(step.sectionId, [...(map.get(step.sectionId) ?? []), step]);
    });
    return map;
  }, [draft]);

  const prepSections = orderedSections.filter((s) => s.type === 'prep' || (prepStepsBySection.get(s.id)?.length ?? 0) > 0);
  const cookSections = orderedSections.filter((s) => s.type !== 'prep' || (activeStepsBySection.get(s.id)?.length ?? 0) > 0);

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
          <span className="flex-1 text-lg font-semibold text-text">Recipe library &amp; import</span>
          <span className="text-sm text-text-3">{savedRecipes.length} saved</span>
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
          {/* Sticky jump bar */}
          <div className="sticky top-0 z-30 -mx-1 px-1 py-2 bg-bg/95 backdrop-blur border-b border-border">
            <div className="flex flex-wrap items-center gap-1.5">
              {PANEL_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => jumpTo(key)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-text-2 hover:text-text hover:bg-surface-2 focus-ring"
                >
                  {PANEL_LABELS[key]}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-2">
                {dirty && <span className="text-xs text-warning" title="Unsaved changes">● unsaved</span>}
                <Button size="sm" onClick={handleSaveClick} className="inline-flex items-center gap-1.5">
                  <Save size={14} /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={handleClose} aria-label="Close recipe">
                  <X size={16} />
                </Button>
              </span>
            </div>
          </div>

          {status && <p className="text-sm text-text-2">{status}</p>}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <p className="font-medium">Import notes:</p>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="space-y-4">
            <AccordionSection
              ref={(el) => { panelRefs.current.overview = el; }}
              title={PANEL_LABELS.overview}
              icon={PANEL_ICONS.overview}
              open={open.overview}
              onToggle={() => togglePanel('overview')}
            >
              <div className="space-y-4">
                <Input label="Recipe name" value={draft.name} onChange={(e) => handleNameChange(e.target.value)} />
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-1">
                    <p className="font-medium text-text">Servings &amp; yield</p>
                    <p className="text-text-2">Baseline servings: {draft.servings.baselineServings ?? '—'}</p>
                    <p className="text-text-2">Estimated final weight: {draft.yield.estimatedFinalWeightG !== null ? `${draft.yield.estimatedFinalWeightG} g` : '—'}</p>
                    <Input
                      label="Actual final weight (g) — weigh the finished batch to improve scaling"
                      type="number"
                      min={0}
                      step="any"
                      value={draft.yield.actualFinalWeightG ?? ''}
                      onChange={(e) => handleActualWeightChange(e.target.value)}
                    />
                    {draft.yield.yieldNotes && <p className="text-text-3">{draft.yield.yieldNotes}</p>}
                  </div>
                  <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-1">
                    <p className="font-medium text-text">Source</p>
                    <p className="text-text-2">{draft.source.type || '—'}</p>
                    {draft.source.url && (
                      <a href={draft.source.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">
                        {draft.source.url}
                      </a>
                    )}
                    {draft.source.notes && <p className="text-text-3">{draft.source.notes}</p>}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-3">Workflow at a glance</p>
                  <ol className="space-y-1 text-sm">
                    {orderedSections.map((section) => (
                      <li key={section.id} className="flex items-baseline gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${section.type === 'prep' ? 'bg-info/10 text-info' : section.type === 'execution' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent'}`}>
                          {section.type}
                        </span>
                        <span className="font-medium text-text">{section.name}</span>
                        {section.purpose && <span className="text-text-3">— {section.purpose}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
                {draft.notes.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-3">Recipe notes</p>
                    <ul className="list-disc pl-5 text-sm text-text-2 space-y-1">
                      {draft.notes.map((note, i) => <li key={i}>{note}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </AccordionSection>

            <AccordionSection
              ref={(el) => { panelRefs.current.ingredients = el; }}
              title={PANEL_LABELS.ingredients}
              icon={PANEL_ICONS.ingredients}
              subtitle="All ingredients by workflow section — grams first, edits flow through the whole recipe"
              open={open.ingredients}
              onToggle={() => togglePanel('ingredients')}
            >
              <IngredientsView
                recipe={draft}
                factor={scale.factor}
                onIngredientChange={handleIngredientChange}
                onRunNutritionMatch={runNutritionMatch}
              />
            </AccordionSection>

            <AccordionSection
              ref={(el) => { panelRefs.current.prep = el; }}
              title={PANEL_LABELS.prep}
              icon={PANEL_ICONS.prep}
              subtitle="Mise en place — every prep step in recommended order"
              open={open.prep}
              onToggle={() => togglePanel('prep')}
            >
              <div className="space-y-3">
                {prepSections.length === 0 && <p className="text-sm text-text-3">This recipe has no prep steps.</p>}
                {prepSections.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    recipe={draft}
                    steps={prepStepsBySection.get(section.id) ?? []}
                    mode="prep"
                    factor={scale.factor}
                  />
                ))}
              </div>
            </AccordionSection>

            <AccordionSection
              ref={(el) => { panelRefs.current.cook = el; }}
              title={PANEL_LABELS.cook}
              icon={PANEL_ICONS.cook}
              subtitle="Active steps in cooking order"
              open={open.cook}
              onToggle={() => togglePanel('cook')}
            >
              <div className="space-y-3">
                {cookSections.length === 0 && <p className="text-sm text-text-3">This recipe has no active steps.</p>}
                {cookSections.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    recipe={draft}
                    steps={activeStepsBySection.get(section.id) ?? []}
                    mode="active"
                    factor={scale.factor}
                  />
                ))}
              </div>
            </AccordionSection>

            <AccordionSection
              ref={(el) => { panelRefs.current.shopping = el; }}
              title={PANEL_LABELS.shopping}
              icon={PANEL_ICONS.shopping}
              subtitle="Consolidated shopping / pantry pull / mise en place checklist"
              open={open.shopping}
              onToggle={() => togglePanel('shopping')}
            >
              <ShoppingListView recipe={draft} factor={scale.factor} />
            </AccordionSection>

            <AccordionSection
              ref={(el) => { panelRefs.current.scaling = el; }}
              title={PANEL_LABELS.scaling}
              icon={PANEL_ICONS.scaling}
              subtitle="Scale a working copy — grams are the source of truth"
              open={open.scaling}
              onToggle={() => togglePanel('scaling')}
            >
              <ScalingPanel recipe={draft} scale={scale} onScaleChange={setScale} onBakeScale={handleBakeScale} />
            </AccordionSection>

            <AccordionSection
              ref={(el) => { panelRefs.current.json = el; }}
              title={PANEL_LABELS.json}
              icon={PANEL_ICONS.json}
              subtitle="Current recipe data (baseline quantities, live scaling not included)"
              open={open.json}
              onToggle={() => togglePanel('json')}
            >
              <div className="space-y-2">
                <Button size="sm" variant="secondary" onClick={copyJson} className="inline-flex items-center gap-2">
                  {jsonCopied ? <Check size={16} className="text-success" /> : <ClipboardCopy size={16} />}
                  {jsonCopied ? 'Copied' : 'Copy JSON'}
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
          <p>Open a saved recipe or import a new one above to get cooking.</p>
        </div>
      )}

      {saveModalSummary && draft && (
        <SaveChoiceModal
          recipeName={baseline?.name ?? draft.name}
          suggestedNewName={suggestVersionName(draft.name, savedRecipes.map((r) => r.name))}
          changeSummary={saveModalSummary}
          onUpdate={handleUpdateExisting}
          onSaveAsNew={handleSaveAsNew}
          onCancel={() => setSaveModalSummary(null)}
        />
      )}
    </div>
  );
}
