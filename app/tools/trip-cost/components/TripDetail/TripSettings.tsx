"use client";

import React, { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useTrip } from '../../TripContext';
import { CURRENCY_SYMBOL } from '../../constants';
import type { UserProfile, SpendCap, OverageSplit, DefaultSplit } from '../../pageTypes';

export default function TripSettings({
  userProfile,
}: {
  userProfile: UserProfile | null;
}) {
  const {
    trip,
    participants,
    updateSpendCaps,
    updateOverageSplit,
    updateDefaultSplit,
  } = useTrip();

  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Spend cap local state
  const [caps, setCaps] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    (trip?.spendCaps || []).forEach((c) => {
      m[c.participantId] = String(c.maxAmount);
    });
    return m;
  });

  // Overage split local state
  const [overageType, setOverageType] = useState<'even' | 'manual'>(
    trip?.overageSplit?.type || 'even'
  );
  const [overageShares, setOverageShares] = useState<Record<string, string>>(
    () => {
      const m: Record<string, string> = {};
      const shares = trip?.overageSplit?.shares || {};
      Object.entries(shares).forEach(([k, v]) => {
        m[k] = String(v);
      });
      return m;
    }
  );

  // Default split local state
  const [defaultSplitValues, setDefaultSplitValues] = useState<
    Record<string, string>
  >(() => {
    const m: Record<string, string> = {};
    const ds = trip?.defaultSplit || {};
    Object.entries(ds).forEach(([k, v]) => {
      m[k] = String(v);
    });
    return m;
  });

  if (!userProfile?.isAdmin) return null;

  const saveAll = async () => {
    setSaving(true);
    setError('');
    try {
      // Save spend caps
      const spendCaps: SpendCap[] = [];
      for (const [pid, val] of Object.entries(caps)) {
        const n = parseFloat(val);
        if (!Number.isNaN(n) && n > 0) {
          spendCaps.push({ participantId: pid, maxAmount: n });
        }
      }
      await updateSpendCaps(spendCaps);

      // Save overage split
      const overageSplit: OverageSplit = { type: overageType };
      if (overageType === 'manual') {
        const shares: Record<string, number> = {};
        for (const [pid, val] of Object.entries(overageShares)) {
          const n = parseFloat(val);
          if (!Number.isNaN(n) && n > 0) shares[pid] = n;
        }
        overageSplit.shares = shares;
      }
      await updateOverageSplit(overageSplit);

      // Save default split
      const defaultSplit: DefaultSplit = {};
      let totalPct = 0;
      for (const [pid, val] of Object.entries(defaultSplitValues)) {
        const n = parseFloat(val);
        if (!Number.isNaN(n) && n > 0) {
          defaultSplit[pid] = n;
          totalPct += n;
        }
      }
      if (totalPct > 0 && Math.abs(totalPct - 100) > 0.1) {
        setError(`Default split percentages sum to ${totalPct.toFixed(1)}%, must be 100%`);
        setSaving(false);
        return;
      }
      await updateDefaultSplit(defaultSplit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const defaultSplitTotal = Object.values(defaultSplitValues).reduce(
    (s, v) => s + (parseFloat(v) || 0),
    0
  );

  return (
    <section className="bg-surface-1 rounded-lg shadow">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-surface-2 transition-colors"
      >
        <h2 className="text-lg font-semibold text-text">Trip Settings</h2>
        <span className="text-text-3">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-5">
          {/* Default Split */}
          <div>
            <h3 className="text-sm font-semibold text-text mb-1">
              Default Split
            </h3>
            <p className="text-xs text-text-3 mb-2">
              Set default percentage splits for new expenses. Leave blank for
              even splitting.
            </p>
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="flex-1 text-text-2 text-sm">{p.name}</span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="p-1 w-20 text-sm"
                      value={defaultSplitValues[p.id] || ''}
                      onChange={(e) =>
                        setDefaultSplitValues({
                          ...defaultSplitValues,
                          [p.id]: e.target.value,
                        })
                      }
                      placeholder="0"
                    />
                    <span className="text-text-3 text-xs">%</span>
                  </div>
                </div>
              ))}
            </div>
            {defaultSplitTotal > 0 && (
              <div className="mt-1 text-xs text-text-3">
                Total:{' '}
                <span
                  className={
                    Math.abs(defaultSplitTotal - 100) < 0.1
                      ? 'text-success font-medium'
                      : 'text-warning font-medium'
                  }
                >
                  {defaultSplitTotal.toFixed(1)}%
                </span>{' '}
                / 100%
              </div>
            )}
          </div>

          {/* Spend Caps */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-text mb-1">
              Spend Caps
            </h3>
            <p className="text-xs text-text-3 mb-2">
              Set a maximum each person should owe. Overage above the cap is
              redistributed to others.
            </p>
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="flex-1 text-text-2 text-sm">{p.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-text-3 text-xs">
                      {CURRENCY_SYMBOL}
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="p-1 w-24 text-sm"
                      value={caps[p.id] || ''}
                      onChange={(e) =>
                        setCaps({ ...caps, [p.id]: e.target.value })
                      }
                      placeholder="No cap"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Overage Redistribution */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-text mb-1">
              Overage Redistribution
            </h3>
            <p className="text-xs text-text-3 mb-2">
              When someone hits their cap, how is the excess shared?
            </p>
            <div className="flex gap-4 mb-2">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Input
                  type="radio"
                  checked={overageType === 'even'}
                  onChange={() => setOverageType('even')}
                  className="text-accent"
                />
                <span className="text-text-2">
                  Evenly among remaining
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Input
                  type="radio"
                  checked={overageType === 'manual'}
                  onChange={() => setOverageType('manual')}
                  className="text-accent"
                />
                <span className="text-text-2">Custom shares</span>
              </label>
            </div>
            {overageType === 'manual' && (
              <div className="space-y-2 mt-2">
                {participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="flex-1 text-text-2 text-sm">
                      {p.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        className="p-1 w-20 text-sm"
                        value={overageShares[p.id] || ''}
                        onChange={(e) =>
                          setOverageShares({
                            ...overageShares,
                            [p.id]: e.target.value,
                          })
                        }
                        placeholder="0"
                      />
                      <span className="text-text-3 text-xs">%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="p-2 bg-error/10 border border-error/20 text-error rounded text-sm">
              {error}
            </div>
          )}

          <Button
            onClick={saveAll}
            variant="success"
            className="w-full"
            loading={saving}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      )}
    </section>
  );
}
