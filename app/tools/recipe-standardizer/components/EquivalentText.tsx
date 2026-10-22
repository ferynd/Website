/* --- CONFIGURATION: none --- */
/** Shared equivalent display; stale baked measures remain visibly marked in all four views. */

const VIEW_COPY = {
  text: '(',
  text2: ')',
} as const;

import { equivalentSuffix, type EquivalentNote } from '../lib/display';

/** Render secondary equivalent text with its authoritative caveat. */
export default function EquivalentText({ text, note }: {
  text: string;
  note: EquivalentNote;
}) {
  return (
    <>
      {VIEW_COPY.text}{text}
      <span className={note.kind === 'stale-after-bake' ? 'text-warning' : undefined}>
        {equivalentSuffix(note)}
      </span>
      {VIEW_COPY.text2}
    </>
  );
}
