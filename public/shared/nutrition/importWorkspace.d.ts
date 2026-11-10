export function workspaceCapabilities(): Readonly<{ workspace: boolean; photo: false; barcode: false; ocr: false; fit: true; libraryDeepLink: false; directAi: false; save: boolean; exportCopy: true }>;
export const WORKSPACE_STAGES: readonly string[];
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
export function lookupWorkspace(workspace: any, lineIds: string[], attempt?: any): any;
export function packetWorkspace(workspace: any, lineIds: string[], options?: any): Promise<any>;
export function manualWorkspace(workspace: any, lineId: string, nutrients: any): any;
export function incompleteWorkspace(workspace: any): any;
export function calculateWorkspace(workspace: any): any;
export function fitWorkspace(workspace: any): any;
export function reviewWorkspace(workspace: any): any;
export function instructionsWorkspace(): any;
export function saveWorkspace(workspace: any): any;
export function cancelWorkspace(workspace: any): any;
