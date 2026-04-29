// app/tools/date-night/components/Roller/WheelBase.tsx
'use client';

import { useEffect, useMemo, useRef } from 'react';
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
  onPointerChange?: (sliceId: string, label: string) => void;
}

export default function WheelBase({ title, slices, rotationDeg, durationMs, dimmed, onPointerChange }: WheelBaseProps) {
  const laidOut = useMemo(() => describeSlices(slices), [slices]);
  const colors = useMemo(() => getChartColors(), []);
  
  const svgRef = useRef<SVGSVGElement>(null);
  const prevRotationRef = useRef(rotationDeg);
  const currentLabelRef = useRef<string | null>(null);

  // --- Real-time pointer tracking ---
  useEffect(() => {
    if (rotationDeg !== prevRotationRef.current && onPointerChange && svgRef.current) {
      let animationFrameId: number;
      const startTime = Date.now();

      // Reset the current label so the ticker immediately picks up the starting slice
      currentLabelRef.current = null;

      const checkRotation = () => {
        if (!svgRef.current) return;
        const matrix = window.getComputedStyle(svgRef.current).transform;
        
        if (matrix !== 'none') {
          const domMatrix = new DOMMatrix(matrix);
          // Convert 2D matrix to rotation angle
          let currentAngle = Math.atan2(domMatrix.b, domMatrix.a) * (180 / Math.PI);
          if (currentAngle < 0) currentAngle += 360;

          // The pointer is at the top (0 degrees). If wheel rotates clockwise by R, 
          // the slice currently at the top is the one located at (360 - R) degrees.
          const topAngle = (360 - (currentAngle % 360)) % 360;
          
          const activeSlice = laidOut.find(s => topAngle >= s.start && topAngle < s.end) || laidOut[0];

          if (activeSlice && activeSlice.label !== currentLabelRef.current) {
            currentLabelRef.current = activeSlice.label;
            onPointerChange(activeSlice.id, activeSlice.label);
          }
        }

        // Keep looping until the CSS transition duration is fully complete (+ a small buffer)
        if (Date.now() - startTime < durationMs + 100) {
          animationFrameId = requestAnimationFrame(checkRotation);
        }
      };

      animationFrameId = requestAnimationFrame(checkRotation);
      prevRotationRef.current = rotationDeg;

      return () => cancelAnimationFrame(animationFrameId);
    }
  }, [rotationDeg, durationMs, onPointerChange, laidOut]);

  return (
    <div className={`transition-opacity ${title ? 'space-y-2' : ''} ${dimmed ? 'opacity-30' : 'opacity-100'}`}>
      {title && <p className="text-sm font-medium text-text-2">{title}</p>}
      <div className="relative mx-auto w-[320px] max-w-full">
        <div className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-[12px] border-b-[22px] border-x-transparent border-b-accent drop-shadow-md" />
        <svg
          ref={svgRef}
          width={WHEEL_SIZE}
          height={WHEEL_SIZE}
          viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
          className="rounded-full border-2 border-border bg-surface-2 shadow-2xl"
          style={{
            transform: `rotate(${rotationDeg}deg)`,
            transformOrigin: 'center',
            transformBox: 'fill-box',
            transition: `transform ${durationMs}ms ${SPIN_EASING}`,
          }}
        >
          {laidOut.map((slice, index) => {
            const sweep = slice.end - slice.start;
            const angle = slice.center - 90;
            const x = WHEEL_SIZE / 2 + LABEL_RADIUS * Math.cos((angle * Math.PI) / 180);
            const y = WHEEL_SIZE / 2 + LABEL_RADIUS * Math.sin((angle * Math.PI) / 180);
            
            const textRotation = slice.center > 180 && slice.center < 360 
              ? slice.center + 90 
              : slice.center - 90;
              
            const maxChars = sweep < 6 ? 0 : sweep < 12 ? 8 : sweep < 20 ? 12 : 18;
            
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
