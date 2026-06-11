import { ProjectModel } from '../models/ProjectModel';
import { DocumentModel } from '../models/DocumentModel';
import { DeepSeekService } from './DeepSeekService';
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
 * DocumentOrchestrator
 * -------------------
 * Post-refactor workflow entry point. The previous 8-stage
 * ProjectOrchestrator is gone; this is the only write path for
 * documents. Every document generation goes through
 * `enqueue(projectId, docType)`, which:
 *   1. Looks up the project
 *   2. Inserts a row with `status = 'pending'` and returns it
 *      immediately so the API call resolves in <100ms
 *   3. Runs the DeepSeek call in the background (fire-and-forget
 *      coroutine). On success, the row is updated to
 *      `status = 'ready'` with the body. On failure, to
 *      `status = 'failed'`.
 *
 * The frontend polls `GET /api/projects/:id` while any pending
 * row exists, so the row flips from spinner to body without the
 * user needing to refresh.
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
    const project = await ProjectModel.findById(projectId);
    if (!project) {
      throw new Error(`DocumentOrchestrator.enqueue: project ${projectId} not found`);
    }

    // 1. Insert the pending row up front.
    const pending = await DocumentModel.createPending({
      projectId: project.id,
      docType,
    });

    // 2. Fire the AI call in the background.
    void this.runInBackground(pending.id, project, docType);

    return pending;
  }

  /**
   * @deprecated Kept for compatibility with any synchronous caller
   * (none in the current app, but tests / scripts may use it).
   * New code should call `enqueue()` instead.
   */
  async generate(projectId: string, docType: DocType): Promise<Document> {
    return this.enqueue(projectId, docType);
  }

  private async runInBackground(
    documentId: string,
    project: Project,
    docType: DocType,
  ): Promise<void> {
    try {
      const markdown =
        docType === 'proposal'
          ? await this.generateProposalBody(project)
          : await this.generateTechScopeBody(project);
      await DocumentModel.markReady(documentId, markdown);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown generation error';
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
    }
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
