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
    throw new Error('parseStageJson: no JSON object found in model output');
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

  throw new Error('parseStageJson: no balanced JSON object found in model output');
}
