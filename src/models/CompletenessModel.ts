import { supabase } from '../config/supabase';

export interface CompletenessScore {
  project_id: string;
  score: number;
  missing: string[] | null;
  updated_at: string;
}

export interface UpsertCompletenessInput {
  projectId: string;
  score: number;
  missing: string[];
}

export class CompletenessModel {
  static async upsert(input: UpsertCompletenessInput): Promise<CompletenessScore> {
    const { data, error } = await supabase
      .from('completeness_scores')
      .upsert(
        {
          project_id: input.projectId,
          score: input.score,
          missing: input.missing,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id' },
      )
      .select('*')
      .single();

    if (error) throw new Error(`CompletenessModel.upsert failed: ${error.message}`);
    return data;
  }

  static async get(projectId: string): Promise<CompletenessScore | null> {
    const { data, error } = await supabase
      .from('completeness_scores')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) throw new Error(`CompletenessModel.get failed: ${error.message}`);
    return data ?? null;
  }
}
