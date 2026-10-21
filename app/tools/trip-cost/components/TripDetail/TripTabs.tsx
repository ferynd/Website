"use client";

import React, { useRef, useState } from 'react';

interface TripTabsProps {
  expenses: React.ReactNode;
  participantsSettings: React.ReactNode;
}

const tabs = [
  { id: 'expenses', label: 'Expenses' },
  { id: 'settings', label: 'Participants & Settings' },
] as const;

/** Accessible two-panel navigation for expenses and trip settings. */
export default function TripTabs({ expenses, participantsSettings }: TripTabsProps) {
  const [active, setActive] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const panels = [expenses, participantsSettings];

  const select = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setActive(next);
    buttons.current[next]?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') select(index + 1);
    else if (event.key === 'ArrowLeft') select(index - 1);
    else if (event.key === 'Home') select(0);
    else if (event.key === 'End') select(tabs.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className="min-w-0">
      <div role="tablist" aria-label="Trip sections" className="flex border-b border-border">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { buttons.current[index] = element; }}
            id={`trip-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === index}
            aria-controls={`trip-panel-${tab.id}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`px-4 py-3 text-sm font-medium ${active === index ? 'border-b-2 border-accent text-text' : 'text-text-3'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <section
          key={tab.id}
          id={`trip-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`trip-tab-${tab.id}`}
          hidden={active !== index}
          className={`min-w-0 pt-4 ${index === 1 ? 'space-y-4' : ''}`}
        >
          {panels[index]}
        </section>
      ))}
    </div>
  );
}
