import { ProjectModel } from '../models/ProjectModel';
import { SpecificationModel } from '../models/SpecificationModel';
import { Project, Specification, SpecificationWithProject } from '../types';

/**
 * SupabaseService
 * ---------------
 * Thin orchestration layer used by controllers and the MCP server.
 * Encapsulates the "create project + add spec version" flow so the
 * rest of the app never has to know that two tables are involved.
 */
export class SupabaseService {
  /**
   * Save (or update) a specification for a project.
   * - If the project doesn't exist, create it.
   * - Always inserts a new row in `specifications` with an incremented version.
   * - The same name can be re-saved to create v2, v3, etc.
   */
  static async saveSpec(input: {
    projectName: string;
    projectDescription?: string;
    content: string;
  }): Promise<{ project: Project; specification: Specification }> {
    const project = await ProjectModel.upsertByName({
      name: input.projectName,
      description: input.projectDescription,
    });

    const specification = await SpecificationModel.create({
      projectId: project.id,
      content: input.content,
    });

    return { project, specification };
  }

  /**
   * Retrieve the latest spec for a project name, joined with the project row.
   */
  static async getSpec(projectName: string): Promise<SpecificationWithProject | null> {
    return SpecificationModel.getLatestByProjectName(projectName);
  }

  /**
   * List every saved specification, newest first.
   */
  static async listSpecs(): Promise<SpecificationWithProject[]> {
    return SpecificationModel.listAll();
  }
}
