import { supabase } from '../config/supabase';

export interface Intake {
  id: string;
  project_id: string;
  project_type: string | null;
  engagement: string | null;
  timeline_pref: string | null;
  requirement: string;
  details: string | null;
  constraints: string | null;
  version: number;
  created_at: string;
}

export interface CreateIntakeInput {
  projectId: string;
  projectType?: string;
  engagement?: string;
  timelinePref?: string;
  requirement: string;
  details?: string;
  constraints?: string;
}

/**
 * IntakeModel — Supabase queries for `intakes`.
 * Each insert is a new version of the intake for that project.
 */
export class IntakeModel {
  static async create(input: CreateIntakeInput): Promise<Intake> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('intakes')
      .insert({
        project_id: input.projectId,
        project_type: input.projectType ?? null,
        engagement: input.engagement ?? null,
        timeline_pref: input.timelinePref ?? null,
        requirement: input.requirement,
        details: input.details ?? null,
        constraints: input.constraints ?? null,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`IntakeModel.create failed: ${error.message}`);
    return data;
  }

  static async getLatestVersion(projectId: string): Promise<Intake | null> {
    const { data, error } = await supabase
      .from('intakes')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`IntakeModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }

  static async listForProject(projectId: string): Promise<Intake[]> {
    const { data, error } = await supabase
      .from('intakes')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false });
    if (error) throw new Error(`IntakeModel.listForProject failed: ${error.message}`);
    return data ?? [];
  }
}
