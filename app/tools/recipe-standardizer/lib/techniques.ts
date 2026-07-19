/* ------------------------------------------------------------ */
/* CONFIGURATION: site-owned technique glossary                  */
/* ------------------------------------------------------------ */

/**
 * The site owns technique help so imported recipes only carry technique ids
 * from this fixed list instead of repeating explanatory paragraphs. Help
 * text is one to three short sentences and never invents quantities,
 * temperatures, or times the source (or a package) determines — it says so
 * instead. A recipe may carry a compact `techniqueOverrides` entry for
 * genuinely unusual source-mandated handling; overrides win over the
 * glossary for their id. Unknown ids produce an import warning and are
 * skipped at render time.
 */

import type { TechniqueOverride } from './types';

export interface Technique {
  id: string;
  name: string;
  help: string;
}

export const TECHNIQUE_GLOSSARY: Technique[] = [
  {
    id: 'bloom-powdered-gelatin',
    name: 'Blooming powdered gelatin',
    help: 'Sprinkle the powder evenly over the cold liquid the recipe specifies and let it sit until it looks wrinkled and fully wet, usually about 5 minutes. Then dissolve it gently in warm liquid without boiling. Use the amounts from the recipe or package — they vary by brand.',
  },
  {
    id: 'bloom-sheet-gelatin',
    name: 'Blooming sheet gelatin',
    help: 'Soak the sheets in cold water until floppy, about 5–10 minutes, then squeeze out the excess water. Dissolve the softened sheets in warm liquid without boiling. Sheet counts vary by brand strength — follow the recipe or package.',
  },
  {
    id: 'fold',
    name: 'Folding',
    help: 'Use a spatula to cut down through the center, sweep along the bowl, and turn the mixture over itself while rotating the bowl. Stop as soon as it looks uniform — overfolding deflates the air you are trying to keep.',
  },
  {
    id: 'medium-soft-peaks',
    name: 'Medium-soft peaks',
    help: 'Whip until the cream holds a peak that stands briefly, then gently slumps at the tip. It should look smooth and billowy, not grainy — grainy means it went too far.',
  },
  {
    id: 'stiff-peaks',
    name: 'Stiff peaks',
    help: 'Whip until peaks stand straight without slumping when the whisk is lifted. Stop there — whipping past this stage turns cream grainy and egg whites dry.',
  },
  {
    id: 'emulsify',
    name: 'Emulsifying',
    help: 'Combine slowly while mixing constantly so the two liquids stay evenly blended instead of separating. Add the incoming liquid in a thin stream and let each addition incorporate before adding more.',
  },
  {
    id: 'temper-eggs',
    name: 'Tempering eggs',
    help: 'Whisk a little of the hot liquid into the eggs first to warm them gradually, then whisk the warmed eggs back into the pot. Adding eggs straight to hot liquid scrambles them.',
  },
  {
    id: 'water-bath',
    name: 'Water bath (bain-marie)',
    help: 'Set the bowl or pan over (or in) gently simmering water so the contents heat indirectly and evenly. The water should not touch the bottom of a bowl set over it.',
  },
  {
    id: 'blind-bake',
    name: 'Blind baking',
    help: 'Bake the crust before filling: line it with parchment, fill with pie weights or dried beans so it holds shape, and bake per the recipe. Remove the weights near the end to let the base crisp.',
  },
  {
    id: 'ribbon-stage',
    name: 'Ribbon stage',
    help: 'Beat eggs and sugar until thick and pale enough that the mixture falling from the whisk sits on the surface in a visible ribbon for a moment before sinking.',
  },
];

const glossaryById = new Map(TECHNIQUE_GLOSSARY.map((t) => [t.id, t]));

/** Ids the conversion prompt is allowed to emit. */
export const SUPPORTED_TECHNIQUE_IDS: string[] = TECHNIQUE_GLOSSARY.map((t) => t.id);

/**
 * Resolve a technique id against the recipe's overrides first, then the
 * site glossary. Returns null for unknown ids so rendering can skip them
 * safely (the import layer already warned).
 */
export const resolveTechnique = (
  id: string,
  overrides: TechniqueOverride[],
): Technique | null => {
  const override = overrides.find((o) => o.id === id);
  if (override) return { id: override.id, name: override.name, help: override.help };
  return glossaryById.get(id) ?? null;
};

/** Ids that neither the glossary nor the recipe's overrides can resolve. */
export const findUnknownTechniqueIds = (
  ids: string[],
  overrides: TechniqueOverride[],
): string[] => {
  const overrideIds = new Set(overrides.map((o) => o.id));
  return ids.filter((id) => !glossaryById.has(id) && !overrideIds.has(id));
};
