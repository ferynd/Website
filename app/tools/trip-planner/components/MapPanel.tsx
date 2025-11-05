'use client';

import { useMemo, useState } from 'react';
import { MapPinned, ChevronDown, ChevronUp, Route, Pin } from 'lucide-react';
import Button from '@/components/Button';
import type { Planner, PlannerEvent } from '../lib/types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: placeholder map dimensions and icon styling    */
/* ------------------------------------------------------------ */
const MAP_HEIGHT = 280;

interface MapPanelProps {
  planner: Planner;
  events: PlannerEvent[];
  activeDayId: string | null;
  onSelectDay: (dayId: string) => void;
}

export default function MapPanel({ planner, events, activeDayId, onSelectDay }: MapPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const dayOrder = planner.dayOrder ?? [];
  const plannerDays = planner.days ?? {};

  const activityCount = useMemo(
    () => events.filter((event) => event.type === 'activity').length,
    [events]
  );
  const travelCount = useMemo(
    () => events.filter((event) => event.type === 'travel').length,
    [events]
  );

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 shadow-md">
      <header className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 text-accent">
            <MapPinned size={20} />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Map preview</h2>
            <p className="text-sm text-text-3">Phase 2 will stream Leaflet + OSM tiles for live routing.</p>
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1"
        >
          {expanded ? (
            <>
              <ChevronUp size={16} /> Collapse
            </>
          ) : (
            <>
              <ChevronDown size={16} /> Expand
            </>
          )}
        </Button>
      </header>
      {expanded && (
        <div className="space-y-5 px-5 py-5">
          <div className="rounded-xl border border-border/60 bg-surface-2/80 p-4 text-sm text-text-3">
            <p>
              Pins and routes will render here using a dynamic import to Leaflet once the data layer is connected. Until then,
              use this summary to understand how many map annotations we can expect.
            </p>
            <ul className="mt-3 space-y-2 text-text-2">
              <li className="flex items-center gap-2">
                <Pin size={16} className="text-accent" /> {activityCount} activities with coordinates
              </li>
              <li className="flex items-center gap-2">
                <Route size={16} className="text-info" /> {travelCount} travel segments for routing
              </li>
            </ul>
          </div>
          <div
            className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-gradient-to-br from-surface-2 to-surface-3 text-center text-sm text-text-3"
            style={{ height: MAP_HEIGHT }}
          >
            <div>
              <p className="font-semibold text-text">Interactive map coming soon</p>
              <p className="mt-2">We will load Leaflet dynamically to keep initial bundle size lean.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {dayOrder.map((dayId) => {
                  const day = plannerDays[dayId];
                  if (!day) {
                    return null;
                  }
                  return (
                    <Button
                      key={dayId}
                      size="sm"
                      variant={activeDayId === dayId ? 'primary' : 'secondary'}
                      onClick={() => onSelectDay(dayId)}
                    >
                      {day.headline ?? day.date}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
