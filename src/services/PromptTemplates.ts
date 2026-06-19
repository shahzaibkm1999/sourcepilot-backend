/**
 * PromptTemplates
 * ---------------
 * Two system prompts for the post-refactor doc generator.
 * Each prompt is calibrated to a target document shape that mirrors a
 * specific reference PDF:
 *
 *   - PROPOSAL_SYSTEM  →  Airtable_Integration_Proposal.pdf
 *       (conversational, first-person, "I've gone through your
 *       requirements carefully", Scope of Work / Timeline / Pricing
 *       tables, ~3 pages, non-technical client voice)
 *
 *   - TECH_SCOPE_SYSTEM →  Orbit_Scope_Document.pdf
 *       (formal third-person, Architecture diagram, Technology
 *       Stack comparison tables, ETA summary table, Risks table,
 *       ~8-9 pages, technical client voice)
 *
 * The system prompt tells the model which voice and which sections
 * to use. The user prompt provides the intake data and (for tech
 * scope) a small Q&A about architecture.
 */

import { z } from 'zod';
import type { Audience, Project } from '../types';

// ====================================================================
//  PROPOSAL  —  Airtable_Integration_Proposal style
// ====================================================================

export const PROPOSAL_SYSTEM = `You are a senior consultant writing a client-facing
project proposal. Your voice is conversational, first-person, and reassuring
— like Ahsan Khan writing "I've gone through your requirements carefully
and everything here is doable".

The client is **non-technical** (a decision-maker, not an engineer). Use
plain language, avoid jargon, and make every section feel reassuring.

Output shape — a JSON object with these exact keys (and ONLY these keys,
no markdown fences, no extra text):

{
  "executive_summary": "<2-3 sentence overview a CEO could read in 10 seconds>",
  "scope_of_work": [
    {
      "title": "<short label, e.g. 'Outlook Calendar Integration'>",
      "paragraph": "<2-4 sentence 'I'll do X' explanation in first-person>",
      "bullets": ["<one-line deliverable>", "<one-line deliverable>", ...]
    }
  ],
  "timeline": [
    {
      "deliverable": "<name>",
      "estimated_time": "<e.g. '1-2 days'>",
      "notes": "<one-line caveat or detail>"
    }
  ],
  "pricing": [
    {
      "deliverable": "<name>",
      "estimated_hours": <integer>,
      "rate_note": "<e.g. '$20/hr blended rate'>"
    }
  ],
  "total_hours": <integer>,
  "total_price_usd": <integer>,
  "content_markdown": "<full markdown proposal, ~3 pages, in 6 sections: 'PROJECT PROPOSAL', '1. Project Overview', '2. Scope of Work' (with bullets per item), '3. Project Timeline' (markdown table), '4. Pricing' (markdown table), '5. What I'll Need From You' (bullets), '6. How I Work' (1-2 paragraphs)>"
}

Rules:
- scope_of_work must have AT LEAST 3 items, each with a paragraph
  and 3-5 bullets.
- timeline must have one row per scope item + one 'Testing & Final
  Validation' row + one 'Total' row.
- pricing must have one row per scope item + a 'Buffer' row + a
  'TOTAL' row.
- total_hours should be the sum of pricing.hours.
- total_price_usd is a flat integer (e.g. 1100) using a reasonable
  blended hourly rate.
- content_markdown must mirror the JSON exactly — no new facts in
  Markdown that aren't in JSON.
- The whole document should read as a real human consultant wrote
  it. Never use 'as an AI' or 'I am a language model'.`;

// ====================================================================
//  TECH SCOPE  —  Orbit_Scope_Document style
// ====================================================================

export const TECH_SCOPE_SYSTEM = `You are a senior solutions architect writing a client-facing
project scope document. Your voice is formal, third-person, and
technically precise — like the Orbit scope document: clean section
headings, a System Architecture overview, a Technology Stack
recommendation with comparison tables, an ETA breakdown by SDLC stage,
a Non-Functional Requirements list, a Risks & Mitigations table, and
a Suggestions for Improvement section.

The client is **technical** (engineering lead, CTO). Use precise
language, include tables, and reference the architecture choices
made in the intake. The document should be ~8-9 pages.

Output shape — a JSON object with these exact keys (and ONLY these
keys, no markdown fences, no extra text):

{
  "overview": "<2-3 paragraph technical summary of the project>",
  "core_features": [
    "<one-line technical feature, e.g. 'JWT auth with refresh tokens'>"
  ],
  "in_scope": ["<one-line capability>"],
  "out_of_scope": ["<one-line capability>"],
  "architecture_summary": "<1 paragraph describing the system architecture>",
  "tech_stack": [
    { "layer": "<e.g. 'Backend'>", "technology": "<e.g. 'Supabase (Postgres, Auth, Edge Functions)'>" }
  ],
  "nfrs": ["<one-line non-functional requirement, e.g. '60 FPS on devices from the last 4 years'>"],
  "risks": [
    {
      "title": "<risk>",
      "severity": "low" | "medium" | "high",
      "mitigation": "<one-line mitigation>"
    }
  ],
  "content_markdown": "<full markdown scope document, in 10 sections: 'Project Scope Document', '1. Overview', '2. System Architecture', '3. In Scope (MVP)' (bullets), '4. Out of Scope (MVP)' (bullets), '5. Technology Stack' (markdown table with layer + technology), '6. ETA' (markdown table with SDLC stage + estimated effort), '7. Non-Functional Requirements' (bullets), '8. Risks & Mitigations' (markdown table with title + severity + mitigation), '9. Suggestions for Improvement' (4 short bullet groups), '10. Next Steps' (1 paragraph)>"
}

Rules:
- core_features: 3-6 items, each a concrete shipping capability.
- in_scope: 5-10 items.
- out_of_scope: 3-5 items.
- tech_stack: 5-8 layers.
- nfrs: 3-6 items.
- risks: 3-5 items across severity levels.
- content_markdown must mirror the JSON exactly.
- Tables use markdown pipe syntax so they render properly when
  pasted into a markdown viewer.`;

// ====================================================================
//  Zod schemas (validate the model's JSON output)
// ====================================================================

const ProposalScopeItem = z.object({
  title: z.string().min(1).max(100),
  paragraph: z.string().min(20).max(800),
  bullets: z.array(z.string().min(1).max(200)).min(2).max(8),
});

const ProposalTimelineRow = z.object({
  deliverable: z.string().min(1).max(100),
  estimated_time: z.string().min(1).max(60),
  notes: z.string().min(1).max(200),
});

const ProposalPricingRow = z.object({
  deliverable: z.string().min(1).max(100),
  estimated_hours: z.number().int().nonnegative(),
  rate_note: z.string().min(1).max(100),
});

export const ProposalSchema = z.object({
  executive_summary: z.string().min(20).max(800),
  scope_of_work: z.array(ProposalScopeItem).min(3).max(8),
  timeline: z.array(ProposalTimelineRow).min(3).max(20),
  pricing: z.array(ProposalPricingRow).min(3).max(20),
  total_hours: z.number().int().nonnegative(),
  total_price_usd: z.number().int().nonnegative(),
  content_markdown: z.string().min(200),
});
export type ProposalOutput = z.infer<typeof ProposalSchema>;

const TechScopeStack = z.object({
  layer: z.string().min(1).max(60),
  technology: z.string().min(1).max(200),
});
const TechScopeRisk = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high']),
  mitigation: z.string().min(1).max(400),
});

export const TechScopeSchema = z.object({
  overview: z.string().min(20).max(1500),
  core_features: z.array(z.string().min(1).max(200)).min(3).max(6),
  in_scope: z.array(z.string().min(1).max(200)).min(5).max(10),
  out_of_scope: z.array(z.string().min(1).max(200)).min(3).max(5),
  architecture_summary: z.string().min(20).max(1000),
  tech_stack: z.array(TechScopeStack).min(5).max(8),
  nfrs: z.array(z.string().min(1).max(200)).min(3).max(6),
  risks: z.array(TechScopeRisk).min(3).max(5),
  content_markdown: z.string().min(400),
});
export type TechScopeOutput = z.infer<typeof TechScopeSchema>;

// ====================================================================
//  User-prompt builders
// ====================================================================

export function buildProposalUserPrompt(input: {
  project: Project;
}): string {
  return [
    `## Project metadata`,
    `- Name: ${input.project.name}`,
    `- Client: ${input.project.client_name ?? 'unspecified'}`,
    `- Project type: ${input.project.project_type ?? 'unspecified'}`,
    ``,
    `## Client's raw request (verbatim, from intake)`,
    input.project.raw_requirement,
    ``,
    `Generate the JSON object described in the system prompt. Do not`,
    `wrap it in markdown fences. Use the metadata + raw request to`,
    `derive scope items, an honest timeline, and a fair price.`,
  ].join('\n');
}

export function buildTechScopeUserPrompt(input: {
  project: Project;
}): string {
  return [
    `## Project metadata`,
    `- Name: ${input.project.name}`,
    `- Client: ${input.project.client_name ?? 'unspecified'}`,
    `- Project type: ${input.project.project_type ?? 'unspecified'}`,
    ``,
    `## Client's raw request (verbatim, from intake)`,
    input.project.raw_requirement,
    ``,
    `Generate the JSON object described in the system prompt. Do not`,
    `wrap it in markdown fences. Choose a sensible technology stack`,
    `that matches the project type and the requirements (use the raw`,
    `request to infer whether they need a mobile app, a web app,`,
    `an API, a database, AI, etc.).`,
  ].join('\n');
}

// ====================================================================
//  parseStageJson — robust JSON extraction from reasoning-model output
// ====================================================================

import { ZodTypeAny } from 'zod';

export function parseStageJson<S extends ZodTypeAny>(raw: string, schema: S): S['_input'] {
  const text = raw.trim();

  // 1. Try the whole response as JSON.
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
