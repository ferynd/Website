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
        <div className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-[12px] border-b-[22px] border-x-transparent border-b-accent drop-shadow-md" />
        <svg
          width={WHEEL_SIZE}
          height={WHEEL_SIZE}
          viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
          className="rounded-full border-2 border-border bg-surface-2 shadow-2"
          style={{ transform: `rotate(${rotationDeg}deg)`, transition: `transform ${durationMs}ms ${SPIN_EASING}` }}
        >
          {laidOut.map((slice, index) => {
            const sweep = slice.end - slice.start;
            const angle = slice.center - 90;
            const x = WHEEL_SIZE / 2 + LABEL_RADIUS * Math.cos((angle * Math.PI) / 180);
            const y = WHEEL_SIZE / 2 + LABEL_RADIUS * Math.sin((angle * Math.PI) / 180);
            // Flip rotation for bottom-half slices so text is never upside-down
            const textRotation = slice.center > 90 && slice.center < 270 ? slice.center - 180 : slice.center;
            // Scale max chars to available arc width; hide label on tiny slices
            const maxChars = sweep < 13 ? 0 : sweep < 22 ? 5 : sweep < 34 ? 8 : sweep < 52 ? 13 : 18;
            return (
              <g key={slice.id}>
                <path d={arcPath(slice.start, slice.end)} fill={colors[index % colors.length]} stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />
                <title>{slice.label}</title>
                {maxChars > 0 && (
                  <text
                    x={x}
                    y={y}
                    fill="white"
                    fontSize="11"
                    fontWeight="600"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    stroke="rgba(0,0,0,0.55)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ paintOrder: 'stroke' }}
                    transform={`rotate(${textRotation}, ${x}, ${y})`}
                  >
                    {truncateLabel(slice.label, maxChars)}
                  </text>
                )}
              </g>
            );
          })}
          <circle cx={WHEEL_SIZE / 2} cy={WHEEL_SIZE / 2} r={20} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.08)" strokeWidth={2} />
        </svg>
      </div>
    </div>
  );
}
