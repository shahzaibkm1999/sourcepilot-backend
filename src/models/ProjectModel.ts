import { supabase } from '../config/supabase';
import { Project } from '../types';

/**
 * ProjectModel
 * -----------
 * All Supabase queries that touch the `projects` table live here.
 * Controllers never call Supabase directly.
 */
export class ProjectModel {
  /**
   * Find a project by its (unique) name. Returns null if missing.
   */
  static async findByName(name: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('name', name)
      .maybeSingle();

    if (error) throw new Error(`ProjectModel.findByName failed: ${error.message}`);
    return data ?? null;
  }

  /**
   * Create a new project. Throws on duplicate name.
   */
  static async create(input: { name: string; description?: string }): Promise<Project> {
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: input.name,
        description: input.description ?? null,
      })
      .select('*')
      .single();

    if (error) throw new Error(`ProjectModel.create failed: ${error.message}`);
    return data;
  }

  /**
   * Upsert by name - create if missing, otherwise return the existing row.
   * Useful when the spec generator derives a project name from the idea.
   */
  static async upsertByName(input: { name: string; description?: string }): Promise<Project> {
    const existing = await this.findByName(input.name);
    if (existing) return existing;
    return this.create(input);
  }

  /**
   * List every project, newest first.
   */
  static async listAll(): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(`ProjectModel.listAll failed: ${error.message}`);
    return data ?? [];
  }
}
