/**
 * CompletenessCalculator
 * ----------------------
 * Pure function: given the latest artifacts for a project, return a
 * 0–100 score and a list of human-readable missing items.
 *
 * The weights below are demo-tuned. The reasoning model (deepseek-v4-pro)
 * produces JSON, and a completeness badge is what shows users whether
 * they're ready to generate a proposal / spec / plan.
 *
 * Heuristics:
 *  - intake must exist  (10%)
 *  - discovery must exist  (15% — penalized if missing_info non-empty
 *                            or risks non-empty)
 *  - clarifications must exist  (10% — proportional to answer ratio)
 *  - scope must exist  (10%)
 *  - estimate must exist  (10%)
 *  - timeline must exist  (5%)
 *  - proposal must exist  (10%)
 *  - specification must exist  (30% — still the heaviest single artifact)
 */

export interface CompletenessInput {
  hasIntake: boolean;
  hasDiscovery: boolean;
  discoveryMissingInfoCount: number;
  discoveryRiskCount: number;
  hasClarifications: boolean;
  clarificationsAnsweredRatio: number;       // 0..1
  hasScope: boolean;
  hasEstimate: boolean;
  hasTimeline: boolean;
  hasProposal: boolean;
  hasSpecification: boolean;
}

export interface CompletenessResult {
  score: number;        // 0..100, integer
  missing: string[];     // human-readable list of what's missing/weak
}

const WEIGHTS = {
  intake: 10,
  discovery: 15,
  clarifications: 10,
  scope: 10,
  estimate: 10,
  timeline: 5,
  proposal: 10,
  specification: 30,
} as const;

export function computeCompleteness(input: CompletenessInput): CompletenessResult {
  const missing: string[] = [];
  let score = 0;

  if (input.hasIntake) score += WEIGHTS.intake;
  else missing.push('intake');

  if (input.hasDiscovery) score += WEIGHTS.discovery;
  else missing.push('discovery');

  if (input.hasDiscovery && input.discoveryMissingInfoCount > 0) {
    // discovery "exists" but didn't finish the job — small penalty
    score = Math.max(0, score - Math.min(WEIGHTS.discovery / 2, input.discoveryMissingInfoCount));
    missing.push(`${input.discoveryMissingInfoCount} discovery missing-info item(s)`);
  }
  if (input.hasDiscovery && input.discoveryRiskCount > 0) {
    // risks are OK to exist, but not addressed
    missing.push(`${input.discoveryRiskCount} unmitigated risk(s)`);
  }

  if (input.hasClarifications) {
    const ratio = Math.max(0, Math.min(1, input.clarificationsAnsweredRatio));
    score += Math.round(WEIGHTS.clarifications * ratio);
    if (ratio < 1) {
      missing.push(`clarification Q&A ${Math.round(ratio * 100)}% answered`);
    }
  } else {
    missing.push('clarifications');
  }

  if (input.hasScope) score += WEIGHTS.scope;
  else missing.push('scope');
  if (input.hasEstimate) score += WEIGHTS.estimate;
  else missing.push('estimate');
  if (input.hasTimeline) score += WEIGHTS.timeline;
  else missing.push('timeline');
  if (input.hasProposal) score += WEIGHTS.proposal;
  else missing.push('proposal');
  if (input.hasSpecification) score += WEIGHTS.specification;
  else missing.push('specification');

  return { score: Math.max(0, Math.min(100, Math.round(score))), missing };
}
