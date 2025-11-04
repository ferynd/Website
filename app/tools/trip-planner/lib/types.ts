/* ------------------------------------------------------------ */
/* CONFIGURATION: shared unions & TypeScript contracts           */
/* ------------------------------------------------------------ */
import type { Timestamp } from 'firebase/firestore';

export type AddItemMode = 'block' | 'travel' | 'idea' | 'activity';

export type TravelMode =
  | 'flight'
  | 'taxi'
  | 'rideshare'
  | 'bus'
  | 'train'
  | 'car'
  | 'boat'
  | 'subway'
  | 'tram'
  | 'bike'
  | 'walk'
  | 'other';

export interface PlannerSettings {
  incrementMinutes: number;
  visibleHours: { start: number; end: number };
  timezone: string;
}

export interface PlannerDay {
  id: string;
  date: string; // ISO date (YYYY-MM-DD)
  headline?: string;
  notes?: string;
}

export interface PlannerParticipant {
  uid: string;
  displayName: string;
  email?: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface Planner {
  id: string;
  name: string;
  ownerUid: string;
  participantUids: string[];
  participants?: PlannerParticipant[];
  startDate: string;
  endDate: string;
  timezone: string;
  settings: PlannerSettings;
  costTrackerId?: string;
  linkedTripId?: string;
  dayOrder?: string[];
  days?: Record<string, PlannerDay>;
  createdAt: string | Timestamp;
  updatedAt: string | Timestamp;
}

export interface EventBase {
  id: string;
  dayId: string;
  title: string;
  start: string; // ISO timestamp
  end: string; // ISO timestamp
  timezone: string;
  notes?: string;
  images?: string[];
}

export interface EventBlock extends EventBase {
  type: 'block';
}

export interface EventTravel extends EventBase {
  type: 'travel';
  travelMode: TravelMode;
  companyName?: string;
  confirmationCode?: string;
  companyPhone?: string;
}

export interface EventActivity extends EventBase {
  type: 'activity';
  address?: string;
  tags?: string[];
  companyName?: string;
  contact?: string;
}

export type PlannerEvent = EventBlock | EventTravel | EventActivity;

export interface Idea {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  address?: string;
  suggestedDurationMinutes?: number;
  images?: string[];
}

export interface ChangeLogEntry {
  id: string;
  createdAt: string | Timestamp;
  actorUid: string;
  actorEmail?: string;
  action: 'create' | 'update' | 'delete';
  details?: Record<string, unknown>;
}

export interface DaySchedule {
  dayId: string;
  date: string;
  events: PlannerEvent[];
}

export type PlannerEventDraft = {
  id?: string;
  type: PlannerEvent['type'];
  dayId: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  notes?: string;
  recurrence:
    | { mode: 'none' }
    | { mode: 'daily-count'; count: number }
    | { mode: 'daily-until-end' };
  metadata?: Record<string, unknown>;
  images?: string[];
  files?: File[];
  ideaId?: string;
};
