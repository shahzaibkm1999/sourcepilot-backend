import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

const generateSchema = z.object({ projectId: z.string().uuid() });

export class ProposalController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = generateSchema.parse(req.body);
      const { proposal, completeness } = await new ProjectOrchestrator().generateProposal(projectId);
      res.status(201).json({ proposal, completeness });
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
      const proposal = await new ProjectOrchestrator().getLatestProposal(projectId);
      if (!proposal) return res.status(404).json({ error: `No proposal for project ${projectId}` });
      res.json({ proposal });
    } catch (err) {
      next(err);
    }
  }
}
