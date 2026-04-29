/* ------------------------------------------------------------ */
/* CONFIGURATION: wheel geometry constants                      */
/* ------------------------------------------------------------ */

import type { WheelSlice } from '../../lib/types';

export const WHEEL_SIZE = 320;
export const WHEEL_RADIUS = 152;
export const LABEL_RADIUS = 104;

const polarToCartesian = (cx: number, cy: number, radius: number, angleDeg: number) => {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
};

export const arcPath = (startAngle: number, endAngle: number) => {
  const start = polarToCartesian(WHEEL_SIZE / 2, WHEEL_SIZE / 2, WHEEL_RADIUS, endAngle);
  const end = polarToCartesian(WHEEL_SIZE / 2, WHEEL_SIZE / 2, WHEEL_RADIUS, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${WHEEL_SIZE / 2} ${WHEEL_SIZE / 2} L ${start.x} ${start.y} A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
};

export const describeSlices = (slices: WheelSlice[]) => {
  const total = slices.reduce((sum, slice) => sum + slice.weight, 0) || 1;
  let cursor = 0;
  return slices.map((slice) => {
    const sweep = (slice.weight / total) * 360;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;
    return { ...slice, start, end, center: start + sweep / 2 };
  });
};

export const targetRotationForSlice = (
  slices: WheelSlice[],
  chosenId: string,
  currentRotation: number,
  spinTurns = 6,
) => {
  const laidOut = describeSlices(slices);
  const chosen = laidOut.find((slice) => slice.id === chosenId);
  if (!chosen) return currentRotation;
  const normalized = ((currentRotation % 360) + 360) % 360;
  const delta = spinTurns * 360 + ((360 - chosen.center - normalized + 360) % 360);
  return currentRotation + delta;
};

const CHART_COLORS_FALLBACK = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

export const getChartColors = (): string[] => {
  if (typeof window === 'undefined') return CHART_COLORS_FALLBACK;
  const style = getComputedStyle(document.documentElement);
  return CHART_COLORS_FALLBACK.map((fallback, index) =>
    style.getPropertyValue(`--chart-${index + 1}-hex`).trim() || fallback
  );
};

export const truncateLabel = (text: string, max = 18) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
