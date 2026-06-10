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
  SCOPE_SYSTEM,
  ScopeSchema,
  buildScopeUserPrompt,
  ESTIMATE_SYSTEM,
  EstimateSchema,
  buildEstimateUserPrompt,
  TIMELINE_SYSTEM,
  TimelineSchema,
  buildTimelineUserPrompt,
  parseStageJson,
  DiscoveryOutput,
  ClarificationBatchOutput,
  ScopeOutput,
  EstimateOutput,
  TimelineOutput,
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

  async getLatestScope(projectId: string): Promise<Scope | null> {
    return ScopeModel.getLatestVersion(projectId);
  }

  async getLatestEstimate(projectId: string): Promise<Estimate | null> {
    return EstimateModel.getLatestVersion(projectId);
  }

  async getLatestTimeline(projectId: string): Promise<Timeline | null> {
    return TimelineModel.getLatestVersion(projectId);
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
  // Stage: Scope
  // ----------------------------------------------------------------
  async generateScope(projectId: string): Promise<{ scope: Scope; completeness: { score: number; missing: string[] } }> {
    const intake = await IntakeModel.getLatestVersion(projectId);
    if (!intake) throw new Error(`generateScope: no intake for project ${projectId}`);
    const latestDiscovery = await DiscoveryModel.getLatestVersion(projectId);
    if (!latestDiscovery) {
      throw new Error(`generateScope: no discovery for project ${projectId} — run Discovery first`);
    }
    const priorClarifications = await ClarificationModel.listForProject(projectId);
    const answered = priorClarifications
      .flatMap((c) => c.questions)
      .filter((q) => q.status === 'answered' && q.answer)
      .map((q) => ({ area: q.area, question: q.question, answer: q.answer as string }));

    const userPrompt = buildScopeUserPrompt({
      intake,
      discovery: {
        ambiguities: latestDiscovery.ambiguities ?? [],
        risks: (latestDiscovery.risks ?? []).map((r) => ({ title: r.title, severity: r.severity })),
      },
      answeredClarifications: answered,
    });
    const { content } = await this.deepseek.chat({
      system: SCOPE_SYSTEM,
      user: userPrompt,
      temperature: 0.5,
      maxOutputTokens: 4096,
    });
    const parsed = parseStageJson(content, ScopeSchema) as ScopeOutput;

    const created = await ScopeModel.create({
      projectId,
      inScope: parsed.in_scope,
      outOfScope: parsed.out_of_scope,
      futureConsiderations: parsed.future_considerations,
      dependencies: parsed.dependencies,
      assumptions: parsed.assumptions,
      risks: parsed.risks,
      content: parsed.content,
    });

    // Links: scope derived_from intake + discovery + (latest) clarification
    const targets: { type: string; id: string }[] = [
      { type: 'intake', id: intake.id },
      { type: 'discovery', id: latestDiscovery.id },
    ];
    if (answered.length > 0) {
      const latestClar = await ClarificationModel.getLatestVersion(projectId);
      if (latestClar) targets.push({ type: 'clarification', id: latestClar.id });
    }
    for (const t of targets) {
      await ArtifactLinkModel.create({
        projectId,
        sourceType: 'scope',
        sourceId: created.id,
        targetType: t.type,
        targetId: t.id,
        relation: 'derived_from',
      });
    }

    const completeness = await this.recomputeCompleteness(projectId);
    return { scope: created, completeness };
  }

  // ----------------------------------------------------------------
  // Stage: Estimate
  // ----------------------------------------------------------------
  async generateEstimate(projectId: string): Promise<{ estimate: Estimate; completeness: { score: number; missing: string[] } }> {
    const intake = await IntakeModel.getLatestVersion(projectId);
    if (!intake) throw new Error(`generateEstimate: no intake for project ${projectId}`);
    const latestScope = await ScopeModel.getLatestVersion(projectId);
    if (!latestScope) {
      throw new Error(`generateEstimate: no scope for project ${projectId} — run Scope first`);
    }
    const priorClarifications = await ClarificationModel.listForProject(projectId);
    const answered = priorClarifications
      .flatMap((c) => c.questions)
      .filter((q) => q.status === 'answered' && q.answer)
      .map((q) => ({ area: q.area, question: q.question, answer: q.answer as string }));

    const userPrompt = buildEstimateUserPrompt({
      intake,
      scope: {
        in_scope: latestScope.in_scope ?? [],
        out_of_scope: latestScope.out_of_scope ?? [],
        dependencies: latestScope.dependencies ?? [],
      },
      answeredClarifications: answered,
    });
    const { content } = await this.deepseek.chat({
      system: ESTIMATE_SYSTEM,
      user: userPrompt,
      temperature: 0.4,
      maxOutputTokens: 4096,
    });
    const parsed = parseStageJson(content, EstimateSchema) as EstimateOutput;

    const items = parsed.items.map((i) => ({
      area: i.area,
      hours: Math.min(i.hours, i.high_hours),
      complexity: i.complexity,
      confidence: i.confidence,
    }));
    const totalHoursLow = items.reduce((s, i) => s + i.hours, 0);
    const totalHoursHigh = items.reduce((s, i) => s + (parsed.items.find((x) => x.area === i.area)?.high_hours ?? i.hours), 0);

    const created = await EstimateModel.create({
      projectId,
      items,
      budgetRange: parsed.fixed_high > 0
        ? { min: parsed.fixed_low, max: parsed.fixed_high, currency: parsed.currency }
        : undefined,
      riskBuffer: parsed.fixed_high > 0
        ? Math.round((parsed.fixed_low + parsed.fixed_high) / 2 * (parsed.risk_buffer_percent / 100))
        : undefined,
      totalHoursLow,
      totalHoursHigh,
      content: parsed.content,
    });

    // Link: estimate derived_from scope (+ intake, + clarification if any)
    const targets: { type: string; id: string }[] = [
      { type: 'intake', id: intake.id },
      { type: 'scope', id: latestScope.id },
    ];
    if (answered.length > 0) {
      const latestClar = await ClarificationModel.getLatestVersion(projectId);
      if (latestClar) targets.push({ type: 'clarification', id: latestClar.id });
    }
    for (const t of targets) {
      await ArtifactLinkModel.create({
        projectId,
        sourceType: 'estimate',
        sourceId: created.id,
        targetType: t.type,
        targetId: t.id,
        relation: 'derived_from',
      });
    }

    const completeness = await this.recomputeCompleteness(projectId);
    return { estimate: created, completeness };
  }

  // ----------------------------------------------------------------
  // Stage: Timeline
  // ----------------------------------------------------------------
  async generateTimeline(projectId: string): Promise<{ timeline: Timeline; completeness: { score: number; missing: string[] } }> {
    const intake = await IntakeModel.getLatestVersion(projectId);
    if (!intake) throw new Error(`generateTimeline: no intake for project ${projectId}`);
    const latestEstimate = await EstimateModel.getLatestVersion(projectId);
    if (!latestEstimate) {
      throw new Error(`generateTimeline: no estimate for project ${projectId} — run Estimate first`);
    }
    const latestScope = await ScopeModel.getLatestVersion(projectId);
    const priorClarifications = await ClarificationModel.listForProject(projectId);
    const answered = priorClarifications
      .flatMap((c) => c.questions)
      .filter((q) => q.status === 'answered' && q.answer)
      .map((q) => ({ area: q.area, question: q.question, answer: q.answer as string }));

    const userPrompt = buildTimelineUserPrompt({
      timelinePref: intake.timeline_pref,
      totalHoursLow: latestEstimate.total_hours_low ?? 0,
      totalHoursHigh: latestEstimate.total_hours_high ?? 0,
      scope: { in_scope: latestScope?.in_scope ?? [] },
      answeredClarifications: answered,
    });
    const { content } = await this.deepseek.chat({
      system: TIMELINE_SYSTEM,
      user: userPrompt,
      temperature: 0.4,
      // The reasoning model needs room to think + produce a 6-phase
      // timeline with milestones. 4096 = safe upper bound.
      maxOutputTokens: 4096,
    });
    const parsed = parseStageJson(content, TimelineSchema) as TimelineOutput;

    const created = await TimelineModel.create({
      projectId,
      phases: parsed.phases,
      totalWeeks: parsed.total_weeks,
      content: parsed.content,
    });

    // Link: timeline derived_from estimate + scope
    const targets: { type: string; id: string }[] = [
      { type: 'intake', id: intake.id },
      { type: 'estimate', id: latestEstimate.id },
    ];
    if (latestScope) targets.push({ type: 'scope', id: latestScope.id });
    for (const t of targets) {
      await ArtifactLinkModel.create({
        projectId,
        sourceType: 'timeline',
        sourceId: created.id,
        targetType: t.type,
        targetId: t.id,
        relation: 'derived_from',
      });
    }

    const completeness = await this.recomputeCompleteness(projectId);
    return { timeline: created, completeness };
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
