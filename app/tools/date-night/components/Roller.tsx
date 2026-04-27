'use client';

import { useMemo, useState } from 'react';
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
/* CONFIGURATION: spin durations + stage timings               */
/* ------------------------------------------------------------ */
const DATE_SPIN_MS = 2200;
const MODIFIER_SPIN_MS = 900;
const REVEAL_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [showReveal, setShowReveal] = useState(false);

  const rarityWeights = pushRare ? RARE_PUSH_WEIGHTS : settings.rarityWeights;

  const startSpinSequence = async () => {
    setRolling(true);
    setShowReveal(false);
    setEmptyState('');

    const dateRarity = pickRarity(settings, { pushRare });
    const raritySlices: WheelSlice[] = Object.entries(rarityWeights).map(([id, weight]) => ({ id, label: id, weight }));
    const nextRarityRotation = targetRotationForSlice(raritySlices, dateRarity, rarityRotation);
    setRarityRotation(nextRarityRotation);
    await sleep(DATE_SPIN_MS);

    const chosenDate = pickItemByRarity(dates, dateRarity, settings, { overrideFrequency, pushRare });
    if (!chosenDate) {
      setEmptyState("Everything is on cooldown right now. Try override frequency or add more ideas.");
      setRolling(false);
      return;
    }

    const dateSlicePool = dates
      .filter((item) => item.rarity === chosenDate.rarity)
      .map((item) => ({ id: item.id, label: item.name, weight: effectiveWeight(item, settings, { overrideFrequency }) }))
      .filter((slice) => slice.weight > 0);

    if (!dateSlicePool.length) {
      setEmptyState('No eligible date ideas in the selected tier.');
      setRolling(false);
      return;
    }

    const nextItemRotation = targetRotationForSlice(dateSlicePool, chosenDate.id, itemRotation);
    setItemRotation(nextItemRotation);
    await sleep(DATE_SPIN_MS);

    let selectedModifiers: RollCandidate['modifiers'] = [];
    if (!noModifier && modifiers.length) {
      const desiredCount = pickModifierCount(settings, higherStacking);
      selectedModifiers = pickDistinctModifiers(modifiers, settings, desiredCount, { pushRare, overrideFrequency });

      if (selectedModifiers.length > 0) {
        let runningRarityRotation = modifierRarityRotation;
        let runningItemRotation = modifierItemRotation;
        const raritySlicesMod: WheelSlice[] = Object.entries(rarityWeights).map(([id, weight]) => ({ id, label: id, weight }));

        for (const selectedModifier of selectedModifiers) {
          const modRarity = selectedModifier.rarity;
          runningRarityRotation = targetRotationForSlice(raritySlicesMod, modRarity, runningRarityRotation, 3);
          setModifierRarityRotation(runningRarityRotation);
          await sleep(MODIFIER_SPIN_MS);

          const modPool = modifiers
            .filter((item) => item.rarity === modRarity)
            .map((item) => ({ id: item.id, label: item.name, weight: effectiveWeight(item, settings, { overrideFrequency }) }))
            .filter((slice) => slice.weight > 0);

          if (modPool.length) {
            runningItemRotation = targetRotationForSlice(modPool, selectedModifier.id, runningItemRotation, 3);
            setModifierItemRotation(runningItemRotation);
            await sleep(MODIFIER_SPIN_MS);
          }
        }
      }
    }

    setCandidate({ date: chosenDate, modifiers: selectedModifiers, modifierCountRequested: selectedModifiers.length });
    await sleep(REVEAL_DELAY_MS);
    setShowReveal(true);
    setRolling(false);
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
  };

  const vetoAndRespin = async () => {
    if (!candidate) return;
    await recordVeto(candidate);
    setVetoCount((prev) => prev + 1);
    await startSpinSequence();
  };

  const dateItemSlices = useMemo(() => {
    return dates
      .map((item) => ({ id: item.id, label: item.name, weight: effectiveWeight(item, settings, { overrideFrequency }) }))
      .filter((slice) => slice.weight > 0);
  }, [dates, overrideFrequency, settings]);

  const modifierItemSlices = useMemo(() => {
    return modifiers
      .map((item) => ({ id: item.id, label: item.name, weight: effectiveWeight(item, settings, { overrideFrequency }) }))
      .filter((slice) => slice.weight > 0);
  }, [modifiers, overrideFrequency, settings]);

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md space-y-4">
      <h2 className="text-xl font-semibold">Roller</h2>
      <div className="grid sm:grid-cols-2 gap-2 text-sm">
        <label><input type="checkbox" checked={noModifier} onChange={(e) => setNoModifier(e.target.checked)} /> No modifier</label>
        <label><input type="checkbox" checked={higherStacking} onChange={(e) => setHigherStacking(e.target.checked)} /> Higher stacking</label>
        <label><input type="checkbox" checked={pushRare} onChange={(e) => setPushRare(e.target.checked)} /> Push rare stuff</label>
        <label><input type="checkbox" checked={overrideFrequency} onChange={(e) => setOverrideFrequency(e.target.checked)} /> Override frequency</label>
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <RarityWheel weights={rarityWeights} rotationDeg={rarityRotation} durationMs={DATE_SPIN_MS} dimmed={showReveal} />
        <ItemWheel title="Date item wheel" slices={dateItemSlices.length ? dateItemSlices : [{ id: 'empty', label: 'No eligible items', weight: 1 }]} rotationDeg={itemRotation} durationMs={DATE_SPIN_MS} dimmed={showReveal} />
      </div>
      {!noModifier && (
        <div className="grid xl:grid-cols-2 gap-6">
          <RarityWheel weights={rarityWeights} rotationDeg={modifierRarityRotation} durationMs={MODIFIER_SPIN_MS} dimmed={showReveal} />
          <ItemWheel title="Modifier item wheel" slices={modifierItemSlices.length ? modifierItemSlices : [{ id: 'empty', label: 'No eligible modifiers', weight: 1 }]} rotationDeg={modifierItemRotation} durationMs={MODIFIER_SPIN_MS} dimmed={showReveal} />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSpinClick} disabled={rolling}>{rolling ? 'Spinning...' : 'Spin Roulette'}</Button>
        {candidate && showReveal && (
          <>
            <Button variant="success" onClick={accept}>Accept</Button>
            <Button variant="danger" onClick={vetoAndRespin}>Veto & Re-spin</Button>
          </>
        )}
      </div>

      {emptyState && <p className="text-sm text-warning">{emptyState}</p>}

      {showReveal && candidate && (
        <div className="rounded-xl border border-accent/40 bg-surface-2/80 p-6 text-center animate-date-reveal">
          <div className="flex items-center justify-center gap-2 text-accent animate-sparkle-float">
            <Sparkles size={20} /><Sparkles size={28} /><Sparkles size={20} />
          </div>
          <p className="mt-3 text-sm uppercase tracking-widest text-text-3">Date selected</p>
          <h3 className="text-3xl font-bold glow-accent mt-1">{candidate.date.name}</h3>
          <p className="mt-2 text-text-2">{candidate.modifiers.length ? candidate.modifiers.map((mod) => mod.name).join(' · ') : 'No modifiers'}</p>
          {vetoCount > 0 && <p className="mt-2 text-xs text-warning">Vetoes before acceptance: {vetoCount}</p>}
        </div>
      )}

      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-xl3 border border-border bg-surface-1 p-5 space-y-4">
            <h3 className="text-lg font-semibold">Pending review exists</h3>
            <p className="text-sm text-text-2">You haven&apos;t finished reviewing your last date night. If you spin now, it&apos;ll be archived without a review. Spin anyway?</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowArchiveConfirm(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => void confirmArchiveThenSpin()}>Spin anyway</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
