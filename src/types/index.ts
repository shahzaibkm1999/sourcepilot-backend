/**
 * Shared domain types for the AI Software Planning Assistant backend.
 * Kept thin on purpose - they mirror the Supabase schema.
 */

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Specification {
  id: string;
  project_id: string;
  content: string;
  version: number;
  created_at: string;
}

/**
 * The shape returned to clients when they ask for a spec
 * with its parent project joined in.
 */
export interface SpecificationWithProject extends Specification {
  project: Pick<Project, 'id' | 'name' | 'description'>;
}

/**
 * What the Gemini service produces. Stored verbatim in
 * `specifications.content`.
 */
export interface GeneratedSpec {
  projectName: string;
  projectDescription: string;
  content: string;
}
