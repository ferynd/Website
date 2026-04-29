import type { ListMember } from '../types';

interface Props {
  members: ListMember[];
  watcherUids: string[];
  size?: 'sm' | 'md';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const COLORS = [
  'bg-accent/30 text-accent',
  'bg-purple/30 text-purple',
  'bg-warning/30 text-warning',
  'bg-success/30 text-success',
  'bg-magenta/30 text-magenta',
];

export default function MemberAvatars({ members, watcherUids, size = 'sm' }: Props) {
  const watchers = members.filter((m) => watcherUids.includes(m.uid));
  if (watchers.length === 0) return null;
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs';

  return (
    <div className="flex -space-x-1.5">
      {watchers.map((m, i) => (
        <span
          key={m.uid}
          title={m.displayName}
          className={`${dim} ${COLORS[i % COLORS.length]} rounded-full flex items-center justify-center font-semibold ring-1 ring-bg`}
        >
          {initials(m.displayName)}
        </span>
      ))}
    </div>
  );
}
