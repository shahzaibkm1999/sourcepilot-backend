import { GeminiService } from './GeminiService';
import { SupabaseService } from './SupabaseService';
import { ProjectModel } from '../models/ProjectModel';
import { GeneratedSpec, SpecificationWithProject } from '../types';

/**
 * SpecificationGenerator
 * ----------------------
 * High-level orchestration: ask Gemini for a spec, then persist it
 * to Supabase. Used by both the HTTP layer and the MCP `create_spec` tool
 * so the two entry points stay in sync.
 */
export class SpecificationGenerator {
  private gemini: GeminiService;

  constructor() {
    this.gemini = new GeminiService();
  }

  /**
   * Generate a spec for an idea AND save it. Returns the saved row
   * (with joined project metadata) so the caller can show it immediately.
   */
  async createAndSave(projectIdea: string): Promise<{
    generated: GeneratedSpec;
    saved: SpecificationWithProject;
  }> {
    const generated = await this.gemini.generateSpecification(projectIdea);

    const { specification } = await SupabaseService.saveSpec({
      projectName: generated.projectName,
      projectDescription: generated.projectDescription,
      content: generated.content,
    });

    // Re-fetch the project so the caller gets a single joined object.
    const project = await ProjectModel.findByName(generated.projectName);
    if (!project) {
      throw new Error(
        `SpecificationGenerator: project "${generated.projectName}" vanished after save`,
      );
    }

    const saved: SpecificationWithProject = {
      ...specification,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
    };

    return { generated, saved };
  }
}
