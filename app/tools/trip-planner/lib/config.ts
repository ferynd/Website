/* ------------------------------------------------------------ */
/* CONFIGURATION: shared planner defaults and placeholder IDs    */
/* ------------------------------------------------------------ */
export const INCREMENTS = [5, 10, 15, 30, 60, 120, 240] as const;
export const DEFAULT_INCREMENT = 30;
export const DEFAULT_VISIBLE_HOURS = { start: 6, end: 22 } as const;
export const DEFAULT_TIMEZONE = 'America/New_York';
export const SAMPLE_TRIP_ID = 'demo-trip';
