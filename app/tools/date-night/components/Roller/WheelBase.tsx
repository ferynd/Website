'use client';

import { useMemo } from 'react';
import type { WheelSlice } from '../../lib/types';
import { arcPath, describeSlices, getChartColors, LABEL_RADIUS, truncateLabel, WHEEL_SIZE } from './wheelUtils';

/* ------------------------------------------------------------ */
/* CONFIGURATION: wheel rendering + easing                      */
/* ------------------------------------------------------------ */
const SPIN_EASING = 'cubic-bezier(0.17, 0.67, 0.34, 1)';

interface WheelBaseProps {
  title: string;
  slices: WheelSlice[];
  rotationDeg: number;
  durationMs: number;
  dimmed?: boolean;
}

export default function WheelBase({ title, slices, rotationDeg, durationMs, dimmed }: WheelBaseProps) {
  const laidOut = useMemo(() => describeSlices(slices), [slices]);
  const colors = useMemo(() => getChartColors(), []);

  return (
    <div className={`space-y-2 transition-opacity ${dimmed ? 'opacity-30' : 'opacity-100'}`}>
      <p className="text-sm font-medium text-text-2">{title}</p>
      <div className="relative mx-auto w-[320px]">
        <div className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-[10px] border-b-[18px] border-x-transparent border-b-accent" />
        <svg
          width={WHEEL_SIZE}
          height={WHEEL_SIZE}
          viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
          className="rounded-full border border-border bg-surface-2 shadow-2"
          style={{ transform: `rotate(${rotationDeg}deg)`, transition: `transform ${durationMs}ms ${SPIN_EASING}` }}
        >
          {laidOut.map((slice, index) => {
            const angle = slice.center - 90;
            const x = WHEEL_SIZE / 2 + LABEL_RADIUS * Math.cos((angle * Math.PI) / 180);
            const y = WHEEL_SIZE / 2 + LABEL_RADIUS * Math.sin((angle * Math.PI) / 180);
            return (
              <g key={slice.id}>
                <path d={arcPath(slice.start, slice.end)} fill={colors[index % colors.length]} stroke="rgba(0,0,0,0.2)" strokeWidth={1} />
                <title>{slice.label}</title>
                <text
                  x={x}
                  y={y}
                  fill="white"
                  fontSize="11"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${slice.center}, ${x}, ${y})`}
                >
                  {truncateLabel(slice.label)}
                </text>
              </g>
            );
          })}
          <circle cx={WHEEL_SIZE / 2} cy={WHEEL_SIZE / 2} r={18} fill="rgba(0,0,0,0.35)" />
        </svg>
      </div>
    </div>
  );
}
