'use client';

import { useMemo } from 'react';
import { Settings } from 'lucide-react';
import Select from '@/components/Select';
import type { PlannerSettings as PlannerSettingsType } from '../lib/types';
import { INCREMENTS } from '../lib/config';

/* ------------------------------------------------------------ */
/* CONFIGURATION: timezones list & hour bounds validation        */
/* ------------------------------------------------------------ */
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

interface PlannerSettingsProps {
  settings: PlannerSettingsType;
  onChange: (patch: Partial<PlannerSettingsType>) => void;
}

export default function PlannerSettings({ settings, onChange }: PlannerSettingsProps) {
  const hoursRange = useMemo(() => Array.from({ length: 24 }, (_, index) => index), []);

  const handleIncrementChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ incrementMinutes: Number(event.target.value) });
  };

  const handleVisibleHourChange = (key: 'start' | 'end', value: number) => {
    const clampedValue = Math.min(23, Math.max(0, value));
    const nextVisible = { ...settings.visibleHours, [key]: clampedValue };
    if (nextVisible.start >= nextVisible.end) {
      nextVisible.end = Math.min(23, nextVisible.start + 1);
    }
    onChange({ visibleHours: nextVisible });
  };

  const handleTimezoneChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ timezone: event.target.value });
  };

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 shadow-md">
      <header className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 text-accent">
          <Settings size={20} />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Planner settings</h2>
          <p className="text-sm text-text-3">Adjust the grid cadence and default timezone.</p>
        </div>
      </header>
      <div className="space-y-6 px-5 py-5">
        <Select label="Increment" value={String(settings.incrementMinutes)} onChange={handleIncrementChange}>
          {INCREMENTS.map((increment) => (
            <option key={increment} value={increment}>
              {increment} minute blocks
            </option>
          ))}
        </Select>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm font-medium text-text-2">
            Visible hour start
            <Select
              value={String(settings.visibleHours.start)}
              onChange={(event) => handleVisibleHourChange('start', Number(event.target.value))}
              className="mt-2"
            >
              {hoursRange.map((hour) => (
                <option key={hour} value={hour}>
                  {hour.toString().padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col text-sm font-medium text-text-2">
            Visible hour end
            <Select
              value={String(settings.visibleHours.end)}
              onChange={(event) => handleVisibleHourChange('end', Number(event.target.value))}
              className="mt-2"
            >
              {hoursRange.map((hour) => (
                <option key={hour} value={hour}>
                  {hour.toString().padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          </label>
        </div>

        <Select label="Timezone" value={settings.timezone} onChange={handleTimezoneChange}>
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </div>
    </section>
  );
}
