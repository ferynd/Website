/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * Pure normalization of a recipe into the workflow view model that the
 * Timeline, Prep, Execution, and Ingredients components render.
 *
 * v2 recipes use their imported prep groups, named results, and timeline
 * directly. v1 recipes are conservatively derived — structural data only
 * (`primarySectionId`, `sectionIds`, step `ingredientRefs`, section order
 * and `dependsOn`): one prep group per section that has prep steps, a
 * fallback timeline from section order, no invented result names, and no
 * prose analysis. Old saved recipes therefore render through the same
 * clean components, just with less workflow metadata.
 */

import { resolveTechnique } from './techniques';
import type {
  PrepGroup,
  PrepTiming,
  Recipe,
  RecipeIngredient,
  RecipeSection,
  RecipeStep,
  TimelineEntry,
} from './types';

export interface NormalizedPrepGroup {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  destination: string;
  instruction: string;
  timing: PrepTiming;
  /** Human label derived from the timing union ("At the start", …). */
  timingLabel: string;
  firstUseStepId: string;
  /** Where this group is first consumed ("Build Dough"); '' when unknown. */
  firstUseLabel: string;
  holdNote: string;
  details: string;
  techniqueIds: string[];
  /** v1 only: the section's prep steps, shown inside the group card. */
  steps: RecipeStep[];
}

export interface NormalizedStepInput {
  kind: 'prepGroup' | 'result';
  id: string;
  name: string;
}

export interface NormalizedStep {
  step: RecipeStep;
  inputs: NormalizedStepInput[];
  resultName: string | null;
  /** Underlying ingredients for the collapsed "Verify contents" disclosure. */
  verifyIngredients: RecipeIngredient[];
}

export interface NormalizedExecutionSection {
  section: RecipeSection;
  steps: NormalizedStep[];
}

export interface NormalizedTimelineEntry {
  entry: TimelineEntry;
  title: string;
  /** Section purpose when the entry references a section; '' otherwise. */
  detail: string;
  /** Dependency names surfaced from section dependsOn; [] when none. */
  afterNames: string[];
  /** Entries overlapping this wait (their duringEntryId points here). */
  nested: NormalizedTimelineEntry[];
}

export interface NormalizedWorkflow {
  /** True when prep groups came from the recipe (v2) vs derived (v1). */
  nativeGroups: boolean;
  /** True when the timeline came from the recipe (v2) vs derived (v1). */
  nativeTimeline: boolean;
  prepGroups: NormalizedPrepGroup[];
  /** v2 prep steps not represented by a group — never silently hidden. */
  residualPrepSections: { section: RecipeSection; steps: RecipeStep[] }[];
  executionSections: NormalizedExecutionSection[];
  timeline: NormalizedTimelineEntry[];
  /**
   * First occurrence of each technique: anchor key (`group:<id>` /
   * `step:<id>`) → technique ids to show there. Later occurrences render
   * nothing. Unknown ids are excluded (import already warned).
   */
  techniqueAnchors: Map<string, string[]>;
}

export const groupAnchor = (groupId: string): string => `group:${groupId}`;
export const stepAnchor = (stepId: string): string => `step:${stepId}`;

const sortByOrder = <T extends { order: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.order - b.order);

/** Global chronological step sequence: prep steps then active steps. */
const globalStepIndex = (recipe: Recipe): Map<string, number> => {
  const index = new Map<string, number>();
  let i = 0;
  sortByOrder(recipe.prepSteps).forEach((s) => { index.set(s.id, i); i += 1; });
  sortByOrder(recipe.activeSteps).forEach((s) => { index.set(s.id, i); i += 1; });
  return index;
};

/* ------------------------------------------------------------ */
/* Timing labels                                                 */
/* ------------------------------------------------------------ */

/** Human-readable schedule for a prep group. The note wins when present. */
export const formatPrepTimingLabel = (
  timing: PrepTiming,
  recipe: Recipe,
  timelineTitles: Map<string, string>,
): string => {
  if (timing.note) return timing.note;
  switch (timing.when) {
    case 'start':
      return 'At the start';
    case 'during-wait': {
      const title = timelineTitles.get(timing.waitEntryId);
      return title ? `During: ${title}` : 'During a waiting period';
    }
    case 'after-section': {
      const section = recipe.sections.find((s) => s.id === timing.sectionId);
      return section ? `After ${section.name}` : 'After an earlier section';
    }
    case 'just-in-time':
      return 'Just before use';
  }
};

/* ------------------------------------------------------------ */
/* Timeline                                                      */
/* ------------------------------------------------------------ */

const deriveEntryTitle = (
  entry: TimelineEntry,
  recipe: Recipe,
  groupById: Map<string, PrepGroup>,
  stepById: Map<string, RecipeStep>,
): string => {
  if (entry.titleOverride) return entry.titleOverride;
  for (const ref of entry.references) {
    if (ref.kind === 'prepGroup') {
      const group = groupById.get(ref.id);
      if (group) return group.name;
    } else if (ref.kind === 'section') {
      const section = recipe.sections.find((s) => s.id === ref.id);
      if (section) return section.name;
    } else {
      const step = stepById.get(ref.id);
      if (step) {
        if (step.result) return step.result.name;
        const section = recipe.sections.find((s) => s.id === step.sectionId);
        if (section) return section.name;
      }
    }
  }
  if (entry.phaseLabel) return entry.phaseLabel;
  return entry.kind.charAt(0).toUpperCase() + entry.kind.slice(1);
};

const normalizeTimeline = (
  recipe: Recipe,
  entries: TimelineEntry[],
): NormalizedTimelineEntry[] => {
  const groupById = new Map(recipe.prepGroups.map((g) => [g.id, g]));
  const stepById = new Map(
    [...recipe.prepSteps, ...recipe.activeSteps].map((s) => [s.id, s]),
  );
  const sectionById = new Map(recipe.sections.map((s) => [s.id, s]));

  const normalized = sortByOrder(entries).map((entry): NormalizedTimelineEntry => {
    const firstSectionRef = entry.references.find((r) => r.kind === 'section');
    const section = firstSectionRef ? sectionById.get(firstSectionRef.id) : undefined;
    const afterNames = (section?.dependsOn ?? [])
      .map((id) => sectionById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    return {
      entry,
      title: deriveEntryTitle(entry, recipe, groupById, stepById),
      detail: section?.purpose ?? '',
      afterNames,
      nested: [],
    };
  });

  // Nest overlapped work under its wait; invalid targets stay top-level
  // (the validator reports them — rendering must not lose entries).
  const byId = new Map(normalized.map((n) => [n.entry.id, n]));
  const topLevel: NormalizedTimelineEntry[] = [];
  normalized.forEach((n) => {
    const parent = n.entry.duringEntryId ? byId.get(n.entry.duringEntryId) : undefined;
    if (parent && parent !== n && parent.entry.kind === 'wait') parent.nested.push(n);
    else topLevel.push(n);
  });
  return topLevel;
};

/** Conservative v1 fallback: one entry per section, in section order. */
const deriveFallbackTimeline = (recipe: Recipe): TimelineEntry[] =>
  sortByOrder(recipe.sections).map((section, i) => ({
    id: `derived-timeline-${section.id}`,
    kind: section.type === 'prep' ? 'prep' : 'execution',
    phaseLabel: '',
    references: [{ kind: 'section' as const, id: section.id }],
    titleOverride: '',
    activeTime: '',
    passiveTime: '',
    duringEntryId: '',
    alternatives: [],
    order: i + 1,
  }));

/* ------------------------------------------------------------ */
/* Prep groups                                                   */
/* ------------------------------------------------------------ */

/** v1: derive one group per section that has prep steps (or type 'prep'). */
const derivePrepGroups = (recipe: Recipe): NormalizedPrepGroup[] => {
  const activeInOrder = sortByOrder(recipe.activeSteps);

  return sortByOrder(recipe.sections)
    .map((section): NormalizedPrepGroup | null => {
      const steps = sortByOrder(recipe.prepSteps.filter((s) => s.sectionId === section.id));
      if (steps.length === 0 && section.type !== 'prep') return null;

      const ids = new Set<string>();
      recipe.ingredients.forEach((ing) => {
        if (ing.primarySectionId === section.id) ids.add(ing.id);
      });
      steps.forEach((step) => step.ingredientRefs.forEach((ref) => ids.add(ref)));
      const ingredients = recipe.ingredients.filter((ing) => ids.has(ing.id));
      if (steps.length === 0 && ingredients.length === 0) return null;

      const firstUse = activeInOrder.find((step) =>
        step.ingredientRefs.some((ref) => ids.has(ref)),
      );
      const firstUseSection = firstUse
        ? recipe.sections.find((s) => s.id === firstUse.sectionId)
        : undefined;

      return {
        id: `derived-group-${section.id}`,
        name: section.name,
        ingredients,
        destination: '',
        instruction: '',
        timing: { when: 'start', note: '' },
        timingLabel: 'At the start',
        firstUseStepId: firstUse?.id ?? '',
        firstUseLabel: firstUseSection?.name ?? '',
        holdNote: '',
        details: section.notes,
        techniqueIds: [],
        steps,
      };
    })
    .filter((group): group is NormalizedPrepGroup => group !== null);
};

const normalizeNativePrepGroups = (
  recipe: Recipe,
  timelineTitles: Map<string, string>,
): NormalizedPrepGroup[] => {
  const ingredientById = new Map(recipe.ingredients.map((ing) => [ing.id, ing]));
  const stepIndex = globalStepIndex(recipe);
  const stepById = new Map(
    [...recipe.prepSteps, ...recipe.activeSteps].map((s) => [s.id, s]),
  );
  const sectionById = new Map(recipe.sections.map((s) => [s.id, s]));

  const sortKey = (group: PrepGroup): number => {
    if (group.firstUseStepId && stepIndex.has(group.firstUseStepId)) {
      return stepIndex.get(group.firstUseStepId)!;
    }
    if (group.timing.when === 'just-in-time' && stepIndex.has(group.timing.beforeStepId)) {
      return stepIndex.get(group.timing.beforeStepId)!;
    }
    return Number.MAX_SAFE_INTEGER;
  };

  return [...recipe.prepGroups]
    .map((group, i) => ({ group, i }))
    .sort((a, b) => sortKey(a.group) - sortKey(b.group) || a.i - b.i)
    .map(({ group }): NormalizedPrepGroup => {
      const firstUseStep = stepById.get(group.firstUseStepId);
      const firstUseSection = firstUseStep ? sectionById.get(firstUseStep.sectionId) : undefined;
      return {
        id: group.id,
        name: group.name,
        ingredients: group.ingredientIds
          .map((id) => ingredientById.get(id))
          .filter((ing): ing is RecipeIngredient => Boolean(ing)),
        destination: group.destination,
        instruction: group.instruction,
        timing: group.timing,
        timingLabel: formatPrepTimingLabel(group.timing, recipe, timelineTitles),
        firstUseStepId: group.firstUseStepId,
        firstUseLabel: firstUseStep?.result?.name ?? firstUseSection?.name ?? '',
        holdNote: group.holdNote,
        details: group.details,
        techniqueIds: group.techniqueIds,
        steps: [],
      };
    });
};

/* ------------------------------------------------------------ */
/* Execution sections                                            */
/* ------------------------------------------------------------ */

const normalizeExecution = (recipe: Recipe): NormalizedExecutionSection[] => {
  const ingredientById = new Map(recipe.ingredients.map((ing) => [ing.id, ing]));
  const groupById = new Map(recipe.prepGroups.map((g) => [g.id, g]));
  const resultNameById = new Map<string, string>();
  [...recipe.prepSteps, ...recipe.activeSteps].forEach((step) => {
    if (step.result) resultNameById.set(step.result.id, step.result.name);
  });

  return sortByOrder(recipe.sections)
    .map((section): NormalizedExecutionSection | null => {
      const steps = sortByOrder(recipe.activeSteps.filter((s) => s.sectionId === section.id));
      if (steps.length === 0) return null;
      return {
        section,
        steps: steps.map((step): NormalizedStep => {
          const inputs: NormalizedStepInput[] = [
            ...step.usesPrepGroupIds.map((id): NormalizedStepInput | null => {
              const group = groupById.get(id);
              return group ? { kind: 'prepGroup', id, name: group.name } : null;
            }),
            ...step.usesResultIds.map((id): NormalizedStepInput | null => {
              const name = resultNameById.get(id);
              return name ? { kind: 'result', id, name } : null;
            }),
          ].filter((input): input is NormalizedStepInput => input !== null);
          return {
            step,
            inputs,
            resultName: step.result?.name ?? null,
            verifyIngredients: step.ingredientRefs
              .map((id) => ingredientById.get(id))
              .filter((ing): ing is RecipeIngredient => Boolean(ing)),
          };
        }),
      };
    })
    .filter((section): section is NormalizedExecutionSection => section !== null);
};

/* ------------------------------------------------------------ */
/* Technique first occurrences                                   */
/* ------------------------------------------------------------ */

const buildTechniqueAnchors = (
  recipe: Recipe,
  prepGroups: NormalizedPrepGroup[],
  executionSections: NormalizedExecutionSection[],
): Map<string, string[]> => {
  const anchors = new Map<string, string[]>();
  const seen = new Set<string>();
  const add = (anchorKey: string, techniqueIds: string[]) => {
    techniqueIds.forEach((id) => {
      if (seen.has(id)) return;
      if (!resolveTechnique(id, recipe.techniqueOverrides)) return;
      seen.add(id);
      anchors.set(anchorKey, [...(anchors.get(anchorKey) ?? []), id]);
    });
  };
  prepGroups.forEach((group) => add(groupAnchor(group.id), group.techniqueIds));
  executionSections.forEach((section) =>
    section.steps.forEach((s) => add(stepAnchor(s.step.id), s.step.techniqueIds)),
  );
  return anchors;
};

/* ------------------------------------------------------------ */
/* Entry point                                                   */
/* ------------------------------------------------------------ */

export const normalizeRecipeWorkflow = (recipe: Recipe): NormalizedWorkflow => {
  const nativeGroups = recipe.prepGroups.length > 0;
  const nativeTimeline = recipe.timeline.length > 0;

  const timelineEntries = nativeTimeline ? recipe.timeline : deriveFallbackTimeline(recipe);
  const timeline = normalizeTimeline(recipe, timelineEntries);
  const timelineTitles = new Map<string, string>();
  const collectTitles = (entries: NormalizedTimelineEntry[]) => {
    entries.forEach((n) => {
      timelineTitles.set(n.entry.id, n.title);
      collectTitles(n.nested);
    });
  };
  collectTitles(timeline);

  const prepGroups = nativeGroups
    ? normalizeNativePrepGroups(recipe, timelineTitles)
    : derivePrepGroups(recipe);

  // v2 prep steps not owned by a group still display — grouped by section
  // under the group cards, so imported data is never silently hidden.
  const residualPrepSections = nativeGroups
    ? sortByOrder(recipe.sections)
        .map((section) => ({
          section,
          steps: sortByOrder(recipe.prepSteps.filter((s) => s.sectionId === section.id)),
        }))
        .filter(({ steps }) => steps.length > 0)
    : [];

  const executionSections = normalizeExecution(recipe);

  return {
    nativeGroups,
    nativeTimeline,
    prepGroups,
    residualPrepSections,
    executionSections,
    timeline,
    techniqueAnchors: buildTechniqueAnchors(recipe, prepGroups, executionSections),
  };
};

/* ------------------------------------------------------------ */
/* Ingredient grouping for the Ingredients view                  */
/* ------------------------------------------------------------ */

export interface IngredientGroupDisplay {
  key: string;
  title: string;
  destination: string;
  timingLabel: string;
  holdNote: string;
  ingredients: RecipeIngredient[];
}

/**
 * Ingredients grouped by their prep group (imported or derived), with any
 * remaining ingredients grouped by primary section so nothing disappears.
 */
export const groupIngredientsForDisplay = (
  recipe: Recipe,
  workflow: NormalizedWorkflow,
): IngredientGroupDisplay[] => {
  const grouped = new Set<string>();
  const groups: IngredientGroupDisplay[] = workflow.prepGroups
    .filter((group) => group.ingredients.length > 0)
    .map((group) => {
      group.ingredients.forEach((ing) => grouped.add(ing.id));
      return {
        key: group.id,
        title: group.name,
        destination: group.destination,
        timingLabel: group.timingLabel,
        holdNote: group.holdNote,
        ingredients: group.ingredients,
      };
    });

  const remaining = recipe.ingredients.filter((ing) => !grouped.has(ing.id));
  sortByOrder(recipe.sections).forEach((section) => {
    const items = remaining.filter((ing) => ing.primarySectionId === section.id);
    if (items.length === 0) return;
    groups.push({
      key: `section-${section.id}`,
      title: section.name,
      destination: '',
      timingLabel: '',
      holdNote: '',
      ingredients: items,
    });
  });
  const unassigned = remaining.filter((ing) => !ing.primarySectionId);
  if (unassigned.length > 0) {
    groups.push({
      key: 'unassigned',
      title: 'Other ingredients',
      destination: '',
      timingLabel: '',
      holdNote: '',
      ingredients: unassigned,
    });
  }
  return groups;
};
