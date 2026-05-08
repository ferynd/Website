import { Timestamp } from 'firebase/firestore';

export type ShowType = 'anime' | 'tv' | 'movie' | 'animated_movie' | 'cartoon';
export type ShowStatus = 'watching' | 'completed' | 'dropped' | 'on_hold' | 'planned';
export type WouldRewatch = 'yes' | 'no' | 'maybe';
export type MemberRole = 'admin' | 'member';

export interface ListMember {
  uid: string;
  email: string;
  displayName: string;
  role: MemberRole;
  joinedAt: Timestamp;
}

export interface ShowList {
  id: string;
  name: string;
  ownerId: string;
  members: ListMember[];
  memberUids: string[];
  adminUids: string[];
  /** Authoritative current display names, keyed by UID. Overrides members[].displayName. */
  memberDisplayNames?: Record<string, string>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MemberRating {
  story: number | null;
  characters: number | null;
  vibes: number | null;
  wouldRewatch: WouldRewatch | null;
  /** 1–5: how much focus this viewer thinks the show requires. Context only — never affects the score. */
  brainPower: number | null;
  ratedAt: Timestamp | null;
}

export interface Show {
  id: string;
  listId: string;
  title: string;
  type: ShowType;
  status: ShowStatus;
  currentSeason: number | null;
  currentEpisode: number | null;
  totalSeasons: number | null;
  service: string | null;
  watchers: string[];
  description: string;
  /** Legacy shared notes field. Prefer memberNotes for new writes. */
  notes: string;
  /** Per-person notes. uid → note text. */
  memberNotes?: Record<string, string>;
  vibeTags: string[];
  /** 1–5: how much focus the show requires. 1 = braindead, 5 = dense. */
  brainPower?: number | null;
  ratings: Record<string, MemberRating>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  lastEditedBy: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  listId: string;
  invitedBy: string;
  createdAt: Timestamp;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
}

export type SortOption = 'updated' | 'score' | 'alpha';
export type FilterStatus = ShowStatus | 'all';
export type FilterType = ShowType | 'all';
