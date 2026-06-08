import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SpecificationGenerator } from '../services/SpecificationGenerator';
import { SupabaseService } from '../services/SupabaseService';
import { SpecificationModel } from '../models/SpecificationModel';

// ---- Request validation schemas ----
const generateSchema = z.object({
  projectIdea: z.string().min(3, 'projectIdea must be at least 3 characters').max(2000),
});

const saveSchema = z.object({
  projectName: z.string().min(1).max(200),
  projectDescription: z.string().max(2000).optional(),
  specificationContent: z.string().min(10),
});

/**
 * SpecificationController
 * -----------------------
 * HTTP layer for the four spec endpoints.
 */
export class SpecificationController {
  /**
   * POST /api/specifications/generate
   * Body: { projectIdea: string }
   * Calls Gemini, persists the result, returns the saved spec.
   */
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectIdea } = generateSchema.parse(req.body);
      const { generated, saved } = await new SpecificationGenerator().createAndSave(projectIdea);
      res.status(201).json({ generated, specification: saved });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  /**
   * GET /api/specifications
   * Lists every saved spec, newest first.
   */
  static async listAll(req: Request, res: Response, next: NextFunction) {
    try {
      const specifications = await SupabaseService.listSpecs();
      res.json({ specifications });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/specifications/:id
   * Returns a single spec by id, joined with its project.
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Specification id is required' });
      }
      const spec = await SpecificationModel.findById(id);
      if (!spec) {
        return res.status(404).json({ error: `Specification "${id}" not found` });
      }
      res.json({ specification: spec });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/specifications/by-name/:name
   * Returns the latest spec for a project, looked up by name.
   */
  static async getByProjectName(req: Request, res: Response, next: NextFunction) {
    try {
      const { name } = req.params;
      if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
      }
      const spec = await SupabaseService.getSpec(name);
      if (!spec) {
        return res.status(404).json({ error: `No specification found for "${name}"` });
      }
      res.json({ specification: spec });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/specifications/save
   * Body: { projectName, projectDescription?, specificationContent }
   * Saves an already-generated spec to Supabase.
   */
  static async save(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectName, projectDescription, specificationContent } = saveSchema.parse(req.body);
      const { project, specification } = await SupabaseService.saveSpec({
        projectName,
        projectDescription,
        content: specificationContent,
      });
      res.status(201).json({ project, specification });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }
}
