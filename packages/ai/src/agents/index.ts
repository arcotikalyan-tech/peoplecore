import type { AnyAgent } from '../agent.ts';
import { policyAssistant } from './policy-assistant.ts';

export { policyAssistant, NOT_FOUND, selectPassages, searchTerms, type Passage, type PolicyAnswer } from './policy-assistant.ts';

/** Every agent, for the registry checks and the eval runner. */
export const AGENTS: Record<string, AnyAgent> = {
  [policyAssistant.key]: policyAssistant,
};
