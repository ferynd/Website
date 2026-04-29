'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tv, BarChart2, Sparkles, Settings } from 'lucide-react';

const TABS = [
  { href: '/tools/shows',          label: 'Watchlist', icon: Tv },
  { href: '/tools/shows/trends',   label: 'Trends',    icon: BarChart2 },
  { href: '/tools/shows/mood',     label: 'Mood',      icon: Sparkles },
  { href: '/tools/shows/settings', label: 'Settings',  icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface-1/90 backdrop-blur-md">
      <div className="flex">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-colors ${
                active ? 'text-accent' : 'text-text-3 hover:text-text-2'
              }`}
            >
              <Icon size={20} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
