import { supabase } from '../config/supabase';

export interface DiscoveryAmbiguity {
  area: string;
  question: string;
  priority: 'low' | 'medium' | 'high';
}
export interface DiscoveryRisk {
  title: string;
  severity: 'low' | 'medium' | 'high';
  mitigation?: string;
}
export interface Discovery {
  id: string;
  project_id: string;
  ambiguities: DiscoveryAmbiguity[] | null;
  missing_info: string[] | null;
  risks: DiscoveryRisk[] | null;
  assumptions: string[] | null;
  content: string | null;
  version: number;
  created_at: string;
}

export interface CreateDiscoveryInput {
  projectId: string;
  ambiguities?: DiscoveryAmbiguity[];
  missingInfo?: string[];
  risks?: DiscoveryRisk[];
  assumptions?: string[];
  content?: string;
}

export class DiscoveryModel {
  static async create(input: CreateDiscoveryInput): Promise<Discovery> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('discoveries')
      .insert({
        project_id: input.projectId,
        ambiguities: input.ambiguities ?? null,
        missing_info: input.missingInfo ?? null,
        risks: input.risks ?? null,
        assumptions: input.assumptions ?? null,
        content: input.content ?? null,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`DiscoveryModel.create failed: ${error.message}`);
    return data;
  }

  static async getLatestVersion(projectId: string): Promise<Discovery | null> {
    const { data, error } = await supabase
      .from('discoveries')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`DiscoveryModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }
}
