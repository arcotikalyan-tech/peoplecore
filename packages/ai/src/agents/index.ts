import type { AnyAgent } from '../agent.ts';
import { receiptExtraction, resumeExtraction } from './documents.ts';
import { jobDescription } from './job-description.ts';
import { learningGaps } from './learning-gaps.ts';
import { payrollVariance } from './payroll-variance.ts';
import { policyAssistant } from './policy-assistant.ts';
import { reportingCopilot } from './reporting-copilot.ts';
import { selfieReview } from './selfie-review.ts';
import { workforcePlanSummary } from './workforce-plan.ts';

export { policyAssistant, NOT_FOUND, selectPassages, searchTerms, type Passage, type PolicyAnswer } from './policy-assistant.ts';
export { DOCUMENT_TYPES, receiptExtraction, resumeExtraction, type ReceiptResult, type ResumeFields, type ResumeResult } from './documents.ts';
export { inclusiveLanguageWarnings, jobDescription, type JobDescriptionDraft } from './job-description.ts';
export { payrollVariance, type VarianceSummary } from './payroll-variance.ts';
export { COPILOT_TOOLS, reportingCopilot, untracedNumbers, type CopilotAnswer } from './reporting-copilot.ts';
export { learningGaps, type LearningGapsPlan } from './learning-gaps.ts';
export { selfieReview, type SelfieReview } from './selfie-review.ts';
export { workforcePlanSummary, type WorkforcePlanSummary } from './workforce-plan.ts';

/** Every agent, for the registry checks and the eval runner. */
export const AGENTS: Record<string, AnyAgent> = Object.fromEntries(
  [policyAssistant, resumeExtraction, receiptExtraction, jobDescription, reportingCopilot, payrollVariance, workforcePlanSummary, learningGaps, selfieReview].map((a) => [a.key, a]),
);
