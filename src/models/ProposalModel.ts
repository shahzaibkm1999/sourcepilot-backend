import { supabase } from '../config/supabase';

export interface Proposal {
  id: string;
  project_id: string;
  executive_summary: string | null;
  understanding: string | null;
  scope_summary: string | null;
  deliverables: string[] | null;
  content: string | null;
  version: number;
  created_at: string;
}

export interface CreateProposalInput {
  projectId: string;
  executiveSummary?: string;
  understanding?: string;
  scopeSummary?: string;
  deliverables?: string[];
  content: string;             // full markdown is required for the viewer
}

export class ProposalModel {
  static async create(input: CreateProposalInput): Promise<Proposal> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('proposals')
      .insert({
        project_id: input.projectId,
        executive_summary: input.executiveSummary ?? null,
        understanding: input.understanding ?? null,
        scope_summary: input.scopeSummary ?? null,
        deliverables: input.deliverables ?? null,
        content: input.content,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`ProposalModel.create failed: ${error.message}`);
    return data;
  }

  static async getLatestVersion(projectId: string): Promise<Proposal | null> {
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ProposalModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }
}
