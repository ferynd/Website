export function workspaceCapabilities(): Readonly<{ workspace: boolean; photo: false; barcode: false; ocr: false; fit: true; libraryDeepLink: false; directAi: false; save: boolean; exportCopy: true }>;
export const WORKSPACE_STAGES: readonly string[];
/** Exactly `Your existing foods and diary were not changed.` */
export const WORKSPACE_UNCHANGED_NOTICE: 'Your existing foods and diary were not changed.';
/** The export-only save reason; states that the meal was not logged to the diary. */
export const WORKSPACE_SAVE_REASON: 'Export only until ingredient and nutrient writes are approved. This meal was not logged to the diary.';
export function createWorkspace(ownerUid: string): any;
export function importWorkspaceInput(workspace: any, input: any, options?: { kind?: string }): any;
export function correctWorkspaceLine(workspace: any, lineId: string, patch: any): any;
export function matchWorkspace(workspace: any, ports?: any): Promise<any>;
export function confirmWorkspace(workspace: any, lineId: string, variantId: string, ports?: any, options?: any): Promise<any>;
/**
 * Apply a validated research response to the resolution items without writing anything.
 * Each supplied nutrient keeps its full validated object plus `requestId`; each item gains
 * `researchEvidence: { requestId, targetId, verification: 'unverified', sources, unresolved, assumptions }[]`,
 * one record per request. A null value stays null with its validated status.
 */
export function applyResearchResponse(workspace: any, input: any): Promise<any>;
export function packetCopy(packet: any): string;
export function chooseWorkspace(workspace: any, lineId: string, choice: any): any;
/**
 * Records a `not_performed` official attempt (adapter `none`, release null) for each line. No live
 * source is wired; the third argument is ignored so a caller cannot claim `not_found` or `resolved`.
 */
export function lookupWorkspace(workspace: any, lineIds: string[], _attempt?: unknown): any;
export function packetWorkspace(workspace: any, lineIds: string[], options?: any): Promise<any>;
export function manualWorkspace(workspace: any, lineId: string, nutrients: any): any;
export function incompleteWorkspace(workspace: any): any;
export function calculateWorkspace(workspace: any): any;
export function fitWorkspace(workspace: any): any;
export function reviewWorkspace(workspace: any): any;
export function instructionsWorkspace(): any;
/**
 * Save off (either write flag false): a synchronous export-only result with `committed: false` and
 * `save: { available: false, logged: false, reason: WORKSPACE_SAVE_REASON }`.
 * Save on: a Promise of the commit result. With `ports.store` it builds the meal snapshot and calls
 * `ports.store.saveMealVersion()` once (`committed`, `deduped`, `mealRef`, `logged: false`); failures resolve
 * to `ok: false` with `error` (`store_unavailable`, `writes_disabled`, `meal_conflict`, `save_failed`, or a
 * snapshot error with `blockers`) and keep `exportCopy` in both the result and workspace draft.
 * `retained: true` means the pending-save outbox was verified; a failure before queueing returns
 * `retained: false` but still preserves the export copy. Never logs to the diary.
 */
export function saveWorkspace(workspace: any, ports?: any): any;
/** Keeps research jobs, sets `committed: false`, and sets `notice` to `WORKSPACE_UNCHANGED_NOTICE`. */
export function cancelWorkspace(workspace: any): any;
