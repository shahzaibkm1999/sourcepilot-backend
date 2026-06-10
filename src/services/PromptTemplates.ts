/**
 * PromptTemplates
 * ---------------
 * Centralized prompt library for every SourcePilot stage that calls
 * DeepSeek. Each stage exports:
 *   - `system`:  the system prompt
 *   - `user`:    a function that builds the user message from the
 *                inputs the stage received
 *   - `schema`:  a Zod schema for parsing the JSON the model returns
 *                (used by `parseStageJson`)
 *
 * Keeping prompts in one file means prompt engineering happens in
 * one place — we can iterate without touching the orchestrator.
 *
 * The reasoning model (deepseek-v4-pro) spends ~200-500 tokens on
 * internal thinking before the visible answer. Generous `maxOutputTokens`
 * is the orchestrator's job, not the template's.
 */

import { z } from 'zod';
import { Intake } from '../models/IntakeModel';

// ============================================================
//  Stage: Discovery
// ============================================================
// Takes an intake + previously saved clarifications (if any) and
// surfaces ambiguities, missing information, risks, and assumptions.
//
// Output shape (JSON, validated by `DiscoverySchema`):
//   { ambiguities: [...], missing_info: [...], risks: [...], assumptions: [...], content: string }

export const DISCOVERY_SYSTEM = `You are a senior product analyst inside SourcePilot,
a project-operating system used by software agencies.

Given a client requirement and any prior clarifications, produce a
JSON object (and ONLY a JSON object — no prose, no markdown fences)
describing what is ambiguous, what is missing, what could go wrong,
and what assumptions a senior PM would make. Then a Markdown view
for the dashboard.

Output shape (exact keys):
{
  "ambiguities": [
    { "area": "<category, e.g. 'Users'>",
      "question": "<one-sentence question the PM should ask the client>",
      "priority": "low" | "medium" | "high" }
  ],
  "missing_info": [
    "<a concrete piece of information still missing, e.g. 'expected concurrent users'>"
  ],
  "risks": [
    { "title": "<one-line risk title>",
      "severity": "low" | "medium" | "high",
      "mitigation": "<one-sentence mitigation, may be empty string>" }
  ],
  "assumptions": [
    "<a bounded assumption, e.g. 'Single-tenant deployment in client's Azure tenant'>"
  ],
  "content": "<full Markdown summary for the dashboard, in three sections: ## Ambiguities, ## Missing Information, ## Risks & Assumptions>"
}

Rules:
- At least 2 ambiguities, 2 missing items, 1 risk, 2 assumptions.
- Be specific. "Need more details" is not a useful missing item.
- Severities are honest: not every risk is high.
- The Markdown "content" mirrors the JSON; do not include new facts in Markdown that aren't in JSON.`;

export const DiscoverySchema = z.object({
  ambiguities: z
    .array(
      z.object({
        area: z.string().min(1).max(80),
        question: z.string().min(1).max(280),
        priority: z.enum(['low', 'medium', 'high']),
      }),
    )
    .min(2),
  missing_info: z.array(z.string().min(1).max(280)).min(2),
  risks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        severity: z.enum(['low', 'medium', 'high']),
        mitigation: z.string().max(400),
      }),
    )
    .min(1),
  assumptions: z.array(z.string().min(1).max(280)).min(2),
  content: z.string().min(20),
});
export type DiscoveryOutput = z.infer<typeof DiscoverySchema>;

export function buildDiscoveryUserPrompt(input: {
  intake: Intake;
  answeredClarifications?: { area: string; question: string; answer: string }[];
}): string {
  const parts: string[] = [
    `## Client requirement`,
    input.intake.requirement,
    ``,
    `## Metadata`,
    `- Project type: ${input.intake.project_type ?? 'unspecified'}`,
    `- Engagement: ${input.intake.engagement ?? 'unspecified'}`,
    `- Timeline preference: ${input.intake.timeline_pref ?? 'unspecified'}`,
  ];
  if (input.intake.details) {
    parts.push(``, `## Additional details`, input.intake.details);
  }
  if (input.intake.constraints) {
    parts.push(``, `## Constraints`, input.intake.constraints);
  }
  if (input.answeredClarifications && input.answeredClarifications.length > 0) {
    parts.push(
      ``,
      `## Already-answered clarifications`,
      ...input.answeredClarifications.flatMap((c) => [
        `- **${c.area}** — Q: ${c.question}`,
        `  A: ${c.answer}`,
      ]),
    );
  }
  parts.push(
    ``,
    `Return the JSON object described in the system prompt. Do not wrap it in markdown fences.`,
  );
  return parts.join('\n');
}

// ============================================================
//  Stage: Clarification (question generator)
// ============================================================
// When the user clicks "Generate Clarifications" we ask DeepSeek to
// produce a small set of high-impact questions the client should
// answer before we draft a scope / estimate / proposal.

export const CLARIFICATION_SYSTEM = `You are a senior product analyst inside SourcePilot.
Given a client requirement, previous discovery, and any prior Q&A,
produce the *next* batch of high-impact questions for the client.

Output shape (exact keys, JSON only — no markdown fences):
{
  "questions": [
    { "id": "<kebab-case-id, unique within this batch>",
      "area": "<category, e.g. 'Users' | 'Scope' | 'Compliance' | 'Timeline' | 'Integrations'>",
      "question": "<one-sentence, plain-language question>",
      "status": "pending" }
  ],
  "refined_input": "<a refined version of the original requirement, incorporating every ANSWERED question (NOT the new pending ones) so the user can see how their answers are reshaping the brief. If no answers yet, return the original requirement unchanged.>"
}

Rules:
- At most 5 questions per batch.
- Skip questions that are already answered.
- Skip trivial questions the client would consider "obvious".
- Each question must be answerable in one or two sentences.
- Each id must be unique within the batch.`;

export const ClarificationItemSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'id must be kebab-case'),
  area: z.string().min(1).max(60),
  question: z.string().min(1).max(280),
  status: z.literal('pending'),
});
export const ClarificationBatchSchema = z.object({
  questions: z.array(ClarificationItemSchema).min(1).max(5),
  refined_input: z.string().min(10),
});
export type ClarificationBatchOutput = z.infer<typeof ClarificationBatchSchema>;

// ============================================================
//  Stage: Scope
// ============================================================
// Takes the full chain (intake + discovery + answered clarifications)
// and produces the in/out/future scope, plus dependencies, risks,
// assumptions. The Markdown "content" is what the dashboard renders.

export const SCOPE_SYSTEM = `You are a senior solutions architect inside SourcePilot.
Given a client requirement, a discovery analysis, and answered
clarifications, produce a JSON scope document (and ONLY a JSON
object — no prose, no markdown fences) with these exact keys:

{
  "in_scope": [ "<one-line capability the team WILL build, e.g. 'Web portal for time-off requests'>" ],
  "out_of_scope": [ "<one-line thing the team WILL NOT build, e.g. 'Payroll processing'>" ],
  "future_considerations": [ "<one-line thing to revisit in a later phase>" ],
  "dependencies": [ "<one-line external dependency, e.g. 'Workday REST API access with OAuth2 credentials'>" ],
  "assumptions": [ "<one-line bounded assumption, e.g. 'Single-tenant Azure deployment'>" ],
  "risks": [ "<one-line scoped risk, e.g. 'Workday API rate limits could degrade UX during peak'>" ],
  "content": "<full Markdown summary in five sections: ## In Scope, ## Out of Scope, ## Future Considerations, ## Dependencies, ## Assumptions & Risks>"
}

Rules:
- At least 3 items per array.
- Items must be concrete and testable. "TBD" is not acceptable.
- Markdown "content" must mirror the JSON exactly — no new facts in Markdown that aren't in JSON.
- In/out are the most important: be decisive about boundaries.`;

export const ScopeSchema = z.object({
  in_scope: z.array(z.string().min(1).max(280)).min(3),
  out_of_scope: z.array(z.string().min(1).max(280)).min(3),
  future_considerations: z.array(z.string().min(1).max(280)).min(1),
  dependencies: z.array(z.string().min(1).max(280)).min(1),
  assumptions: z.array(z.string().min(1).max(280)).min(2),
  risks: z.array(z.string().min(1).max(280)).min(1),
  content: z.string().min(20),
});
export type ScopeOutput = z.infer<typeof ScopeSchema>;

export function buildScopeUserPrompt(input: {
  intake: Intake;
  discovery: { ambiguities: { area: string; question: string }[]; risks: { title: string; severity: string }[] };
  answeredClarifications: { area: string; question: string; answer: string }[];
}): string {
  const parts: string[] = [
    `## Client requirement`,
    input.intake.requirement,
    ``,
    `## Metadata`,
    `- Project type: ${input.intake.project_type ?? 'unspecified'}`,
    `- Engagement: ${input.intake.engagement ?? 'unspecified'}`,
    `- Timeline preference: ${input.intake.timeline_pref ?? 'unspecified'}`,
  ];
  if (input.intake.details) parts.push(``, `## Additional details`, input.intake.details);
  if (input.intake.constraints) parts.push(``, `## Constraints`, input.intake.constraints);
  parts.push(
    ``,
    `## Discovered ambiguities`,
    ...input.discovery.ambiguities.map((a) => `- [${a.area}] ${a.question}`),
    ``,
    `## Risks from discovery`,
    ...input.discovery.risks.map((r) => `- [${r.severity}] ${r.title}`),
    ``,
    `## Answered clarifications`,
    ...(input.answeredClarifications.length > 0
      ? input.answeredClarifications.flatMap((c) => [
          `- [${c.area}] Q: ${c.question}`,
          `  A: ${c.answer}`,
        ])
      : ['(none answered yet — proceed with the information you have)']),
    ``,
    `Return the JSON object described in the system prompt. Do not wrap it in markdown fences.`,
  );
  return parts.join('\n');
}

// ============================================================
//  Stage: Estimate
// ============================================================
// Breaks the project into effort items by area (Discovery / UX /
// Frontend / Backend / Database / QA / Deployment) and returns hours,
// complexity, confidence, plus a budget range (fixed price) or
// billable-hours range (hourly) depending on engagement.

export const ESTIMATE_SYSTEM = `You are a senior engineering manager inside SourcePilot.
Given a scope and a client engagement model, produce a JSON estimate
(and ONLY a JSON object — no prose, no markdown fences) with these
exact keys:

{
  "items": [
    {
      "area": "<one of: 'Discovery' | 'UX/UI Design' | 'Frontend' | 'Backend' | 'Database' | 'QA' | 'Deployment' | 'Project Management'>",
      "hours": <integer, low estimate>,
      "high_hours": <integer, high estimate — same as 'hours' if you're confident>,
      "complexity": "low" | "medium" | "high",
      "confidence": "low" | "medium" | "high"
    }
  ],
  "currency": "USD",
  "hourly_rate_low": <integer, if engagement is hourly, e.g. 150>,
  "hourly_rate_high": <integer, e.g. 200>,
  "fixed_low": <integer, total fixed-price LOW end in currency>,
  "fixed_high": <integer, total fixed-price HIGH end in currency>,
  "risk_buffer_percent": <integer 0-30, e.g. 15>,
  "content": "<Markdown summary table by area, with totals and assumptions>"
}

Rules:
- Always include ALL standard areas. Set hours=0 only if truly not applicable.
- For 'fixed_price' engagement: populate fixed_low/high + risk_buffer_percent; set hourly fields to 0.
- For 'hourly' engagement: populate hourly_rate_low/high; set fixed fields to 0.
- Markdown 'content' must include a totals row and a 1-line confidence note.
- Be honest: junior-dev rates are $80-120/hr in USD, senior $150-250/hr, principal $250-400/hr.
  Pick a blended rate appropriate for the project complexity.`;

export const EstimateItemSchema = z.object({
  area: z.enum([
    'Discovery',
    'UX/UI Design',
    'Frontend',
    'Backend',
    'Database',
    'QA',
    'Deployment',
    'Project Management',
  ]),
  hours: z.number().int().nonnegative(),
  high_hours: z.number().int().nonnegative(),
  complexity: z.enum(['low', 'medium', 'high']),
  confidence: z.enum(['low', 'medium', 'high']),
});
export const EstimateSchema = z.object({
  items: z.array(EstimateItemSchema).min(3),
  currency: z.string().default('USD'),
  hourly_rate_low: z.number().int().nonnegative().default(0),
  hourly_rate_high: z.number().int().nonnegative().default(0),
  fixed_low: z.number().int().nonnegative().default(0),
  fixed_high: z.number().int().nonnegative().default(0),
  risk_buffer_percent: z.number().int().min(0).max(50).default(15),
  content: z.string().min(20),
});
export type EstimateOutput = z.infer<typeof EstimateSchema>;

export function buildEstimateUserPrompt(input: {
  intake: Pick<Intake, 'engagement' | 'timeline_pref' | 'project_type'>;
  scope: { in_scope: string[]; out_of_scope: string[]; dependencies: string[] };
  answeredClarifications: { area: string; question: string; answer: string }[];
}): string {
  const eng = input.intake.engagement ?? 'fixed_price';
  return [
    `## Engagement model`,
    eng,
    ``,
    `## Timeline preference`,
    input.intake.timeline_pref ?? 'unspecified',
    ``,
    `## In scope`,
    ...input.scope.in_scope.map((s) => `- ${s}`),
    ``,
    `## Out of scope (do not estimate these)`,
    ...input.scope.out_of_scope.map((s) => `- ${s}`),
    ``,
    `## Dependencies`,
    ...input.scope.dependencies.map((d) => `- ${d}`),
    ``,
    `## Answered clarifications (key context)`,
    ...(input.answeredClarifications.length > 0
      ? input.answeredClarifications.flatMap((c) => [
          `- [${c.area}] Q: ${c.question}`,
          `  A: ${c.answer}`,
        ])
      : ['(none)']),
    ``,
    eng === 'hourly'
      ? `Produce an HOURLY estimate. Set hourly_rate_low/high. Set fixed_low/high to 0.`
      : `Produce a FIXED-PRICE estimate. Set fixed_low/high + risk_buffer_percent. Set hourly_rate_* to 0.`,
    `Return the JSON object described in the system prompt. Do not wrap it in markdown fences.`,
  ].join('\n');
}

// ============================================================
//  Stage: Timeline
// ============================================================

export const TIMELINE_SYSTEM = `You are a senior engineering manager inside SourcePilot.
Given a scope and an effort estimate, produce a JSON project timeline
(and ONLY a JSON object — no prose, no markdown fences) with these
exact keys:

{
  "phases": [
    {
      "name": "<one of: 'Discovery' | 'Planning' | 'Design' | 'Development' | 'Testing' | 'Deployment' | 'Hardening'>",
      "duration_weeks": <integer, >= 1>,
      "milestones": [ "<one-line deliverable, e.g. 'Approved technical design'>" ],
      "dependencies": [ "<name of the phase this depends on, e.g. 'Discovery'>" ]
    }
  ],
  "total_weeks": <integer, sum of phase durations>,
  "content": "<Markdown summary with a horizontal timeline of the phases + a milestone list>"
}

Rules:
- Phases run in dependency order: Discovery -> Planning -> Design -> Development -> Testing -> Deployment -> Hardening.
- 'dependencies' should list the phase name(s) this phase is blocked on (e.g. Development depends on Design).
- 'milestones' is a flat list of one-line, verifiable deliverables.
- 'total_weeks' must equal the sum of phase durations.
- A realistic MVP with 3 standard areas is 8-14 weeks. Add a Hardening phase (~10% of total) before go-live.
- Markdown 'content' must include a milestone checklist at the end.`;

export const TimelinePhaseSchema = z.object({
  name: z.string().min(1).max(60),
  duration_weeks: z.number().int().min(1).max(104),
  milestones: z.array(z.string().min(1).max(200)).min(1),
  dependencies: z.array(z.string().min(1).max(60)),
});
export const TimelineSchema = z.object({
  phases: z.array(TimelinePhaseSchema).min(3).max(10),
  total_weeks: z.number().int().min(1).max(520),
  content: z.string().min(20),
}).refine(
  (t) => t.phases.reduce((sum, p) => sum + p.duration_weeks, 0) === t.total_weeks,
  { message: 'total_weeks must equal the sum of phase duration_weeks' },
);
export type TimelineOutput = z.infer<typeof TimelineSchema>;

export function buildTimelineUserPrompt(input: {
  timelinePref: string | null;
  totalHoursLow: number;
  totalHoursHigh: number;
  scope: { in_scope: string[] };
  answeredClarifications: { area: string; question: string; answer: string }[];
}): string {
  return [
    `## Timeline preference from client`,
    input.timelinePref ?? 'flexible',
    ``,
    `## Total estimated effort`,
    `${input.totalHoursLow} – ${input.totalHoursHigh} hours`,
    ``,
    `## In scope (recap)`,
    ...input.scope.in_scope.map((s) => `- ${s}`),
    ``,
    `## Answered clarifications (timing context)`,
    ...(input.answeredClarifications.length > 0
      ? input.answeredClarifications.flatMap((c) => [
          `- [${c.area}] Q: ${c.question}`,
          `  A: ${c.answer}`,
        ])
      : ['(none)']),
    ``,
    `Produce the JSON timeline described in the system prompt. Do not wrap it in markdown fences.`,
  ].join('\n');
}

export function buildClarificationUserPrompt(input: {
  intake: Intake;
  latestDiscovery: { ambiguities: { area: string; question: string }[] } | null;
  priorQa: { area: string; question: string; answer: string }[];
}): string {
  const parts: string[] = [
    `## Client requirement`,
    input.intake.requirement,
    ``,
  ];
  if (input.intake.details) {
    parts.push(`## Additional details`, input.intake.details, ``);
  }
  if (input.latestDiscovery) {
    parts.push(
      `## Known ambiguities from Discovery (do NOT re-ask these)`,
      ...input.latestDiscovery.ambiguities.map((a) => `- [${a.area}] ${a.question}`),
      ``,
    );
  }
  if (input.priorQa.length > 0) {
    parts.push(
      `## Already answered (do NOT re-ask these)`,
      ...input.priorQa.map((c) => `- [${c.area}] Q: ${c.question}\n  A: ${c.answer}`),
      ``,
    );
  }
  parts.push(
    `Return the JSON object described in the system prompt. Do not wrap it in markdown fences.`,
  );
  return parts.join('\n');
}

// ============================================================
//  parseStageJson — robust JSON extraction from reasoning-model output
// ============================================================
// deepseek-v4-pro can wrap its JSON in markdown fences, or prepend
// reasoning, or both. This helper finds the first complete top-level
// JSON object and validates it against the supplied Zod schema.
//
// Throws if no parseable JSON is found.

import { ZodTypeAny } from 'zod';

export function parseStageJson<S extends ZodTypeAny>(raw: string, schema: S): z.infer<S> {
  const text = raw.trim();

  // 1. Try the whole response as JSON (most common case for
  //    reasoning models that follow instructions well).
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    // fall through
  }

  // 2. Strip markdown code fences and try again.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return schema.parse(JSON.parse(fenceMatch[1].trim()));
    } catch {
      // fall through
    }
  }

  // 3. Find the first balanced top-level JSON object via brace matching.
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error(
      'parseStageJson: no JSON object found in model output. ' +
        `First 500 chars: ${text.slice(0, 500)}`,
    );
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        return schema.parse(JSON.parse(candidate));
      }
    }
  }

  throw new Error(
    'parseStageJson: no balanced JSON object found in model output ' +
      `(likely truncated by max_tokens). Last 500 chars: ${text.slice(-500)}`,
  );
}
