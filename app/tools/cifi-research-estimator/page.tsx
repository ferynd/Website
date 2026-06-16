'use client';

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Nav from '@/components/Nav';
import {
  BarChart2,
  Calculator,
  Flag,
  HelpCircle,
  PlayCircle,
  PlusCircle,
  RotateCcw,
  Target,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: defaults, storage keys, chart dimensions       */
/* ------------------------------------------------------------ */
const APP_STORAGE_KEY = 'website:tools:cifi-research-estimator:v1';
const CHART_CLIP_ID = 'cifi-research-estimator-chart-clip';

const DEFAULTS = {
  rate: '35.67d',
  target: '1.09e39',
  ticksPerCycle: '5',
  secondsPerTick: '2.25',
  modelOverride: 'auto',
  history: [] as HistoryPoint[],
};

const CHART = {
  width: 800,
  height: 280,
  padding: { top: 30, right: 30, bottom: 40, left: 65 },
  maxProjectedSeconds: 3_153_600_000,
  renderSteps: 300,
};

const SUFFIXES = [
  { label: 'k', value: 'k', exponent: 3 },
  { label: 'm', value: 'm', exponent: 6 },
  { label: 'b', value: 'b', exponent: 9 },
  { label: 't', value: 't', exponent: 12 },
  { label: 'Qa', value: 'qa', exponent: 15 },
  { label: 'Qi', value: 'qi', exponent: 18 },
  { label: 'Sx', value: 'sx', exponent: 21 },
  { label: 'Sept', value: 'sept', exponent: 24 },
  { label: 'Oct', value: 'oct', exponent: 27 },
  { label: 'Non', value: 'non', exponent: 30 },
  { label: 'd', value: 'd', exponent: 33 },
  { label: 'Ud', value: 'ud', exponent: 36 },
  { label: 'Dd', value: 'dd', exponent: 39 },
  { label: 'Td', value: 'td', exponent: 42 },
  { label: 'Qad', value: 'qad', exponent: 45 },
  { label: 'Qid', value: 'qid', exponent: 48 },
];

type ModelType = 'linear' | 'exponential' | 'logarithmic' | 'none';
type ChartType = 'rate' | 'cumulative';
type ModelOverride = 'auto' | ModelType;

type HistoryPoint = {
  id: string;
  timestamp: number;
  rateStr: string;
  rateValue: number;
};

type FittedModel = {
  type: ModelType;
  a: number;
  b: number;
  r2: number;
  mape: number;
};

type FitResult = {
  linear: FittedModel;
  exponential: FittedModel;
  logarithmic: FittedModel;
  t0: number;
};

type PlotPoint = {
  xGlobal: number;
  rLin: number;
  rExp: number;
  rLog: number;
  cumLin: number;
  cumExp: number;
  cumLog: number;
};

function parseNumber(value: string) {
  const number = Number(String(value).trim());
  return Number.isFinite(number) ? number : 0;
}

function useStickyState<T>(defaultValue: T, key: string) {
  const [value, setValue] = useState<T>(defaultValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stickyValue = window.localStorage.getItem(key);
      if (stickyValue !== null) setValue(JSON.parse(stickyValue) as T);
    } catch {
      // Storage may be unavailable in private browsing or hardened environments.
    } finally {
      setLoaded(true);
    }
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage may be unavailable in private browsing or hardened environments.
    }
  }, [key, loaded, value]);

  return [value, setValue] as const;
}

function parseScientificString(input: string) {
  if (!input) return { valid: false, error: 'Empty input', value: 0 };
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(e[+-]?\d+|[a-z]+)?$/);

  if (!match) return { valid: false, error: "Invalid format. E.g., '35.67d' or '1.09e39'", value: 0 };

  const mantissa = Number.parseFloat(match[1]);
  if (Number.isNaN(mantissa) || mantissa <= 0) return { valid: false, error: 'Number must be > 0', value: 0 };

  const rawSuffix = match[2] || '';
  let exponent = 0;

  if (rawSuffix.startsWith('e')) {
    exponent = Number.parseInt(rawSuffix.substring(1), 10);
    if (Number.isNaN(exponent)) return { valid: false, error: 'Invalid e-notation', value: 0 };
  } else if (rawSuffix) {
    const found = SUFFIXES.find((s) => s.value === rawSuffix);
    if (!found) return { valid: false, error: `Unknown suffix: '${rawSuffix}'`, value: 0 };
    exponent = found.exponent;
  }

  return { valid: true, mantissa, exponent, value: mantissa * 10 ** exponent };
}

function formatNumber(value: number, decimals = 2) {
  if (!Number.isFinite(value)) return 'Too large to display';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: value < 10 && value > 0 ? Math.min(decimals, 2) : 0,
  });
}

function formatScientific(val: number) {
  if (!Number.isFinite(val) || val <= 0) return '0';
  if (val < 1000) return val.toFixed(1);
  const exponent = Math.floor(Math.log10(val));
  const mantissa = val / 10 ** exponent;
  return `${mantissa.toFixed(2)}e${exponent}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds > CHART.maxProjectedSeconds) return '> 100y';
  const rounded = Math.round(seconds);
  const days = Math.floor(rounded / 86400);
  const hours = Math.floor((rounded % 86400) / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function fitModels(historySubset: HistoryPoint[]): FitResult | null {
  if (!historySubset || historySubset.length < 2) return null;

  const t0 = historySubset[0].timestamp;
  const scaleY = historySubset[0].rateValue || 1;
  const data = historySubset.map((p) => ({ x: (p.timestamp - t0) / 1000, y: p.rateValue / scaleY }));
  const n = data.length;

  function regress(X: number[], Y: number[]) {
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i += 1) {
      sumX += X[i];
      sumY += Y[i];
      sumXY += X[i] * Y[i];
      sumXX += X[i] * X[i];
    }
    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: sumY / n };
    const slope = (n * sumXY - sumX * sumY) / denom;
    return { slope, intercept: (sumY - slope * sumX) / n };
  }

  const meanY = data.reduce((sum, d) => sum + d.y, 0) / n;
  const ssTot = data.reduce((sum, d) => sum + (d.y - meanY) ** 2, 0);

  function getStats(predFn: (x: number) => number) {
    if (ssTot === 0) return { r2: 1, mape: 0 };
    let ssRes = 0;
    let sumPe = 0;
    data.forEach((d) => {
      const pred = predFn(d.x);
      ssRes += (d.y - pred) ** 2;
      sumPe += Math.abs((d.y - pred) / d.y);
    });
    return { r2: Math.max(0, 1 - ssRes / ssTot), mape: (sumPe / n) * 100 };
  }

  const xLinear = data.map((d) => d.x);
  const yLinear = data.map((d) => d.y);
  const linFit = regress(xLinear, yLinear);
  const linStats = getStats((x) => linFit.slope * x + linFit.intercept);

  let expFit = { a: 0, b: 0, r2: 0, mape: 0 };
  if (data.every((d) => d.y > 0)) {
    const yExp = data.map((d) => Math.log(d.y));
    const reg = regress(xLinear, yExp);
    const aExp = Math.exp(reg.intercept);
    const bExp = reg.slope;
    expFit = { a: aExp, b: bExp, ...getStats((x) => aExp * Math.exp(bExp * x)) };
  }

  const xLog = data.map((d) => Math.log(d.x + 1));
  const logFit = regress(xLog, yLinear);
  const logStats = getStats((x) => logFit.slope * Math.log(x + 1) + logFit.intercept);

  return {
    linear: { type: 'linear', a: linFit.slope * scaleY, b: linFit.intercept * scaleY, r2: linStats.r2, mape: linStats.mape },
    exponential: { type: 'exponential', a: expFit.a * scaleY, b: expFit.b, r2: expFit.r2, mape: expFit.mape },
    logarithmic: { type: 'logarithmic', a: logFit.slope * scaleY, b: logFit.intercept * scaleY, r2: logStats.r2, mape: logStats.mape },
    t0,
  };
}

function solveLogarithmic(a: number, bAdjusted: number, tLatest: number, targetVal: number, cycleSeconds: number) {
  let low = 0;
  let high = 1e15;
  function getAccum(tau: number) {
    const u1 = tLatest + 1;
    const u2 = tLatest + tau + 1;
    const val1 = a * (u1 * Math.log(u1) - u1) + bAdjusted * u1;
    const val2 = a * (u2 * Math.log(u2) - u2) + bAdjusted * u2;
    return (val2 - val1) / cycleSeconds;
  }
  if (getAccum(high) < targetVal) return Number.POSITIVE_INFINITY;
  for (let iter = 0; iter < 100; iter += 1) {
    const mid = (low + high) / 2;
    if (Math.abs(high - low) < 0.1) return mid;
    if (getAccum(mid) < targetVal) low = mid;
    else high = mid;
  }
  return low;
}

function getRateAtTime(model: FittedModel | { type: 'none' } | null, xSecs: number) {
  if (!model || model.type === 'none') return 0;
  const { a, b, type } = model;
  if (type === 'linear') return Math.max(0, a * xSecs + b);
  if (type === 'exponential') return a * Math.exp(b * xSecs);
  if (type === 'logarithmic') return Math.max(0, a * Math.log(xSecs + 1) + b);
  return 0;
}

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-border bg-surface-1 shadow-1 ${className}`}>{children}</div>
);

const CardContent = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <div className={`p-5 ${className}`}>{children}</div>;

function Button({
  children,
  onClick,
  className = '',
  variant = 'primary',
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  disabled?: boolean;
  title?: string;
}) {
  const baseClasses = 'inline-flex h-10 items-center justify-center rounded-xl px-4 py-2 font-medium transition focus-ring disabled:cursor-not-allowed disabled:opacity-50';
  const variants = {
    outline: 'border border-border bg-surface-1 text-text shadow-1 hover:bg-surface-2',
    primary: 'bg-accent text-slate-950 shadow-1 hover:bg-accent-600',
    danger: 'border border-error/30 bg-error/10 text-error hover:bg-error/15',
    ghost: 'text-text-2 hover:bg-surface-2 hover:text-text',
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`${baseClasses} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

function InteractiveChart({
  history,
  fits,
  selectedModel,
  chartType,
  cycleSeconds,
  targetValue,
  projectedTime,
}: {
  history: HistoryPoint[];
  fits: FitResult | null;
  selectedModel: FittedModel | { type: 'none' };
  chartType: ChartType;
  cycleSeconds: number;
  targetValue: number;
  projectedTime: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverData, setHoverData] = useState<{ xSvg: number; xCss: number; timeSecs: number; data: PlotPoint; actual?: HistoryPoint } | null>(null);

  const firstHistoryTimestamp = history[0]?.timestamp;
  const globalT0 = firstHistoryTimestamp;
  const t0Fit = fits?.t0 ?? globalT0;
  const elapsedHistorySeconds = history.length > 0 ? (history[history.length - 1].timestamp - globalT0) / 1000 : 0;
  const baseMaxTime = Math.max(60, elapsedHistorySeconds * 1.5);
  const finalMaxTime = projectedTime && projectedTime < CHART.maxProjectedSeconds && projectedTime > 0 ? Math.max(baseMaxTime, projectedTime * 1.05) : baseMaxTime;
  const [viewDomain, setViewDomain] = useState<[number, number]>([0, finalMaxTime]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPx, setDragStartPx] = useState(0);
  const [dragStartDomain, setDragStartDomain] = useState<[number, number]>([0, 1]);

  const { width, height, padding } = CHART;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const getChartRect = useCallback(() => containerRef.current?.getBoundingClientRect(), []);
  const cssXToSvgX = useCallback((cssX: number, rect: DOMRect) => (cssX / rect.width) * width, [width]);
  const clientXToSvgX = useCallback((clientX: number, rect: DOMRect) => cssXToSvgX(clientX - rect.left, rect), [cssXToSvgX]);

  useEffect(() => {
    setViewDomain([0, finalMaxTime]);
  }, [finalMaxTime, history.length, firstHistoryTimestamp]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = getChartRect();
      if (!rect) return;
      const mouseXSvg = clientXToSvgX(event.clientX, rect);
      const pct = Math.max(0, Math.min(1, (mouseXSvg - padding.left) / innerW));
      const zoomFactor = event.deltaY > 0 ? 1.15 : 0.85;

      setViewDomain((prev) => {
        const range = Math.max(1, prev[1] - prev[0]);
        const hoverTime = prev[0] + range * pct;
        const newRange = Math.min(CHART.maxProjectedSeconds, Math.max(1, range * zoomFactor));
        return [hoverTime - newRange * pct, hoverTime + newRange * (1 - pct)];
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [clientXToSvgX, getChartRect, innerW, padding.left]);

  const plotData = useMemo(() => {
    if (!fits || !globalT0 || cycleSeconds <= 0) return [] as PlotPoint[];
    const points: PlotPoint[] = [];
    let cumLin = 0;
    let cumExp = 0;
    let cumLog = 0;
    const calcMaxTime = Math.max(finalMaxTime, viewDomain[1]);
    const dt = calcMaxTime / CHART.renderSteps;

    for (let i = 0; i <= CHART.renderSteps; i += 1) {
      const xGlobal = i * dt;
      const xFit = Math.max(0, xGlobal - (t0Fit - globalT0) / 1000);
      const rLin = getRateAtTime(fits.linear, xFit);
      const rExp = getRateAtTime(fits.exponential, xFit);
      const rLog = getRateAtTime(fits.logarithmic, xFit);
      if (i > 0) {
        cumLin += (rLin / cycleSeconds) * dt;
        cumExp += (rExp / cycleSeconds) * dt;
        cumLog += (rLog / cycleSeconds) * dt;
      }
      points.push({ xGlobal, rLin, rExp, rLog, cumLin, cumExp, cumLog });
    }
    return points;
  }, [cycleSeconds, finalMaxTime, fits, globalT0, t0Fit, viewDomain]);

  if (!history || history.length === 0 || !fits) {
    return <div className="flex h-full items-center justify-center text-sm text-text-3">Add at least two data points to draw forecast curves.</div>;
  }

  let minVal = Infinity;
  let maxVal = -Infinity;
  if (chartType === 'rate') {
    minVal = Math.min(...history.map((h) => h.rateValue)) * 0.8;
    const visiblePlot = plotData.filter((d) => d.xGlobal >= viewDomain[0] && d.xGlobal <= viewDomain[1]);
    if (visiblePlot.length > 0) {
      maxVal = Math.max(...visiblePlot.map((d) => Math.max(d.rLin, d.rExp, d.rLog)));
      const visibleHist = history.filter((h) => {
        const t = (h.timestamp - globalT0) / 1000;
        return t >= viewDomain[0] && t <= viewDomain[1];
      });
      if (visibleHist.length > 0) maxVal = Math.max(maxVal, ...visibleHist.map((h) => h.rateValue));
    }
    maxVal = maxVal !== -Infinity ? maxVal * 1.2 : Math.max(...history.map((h) => h.rateValue)) * 1.5;
  } else {
    minVal = Math.max(1, (history[0]?.rateValue || targetValue * 1e-4) * 0.1);
    maxVal = targetValue * 1.2;
  }

  if (minVal <= 0 || !Number.isFinite(minVal)) minVal = 0.01;
  if (maxVal <= minVal || !Number.isFinite(maxVal)) maxVal = minVal * 10;

  const minLogY = Math.log10(minVal);
  const maxLogY = Math.log10(maxVal);
  const logRange = maxLogY === minLogY ? 1 : maxLogY - minLogY;
  const domainRange = Math.max(1, viewDomain[1] - viewDomain[0]);
  const selectedPrefix = chartType === 'rate' ? 'r' : 'cum';

  const mapX = (xSecs: number) => padding.left + ((xSecs - viewDomain[0]) / domainRange) * innerW;
  const mapY = (yVal: number) => {
    const yL = Math.max(minVal, yVal);
    return padding.top + innerH - ((Math.log10(yL) - minLogY) / logRange) * innerH;
  };
  const getPath = (key: keyof PlotPoint) => {
    const buffer = viewDomain[1] - viewDomain[0];
    const pts = plotData
      .filter((d) => d.xGlobal >= viewDomain[0] - buffer && d.xGlobal <= viewDomain[1] + buffer)
      .filter((d) => Number(d[key]) > 0)
      .map((d) => `${mapX(d.xGlobal)},${mapY(Number(d[key]))}`);
    return pts.length > 0 ? `M ${pts.join(' L ')}` : '';
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(true);
    setDragStartPx(event.clientX);
    setDragStartDomain([...viewDomain] as [number, number]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (isDragging) {
      const rect = getChartRect();
      if (!rect) return;
      const deltaCssPx = event.clientX - dragStartPx;
      const deltaSvgPx = cssXToSvgX(deltaCssPx, rect);
      const range = dragStartDomain[1] - dragStartDomain[0];
      const timeShift = -(deltaSvgPx / innerW) * range;
      setViewDomain([dragStartDomain[0] + timeShift, dragStartDomain[1] + timeShift]);
      setHoverData(null);
      return;
    }
    const rect = getChartRect();
    if (!rect || plotData.length === 0) return;
    const mouseCssX = event.clientX - rect.left;
    const mouseSvgX = cssXToSvgX(mouseCssX, rect);
    if (mouseSvgX < padding.left || mouseSvgX > width - padding.right) {
      setHoverData(null);
      return;
    }
    const timeRatio = (mouseSvgX - padding.left) / innerW;
    const hoveredTimeSecs = viewDomain[0] + timeRatio * domainRange;
    const closest = plotData.reduce((prev, curr) => (Math.abs(curr.xGlobal - hoveredTimeSecs) < Math.abs(prev.xGlobal - hoveredTimeSecs) ? curr : prev));
    const actual = history.find((h) => Math.abs((h.timestamp - globalT0) / 1000 - hoveredTimeSecs) < domainRange * 0.02);
    setHoverData({ xSvg: mouseSvgX, xCss: mouseCssX, timeSecs: closest.xGlobal, data: closest, actual });
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const keyMap = { linear: 'Lin', exponential: 'Exp', logarithmic: 'Log' } as const;
  const xTicks = [0, 1, 2, 3, 4].map((i) => viewDomain[0] + i * (domainRange / 4));

  return (
    <div className="relative h-full w-full cursor-crosshair overflow-hidden" ref={containerRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full select-none font-sans text-xs text-text-3 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (!isDragging) setHoverData(null);
        }}
      >
        <defs>
          <clipPath id={CHART_CLIP_ID}>
            <rect x={padding.left} y={padding.top - 10} width={innerW} height={innerH + 20} />
          </clipPath>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const yPx = padding.top + innerH - pct * innerH;
          const val = 10 ** (minLogY + pct * logRange);
          return (
            <g key={`y-${pct}`}>
              <line x1={padding.left} y1={yPx} x2={width - padding.right} y2={yPx} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" opacity="0.25" />
              <text x={padding.left - 8} y={yPx + 4} textAnchor="end" fill="currentColor">
                {formatScientific(val)}
              </text>
            </g>
          );
        })}

        {xTicks.map((valSecs, i) => (
          <text key={`x-${i}`} x={mapX(valSecs)} y={height - 10} textAnchor="middle" fill="currentColor">
            {formatDuration(valSecs)}
          </text>
        ))}

        <g clipPath={`url(#${CHART_CLIP_ID})`}>
          {chartType === 'cumulative' && targetValue > minVal && (
            <g>
              <line x1={padding.left} y1={mapY(targetValue)} x2={width - padding.right} y2={mapY(targetValue)} stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 4" opacity="0.8" />
              <text x={width - padding.right - 5} y={mapY(targetValue) - 6} textAnchor="end" fill="#f59e0b" fontWeight="bold">
                TARGET GOAL
              </text>
            </g>
          )}

          <path d={getPath(`${selectedPrefix}Lin` as keyof PlotPoint)} fill="none" stroke={selectedModel.type === 'linear' ? '#10b981' : '#64748b'} strokeWidth={selectedModel.type === 'linear' ? 3 : 1.5} strokeDasharray={selectedModel.type === 'linear' ? '' : '4 4'} />
          <path d={getPath(`${selectedPrefix}Exp` as keyof PlotPoint)} fill="none" stroke={selectedModel.type === 'exponential' ? '#10b981' : '#64748b'} strokeWidth={selectedModel.type === 'exponential' ? 3 : 1.5} strokeDasharray={selectedModel.type === 'exponential' ? '' : '4 4'} />
          <path d={getPath(`${selectedPrefix}Log` as keyof PlotPoint)} fill="none" stroke={selectedModel.type === 'logarithmic' ? '#10b981' : '#64748b'} strokeWidth={selectedModel.type === 'logarithmic' ? 3 : 1.5} strokeDasharray={selectedModel.type === 'logarithmic' ? '' : '4 4'} />

          {chartType === 'rate' &&
            history.map((p) => {
              const xSecs = (p.timestamp - globalT0) / 1000;
              if (xSecs < viewDomain[0] || xSecs > viewDomain[1]) return null;
              return <circle key={p.id} cx={mapX(xSecs)} cy={mapY(p.rateValue)} r="4" fill="#38bdf8" stroke="#0f172a" strokeWidth="1.5" />;
            })}
        </g>

        {hoverData && !isDragging && <line x1={hoverData.xSvg} y1={padding.top} x2={hoverData.xSvg} y2={height - padding.bottom} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />}
      </svg>

      {hoverData && !isDragging && (
        <div
          className="pointer-events-none absolute top-4 z-10 w-48 rounded-xl bg-slate-950 p-3 text-xs text-white shadow-2 transition-transform duration-75"
          style={{ left: hoverData.xSvg > width / 2 ? hoverData.xCss - 210 : hoverData.xCss + 15 }}
        >
          <div className="mb-2 border-b border-slate-700 pb-1 font-bold text-slate-300">Time: {formatDuration(hoverData.timeSecs)}</div>
          {hoverData.actual && chartType === 'rate' && (
            <div className="mb-1 flex justify-between font-bold text-sky-400">
              <span>Actual Logged:</span>
              <span>{formatScientific(hoverData.actual.rateValue)}</span>
            </div>
          )}
          <div className="mt-1 space-y-1">
            {(['linear', 'exponential', 'logarithmic'] as const).map((type) => {
              const val = hoverData.data[`${selectedPrefix}${keyMap[type]}` as keyof PlotPoint];
              return (
                <div key={type} className={`flex justify-between ${selectedModel.type === type ? 'font-bold text-emerald-400' : 'text-slate-400'}`}>
                  <span className="capitalize">{type}:</span>
                  <span>{formatScientific(Number(val))}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CifiResearchEstimatorPage() {
  const [rate, setRate] = useStickyState(DEFAULTS.rate, `${APP_STORAGE_KEY}:rate`);
  const [target, setTarget] = useStickyState(DEFAULTS.target, `${APP_STORAGE_KEY}:target`);
  const [ticksPerCycle, setTicksPerCycle] = useStickyState(DEFAULTS.ticksPerCycle, `${APP_STORAGE_KEY}:ticks`);
  const [secondsPerTick, setSecondsPerTick] = useStickyState(DEFAULTS.secondsPerTick, `${APP_STORAGE_KEY}:seconds`);
  const [modelOverride, setModelOverride] = useStickyState<ModelOverride>(DEFAULTS.modelOverride as ModelOverride, `${APP_STORAGE_KEY}:override`);
  const [history, setHistory] = useStickyState<HistoryPoint[]>(DEFAULTS.history, `${APP_STORAGE_KEY}:history`);
  const [baselineId, setBaselineId] = useStickyState<string | null>(null, `${APP_STORAGE_KEY}:baseline`);
  const [backtestId, setBacktestId] = useState<string | null>(null);
  const [activeChartTab, setActiveChartTab] = useState<ChartType>('rate');
  const [showHelper, setShowHelper] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  const parsedRate = parseScientificString(rate);
  const parsedTarget = parseScientificString(target);
  const cycleSeconds = parseNumber(ticksPerCycle) * parseNumber(secondsPerTick);

  const activeHistory = useMemo(() => {
    let startIdx = 0;
    let endIdx = history.length - 1;
    if (baselineId) {
      const idx = history.findIndex((h) => h.id === baselineId);
      if (idx !== -1) startIdx = idx;
    }
    if (backtestId) {
      const idx = history.findIndex((h) => h.id === backtestId);
      if (idx !== -1) endIdx = idx;
    }
    if (startIdx > endIdx) startIdx = endIdx;
    return history.slice(Math.max(0, startIdx), endIdx + 1);
  }, [history, baselineId, backtestId]);

  const fits = useMemo(() => fitModels(activeHistory), [activeHistory]);

  const selectedModel = useMemo<FittedModel | { type: 'none' }>(() => {
    if (!fits || activeHistory.length < 2) return { type: 'none' };
    if (modelOverride && modelOverride !== 'auto') {
      if (modelOverride === 'none') return { type: 'none' };
      return fits[modelOverride] || { type: 'none' };
    }
    let best = fits.linear;
    const threshold = 0.005;
    if (fits.exponential.r2 > best.r2 + threshold) best = fits.exponential;
    if (fits.logarithmic.r2 > best.r2 + threshold) best = fits.logarithmic;
    return best;
  }, [fits, modelOverride, activeHistory.length]);

  const results = useMemo(() => {
    const rawTarget = parsedTarget.valid ? parsedTarget.value : 0;
    const rawRate = parsedRate.valid ? parsedRate.value : 0;
    const staticCycles = rawRate > 0 ? rawTarget / rawRate : 0;
    const staticTotalSeconds = staticCycles * cycleSeconds;
    let dynamicSeconds = staticTotalSeconds;
    let modelApplied: ModelType = 'none';
    let stats: { r2: number; mape: number } | null = null;

    if (activeHistory.length >= 2 && selectedModel.type !== 'none' && cycleSeconds > 0) {
      const t0 = activeHistory[0].timestamp;
      const tLatest = (activeHistory[activeHistory.length - 1].timestamp - t0) / 1000;
      const latestRate = activeHistory[activeHistory.length - 1].rateValue;

      if (selectedModel.type === 'linear') {
        const { a } = selectedModel;
        if (a > 0) {
          const A = 0.5 * a;
          const B = latestRate;
          const C = -rawTarget * cycleSeconds;
          dynamicSeconds = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
        } else if (a === 0) {
          dynamicSeconds = (rawTarget * cycleSeconds) / latestRate;
        } else {
          const maxAccum = (latestRate * latestRate) / (-2 * a * cycleSeconds);
          dynamicSeconds = rawTarget > maxAccum ? Number.POSITIVE_INFINITY : (-latestRate - Math.sqrt(latestRate * latestRate - 4 * (0.5 * a) * (-rawTarget * cycleSeconds))) / a;
        }
        modelApplied = 'linear';
      } else if (selectedModel.type === 'exponential') {
        const { b } = selectedModel;
        if (b > 0) dynamicSeconds = Math.log(1 + (rawTarget * cycleSeconds * b) / latestRate) / b;
        else if (b === 0) dynamicSeconds = (rawTarget * cycleSeconds) / latestRate;
        else {
          const check = 1 + (rawTarget * cycleSeconds * b) / latestRate;
          dynamicSeconds = check <= 0 ? Number.POSITIVE_INFINITY : Math.log(check) / b;
        }
        modelApplied = 'exponential';
      } else if (selectedModel.type === 'logarithmic') {
        const { a } = selectedModel;
        const bAdjusted = latestRate - a * Math.log(tLatest + 1);
        dynamicSeconds = solveLogarithmic(a, bAdjusted, tLatest, rawTarget, cycleSeconds);
        modelApplied = 'logarithmic';
      }
      stats = { r2: selectedModel.r2, mape: selectedModel.mape };
    }

    return {
      staticTotalSeconds,
      dynamicSeconds,
      modelApplied,
      stats,
      isValid: parsedRate.valid && parsedTarget.valid && cycleSeconds > 0,
      targetValue: rawTarget,
    };
  }, [activeHistory, cycleSeconds, parsedRate, parsedTarget, selectedModel]);

  const logCurrentState = () => {
    if (!parsedRate.valid) return;
    const newPoint = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      rateStr: rate,
      rateValue: parsedRate.value,
    };
    setHistory((prev) => [...prev, newPoint]);
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), 2000);
  };

  const deletePoint = (id: string) => {
    setHistory((prev) => prev.filter((p) => p.id !== id));
    if (baselineId === id) setBaselineId(null);
    if (backtestId === id) setBacktestId(null);
  };

  const clearHistory = () => {
    setHistory([]);
    setBaselineId(null);
    setBacktestId(null);
  };

  const reset = () => {
    setRate(DEFAULTS.rate);
    setTarget(DEFAULTS.target);
    setTicksPerCycle(DEFAULTS.ticksPerCycle);
    setSecondsPerTick(DEFAULTS.secondsPerTick);
    setModelOverride(DEFAULTS.modelOverride as ModelOverride);
    clearHistory();
  };

  return (
    <main className="min-h-dvh bg-bg text-text">
      <Nav />
      <div className="mx-auto flex w-full max-w-5xl flex-col space-y-6 p-4 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-2">
              <Calculator className="h-4 w-4 text-accent" />
              CIFI Growth-Forecasting Time Tool
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">CIFI - Research Estimator</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowHelper(true)} variant="outline">
              <HelpCircle className="mr-2 h-4 w-4" /> Suffix Guide
            </Button>
            <Button onClick={reset} variant="outline">
              <RotateCcw className="mr-2 h-4 w-4" /> Reset All
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-5">
                <h2 className="text-lg font-semibold">Configuration</h2>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="flex justify-between text-sm font-medium text-text-2">Target Amount</label>
                    <input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="e.g. 1.09e39 or 1.09dd" className={`w-full rounded-xl border bg-surface-1 px-3 py-2 text-text shadow-1 outline-none transition focus:ring-2 ${!target || parsedTarget.valid ? 'border-border focus:border-accent focus:ring-accent/20' : 'border-error/50 bg-error/10 focus:border-error focus:ring-error/20'}`} />
                    {!parsedTarget.valid && target ? <p className="text-xs text-error">{parsedTarget.error}</p> : null}
                  </div>
                  <div className="space-y-1">
                    <label className="flex justify-between text-sm font-medium text-text-2">Rate per Payout</label>
                    <input value={rate} onChange={(event) => setRate(event.target.value)} placeholder="e.g. 35.67d or 3.5e34" className={`w-full rounded-xl border bg-surface-1 px-3 py-2 text-text shadow-1 outline-none transition focus:ring-2 ${!rate || parsedRate.valid ? 'border-border focus:border-accent focus:ring-accent/20' : 'border-error/50 bg-error/10 focus:border-error focus:ring-error/20'}`} />
                    {!parsedRate.valid && rate ? <p className="text-xs text-error">{parsedRate.error}</p> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-text-2">Ticks per Payout</label>
                      <input type="number" min="0" value={ticksPerCycle} onChange={(event) => setTicksPerCycle(event.target.value)} className="w-full rounded-xl border border-border bg-surface-1 px-3 py-2 text-text shadow-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-text-2">Seconds per Tick</label>
                      <input type="number" min="0" step="0.1" value={secondsPerTick} onChange={(event) => setSecondsPerTick(event.target.value)} className="w-full rounded-xl border border-border bg-surface-1 px-3 py-2 text-text shadow-1 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4">
                <h2 className="flex items-center text-lg font-semibold"><BarChart2 className="mr-2 h-5 w-5 text-accent" />Data Model</h2>
                <Button className="w-full" onClick={logCurrentState} disabled={!parsedRate.valid || cooldown}>
                  <PlusCircle className="mr-2 h-4 w-4" /> {cooldown ? 'Logged!' : 'Log Current Rate'}
                </Button>

                {history.length >= 2 && (
                  <div className="space-y-2 border-t border-border pt-2">
                    <label className="block text-xs font-semibold text-text-2">Forecast Model Override</label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <select value={modelOverride} onChange={(event) => setModelOverride(event.target.value as ModelOverride)} className="w-full rounded-lg border border-border bg-surface-1 p-1.5 text-text outline-none">
                        <option value="auto">Auto (Choose Best Fit)</option>
                        <option value="linear">Force Linear</option>
                        <option value="exponential">Force Exponential</option>
                        <option value="logarithmic">Force Logarithmic</option>
                        <option value="none">None (Constant Rate)</option>
                      </select>
                      <div className="flex items-center rounded-lg border border-border bg-surface-2 p-1.5 text-[10px] text-text-2">
                        {fits ? (
                          <div className="flex w-full justify-between">
                            <div><div className="font-semibold text-text">Fit R²</div><div>Lin: {formatNumber(fits.linear.r2, 3)}</div><div>Exp: {fits.exponential.r2 > 0 ? formatNumber(fits.exponential.r2, 3) : 'N/A'}</div><div>Log: {formatNumber(fits.logarithmic.r2, 3)}</div></div>
                            <div className="text-right"><div className="font-semibold text-text">Err %</div><div>{formatNumber(fits.linear.mape, 1)}%</div><div>{fits.exponential.mape ? `${formatNumber(fits.exponential.mape, 1)}%` : 'N/A'}</div><div>{formatNumber(fits.logarithmic.mape, 1)}%</div></div>
                          </div>
                        ) : 'Calculating...'}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="flex h-full flex-col">
            <CardContent className="flex h-full flex-col justify-between space-y-5">
              <div>
                <h2 className="mb-3 text-lg font-semibold">Time Estimate</h2>
                {results.isValid ? (
                  <div className="space-y-4">
                    <div className="relative overflow-hidden rounded-2xl bg-slate-950 p-5 text-white shadow-inner">
                      <div className="absolute right-4 top-4 text-emerald-400">{results.modelApplied !== 'none' && <TrendingUp className="h-6 w-6 animate-pulse" />}</div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">{backtestId && <span className="mr-1 text-amber-400">[SIMULATION]</span>}{results.modelApplied !== 'none' ? `${results.modelApplied} Projection` : 'Constant Rate'}</div>
                      <div className="mt-2 text-3xl font-bold leading-tight">{formatDuration(results.dynamicSeconds)}</div>
                      {results.modelApplied !== 'none' && results.stats && <div className="mt-2 text-[11px] text-slate-400">{activeHistory.length} points | R²: {(results.stats.r2 * 100).toFixed(1)}% | Err: {results.stats.mape.toFixed(1)}%</div>}
                    </div>
                    <div className="grid gap-3 text-sm">
                      <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3.5"><div className="font-medium text-text-2">Constant Rate Time</div><div className="font-semibold text-text">{formatDuration(results.staticTotalSeconds)}</div></div>
                      {results.modelApplied !== 'none' && <div className="flex items-center justify-between rounded-xl border border-success/25 bg-success/10 p-3.5 text-success"><div className="font-semibold">Time Saved by Growth</div><div className="font-bold">{results.staticTotalSeconds - results.dynamicSeconds > 0 ? formatDuration(results.staticTotalSeconds - results.dynamicSeconds) : '0s'}</div></div>}
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[180px] items-center justify-center rounded-2xl border-2 border-dashed border-border p-6 text-center text-text-3">Please fill out configurations.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="min-h-[450px] flex-1">
          <CardContent className="h-full divide-y divide-border overflow-hidden rounded-2xl p-0 sm:flex sm:divide-x sm:divide-y-0">
            <div className="flex h-full max-h-[450px] flex-col bg-surface-2/40 p-5 sm:w-1/3">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-text">History Ledger</h3>{history.length > 0 && <Button variant="ghost" className="h-6 rounded-md px-2 text-xs text-error hover:bg-error/10" onClick={clearHistory}>Clear</Button>}</div>
              {history.length === 0 ? <div className="flex flex-1 items-center px-4 text-center text-xs text-text-3">Log points above to begin building trends.</div> : (
                <div className="flex-1 space-y-2 overflow-y-auto pr-2">
                  {history.map((pt, i) => {
                    const elapsed = i === 0 ? '0s' : formatDuration((pt.timestamp - history[0].timestamp) / 1000);
                    const isBaseline = baselineId === pt.id;
                    const isBacktest = backtestId === pt.id;
                    const isActive = activeHistory.some((h) => h.id === pt.id);
                    return (
                      <div key={pt.id} className={`rounded-xl border p-2.5 text-xs transition-colors ${isActive ? 'border-border bg-surface-1 shadow-1' : 'border-border bg-surface-2 opacity-60 grayscale'}`}>
                        <div className="mb-1 flex items-center justify-between"><span className="font-bold text-text">Point {i + 1} <span className="ml-1 font-normal text-text-3">({elapsed})</span></span><span className="font-semibold text-success">{pt.rateStr}</span></div>
                        <div className="mt-2 flex gap-1">
                          <Button variant={isBaseline ? 'primary' : 'ghost'} className={`h-6 flex-1 rounded-lg px-1 text-[10px] ${isBaseline ? 'bg-sky-500 hover:bg-sky-600' : 'bg-surface-2'}`} onClick={() => setBaselineId(isBaseline ? null : pt.id)} title="Set as new era baseline"><Flag className="mr-1 h-3 w-3" />Era</Button>
                          <Button variant={isBacktest ? 'primary' : 'ghost'} className={`h-6 flex-1 rounded-lg px-1 text-[10px] ${isBacktest ? 'bg-amber-500 text-slate-950 hover:bg-amber-600' : 'bg-surface-2'}`} onClick={() => setBacktestId(isBacktest ? null : pt.id)} title="Simulate forecast using only points up to here"><PlayCircle className="mr-1 h-3 w-3" />Sim</Button>
                          <Button variant="ghost" className="h-6 w-6 rounded-lg px-0 text-text-3 hover:bg-error/10 hover:text-error" onClick={() => deletePoint(pt.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex h-full min-h-[350px] flex-col bg-surface-1 p-5 sm:w-2/3">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex space-x-1 rounded-xl bg-surface-2 p-1">
                  <button onClick={() => setActiveChartTab('rate')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeChartTab === 'rate' ? 'bg-surface-1 text-text shadow-1' : 'text-text-2 hover:text-text'}`}><TrendingUp className="mr-1.5 inline h-3.5 w-3.5" />Rate Trajectory</button>
                  <button onClick={() => setActiveChartTab('cumulative')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeChartTab === 'cumulative' ? 'bg-surface-1 text-text shadow-1' : 'text-text-2 hover:text-text'}`}><Target className="mr-1.5 inline h-3.5 w-3.5" />Projected Accumulation From Baseline</button>
                </div>
                {backtestId && <span className="rounded-lg bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">Simulating Past</span>}
              </div>

              <div className="mb-2 flex flex-wrap justify-center gap-4 text-[10px] font-semibold text-text-2"><div className="flex items-center"><div className="mr-1.5 h-1 w-3 rounded-full bg-[#10b981]" />Active Model ({selectedModel.type})</div><div className="flex items-center"><div className="mr-1.5 h-1 w-3 rounded-full bg-slate-500" />Other Models</div>{activeChartTab === 'cumulative' && <div className="flex items-center"><div className="mr-1.5 h-1 w-3 rounded-full border-b-2 border-dashed border-amber-500 bg-amber-500" />Baseline Target</div>}</div>
              <div className="relative min-h-[280px] w-full flex-1 rounded-xl border border-border bg-surface-2/40">
                {history.length > 0 ? <InteractiveChart history={activeHistory.length >= 2 ? activeHistory : history} fits={fits} selectedModel={selectedModel} chartType={activeChartTab} cycleSeconds={cycleSeconds} targetValue={results.targetValue} projectedTime={results.dynamicSeconds} /> : <div className="flex h-full items-center justify-center text-sm text-text-3">Waiting for data points...</div>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showHelper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-6 shadow-2">
            <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold">Suffix Dictionary</h3><Button variant="ghost" className="h-8 w-8 px-0" onClick={() => setShowHelper(false)}><X className="h-5 w-5" /></Button></div>
            <div className="grid max-h-[60vh] grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto font-mono text-sm">
              {SUFFIXES.map((s) => <div key={s.value} className="flex justify-between border-b border-border py-1.5"><span className="font-bold text-text">{s.label}</span><span className="text-text-2">e{s.exponent}</span></div>)}
            </div>
            <Button className="mt-6 w-full" onClick={() => setShowHelper(false)}>Close</Button>
          </div>
        </div>
      )}
    </main>
  );
}
