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
 * `generate(projectId, docType)`, which:
 *   1. Looks up the project (the only required input)
 *   2. Picks the right system prompt + user-prompt builder
 *   3. Calls DeepSeek, parses the JSON, validates with Zod
 *   4. Persists to `documents`
 *
 * No lineage, no completeness, no intermediate stages. Just
 * intake → document.
 */
export class DocumentOrchestrator {
  private deepseek: DeepSeekService;

  constructor() {
    this.deepseek = new DeepSeekService();
  }

  /**
   * Generate a document for an existing project.
   * Throws with a descriptive message if the project doesn't exist.
   */
  async generate(projectId: string, docType: DocType): Promise<Document> {
    const project = await ProjectModel.findById(projectId);
    if (!project) {
      throw new Error(`DocumentOrchestrator.generate: project ${projectId} not found`);
    }

    if (docType === 'proposal') {
      return this.generateProposal(project);
    }
    return this.generateTechScope(project);
  }

  private async generateProposal(project: Project): Promise<Document> {
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

    return DocumentModel.create({
      projectId: project.id,
      docType: 'proposal',
      contentMarkdown: parsed.content_markdown,
    });
  }

  private async generateTechScope(project: Project): Promise<Document> {
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

    return DocumentModel.create({
      projectId: project.id,
      docType: 'tech_scope',
      contentMarkdown: parsed.content_markdown,
    });
  }
}
