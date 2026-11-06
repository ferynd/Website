import type { ResearchJob } from './researchJob';

export declare const VALIDATOR_VERSION: number;

export interface ValidationOutcome {
  validatorVersion: number;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  blockedReason: { code: string; needs: string } | null;
}

export declare function validateProposal(
  job: ResearchJob,
  options?: { base?: any }
): Promise<ValidationOutcome>;
