import { supabase } from '../config/supabase';

export interface ArtifactLink {
  id: string;
  project_id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relation: string | null;
  created_at: string;
}

export interface CreateArtifactLinkInput {
  projectId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relation?: string;
}

export class ArtifactLinkModel {
  static async create(input: CreateArtifactLinkInput): Promise<ArtifactLink> {
    const { data, error } = await supabase
      .from('artifact_links')
      .insert({
        project_id: input.projectId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        target_type: input.targetType,
        target_id: input.targetId,
        relation: input.relation ?? 'derived_from',
      })
      .select('*')
      .single();

    if (error) throw new Error(`ArtifactLinkModel.create failed: ${error.message}`);
    return data;
  }

  static async listForProject(projectId: string): Promise<ArtifactLink[]> {
    const { data, error } = await supabase
      .from('artifact_links')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`ArtifactLinkModel.listForProject failed: ${error.message}`);
    return data ?? [];
  }
}
