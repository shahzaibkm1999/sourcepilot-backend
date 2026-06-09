import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectOrchestrator } from '../services/ProjectOrchestrator';

const questionSchema = z.object({
  id: z.string().min(1).max(60),
  area: z.string().min(1).max(60),
  question: z.string().min(1).max(280),
  answer: z.string().max(4000).optional().nullable(),
  status: z.enum(['pending', 'answered']).default('pending'),
});

const generateSchema = z.object({
  projectId: z.string().uuid(),
});

const saveSchema = z.object({
  projectId: z.string().uuid(),
  questions: z.array(questionSchema).min(1).max(20),
  refinedInput: z.string().min(1).optional(),
});

/**
 * ClarificationController
 * -----------------------
 * POST /api/clarifications/generate   — ask DeepSeek for next batch
 * POST /api/clarifications/save       — save answers (creates new version)
 * GET  /api/clarifications/:projectId — list all iterations
 */
export class ClarificationController {
  static async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = generateSchema.parse(req.body);
      const { clarification, completeness } = await new ProjectOrchestrator().generateClarifications(projectId);
      res.status(201).json({ clarification, completeness });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  static async save(req: Request, res: Response, next: NextFunction) {
    try {
      const input = saveSchema.parse(req.body);
      const { clarification, completeness } = await new ProjectOrchestrator().saveClarifications(input);
      res.status(201).json({ clarification, completeness });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  static async listForProject(req: Request, res: Response, next: NextFunction) {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      const items = await new ProjectOrchestrator().listClarifications(projectId);
      res.json({ projectId, clarifications: items });
    } catch (err) {
      next(err);
    }
  }
}
