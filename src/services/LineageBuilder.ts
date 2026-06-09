/**
 * LineageBuilder
 * --------------
 * Walks the latest artifact rows for a project (intake, discovery,
 * clarifications, scope, estimate, timeline, proposal, specification)
 * and produces a linear version graph for the UI drawer:
 *
 *   Intake v1 → Discovery v1 → Clarification v1 → Scope v1 →
 *   Estimate v1 → Timeline v1 → Proposal v1 → Specification v3
 *
 * Stages with multiple iterations show their latest version only;
 * the underlying `*_version` rows are still in the DB and queryable.
 */

import { IntakeModel } from '../models/IntakeModel';
import type { Intake } from '../models/IntakeModel';
import { DiscoveryModel } from '../models/DiscoveryModel';
import type { Discovery } from '../models/DiscoveryModel';
import { ClarificationModel } from '../models/ClarificationModel';
import type { Clarification } from '../models/ClarificationModel';
import { ScopeModel } from '../models/ScopeModel';
import type { Scope } from '../models/ScopeModel';
import { EstimateModel } from '../models/EstimateModel';
import type { Estimate } from '../models/EstimateModel';
import { TimelineModel } from '../models/TimelineModel';
import type { Timeline } from '../models/TimelineModel';
import { ProposalModel } from '../models/ProposalModel';
import type { Proposal } from '../models/ProposalModel';
import { SpecificationModel } from '../models/SpecificationModel';
import type { Specification } from '../types';

export type Stage =
  | 'intake'
  | 'discovery'
  | 'clarification'
  | 'scope'
  | 'estimate'
  | 'timeline'
  | 'proposal'
  | 'specification';

export interface LineageNode {
  stage: Stage;
  id: string;
  version: number;
  createdAt: string;
}

export type LineageSnapshot =
  | { stage: 'intake';            present: true;  node: LineageNode; artifact: Intake }
  | { stage: 'intake';            present: false }
  | { stage: 'discovery';         present: true;  node: LineageNode; artifact: Discovery }
  | { stage: 'discovery';         present: false }
  | { stage: 'clarification';     present: true;  node: LineageNode; artifact: Clarification }
  | { stage: 'clarification';     present: false }
  | { stage: 'scope';             present: true;  node: LineageNode; artifact: Scope }
  | { stage: 'scope';             present: false }
  | { stage: 'estimate';          present: true;  node: LineageNode; artifact: Estimate }
  | { stage: 'estimate';          present: false }
  | { stage: 'timeline';          present: true;  node: LineageNode; artifact: Timeline }
  | { stage: 'timeline';          present: false }
  | { stage: 'proposal';          present: true;  node: LineageNode; artifact: Proposal }
  | { stage: 'proposal';          present: false }
  | { stage: 'specification';     present: true;  node: LineageNode; artifact: Specification }
  | { stage: 'specification';     present: false };

export const STAGE_ORDER: Stage[] = [
  'intake',
  'discovery',
  'clarification',
  'scope',
  'estimate',
  'timeline',
  'proposal',
  'specification',
];

function nodeOf(stage: Stage, row: { id: string; version: number; created_at: string }): LineageNode {
  return { stage, id: row.id, version: row.version, createdAt: row.created_at };
}

export async function buildLineage(projectId: string): Promise<LineageSnapshot[]> {
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

  const stages: LineageSnapshot[] = [
    intake            ? { stage: 'intake',        present: true,  node: nodeOf('intake', intake),         artifact: intake }            : { stage: 'intake',        present: false },
    discovery         ? { stage: 'discovery',     present: true,  node: nodeOf('discovery', discovery),   artifact: discovery }         : { stage: 'discovery',     present: false },
    clarification     ? { stage: 'clarification', present: true,  node: nodeOf('clarification', clarification), artifact: clarification } : { stage: 'clarification', present: false },
    scope             ? { stage: 'scope',         present: true,  node: nodeOf('scope', scope),           artifact: scope }             : { stage: 'scope',         present: false },
    estimate          ? { stage: 'estimate',      present: true,  node: nodeOf('estimate', estimate),     artifact: estimate }          : { stage: 'estimate',      present: false },
    timeline          ? { stage: 'timeline',      present: true,  node: nodeOf('timeline', timeline),     artifact: timeline }          : { stage: 'timeline',      present: false },
    proposal          ? { stage: 'proposal',      present: true,  node: nodeOf('proposal', proposal),     artifact: proposal }          : { stage: 'proposal',      present: false },
    specification     ? { stage: 'specification', present: true,  node: nodeOf('specification', specification), artifact: specification } : { stage: 'specification', present: false },
  ];
  return stages;
}
