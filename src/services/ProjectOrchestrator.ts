import { ProjectModel } from '../models/ProjectModel';
import { IntakeModel } from '../models/IntakeModel';
import type { Intake, CreateIntakeInput } from '../models/IntakeModel';
import { DiscoveryModel } from '../models/DiscoveryModel';
import type { Discovery, CreateDiscoveryInput } from '../models/DiscoveryModel';
import { ClarificationModel } from '../models/ClarificationModel';
import type {
  Clarification,
  ClarificationQuestion,
  CreateClarificationInput,
} from '../models/ClarificationModel';
import { ScopeModel } from '../models/ScopeModel';
import type { Scope, CreateScopeInput } from '../models/ScopeModel';
import { EstimateModel } from '../models/EstimateModel';
import type { Estimate, CreateEstimateInput } from '../models/EstimateModel';
import { TimelineModel } from '../models/TimelineModel';
import type { Timeline, CreateTimelineInput } from '../models/TimelineModel';
import { ProposalModel } from '../models/ProposalModel';
import type { Proposal, CreateProposalInput } from '../models/ProposalModel';
import { SpecificationModel } from '../models/SpecificationModel';
import type { Project, Specification } from '../types';
import { ArtifactLinkModel } from '../models/ArtifactLinkModel';
import { CompletenessModel } from '../models/CompletenessModel';

import { DeepSeekService } from './DeepSeekService';
import { computeCompleteness } from './CompletenessCalculator';
import { buildLineage, LineageSnapshot } from './LineageBuilder';
import {
  DISCOVERY_SYSTEM,
  DiscoverySchema,
  buildDiscoveryUserPrompt,
  CLARIFICATION_SYSTEM,
  ClarificationBatchSchema,
  buildClarificationUserPrompt,
  parseStageJson,
  DiscoveryOutput,
  ClarificationBatchOutput,
} from './PromptTemplates';

/**
 * ProjectOrchestrator
 * -------------------
 * The single workflow entry point for the entire SourcePilot pipeline.
 * Both REST controllers and the MCP server call into this class — never
 * straight into the models (Constitution Article II).
 *
 * Phases 2-5 will fill in the actual `generate*()` per-stage methods that
 * call DeepSeek. Phase 1 ships the orchestrator skeleton with a single
 * path wired up (`createIntake`) so we can prove the end-to-end flow.
 */

export interface CreateIntakeOrchestratorInput {
  projectName: string;
  projectDescription?: string;
  projectType?: string;
  engagement?: string;
  timelinePref?: string;
  requirement: string;
  details?: string;
  constraints?: string;
}

export interface IntakeSaved {
  project: Project;
  intake: Intake;
}

export class ProjectOrchestrator {
  private deepseek: DeepSeekService;

  constructor() {
    this.deepseek = new DeepSeekService();
  }

  // ----------------------------------------------------------------
  // Stage: Intake (wired up in Phase 1)
  // ----------------------------------------------------------------
  async createIntake(input: CreateIntakeOrchestratorInput): Promise<IntakeSaved> {
    // 1. Upsert the project (keep existing behavior from the spec system).
    const project = await ProjectModel.upsertByName({
      name: input.projectName,
      description: input.projectDescription ?? input.requirement.slice(0, 200),
    });

    // 2. Persist the intake.
    const createInput: CreateIntakeInput = {
      projectId: project.id,
      projectType: input.projectType,
      engagement: input.engagement,
      timelinePref: input.timelinePref,
      requirement: input.requirement,
      details: input.details,
      constraints: input.constraints,
    };
    const intake = await IntakeModel.create(createInput);

    // 3. Recompute completeness.
    await this.recomputeCompleteness(project.id);

    return { project, intake };
  }

  async getLatestIntake(projectId: string): Promise<Intake | null> {
    return IntakeModel.getLatestVersion(projectId);
  }

  async getLatestDiscovery(projectId: string): Promise<Discovery | null> {
    return DiscoveryModel.getLatestVersion(projectId);
  }

  async listClarifications(projectId: string): Promise<Clarification[]> {
    return ClarificationModel.listForProject(projectId);
  }

  // ----------------------------------------------------------------
  // Stage: Discovery (wired in Phase 3)
  // ----------------------------------------------------------------
  /**
   * Generate a discovery analysis for a project. Pulls the latest
   * intake + any answered clarifications, asks DeepSeek to surface
   * ambiguities / missing info / risks / assumptions, persists a new
   * discovery row, links it to the latest intake, and recomputes
   * completeness.
   */
  async generateDiscovery(projectId: string): Promise<{ discovery: Discovery; completeness: { score: number; missing: string[] } }> {
    const intake = await IntakeModel.getLatestVersion(projectId);
    if (!intake) {
      throw new Error(`ProjectOrchestrator.generateDiscovery: no intake for project ${projectId}`);
    }

    // Gather every answered clarification so far (across versions),
    // flatten into a single array for the prompt.
    const priorClarifications = await ClarificationModel.listForProject(projectId);
    const answered = priorClarifications
      .flatMap((c) => c.questions)
      .filter((q) => q.status === 'answered' && q.answer)
      .map((q) => ({ area: q.area, question: q.question, answer: q.answer as string }));

    const userPrompt = buildDiscoveryUserPrompt({ intake, answeredClarifications: answered });
    const { content } = await this.deepseek.chat({
      system: DISCOVERY_SYSTEM,
      user: userPrompt,
      temperature: 0.5,
      maxOutputTokens: 4096,
    });
    const parsed = parseStageJson(content, DiscoverySchema) as DiscoveryOutput;

    const created = await DiscoveryModel.create({
      projectId,
      ambiguities: parsed.ambiguities,
      missingInfo: parsed.missing_info,
      risks: parsed.risks.map((r) => ({
        title: r.title,
        severity: r.severity,
        mitigation: r.mitigation || undefined,
      })),
      assumptions: parsed.assumptions,
      content: parsed.content,
    });

    // Link: discovery derived_from intake
    await ArtifactLinkModel.create({
      projectId,
      sourceType: 'discovery',
      sourceId: created.id,
      targetType: 'intake',
      targetId: intake.id,
      relation: 'derived_from',
    });

    const completeness = await this.recomputeCompleteness(projectId);
    return { discovery: created, completeness };
  }

  // ----------------------------------------------------------------
  // Stage: Clarification
  // ----------------------------------------------------------------
  /**
   * Generate the *next* batch of clarification questions. Pulls
   * the latest intake + discovery + every prior Q&A, asks DeepSeek
   * to produce up to 5 fresh questions, persists them.
   */
  async generateClarifications(projectId: string): Promise<{ clarification: Clarification; completeness: { score: number; missing: string[] } }> {
    const intake = await IntakeModel.getLatestVersion(projectId);
    if (!intake) {
      throw new Error(`ProjectOrchestrator.generateClarifications: no intake for project ${projectId}`);
    }
    const latestDiscovery = await DiscoveryModel.getLatestVersion(projectId);
    const priorClarifications = await ClarificationModel.listForProject(projectId);
    const priorQa = priorClarifications
      .flatMap((c) => c.questions)
      .filter((q) => q.status === 'answered' && q.answer)
      .map((q) => ({ area: q.area, question: q.question, answer: q.answer as string }));

    const userPrompt = buildClarificationUserPrompt({
      intake,
      latestDiscovery: latestDiscovery
        ? { ambiguities: latestDiscovery.ambiguities ?? [] }
        : null,
      priorQa,
    });

    const { content } = await this.deepseek.chat({
      system: CLARIFICATION_SYSTEM,
      user: userPrompt,
      temperature: 0.5,
      maxOutputTokens: 2048,
    });
    const parsed = parseStageJson(content, ClarificationBatchSchema) as ClarificationBatchOutput;

    const created = await ClarificationModel.create({
      projectId,
      questions: parsed.questions,
      refinedInput: parsed.refined_input,
    });

    // Link: clarification derived_from intake (and discovery if present)
    const targets: { type: string; id: string }[] = [
      { type: 'intake', id: intake.id },
    ];
    if (latestDiscovery) targets.push({ type: 'discovery', id: latestDiscovery.id });
    for (const t of targets) {
      await ArtifactLinkModel.create({
        projectId,
        sourceType: 'clarification',
        sourceId: created.id,
        targetType: t.type,
        targetId: t.id,
        relation: 'derived_from',
      });
    }

    const completeness = await this.recomputeCompleteness(projectId);
    return { clarification: created, completeness };
  }

  /**
   * Save answers to a previously generated clarification batch.
   * The batch's questions are mutated in place (status flipped to
   * "answered", answer filled). A new versioned clarification row
   * is created so the lineage preserves every iteration.
   */
  async saveClarifications(input: CreateClarificationInput): Promise<{ clarification: Clarification; completeness: { score: number; missing: string[] } }> {
    // Merge: start from the latest pending questions, overlay the
    // answers the client just provided.
    const latest = await ClarificationModel.getLatestVersion(input.projectId);
    const previousQuestions: ClarificationQuestion[] = latest?.questions ?? [];

    const answeredById = new Map<string, string>();
    for (const q of input.questions) {
      if (q.answer && q.answer.trim().length > 0) {
        answeredById.set(q.id, q.answer.trim());
      }
    }

    const merged: ClarificationQuestion[] = previousQuestions.map((q) => {
      const fresh = input.questions.find((x) => x.id === q.id);
      if (!fresh) return q; // unchanged
      const answer = answeredById.get(q.id);
      return {
        ...q,
        ...fresh,
        answer: answer ?? q.answer ?? null,
        status: answer ? 'answered' : 'pending',
      };
    });

    // Newly added questions (not in previousQuestions) get appended
    // as-is.
    const existingIds = new Set(previousQuestions.map((q) => q.id));
    const appended = input.questions.filter((q) => !existingIds.has(q.id));
    const finalQuestions: ClarificationQuestion[] = [...merged, ...appended];

    const created = await ClarificationModel.create({
      projectId: input.projectId,
      questions: finalQuestions,
      refinedInput: input.refinedInput,
    });

    // Link the new iteration to the previous one (clarification supersedes clarification)
    if (latest) {
      await ArtifactLinkModel.create({
        projectId: input.projectId,
        sourceType: 'clarification',
        sourceId: created.id,
        targetType: 'clarification',
        targetId: latest.id,
        relation: 'supersedes',
      });
    }

    const completeness = await this.recomputeCompleteness(input.projectId);
    return { clarification: created, completeness };
  }

  // ----------------------------------------------------------------
  // Stage: Scope (skeleton — wired in Phase 4)
  // ----------------------------------------------------------------
  async generateScope(projectId: string): Promise<Scope> {
    // TODO Phase 4.
    throw new Error('ProjectOrchestrator.generateScope: not implemented yet (Phase 4)');
  }

  // ----------------------------------------------------------------
  // Stage: Estimate (skeleton — wired in Phase 4)
  // ----------------------------------------------------------------
  async generateEstimate(projectId: string): Promise<Estimate> {
    // TODO Phase 4.
    throw new Error('ProjectOrchestrator.generateEstimate: not implemented yet (Phase 4)');
  }

  // ----------------------------------------------------------------
  // Stage: Timeline (skeleton — wired in Phase 4)
  // ----------------------------------------------------------------
  async generateTimeline(projectId: string): Promise<Timeline> {
    // TODO Phase 4.
    throw new Error('ProjectOrchestrator.generateTimeline: not implemented yet (Phase 4)');
  }

  // ----------------------------------------------------------------
  // Stage: Proposal (skeleton — wired in Phase 5)
  // ----------------------------------------------------------------
  async generateProposal(projectId: string): Promise<Proposal> {
    // TODO Phase 5.
    throw new Error('ProjectOrchestrator.generateProposal: not implemented yet (Phase 5)');
  }

  // ----------------------------------------------------------------
  // Stage: Specification (delegates to existing SpecificationGenerator)
  // ----------------------------------------------------------------
  /**
   * Spec generation already has a working code path via
   * SpecificationGenerator. The orchestrator re-exports it so all
   * write paths flow through this class (Constitution Article II).
   * Phase 6 will fold the actual generation into a generate*() method.
   */
  async generateSpecFromIdea(projectIdea: string): Promise<{
    project: Project;
    specification: Specification;
  }> {
    // Delegate to the existing service. This will be replaced in Phase 6
    // by an orchestrator-native call that also produces artifact links
    // and recomputes completeness.
    const { SpecificationGenerator } = await import('./SpecificationGenerator');
    const { saved } = await new SpecificationGenerator().createAndSave(projectIdea);
    await this.recomputeCompleteness(saved.project.id);
    return { project: (await ProjectModel.findByName(saved.project.name))!, specification: saved };
  }

  // ----------------------------------------------------------------
  // Lineage + completeness queries (read paths)
  // ----------------------------------------------------------------
  async getLineage(projectId: string): Promise<LineageSnapshot[]> {
    return buildLineage(projectId);
  }

  async getCompleteness(projectId: string): Promise<{
    score: number;
    missing: string[];
  }> {
    // Always compute live from current artifact state, then persist.
    // This guarantees the score is correct even if a stage ran without
    // a prior recompute (e.g. legacy data created before this method).
    return this.recomputeCompleteness(projectId);
  }

  // ----------------------------------------------------------------
  // Recompute completeness for a project from current state
  // ----------------------------------------------------------------
  async recomputeCompleteness(projectId: string): Promise<{ score: number; missing: string[] }> {
    const [intake, discovery, clarification, scope, estimate, timeline, proposal, specification] =
      await Promise.all([
        IntakeModel.getLatestVersion(projectId),
        DiscoveryModel.getLatestVersion(projectId),
        ClarificationModel.getLatestVersion(projectId),
        ScopeModel.getLatestVersion(projectId),
        EstimateModel.getLatestVersion(projectId),
        TimelineModel.getLatestVersion(projectId),
        ProposalModel.getLatestVersion(projectId),
        SpecificationModel.getLatestVersion(projectId),
      ]);

    const answered =
      clarification?.questions?.filter((q) => q.status === 'answered' && q.answer).length ?? 0;
    const total =
      clarification?.questions?.length ?? 0;
    const clarificationsAnsweredRatio = total === 0 ? 0 : answered / total;

    const result = computeCompleteness({
      hasIntake: !!intake,
      hasDiscovery: !!discovery,
      discoveryMissingInfoCount: discovery?.missing_info?.length ?? 0,
      discoveryRiskCount: discovery?.risks?.length ?? 0,
      hasClarifications: !!clarification,
      clarificationsAnsweredRatio,
      hasScope: !!scope,
      hasEstimate: !!estimate,
      hasTimeline: !!timeline,
      hasProposal: !!proposal,
      hasSpecification: !!specification,
    });

    await CompletenessModel.upsert({
      projectId,
      score: result.score,
      missing: result.missing,
    });

    return result;
  }
}
