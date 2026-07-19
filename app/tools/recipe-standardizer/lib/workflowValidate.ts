/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * Structural chronology validation for the v2 workflow model.
 *
 * Everything here is reference- and order-based; free prose is never
 * analyzed. Errors are conditions that make the workflow impossible to
 * follow (missing references, duplicate result ids, ordering that puts a
 * consumer before its producer, cycles). Warnings flag metadata that is
 * wrong but leaves the recipe usable (unused prep groups, a declared
 * firstUseStepId that is not the earliest actual consumer).
 *
 * The global step sequence is prepSteps (by order) followed by activeSteps
 * (by order) — the same chronological reading the UI presents.
 */

import type { PrepGroup, Recipe, RecipeStep, TimelineEntry } from './types';

export interface WorkflowValidation {
  errors: string[];
  warnings: string[];
}

interface StepInfo {
  step: RecipeStep;
  /** Position in the global prep-then-active sequence. */
  index: number;
  /** Human-readable path, e.g. `activeSteps[2]`. */
  path: string;
}

const buildStepInfos = (recipe: Recipe, errors: string[]): Map<string, StepInfo> => {
  const infos = new Map<string, StepInfo>();
  let index = 0;
  (['prepSteps', 'activeSteps'] as const).forEach((list) => {
    [...recipe[list]]
      .sort((a, b) => a.order - b.order)
      .forEach((step, sortedPos) => {
        const path = `${list}[${sortedPos}]`;
        if (infos.has(step.id)) {
          errors.push(`${path}.id "${step.id}" is a duplicate step id — step ids must be globally unique across prepSteps and activeSteps.`);
        } else {
          infos.set(step.id, { step, index, path });
        }
        index += 1;
      });
  });
  return infos;
};

/** DFS cycle detection over a directed graph given as adjacency lists. */
const findCycle = (nodes: string[], edges: Map<string, string[]>): string[] | null => {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n, WHITE]));
  const stack: string[] = [];
  let cycle: string[] | null = null;

  const visit = (node: string): boolean => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (!color.has(next)) continue;
      if (color.get(next) === GRAY) {
        cycle = [...stack.slice(stack.indexOf(next)), next];
        return true;
      }
      if (color.get(next) === WHITE && visit(next)) return true;
    }
    stack.pop();
    color.set(node, BLACK);
    return false;
  };

  for (const node of nodes) {
    if (color.get(node) === WHITE && visit(node)) return cycle;
  }
  return null;
};

/** Validate the v2 workflow references and chronology. Pure; never throws. */
export const validateWorkflow = (recipe: Recipe): WorkflowValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const sectionById = new Map(recipe.sections.map((s) => [s.id, s]));
  const ingredientIds = new Set(recipe.ingredients.map((ing) => ing.id));
  const stepInfos = buildStepInfos(recipe, errors);
  const timelineById = new Map<string, TimelineEntry>(recipe.timeline.map((t) => [t.id, t]));

  /* ---- prep group ids and ingredient references ---- */
  const groupById = new Map<string, PrepGroup>();
  recipe.prepGroups.forEach((group, i) => {
    const path = `prepGroups[${i}]`;
    if (groupById.has(group.id)) {
      errors.push(`${path}.id "${group.id}" is a duplicate prep group id.`);
      return;
    }
    groupById.set(group.id, group);
    group.ingredientIds.forEach((ref) => {
      if (!ingredientIds.has(ref)) {
        errors.push(`${path}.ingredientIds references "${ref}" which does not match any ingredients[].id.`);
      }
    });
  });

  /* ---- named results: unique ids, exactly one producer ---- */
  const resultProducer = new Map<string, StepInfo>();
  stepInfos.forEach((info) => {
    const result = info.step.result;
    if (!result) return;
    if (resultProducer.has(result.id)) {
      errors.push(
        `${info.path}.result.id "${result.id}" is a duplicate — every named result needs exactly one producing step.`,
      );
      return;
    }
    resultProducer.set(result.id, info);
  });

  /* ---- step references: results and prep groups ---- */
  stepInfos.forEach((info) => {
    info.step.usesResultIds.forEach((resultId) => {
      const producer = resultProducer.get(resultId);
      if (!producer) {
        errors.push(`${info.path}.usesResultIds references "${resultId}" which no step produces.`);
        return;
      }
      if (producer.index >= info.index) {
        errors.push(
          `${info.path} consumes result "${producer.step.result?.name || resultId}" before its producing step (${producer.path}).`,
        );
      }
    });
    info.step.usesPrepGroupIds.forEach((groupId) => {
      if (!groupById.has(groupId)) {
        errors.push(`${info.path}.usesPrepGroupIds references "${groupId}" which does not match any prepGroups[].id.`);
      }
    });
  });

  /* ---- timeline order lookup, including equivalent section/step refs ---- */
  const sectionMinOrder = new Map<string, number>();
  const stepMinOrder = new Map<string, number>();
  const stepDirectMinOrder = new Map<string, number>();
  const recordMinOrder = (map: Map<string, number>, id: string, order: number) => {
    const existing = map.get(id);
    if (existing === undefined || order < existing) map.set(id, order);
  };

  recipe.timeline.forEach((entry) => {
    entry.references.forEach((ref) => {
      if (ref.kind === 'section') {
        recordMinOrder(sectionMinOrder, ref.id, entry.order);
        stepInfos.forEach((info) => {
          if (info.step.sectionId === ref.id) recordMinOrder(stepMinOrder, info.step.id, entry.order);
        });
      } else if (ref.kind === 'step') {
        recordMinOrder(stepMinOrder, ref.id, entry.order);
        recordMinOrder(stepDirectMinOrder, ref.id, entry.order);
        const sectionId = stepInfos.get(ref.id)?.step.sectionId;
        if (sectionId) recordMinOrder(sectionMinOrder, sectionId, entry.order);
      }
    });
  });

  const timelineOrderForStep = (stepId: string): number | undefined => {
    const directOrder = stepMinOrder.get(stepId);
    if (directOrder !== undefined) return directOrder;
    const sectionId = stepInfos.get(stepId)?.step.sectionId;
    return sectionId ? sectionMinOrder.get(sectionId) : undefined;
  };

  /* ---- prep group timing, first use, and availability ---- */
  recipe.prepGroups.forEach((group, i) => {
    const path = `prepGroups[${i}]`;
    const timing = group.timing;

    if (timing.when === 'during-wait') {
      const entry = timelineById.get(timing.waitEntryId);
      if (!entry) {
        errors.push(`${path}.timing.waitEntryId "${timing.waitEntryId}" does not match any timeline[].id.`);
      } else if (entry.kind !== 'wait') {
        errors.push(`${path}.timing.waitEntryId "${timing.waitEntryId}" points at a "${entry.kind}" timeline entry — during-wait prep must reference a wait.`);
      }
    } else if (timing.when === 'after-section') {
      if (!sectionById.has(timing.sectionId)) {
        errors.push(`${path}.timing.sectionId "${timing.sectionId}" does not match any sections[].id.`);
      }
    } else if (timing.when === 'just-in-time') {
      if (!stepInfos.has(timing.beforeStepId)) {
        errors.push(`${path}.timing.beforeStepId "${timing.beforeStepId}" does not match any step id — just-in-time prep must identify the step it precedes.`);
      }
    }

    const consumers = [...stepInfos.values()]
      .filter((info) => info.step.usesPrepGroupIds.includes(group.id))
      .sort((a, b) => a.index - b.index);

    if (consumers.length === 0) {
      warnings.push(`${path} ("${group.name}") is never used by any step.`);
    } else {
      const earliest = consumers[0];
      if (!group.firstUseStepId) {
        warnings.push(`${path} ("${group.name}") has no firstUseStepId — its first actual use is ${earliest.path}.`);
      } else if (!stepInfos.has(group.firstUseStepId)) {
        errors.push(`${path}.firstUseStepId "${group.firstUseStepId}" does not match any step id.`);
      } else if (group.firstUseStepId !== earliest.step.id) {
        warnings.push(
          `${path} ("${group.name}") declares firstUseStepId "${group.firstUseStepId}" but its earliest consumer is ${earliest.path}.`,
        );
      }

      if (timing.when === 'during-wait') {
        const waitOrder = timelineById.get(timing.waitEntryId)?.order;
        const firstUseOrder = timelineOrderForStep(earliest.step.id);
        if (waitOrder !== undefined && firstUseOrder !== undefined && waitOrder > firstUseOrder) {
          errors.push(
            `${path}.timing.waitEntryId "${timing.waitEntryId}" schedules prep group "${group.name}" after its first use (${earliest.path}).`,
          );
        }
      }

      // Availability: just-in-time prep happens immediately before
      // timing.beforeStepId — a consumer earlier in the sequence would use
      // the group before it exists.
      if (timing.when === 'just-in-time' && stepInfos.has(timing.beforeStepId)) {
        const availableAt = stepInfos.get(timing.beforeStepId)!;
        if (availableAt.step.id !== earliest.step.id) {
          errors.push(
            `${path}.timing.beforeStepId "${timing.beforeStepId}" must be the prep group's first consuming step (${earliest.path}).`,
          );
        }
        consumers.forEach((consumer) => {
          if (consumer.index < availableAt.index) {
            errors.push(
              `${consumer.path} uses prep group "${group.name}" before it is prepared (just-in-time before ${availableAt.path}).`,
            );
          }
        });
      }

      // Availability: after-section prep happens once the referenced section
      // completes — a consumer in that section or an earlier section would use it too soon.
      if (timing.when === 'after-section') {
        const afterSection = sectionById.get(timing.sectionId);
        if (afterSection) {
          consumers.forEach((consumer) => {
            const consumerSection = sectionById.get(consumer.step.sectionId);
            if (consumerSection && consumerSection.order <= afterSection.order) {
              errors.push(
                `${consumer.path} uses prep group "${group.name}" but the group is scheduled after section "${afterSection.name}", which has not completed yet.`,
              );
            }
          });
        }
      }
    }
  });

  /* ---- timeline: unique ids, typed references, overlap targets ---- */
  const seenTimelineIds = new Set<string>();
  recipe.timeline.forEach((entry, i) => {
    const path = `timeline[${i}]`;
    if (seenTimelineIds.has(entry.id)) {
      errors.push(`${path}.id "${entry.id}" is a duplicate timeline entry id.`);
    }
    seenTimelineIds.add(entry.id);

    entry.references.forEach((ref, j) => {
      const refPath = `${path}.references[${j}]`;
      if (ref.kind === 'section' && !sectionById.has(ref.id)) {
        errors.push(`${refPath} references section "${ref.id}" which does not match any sections[].id.`);
      } else if (ref.kind === 'step' && !stepInfos.has(ref.id)) {
        errors.push(`${refPath} references step "${ref.id}" which does not match any step id.`);
      } else if (ref.kind === 'prepGroup' && !groupById.has(ref.id)) {
        errors.push(`${refPath} references prep group "${ref.id}" which does not match any prepGroups[].id.`);
      }
    });

    if (entry.duringEntryId) {
      const target = timelineById.get(entry.duringEntryId);
      if (!target) {
        errors.push(`${path}.duringEntryId "${entry.duringEntryId}" does not match any timeline[].id.`);
      } else if (target.id === entry.id) {
        errors.push(`${path}.duringEntryId points at itself.`);
      } else if (target.kind !== 'wait') {
        errors.push(`${path}.duringEntryId "${entry.duringEntryId}" points at a "${target.kind}" entry — overlapped work must reference a wait.`);
      }
    }
  });

  /* ---- timeline order vs section/result dependencies ---- */
  // Sparse references are fine — checks only fire when both sides appear in the timeline.
  recipe.sections.forEach((section) => {
    const dependentOrder = sectionMinOrder.get(section.id);
    if (dependentOrder === undefined) return;
    section.dependsOn.forEach((depId) => {
      const depOrder = sectionMinOrder.get(depId);
      if (depOrder !== undefined && dependentOrder < depOrder) {
        errors.push(
          `Timeline schedules section "${section.name}" before its dependency "${sectionById.get(depId)?.name ?? depId}".`,
        );
      }
    });
  });
  stepInfos.forEach((info) => {
    const consumerOrder = stepMinOrder.get(info.step.id);
    if (consumerOrder === undefined) return;
    info.step.usesResultIds.forEach((resultId) => {
      const producer = resultProducer.get(resultId);
      if (!producer) return;
      const producerOrder = stepDirectMinOrder.get(producer.step.id) ?? stepMinOrder.get(producer.step.id);
      if (producerOrder !== undefined && consumerOrder < producerOrder) {
        errors.push(
          `Timeline schedules a step before the step that produces its input "${producer.step.result?.name ?? resultId}".`,
        );
      }
    });
  });

  /* ---- cycles: timeline overlaps, section dependencies, and result production/consumption ---- */
  const timelineOverlapEdges = new Map<string, string[]>();
  recipe.timeline.forEach((entry) => {
    timelineOverlapEdges.set(entry.id, entry.duringEntryId ? [entry.duringEntryId] : []);
  });
  const timelineOverlapCycle = findCycle(recipe.timeline.map((entry) => entry.id), timelineOverlapEdges);
  if (timelineOverlapCycle) {
    errors.push(`timeline duringEntryId contains a cycle: ${timelineOverlapCycle.join(' → ')}.`);
  }

  const sectionCycle = findCycle(
    recipe.sections.map((s) => s.id),
    new Map(recipe.sections.map((s) => [s.id, s.dependsOn])),
  );
  if (sectionCycle) {
    const names = sectionCycle.map((id) => sectionById.get(id)?.name ?? id);
    errors.push(`sections dependsOn contains a cycle: ${names.join(' → ')}.`);
  }

  const resultEdges = new Map<string, string[]>();
  stepInfos.forEach((info) => {
    resultEdges.set(
      info.step.id,
      info.step.usesResultIds
        .map((resultId) => resultProducer.get(resultId)?.step.id)
        .filter((id): id is string => Boolean(id)),
    );
  });
  const resultCycle = findCycle([...stepInfos.keys()], resultEdges);
  if (resultCycle) {
    errors.push(`Named results form a dependency cycle across steps: ${resultCycle.join(' → ')}.`);
  }

  return { errors, warnings };
};
