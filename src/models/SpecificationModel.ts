import { supabase } from '../config/supabase';
import { Specification, SpecificationWithProject } from '../types';

/**
 * SpecificationModel
 * ------------------
 * Supabase queries for the `specifications` table.
 * Each insert is a new version of the spec for a given project.
 */
export class SpecificationModel {
  /**
   * Insert a new specification version for a project.
   * The version number is computed as (latest version + 1).
   */
  static async create(input: { projectId: string; content: string }): Promise<Specification> {
    const latest = await this.getLatestVersion(input.projectId);
    const nextVersion = latest ? latest.version + 1 : 1;

    const { data, error } = await supabase
      .from('specifications')
      .insert({
        project_id: input.projectId,
        content: input.content,
        version: nextVersion,
      })
      .select('*')
      .single();

    if (error) throw new Error(`SpecificationModel.create failed: ${error.message}`);
    return data;
  }

  /**
   * Get the latest specification for a project (highest version).
   * Returns null if the project has no specs yet.
   */
  static async getLatestVersion(projectId: string): Promise<Specification | null> {
    const { data, error } = await supabase
      .from('specifications')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`SpecificationModel.getLatestVersion failed: ${error.message}`);
    return data ?? null;
  }

  /**
   * Convenience helper: lookup the latest spec for a project by its name.
   * Returns null if the project or its spec is missing.
   */
  static async getLatestByProjectName(projectName: string): Promise<SpecificationWithProject | null> {
    const { data, error } = await supabase
      .from('specifications')
      .select('*, project:projects(id, name, description)')
      .eq('project.name', projectName)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`SpecificationModel.getLatestByProjectName failed: ${error.message}`);
    return (data as unknown as SpecificationWithProject) ?? null;
  }

  /**
   * List every specification joined with its project, newest first.
   */
  static async listAll(): Promise<SpecificationWithProject[]> {
    const { data, error } = await supabase
      .from('specifications')
      .select('*, project:projects(id, name, description)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`SpecificationModel.listAll failed: ${error.message}`);
    return (data as unknown as SpecificationWithProject[]) ?? [];
  }

  /**
   * Get a single specification by its id.
   */
  static async findById(id: string): Promise<SpecificationWithProject | null> {
    const { data, error } = await supabase
      .from('specifications')
      .select('*, project:projects(id, name, description)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(`SpecificationModel.findById failed: ${error.message}`);
    return (data as unknown as SpecificationWithProject) ?? null;
  }
}
