import type { AnyAgent } from '../agent.ts';
import { receiptExtraction, resumeExtraction } from './documents.ts';
import { jobDescription } from './job-description.ts';
import { policyAssistant } from './policy-assistant.ts';

export { policyAssistant, NOT_FOUND, selectPassages, searchTerms, type Passage, type PolicyAnswer } from './policy-assistant.ts';
export { DOCUMENT_TYPES, receiptExtraction, resumeExtraction, type ReceiptResult, type ResumeFields, type ResumeResult } from './documents.ts';
export { inclusiveLanguageWarnings, jobDescription, type JobDescriptionDraft } from './job-description.ts';

/** Every agent, for the registry checks and the eval runner. */
export const AGENTS: Record<string, AnyAgent> = Object.fromEntries(
  [policyAssistant, resumeExtraction, receiptExtraction, jobDescription].map((a) => [a.key, a]),
);
