import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

const generateSchema = z.object({
  projectId: z.string().uuid(),
});

/**
 * DiscoveryController
 * -------------------
 * POST /api/discoveries/generate
 * GET  /api/discoveries/:projectId/latest
 */
export class DiscoveryController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = generateSchema.parse(req.body);
      const { discovery, completeness } = await new ProjectOrchestrator().generateDiscovery(projectId);
      res.status(201).json({ discovery, completeness });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  static async getLatest(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      const discovery = await new ProjectOrchestrator().getLatestDiscovery(projectId);
      if (!discovery) {
        return res.status(404).json({ error: `No discovery for project ${projectId}` });
      }
      res.json({ discovery });
    } catch (err) {
      next(err);
    }
  }
}
