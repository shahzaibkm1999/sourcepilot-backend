import { ProjectModel } from '../models/ProjectModel';
import { IntakeModel } from '../models/IntakeModel';
import type { Intake, CreateIntakeInput } from '../models/IntakeModel';
import { DiscoveryModel } from '../models/DiscoveryModel';
import type { Discovery, CreateDiscoveryInput } from '../models/DiscoveryModel';
import { ClarificationModel } from '../models/ClarificationModel';
import type { Clarification, CreateClarificationInput } from '../models/ClarificationModel';
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

  // ----------------------------------------------------------------
  // Stage: Discovery (skeleton — wired in Phase 3)
  // ----------------------------------------------------------------
  async generateDiscovery(projectId: string): Promise<Discovery> {
    // TODO Phase 3: call DeepSeek with intake + clarifications, parse JSON,
    //              create Discovery row, link to latest intake, recompute completeness.
    throw new Error('ProjectOrchestrator.generateDiscovery: not implemented yet (Phase 3)');
  }

  // ----------------------------------------------------------------
  // Stage: Clarification (skeleton — wired in Phase 3)
  // ----------------------------------------------------------------
  async saveClarifications(input: CreateClarificationInput): Promise<Clarification> {
    // TODO Phase 3: persist, link to latest discovery, recompute completeness.
    throw new Error('ProjectOrchestrator.saveClarifications: not implemented yet (Phase 3)');
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
