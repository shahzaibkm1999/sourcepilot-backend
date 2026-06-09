import { supabase } from '../config/supabase';

export interface Scope {
  id: string;
  project_id: string;
  in_scope: string[] | null;
  out_of_scope: string[] | null;
  future_considerations: string[] | null;
  dependencies: string[] | null;
  assumptions: string[] | null;
  risks: string[] | null;
  content: string | null;
  version: number;
  created_at: string;
}

export interface CreateScopeInput {
  projectId: string;
  inScope?: string[];
  outOfScope?: string[];
  futureConsiderations?: string[];
  dependencies?: string[];
  assumptions?: string[];
  risks?: string[];
  content?: string;
}

export class ScopeModel {
  static async create(input: CreateScopeInput): Promise<Scope> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('scopes')
      .insert({
        project_id: input.projectId,
        in_scope: input.inScope ?? null,
        out_of_scope: input.outOfScope ?? null,
        future_considerations: input.futureConsiderations ?? null,
        dependencies: input.dependencies ?? null,
        assumptions: input.assumptions ?? null,
        risks: input.risks ?? null,
        content: input.content ?? null,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`ScopeModel.create failed: ${error.message}`);
    return data;
  }

  static async getLatestVersion(projectId: string): Promise<Scope | null> {
    const { data, error } = await supabase
      .from('scopes')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ScopeModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }
}
