import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

const generateSchema = z.object({ projectId: z.string().uuid() });

export class EstimateController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = generateSchema.parse(req.body);
      const { estimate, completeness } = await new ProjectOrchestrator().generateEstimate(projectId);
      res.status(201).json({ estimate, completeness });
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
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      const estimate = await new ProjectOrchestrator().getLatestEstimate(projectId);
      if (!estimate) return res.status(404).json({ error: `No estimate for project ${projectId}` });
      res.json({ estimate });
    } catch (err) {
      next(err);
    }
  }
}
