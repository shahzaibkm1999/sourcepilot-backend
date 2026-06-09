import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

// ---- Request validation schemas ----
const createIntakeSchema = z.object({
  projectName: z.string().min(1).max(200),
  projectDescription: z.string().max(2000).optional(),
  projectType: z.enum(['web', 'mobile', 'saas', 'internal', 'api', 'other']).optional(),
  engagement: z.enum(['fixed_price', 'hourly']).optional(),
  timelinePref: z.enum(['1-2w', '1m', '2-3m', '3-6m', 'flexible']).optional(),
  requirement: z.string().min(10, 'requirement must be at least 10 characters').max(20000),
  details: z.string().max(20000).optional(),
  constraints: z.string().max(20000).optional(),
});

/**
 * IntakeController
 * ----------------
 * HTTP layer for the SourcePilot intake stage.
 * All real work happens in ProjectOrchestrator (Constitution Article II).
 */
export class IntakeController {
  /**
   * POST /api/intake
   * Body: { projectName, projectType?, engagement?, timelinePref?, requirement, details?, constraints? }
   * Returns: { project, intake, completeness }
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createIntakeSchema.parse(req.body);
      const orchestrator = new ProjectOrchestrator();
      const { project, intake } = await orchestrator.createIntake(input);
      const completeness = await orchestrator.getCompleteness(project.id);
      res.status(201).json({ project, intake, completeness });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  /**
   * GET /api/intake/:projectId/latest
   */
  static async getLatest(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      const intake = await new ProjectOrchestrator().getLatestIntake(projectId);
      if (!intake) {
        return res.status(404).json({ error: `No intake found for project ${projectId}` });
      }
      res.json({ intake });
    } catch (err) {
      next(err);
    }
  }
}
