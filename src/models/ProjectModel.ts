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

  /**
   * Paginated list, newest first. Returns the requested page of
   * projects plus the total row count, so the caller can compute
   * `hasMore` without a second query.
   *
   * `count: 'exact'` returns the full table count in the same
   * response. `.range(start, end)` is inclusive on both ends per
   * PostgREST; we want `[offset, offset + limit - 1]`.
   */
  static async listAll(opts: {
    limit: number;
    offset: number;
  }): Promise<{ projects: Project[]; total: number }> {
    const { limit, offset } = opts;
    const { data, error, count } = await supabase
      .from('projects')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(`ProjectModel.listAll failed: ${error.message}`);
    return { projects: data ?? [], total: count ?? 0 };
  }

  /**
   * Partial-update a project. Only the keys present in `partial` are
   * written; absent keys are left untouched. `null` for an optional
   * field clears it.
   *
   * Returns the updated row, or `null` if no row with that id exists.
   */
  static async update(
    id: string,
    partial: {
      name?: string;
      client_name?: string | null;
      audience?: 'non_tecnico' | 'tecnico';
      project_type?: string | null;
      raw_requirement?: string;
    },
  ): Promise<Project | null> {
    const { data, error } = await supabase
      .from('projects')
      .update(partial)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`ProjectModel.update failed: ${error.message}`);
    return data ?? null;
  }

  /**
   * Hard-delete a project. Document rows are removed by the
   * `documents.project_id` FK's ON DELETE CASCADE constraint — we
   * do not delete them from Node.
   *
   * Returns `true` if a row was deleted, `false` if no row matched.
   */
  static async delete(id: string): Promise<boolean> {
    const { error, count } = await supabase
      .from('projects')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new Error(`ProjectModel.delete failed: ${error.message}`);
    return (count ?? 0) > 0;
  }
}
