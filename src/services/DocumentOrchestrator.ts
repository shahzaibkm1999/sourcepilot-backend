import pLimit from 'p-limit';

import { env } from '../config/env';
import { ProjectModel } from '../models/ProjectModel';
import { DocumentModel } from '../models/DocumentModel';
import { DeepSeekService, DeepSeekError } from './DeepSeekService';
import {
  PROPOSAL_SYSTEM,
  TECH_SCOPE_SYSTEM,
  buildProposalUserPrompt,
  buildTechScopeUserPrompt,
  ProposalSchema,
  TechScopeSchema,
  parseStageJson,
  ProposalOutput,
  TechScopeOutput,
} from './PromptTemplates';
import { DocType, Document, Project } from '../types';

/**
 * Process-wide concurrency cap on outbound DeepSeek calls. Without
 * this, a flood of "Regenerate" clicks (across users, tabs, MCP
 * clients) can saturate the upstream API's rate limit. Article V
 * keeps user-side rate limiting out of the MVP; this is back-
 * pressure on outbound traffic, not on incoming requests.
 *
 * Singleton because p-limit's counter must be shared by every
 * orchestrator instance (a new instance is constructed per
 * controller call).
 *
 * Justification (Article VI): `p-limit` is a 200-byte, well-typed,
 * widely-used (sindresorhus, 100M weekly downloads) one-purpose
 * library. A handwritten semaphore would be ~30 lines of fiddly
 * Promise queueing that we'd have to test ourselves.
 */
const deepseekLimit = pLimit(env.DEEPSEEK_MAX_CONCURRENCY);

/**
 * Exponential backoff with full jitter. Attempt index is 0-based:
 * attempt=0 means "we just failed for the first time, backing off
 * before retry #1". Returns delay in ms, capped at 30s.
 */
function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return Math.floor(Math.random() * base);
}

/**
 * Retry a function on transient failures (DeepSeekError with
 * `retryable: true`). Non-retryable errors and any other thrown
 * value propagate immediately.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry: (attempt: number, err: DeepSeekError, delayMs: number) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!(err instanceof DeepSeekError) || !err.retryable) throw err;
      if (attempt === maxRetries) throw err;
      const delay = backoffMs(attempt);
      onRetry(attempt + 1, err, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable — the loop either returns or throws — but satisfies
  // TypeScript's control-flow analysis.
  throw lastErr;
}

/**
 * DocumentOrchestrator
 * -------------------
 * Post-refactor workflow entry point. The previous 8-stage
 * ProjectOrchestrator is gone; this is the only write path for
 * documents (Article II — one workflow shared by REST and MCP).
 *
 * Public surface:
 *   - enqueue(project, docType)
 *       Insert a `pending` row, run the AI call in the background,
 *       return the pending row in <100ms. The REST controller uses
 *       this and returns HTTP 202 + the pending row; the React app
 *       polls until the row is `ready` or `failed`.
 *
 *   - generateSync(project, docType)
 *       Insert a pending row AND await the AI call. Returns the
 *       final `ready` or `failed` row. The MCP server uses this
 *       because MCP has no polling channel — the tool result must
 *       contain the final body.
 *
 * Both methods share `runOnce`, which is the unit of work that's
 * subject to the concurrency cap and the retry policy.
 */
export class DocumentOrchestrator {
  private deepseek: DeepSeekService;

  constructor() {
    this.deepseek = new DeepSeekService();
  }

  /**
   * Enqueue a document generation. Returns the pending row
   * synchronously; the AI call continues in the background.
   *
   * The background work uses `.catch(...)` to swallow rejection
   * (we already wrote `status='failed'` to the row) so the
   * floating promise never becomes an unhandledRejection.
   */
  async enqueue(projectId: string, docType: DocType): Promise<Document> {
    const { pending, project } = await this.createPending(projectId, docType);
    void this.runOnce(pending.id, project, docType).catch(() => {
      /* already recorded to the row */
    });
    return pending;
  }

  /**
   * Synchronous generation for callers that have no polling
   * channel (MCP). Inserts the pending row, awaits the AI call,
   * and returns the final row (`ready` or `failed`).
   *
   * Concurrency, retry, and the background-write path are identical
   * to `enqueue` — the only difference is that we await the result
   * here instead of returning the pending row.
   */
  async generateSync(projectId: string, docType: DocType): Promise<Document> {
    const { pending, project } = await this.createPending(projectId, docType);
    const final = await this.runOnce(pending.id, project, docType).catch(
      async () => DocumentModel.findById(pending.id),
    );
    // `runOnce` returns the final row on success and updates the row
    // on failure too; the .catch above re-reads the failed row so
    // the MCP caller always gets the latest state.
    if (!final) {
      throw new Error(
        `DocumentOrchestrator.generateSync: row ${pending.id} disappeared`,
      );
    }
    return final;
  }

  /**
   * @deprecated Old alias kept for any external test/script. New
   * code should call `enqueue` (REST) or `generateSync` (MCP).
   * The MCP server used to call this and got back a `pending` row
   * with empty `content_markdown` — that broke the tool contract.
   */
  async generate(projectId: string, docType: DocType): Promise<Document> {
    return this.enqueue(projectId, docType);
  }

  /**
   * Shared setup: validate the project exists, insert the pending
   * row. Used by both `enqueue` and `generateSync`.
   */
  private async createPending(
    projectId: string,
    docType: DocType,
  ): Promise<{ pending: Document; project: Project }> {
    const project = await ProjectModel.findById(projectId);
    if (!project) {
      throw new Error(`DocumentOrchestrator: project ${projectId} not found`);
    }
    const pending = await DocumentModel.createPending({
      projectId: project.id,
      docType,
    });
    return { pending, project };
  }

  /**
   * The single unit of work, gated by the process-wide concurrency
   * cap and the retry policy. Returns the final row on success;
   * on failure, marks the row `failed` (writing the error message
   * into `content_markdown`) and re-throws so callers can react if
   * they want to.
   */
  private async runOnce(
    documentId: string,
    project: Project,
    docType: DocType,
  ): Promise<Document> {
    return deepseekLimit(async () => {
      try {
        const markdown = await withRetry(
          () =>
            docType === 'proposal'
              ? this.generateProposalBody(project)
              : this.generateTechScopeBody(project),
          env.DEEPSEEK_MAX_RETRIES,
          (attempt, err, delayMs) => {
            // eslint-disable-next-line no-console
            console.warn(
              `[orchestrator] doc ${documentId} retry ${attempt}/${env.DEEPSEEK_MAX_RETRIES} ` +
                `after ${delayMs}ms (status=${err.status ?? 'n/a'}): ${err.message}`,
            );
          },
        );
        const ready = await DocumentModel.markReady(documentId, markdown);
        if (!ready) {
          throw new Error(
            `runOnce: row ${documentId} disappeared before markReady`,
          );
        }
        return ready;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown generation error';
        // eslint-disable-next-line no-console
        console.error(`[orchestrator] doc ${documentId} failed: ${message}`);
        try {
          await DocumentModel.markFailed(documentId, message);
        } catch (updateErr) {
          // eslint-disable-next-line no-console
          console.error(
            `[orchestrator] could not mark doc ${documentId} as failed:`,
            updateErr,
          );
        }
        throw err;
      }
    });
  }

  private async generateProposalBody(project: Project): Promise<string> {
    const userPrompt = buildProposalUserPrompt({ project });
    const { content } = await this.deepseek.chat({
      system: PROPOSAL_SYSTEM,
      user: userPrompt,
      temperature: 0.5,
      // Proposal is ~3 pages but the reasoning model needs room to
      // think. 4096 is safe.
      maxOutputTokens: 4096,
    });
    const parsed = parseStageJson(content, ProposalSchema) as ProposalOutput;
    return parsed.content_markdown;
  }

  private async generateTechScopeBody(project: Project): Promise<string> {
    const userPrompt = buildTechScopeUserPrompt({ project });
    const { content } = await this.deepseek.chat({
      system: TECH_SCOPE_SYSTEM,
      user: userPrompt,
      temperature: 0.4,
      // Tech scope is the larger doc (8-9 pages, 10 sections with
      // multiple tables). 6144 gives the reasoning model + the
      // markdown output enough room.
      maxOutputTokens: 6144,
    });
    const parsed = parseStageJson(content, TechScopeSchema) as TechScopeOutput;
    return parsed.content_markdown;
  }
}
