// app/tools/date-night/components/Roller.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import Button from '@/components/Button';
import { useDateNight } from '../DateNightContext';
import { effectiveWeight } from '../lib/decay';
import { pickItemByRarity, pickRarity, RARE_PUSH_WEIGHTS } from '../lib/roller';
import { pickDistinctModifiers, pickModifierCount } from '../lib/stacking';
import type { RollCandidate, WheelSlice } from '../lib/types';
import ItemWheel from './Roller/ItemWheel';
import RarityWheel from './Roller/RarityWheel';
import { targetRotationForSlice } from './Roller/wheelUtils';

/* ------------------------------------------------------------ */
/* CONFIGURATION: spin durations + stage timings                */
/* ------------------------------------------------------------ */

const DATE_SPIN_MS = 2200;
const MODIFIER_SPIN_MS = 1400;

const INITIAL_PAUSE_MS = 800;
const REVEAL_DELAY_MS = 250;
const RARITY_READ_DELAY_MS = 800;
const DATE_RESULT_READ_DELAY_MS = 1000;
const MODIFIER_STAGE_LABEL_DELAY_MS = 500;
const MODIFIER_RARITY_READ_DELAY_MS = 600;
const MODIFIER_ITEM_READ_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SpinStage = 'idle' | 'date-rarity' | 'date-item' | 'mod-rarity' | 'mod-item';

const EMPTY_DATE_SLICE: WheelSlice = {
  id: 'empty',
  label: 'No eligible items',
  weight: 1,
};

const EMPTY_MODIFIER_SLICE: WheelSlice = {
  id: 'empty',
  label: 'No eligible modifiers',
  weight: 1,
};

const RARITY_DISPLAY_LABELS: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  veryRare: 'Very Rare',
};

export default function Roller() {
  const {
    dates,
    modifiers,
    settings,
    pendingRoll,
    acceptCandidate,
    recordVeto,
    archivePendingRollWithoutReview,
  } = useDateNight();

  const [noModifier, setNoModifier] = useState(false);
  const [higherStacking, setHigherStacking] = useState(false);
  const [pushRare, setPushRare] = useState(false);
  const [overrideFrequency, setOverrideFrequency] = useState(false);

  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [candidate, setCandidate] = useState<RollCandidate | null>(null);
  const [vetoCount, setVetoCount] = useState(0);
  const [emptyState, setEmptyState] = useState('');

  const [rarityRotation, setRarityRotation] = useState(0);
  const [itemRotation, setItemRotation] = useState(0);
  const [modifierRarityRotation, setModifierRarityRotation] = useState(0);
  const [modifierItemRotation, setModifierItemRotation] = useState(0);

  const [activeDateItemSlices, setActiveDateItemSlices] = useState<WheelSlice[]>([]);
  const [activeModifierItemSlices, setActiveModifierItemSlices] = useState<WheelSlice[]>([]);

  const [showReveal, setShowReveal] = useState(false);
  const [spinStage, setSpinStage] = useState<SpinStage>('idle');
  const [tickerText, setTickerText] = useState('');

  const rarityWeights = pushRare ? RARE_PUSH_WEIGHTS : settings.rarityWeights;

  const buildRaritySlices = (): WheelSlice[] => {
    return Object.entries(rarityWeights).map(([id, weight]) => ({
      id,
      label: RARITY_DISPLAY_LABELS[id] ?? id.toUpperCase(),
      weight: Math.max(0.0001, weight),
    }));
  };

  const resetSpinUi = () => {
    setSpinStage('idle');
    setRolling(false);
  };

  const handleLivePointerSync = useCallback((_sliceId: string, label: string) => {
    setTickerText(label);
  }, []);

  const startSpinSequence = async () => {
    try {
      setRolling(true);
      setShowReveal(false);
      setCandidate(null);
      setEmptyState('');
      setTickerText('Get Ready...');
      setActiveDateItemSlices([]);
      setActiveModifierItemSlices([]);

      await sleep(INITIAL_PAUSE_MS);

      /* ------------------------------------------------------------ */
      /* STAGE 1: Date rarity                                         */
      /* ------------------------------------------------------------ */

      setSpinStage('date-rarity');

      const dateRarity = pickRarity(settings, { pushRare });
      const raritySlices = buildRaritySlices();

      const nextRarityRotation = targetRotationForSlice(
        raritySlices,
        dateRarity,
        rarityRotation,
      );

      setRarityRotation(nextRarityRotation);

      await sleep(DATE_SPIN_MS);

      setTickerText(RARITY_DISPLAY_LABELS[dateRarity] ?? dateRarity);

      await sleep(RARITY_READ_DELAY_MS);

      /* ------------------------------------------------------------ */
      /* STAGE 2: Date item                                           */
      /* ------------------------------------------------------------ */

      const chosenDate = pickItemByRarity(dates, dateRarity, settings, {
        overrideFrequency,
        pushRare,
      });

      if (!chosenDate) {
        setEmptyState('Everything is on cooldown right now. Try override frequency or add more ideas.');
        resetSpinUi();
        return;
      }

      const dateSlicePool = dates
        .filter((item) => item.rarity === chosenDate.rarity)
        .map((item) => ({
          id: item.id,
          label: item.name,
          weight: effectiveWeight(item, settings, { overrideFrequency }),
        }))
        .filter((slice) => slice.weight > 0);

      if (!dateSlicePool.length) {
        setEmptyState('No eligible date ideas in the selected tier.');
        resetSpinUi();
        return;
      }

      setActiveDateItemSlices(dateSlicePool);
      setSpinStage('date-item');

      const nextItemRotation = targetRotationForSlice(
        dateSlicePool,
        chosenDate.id,
        itemRotation,
      );

      setItemRotation(nextItemRotation);

      await sleep(DATE_SPIN_MS);

      setTickerText(chosenDate.name);

      await sleep(DATE_RESULT_READ_DELAY_MS);

      /* ------------------------------------------------------------ */
      /* STAGES 3 and 4: Modifiers                                    */
      /* ------------------------------------------------------------ */

      let selectedModifiers: RollCandidate['modifiers'] = [];

      if (!noModifier && modifiers.length) {
        const desiredCount = pickModifierCount(settings, higherStacking);

        selectedModifiers = pickDistinctModifiers(
          modifiers,
          settings,
          desiredCount,
          {
            pushRare,
            overrideFrequency,
          },
        );

        if (selectedModifiers.length > 0) {
          let runningRarityRotation = modifierRarityRotation;
          let runningItemRotation = modifierItemRotation;

          const modifierRaritySlices = buildRaritySlices();

          for (let i = 0; i < selectedModifiers.length; i += 1) {
            const selectedModifier = selectedModifiers[i];
            const modifierRarity = selectedModifier.rarity;

            setSpinStage('mod-rarity');
            setTickerText(`Modifier ${i + 1} Rarity...`);

            await sleep(MODIFIER_STAGE_LABEL_DELAY_MS);

            runningRarityRotation = targetRotationForSlice(
              modifierRaritySlices,
              modifierRarity,
              runningRarityRotation,
              3,
            );

            setModifierRarityRotation(runningRarityRotation);

            await sleep(MODIFIER_SPIN_MS);

            setTickerText(RARITY_DISPLAY_LABELS[modifierRarity] ?? modifierRarity);

            await sleep(MODIFIER_RARITY_READ_DELAY_MS);

            const modifierSlicePool = modifiers
              .filter((item) => item.rarity === modifierRarity)
              .map((item) => ({
                id: item.id,
                label: item.name,
                weight: effectiveWeight(item, settings, { overrideFrequency }),
              }))
              .filter((slice) => slice.weight > 0);

            if (!modifierSlicePool.length) {
              continue;
            }

            setActiveModifierItemSlices(modifierSlicePool);
            setSpinStage('mod-item');

            runningItemRotation = targetRotationForSlice(
              modifierSlicePool,
              selectedModifier.id,
              runningItemRotation,
              3,
            );

            setModifierItemRotation(runningItemRotation);

            await sleep(MODIFIER_SPIN_MS);

            setTickerText(selectedModifier.name);

            await sleep(MODIFIER_ITEM_READ_DELAY_MS);
          }
        }
      }

      setSpinStage('idle');

      setCandidate({
        date: chosenDate,
        modifiers: selectedModifiers,
        modifierCountRequested: selectedModifiers.length,
      });

      await sleep(REVEAL_DELAY_MS);

      setShowReveal(true);
      setRolling(false);
    } catch {
      setSpinStage('idle');
      setRolling(false);
      setEmptyState('Something went wrong during the spin. Try again.');
    }
  };

  const handleSpinClick = () => {
    if (pendingRoll) {
      setShowArchiveConfirm(true);
      return;
    }

    void startSpinSequence();
  };

  const confirmArchiveThenSpin = async () => {
    if (pendingRoll) {
      await archivePendingRollWithoutReview(pendingRoll.id);
    }

    setShowArchiveConfirm(false);
    await startSpinSequence();
  };

  const accept = async () => {
    if (!candidate) return;

    await acceptCandidate(candidate, vetoCount);

    setCandidate(null);
    setVetoCount(0);
    setShowReveal(false);
    setActiveDateItemSlices([]);
    setActiveModifierItemSlices([]);
  };

  const vetoAndRespin = async () => {
    if (!candidate) return;

    await recordVeto(candidate);
    setVetoCount((prev) => prev + 1);

    await startSpinSequence();
  };

  const dateItemSlices = useMemo(() => {
    return dates
      .map((item) => ({
        id: item.id,
        label: item.name,
        weight: effectiveWeight(item, settings, { overrideFrequency }),
      }))
      .filter((slice) => slice.weight > 0);
  }, [dates, overrideFrequency, settings]);

  const modifierItemSlices = useMemo(() => {
    return modifiers
      .map((item) => ({
        id: item.id,
        label: item.name,
        weight: effectiveWeight(item, settings, { overrideFrequency }),
      }))
      .filter((slice) => slice.weight > 0);
  }, [modifiers, overrideFrequency, settings]);

  return (
    <>
      <section
        className={`space-y-5 rounded-3xl border border-border bg-surface-1/80 p-5 shadow-md transition-opacity duration-500 ${
          rolling ? 'pointer-events-none opacity-30' : 'opacity-100'
        }`}
      >
        <h2 className="text-xl font-semibold">Roller</h2>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {([
            { label: 'No modifier', checked: noModifier, set: setNoModifier },
            { label: 'Higher stacking', checked: higherStacking, set: setHigherStacking },
            { label: 'Push rare', checked: pushRare, set: setPushRare },
            { label: 'Override cooldown', checked: overrideFrequency, set: setOverrideFrequency },
          ] as { label: string; checked: boolean; set: (value: boolean) => void }[]).map(
            ({ label, checked, set }) => (
              <label key={label} className="flex cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => set(event.target.checked)}
                  className="h-4 w-4 rounded border border-border accent-[hsl(var(--accent))]"
                />
                {label}
              </label>
            ),
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-3">
            Date
          </p>

          <div className="grid gap-6 xl:grid-cols-2">
            <RarityWheel
              title="Date rarity"
              weights={rarityWeights}
              rotationDeg={rarityRotation}
              durationMs={DATE_SPIN_MS}
              dimmed={showReveal}
            />

            <ItemWheel
              title="Date ideas"
              slices={dateItemSlices.length ? dateItemSlices : [EMPTY_DATE_SLICE]}
              rotationDeg={itemRotation}
              durationMs={DATE_SPIN_MS}
              dimmed={showReveal}
            />
          </div>
        </div>

        {!noModifier && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-3">
              Modifier
            </p>

            <div className="grid gap-6 xl:grid-cols-2">
              <RarityWheel
                title="Modifier rarity"
                weights={rarityWeights}
                rotationDeg={modifierRarityRotation}
                durationMs={MODIFIER_SPIN_MS}
                dimmed={showReveal}
              />

              <ItemWheel
                title="Modifiers"
                slices={modifierItemSlices.length ? modifierItemSlices : [EMPTY_MODIFIER_SLICE]}
                rotationDeg={modifierItemRotation}
                durationMs={MODIFIER_SPIN_MS}
                dimmed={showReveal}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleSpinClick} disabled={rolling}>
            {rolling ? 'Spinning...' : 'Spin Roulette'}
          </Button>

          {candidate && showReveal && (
            <>
              <Button variant="success" onClick={accept}>
                Accept
              </Button>

              <Button variant="danger" onClick={vetoAndRespin}>
                Veto & Re-spin
              </Button>
            </>
          )}
        </div>

        {emptyState && <p className="text-sm text-warning">{emptyState}</p>}

        {showReveal && candidate && (
          <div className="animate-date-reveal rounded-xl border border-accent/40 bg-surface-2/80 p-6 text-center">
            <div className="animate-sparkle-float flex items-center justify-center gap-2 text-accent">
              <Sparkles size={20} />
              <Sparkles size={28} />
              <Sparkles size={20} />
            </div>

            <p className="mt-3 text-sm uppercase tracking-widest text-text-3">
              Date selected
            </p>

            <h3 className="glow-accent mt-1 text-3xl font-bold">
              {candidate.date.name}
            </h3>

            <p className="mt-2 text-text-2">
              {candidate.modifiers.length
                ? candidate.modifiers.map((modifier) => modifier.name).join(' · ')
                : 'No modifiers'}
            </p>

            {vetoCount > 0 && (
              <p className="mt-2 text-xs text-warning">
                Vetoes before acceptance: {vetoCount}
              </p>
            )}
          </div>
        )}
      </section>

      <div
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface-1/95 backdrop-blur-md transition-opacity duration-500 ${
          rolling ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex min-h-0 flex-1 items-end pb-8">
          <h2 className="max-w-[92vw] break-words px-6 text-center text-3xl font-bold tracking-wide text-accent drop-shadow-md text-balance md:text-5xl lg:text-6xl">
            {tickerText}
          </h2>
        </div>

        <div className="relative flex aspect-square w-[min(76vw,360px)] flex-none items-center justify-center">
          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
              spinStage === 'date-rarity'
                ? 'scale-110 opacity-100 sm:scale-125'
                : 'pointer-events-none scale-90 opacity-0'
            }`}
          >
            <RarityWheel
              title=""
              weights={rarityWeights}
              rotationDeg={rarityRotation}
              durationMs={DATE_SPIN_MS}
              onPointerChange={handleLivePointerSync}
            />
          </div>

          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
              spinStage === 'date-item'
                ? 'scale-110 opacity-100 sm:scale-125'
                : 'pointer-events-none scale-90 opacity-0'
            }`}
          >
            <ItemWheel
              title=""
              slices={activeDateItemSlices.length ? activeDateItemSlices : [EMPTY_DATE_SLICE]}
              rotationDeg={itemRotation}
              durationMs={DATE_SPIN_MS}
              onPointerChange={handleLivePointerSync}
            />
          </div>

          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
              spinStage === 'mod-rarity'
                ? 'scale-110 opacity-100 sm:scale-125'
                : 'pointer-events-none scale-90 opacity-0'
            }`}
          >
            <RarityWheel
              title=""
              weights={rarityWeights}
              rotationDeg={modifierRarityRotation}
              durationMs={MODIFIER_SPIN_MS}
              onPointerChange={handleLivePointerSync}
            />
          </div>

          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
              spinStage === 'mod-item'
                ? 'scale-110 opacity-100 sm:scale-125'
                : 'pointer-events-none scale-90 opacity-0'
            }`}
          >
            <ItemWheel
              title=""
              slices={
                activeModifierItemSlices.length
                  ? activeModifierItemSlices
                  : [EMPTY_MODIFIER_SLICE]
              }
              rotationDeg={modifierItemRotation}
              durationMs={MODIFIER_SPIN_MS}
              onPointerChange={handleLivePointerSync}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1" />
      </div>

      {showArchiveConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg space-y-4 rounded-3xl border border-border bg-surface-1 p-5">
            <h3 className="text-lg font-semibold">Pending review exists</h3>

            <p className="text-sm text-text-2">
              You haven&apos;t finished reviewing your last date night. If you spin now,
              it&apos;ll be archived without a review. Spin anyway?
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowArchiveConfirm(false)}>
                Cancel
              </Button>

              <Button variant="danger" onClick={() => void confirmArchiveThenSpin()}>
                Spin anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
