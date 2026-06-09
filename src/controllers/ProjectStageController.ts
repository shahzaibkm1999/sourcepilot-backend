import { Request, Response, NextFunction } from 'express';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

/**
 * ProjectStageController
 * ----------------------
 * Read-side endpoints for the SourcePilot dashboard:
 *   GET /api/projects/:id/completeness
 *   GET /api/artifacts/:projectId/lineage
 */
export class ProjectStageController {
  static async getCompleteness(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Project id is required' });
      }
      const result = await new ProjectOrchestrator().getCompleteness(id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  static async getLineage(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      const lineage = await new ProjectOrchestrator().getLineage(projectId);
      res.json({ projectId, lineage });
    } catch (err) {
      next(err);
    }
  }
}
