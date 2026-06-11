import { supabase } from '../config/supabase';
import { Project, Audience } from '../types';

/**
 * ProjectModel — Supabase queries for the `projects` table.
 * The post-refactor schema has columns: name, client_name, audience,
 * project_type, raw_requirement.
 */
export class ProjectModel {
  static async create(input: {
    name: string;
    client_name?: string;
    audience: Audience;
    project_type?: string;
    raw_requirement: string;
  }): Promise<Project> {
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: input.name,
        client_name: input.client_name ?? null,
        audience: input.audience,
        project_type: input.project_type ?? null,
        raw_requirement: input.raw_requirement,
      })
      .select('*')
      .single();

    if (error) throw new Error(`ProjectModel.create failed: ${error.message}`);
    return data;
  }

  static async findById(id: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`ProjectModel.findById failed: ${error.message}`);
    return data ?? null;
  }

  static async listAll(): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`ProjectModel.listAll failed: ${error.message}`);
    return data ?? [];
  }
}
