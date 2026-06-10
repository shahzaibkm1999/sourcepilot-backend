import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

const generateSchema = z.object({ projectId: z.string().uuid() });

export class TimelineController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = generateSchema.parse(req.body);
      const { timeline, completeness } = await new ProjectOrchestrator().generateTimeline(projectId);
      res.status(201).json({ timeline, completeness });
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
      const timeline = await new ProjectOrchestrator().getLatestTimeline(projectId);
      if (!timeline) return res.status(404).json({ error: `No timeline for project ${projectId}` });
      res.json({ timeline });
    } catch (err) {
      next(err);
    }
  }
}
