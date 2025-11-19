/* ------------------------------------------------------------ */
/* CONFIGURATION: icon mappings and fallbacks for planner events */
/* ------------------------------------------------------------ */
import type { LucideIcon } from 'lucide-react';
import {
  Bike,
  Binoculars,
  Bus,
  CalendarClock,
  Car,
  Footprints,
  Landmark,
  Mountain,
  Plane,
  Ship,
  ShoppingBag,
  Ticket,
  Train,
  TramFront,
  Utensils,
} from 'lucide-react';

import type { ActivityCategory, PlannerEvent, TravelMode } from './types';

const DEFAULT_EVENT_ICON: LucideIcon = CalendarClock;

export const EVENT_ICONS: Record<PlannerEvent['type'], LucideIcon> = {
  block: CalendarClock,
  travel: Plane,
  activity: Mountain,
};

export const CATEGORY_ICONS: Record<ActivityCategory, LucideIcon> = {
  cultural: Landmark,
  sightseeing: Binoculars,
  adventure: Mountain,
  'food-drinks': Utensils,
  show: Ticket,
  shopping: ShoppingBag,
  other: DEFAULT_EVENT_ICON,
};

export const TRAVEL_ICONS: Record<TravelMode, LucideIcon> = {
  flight: Plane,
  taxi: Car,
  rideshare: Car,
  bus: Bus,
  train: Train,
  car: Car,
  boat: Ship,
  subway: TramFront,
  tram: TramFront,
  bike: Bike,
  walk: Footprints,
  other: DEFAULT_EVENT_ICON,
};

export const getEventIcon = (event: PlannerEvent): LucideIcon => {
  if (event.type === 'travel') {
    if (event.travelMode && TRAVEL_ICONS[event.travelMode]) {
      return TRAVEL_ICONS[event.travelMode];
    }
    return EVENT_ICONS.travel;
  }

  if (event.type === 'activity') {
    if (event.category && CATEGORY_ICONS[event.category]) {
      return CATEGORY_ICONS[event.category];
    }
    return EVENT_ICONS.activity;
  }

  return EVENT_ICONS.block ?? DEFAULT_EVENT_ICON;
};
