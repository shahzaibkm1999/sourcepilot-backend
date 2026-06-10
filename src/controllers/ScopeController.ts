import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

const generateSchema = z.object({ projectId: z.string().uuid() });

export class ScopeController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = generateSchema.parse(req.body);
      const { scope, completeness } = await new ProjectOrchestrator().generateScope(projectId);
      res.status(201).json({ scope, completeness });
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
      const scope = await new ProjectOrchestrator().getLatestScope(projectId);
      if (!scope) return res.status(404).json({ error: `No scope for project ${projectId}` });
      res.json({ scope });
    } catch (err) {
      next(err);
    }
  }
}
