import { supabase } from '../config/supabase';

export interface TimelinePhase {
  name: string;                  // e.g. 'Discovery', 'Design', 'Development'
  duration_weeks: number;
  milestones: string[];
  dependencies: string[];        // names of phases this depends on
}
export interface Timeline {
  id: string;
  project_id: string;
  phases: TimelinePhase[];
  total_weeks: number | null;
  content: string | null;
  version: number;
  created_at: string;
}

export interface CreateTimelineInput {
  projectId: string;
  phases: TimelinePhase[];
  totalWeeks?: number;
  content?: string;
}

export class TimelineModel {
  static async create(input: CreateTimelineInput): Promise<Timeline> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('timelines')
      .insert({
        project_id: input.projectId,
        phases: input.phases,
        total_weeks: input.totalWeeks ?? null,
        content: input.content ?? null,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`TimelineModel.create failed: ${error.message}`);
    return data;
  }

  static async getLatestVersion(projectId: string): Promise<Timeline | null> {
    const { data, error } = await supabase
      .from('timelines')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`TimelineModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }
}
