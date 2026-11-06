export declare class PermanentSourceError extends Error {
  constructor(message: string);
}

export declare const STATE_WORDS: readonly string[];
export declare function extractStateWords(text: string): string[];

export interface ParsedFdcNutrient {
  nutrientId: number;
  nutrientNumber: string;
  nutrientName: string;
  unitName: string;
  amount: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  loq: number | null;
  isBelowLoq: boolean;
}

export interface ParsedPortionCandidate {
  kind: 'household' | 'piece';
  unit: string;
  unitQualifier?: string;
  amount: number;
  grams: number;
}

export interface FdcSourceResult {
  type: 'fdc';
  recordId: string;
  fdcId: number;
  dataType: string;
  title: string;
  description: string;
  release: string;
  publishedAt?: string;
  accessedAt: string;
  originalBasis: string;
  permittedUse: string;
  checksum: string;
  nutrients: ParsedFdcNutrient[];
  portions: ParsedPortionCandidate[];
  servingSize: number | null;
  servingSizeUnit: string | null;
  extractedStateWords: string[];
}

export declare function parseFdcFood(
  json: any,
  options?: { release?: string; accessedAt?: string }
): Promise<FdcSourceResult>;
