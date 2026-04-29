// app/tools/date-night/components/Roller/ItemWheel.tsx
'use client';

import type { WheelSlice } from '../../lib/types';
import WheelBase from './WheelBase';

/* ------------------------------------------------------------ */
/* CONFIGURATION: generic item wheel wrapper                    */
/* ------------------------------------------------------------ */

interface ItemWheelProps {
  title: string;
  slices: WheelSlice[];
  rotationDeg: number;
  durationMs: number;
  dimmed?: boolean;
  onPointerChange?: (sliceId: string, label: string) => void;
}

export default function ItemWheel({ title, slices, rotationDeg, durationMs, dimmed, onPointerChange }: ItemWheelProps) {
  return <WheelBase title={title} slices={slices} rotationDeg={rotationDeg} durationMs={durationMs} dimmed={dimmed} onPointerChange={onPointerChange} />;
}
