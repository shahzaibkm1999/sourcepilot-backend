import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { GeneratedSpec } from '../types';

/**
 * GeminiService
 * -------------
 * Thin wrapper around the Google Gemini SDK.
 * Builds the prompt, calls the model, and returns the generated spec.
 */

// The system prompt is shaped to match the spec-kit spec template at
// .specify/templates/spec-template.md (see github/spec-kit) so every
// generated Markdown body can be dropped straight into a spec-kit repo
// with no rewriting. Article I of the constitution in
// .specify/memory/constitution.md makes this conformance mandatory.
const SYSTEM_PROMPT = `You are a senior product manager and software architect
working in the GitHub spec-kit (Spec-Driven Development) style.

Given a one-line project idea, produce a complete, structured software
specification in GitHub-flavoured Markdown. The output MUST follow the
spec-kit spec template (see https://github.com/github/spec-kit) section
for section, in this exact order:

## User Scenarios & Testing  (mandatory)
- At least TWO prioritized user stories, ordered P1, P2, P3.
- For each story use the heading:
    ### User Story N - <Brief Title> (Priority: P1)
  then a one-paragraph description and:
    **Why this priority**: <one sentence>
    **Independent Test**: <one sentence>
    **Acceptance Scenarios**:
    1. **Given** <state>, **When** <action>, **Then** <outcome>
    2. **Given** <state>, **When** <action>, **Then** <outcome>
- A final sub-section:
    ### Edge Cases
  with at least TWO boundary or failure scenarios.

## Requirements  (mandatory)
### Functional Requirements
- Numbered list using **FR-001**, **FR-002**, ... Each is one concrete,
  testable capability. At least FIVE.
### Key Entities  (include only if the feature involves data)
- **<Entity>**: <what it represents, key attributes, relationships>.

## Success Criteria  (mandatory)
### Measurable Outcomes
- Numbered list using **SC-001**, **SC-002**, ... Each is technology-
  agnostic and verifiable. At least THREE.

## Assumptions
- At least THREE explicit assumptions about users, scope, environment,
  or external dependencies.

ALSO: the first line of your response MUST be a JSON object of the form
{"projectName": "<2-4 words, Title Case>", "projectDescription": "<one sentence>"},
followed by a line with "---" and then the full Markdown specification
(which must start with "# Feature Specification: <name>").

Do not include any other text outside the JSON header and the Markdown
body. Do not include implementation details (no language, framework,
library, or file path) in the spec — the spec is the WHAT and the WHY,
the plan is the HOW. Maximum three [NEEDS CLARIFICATION] markers total.`;

export class GeminiService {
  private client: GoogleGenerativeAI;
  private modelName: string;

  constructor() {
    this.client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    this.modelName = env.GEMINI_MODEL;
  }

  /**
   * Generate a structured spec for a project idea.
   */
  async generateSpecification(projectIdea: string): Promise<GeneratedSpec> {
    if (!projectIdea || projectIdea.trim().length < 3) {
      throw new Error('projectIdea must be at least 3 characters');
    }

    const model = this.client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: `Project idea: ${projectIdea.trim()}` }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
    });

    const raw = result.response.text();
    return this.parseResponse(raw, projectIdea);
  }

  /**
   * Split the model's response into a JSON header + Markdown body.
   * Falls back to a sensible default if the model didn't follow the format.
   */
  private parseResponse(raw: string, fallbackIdea: string): GeneratedSpec {
    const text = raw.trim();

    // Expected shape:  {"projectName":"...","projectDescription":"..."}\n---\n<markdown>
    const separatorIndex = text.indexOf('---');
    if (separatorIndex === -1) {
      // Model didn't follow the format. Wrap the whole response as the body.
      return {
        projectName: this.deriveFallbackName(fallbackIdea),
        projectDescription: fallbackIdea.trim(),
        content: text,
      };
    }

    const headerJson = text.slice(0, separatorIndex).trim();
    const body = text.slice(separatorIndex + 3).trim();

    try {
      const parsed = JSON.parse(headerJson) as {
        projectName?: string;
        projectDescription?: string;
      };
      return {
        projectName: parsed.projectName?.trim() || this.deriveFallbackName(fallbackIdea),
        projectDescription: parsed.projectDescription?.trim() || fallbackIdea.trim(),
        content: body,
      };
    } catch {
      return {
        projectName: this.deriveFallbackName(fallbackIdea),
        projectDescription: fallbackIdea.trim(),
        content: body || text,
      };
    }
  }

  /**
   * If the model doesn't return a usable name, derive a Title-Cased
   * version from the first few words of the idea.
   */
  private deriveFallbackName(idea: string): string {
    const words = idea
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
    if (words.length === 0) return 'Untitled Project';
    return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
}
