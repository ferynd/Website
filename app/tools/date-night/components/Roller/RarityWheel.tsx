// app/tools/date-night/components/Roller/RarityWheel.tsx
'use client';

import type { DateNightRarity } from '../../lib/types';
import WheelBase from './WheelBase';

/* ------------------------------------------------------------ */
/* CONFIGURATION: rarity wheel labels                           */
/* ------------------------------------------------------------ */
const LABELS: Record<DateNightRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  veryRare: 'Very Rare',
};

interface RarityWheelProps {
  weights: Record<DateNightRarity, number>;
  rotationDeg: number;
  durationMs: number;
  dimmed?: boolean;
  title?: string;
  onPointerChange?: (sliceId: string, label: string) => void;
}

export default function RarityWheel({ weights, rotationDeg, durationMs, dimmed, title = 'Rarity wheel', onPointerChange }: RarityWheelProps) {
  const slices = (Object.keys(weights) as DateNightRarity[]).map((tier) => ({
    id: tier,
    label: LABELS[tier],
    weight: Math.max(0.0001, weights[tier]),
  }));

  return <WheelBase title={title} slices={slices} rotationDeg={rotationDeg} durationMs={durationMs} dimmed={dimmed} onPointerChange={onPointerChange} />;
}
