import { supabase } from '../config/supabase';

export interface ClarificationQuestion {
  id: string;
  area: string;
  question: string;
  answer?: string | null;
  status: 'pending' | 'answered';
}
export interface Clarification {
  id: string;
  project_id: string;
  questions: ClarificationQuestion[];
  refined_input: string | null;
  version: number;
  created_at: string;
}

export interface CreateClarificationInput {
  projectId: string;
  questions: ClarificationQuestion[];
  refinedInput?: string;
}

export class ClarificationModel {
  static async create(input: CreateClarificationInput): Promise<Clarification> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('clarifications')
      .insert({
        project_id: input.projectId,
        questions: input.questions,
        refined_input: input.refinedInput ?? null,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`ClarificationModel.create failed: ${error.message}`);
    return data;
  }

  static async getLatestVersion(projectId: string): Promise<Clarification | null> {
    const { data, error } = await supabase
      .from('clarifications')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ClarificationModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }

  static async listForProject(projectId: string): Promise<Clarification[]> {
    const { data, error } = await supabase
      .from('clarifications')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false });
    if (error) throw new Error(`ClarificationModel.listForProject failed: ${error.message}`);
    return data ?? [];
  }
}
