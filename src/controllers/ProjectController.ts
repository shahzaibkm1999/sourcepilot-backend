import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ProjectModel } from '../models/ProjectModel';
import { DocumentModel } from '../models/DocumentModel';
import { DocumentOrchestrator } from '../services/DocumentOrchestrator';
import { ProjectWithDocuments, Audience, DocType } from '../types';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  client_name: z.string().max(200).optional(),
  audience: z.enum(['non_tecnico', 'tecnico']),
  project_type: z.string().max(100).optional(),
  raw_requirement: z.string().min(10).max(20_000),
});

const generateDocSchema = z.object({
  doc_type: z.enum(['proposal', 'tech_scope']),
});

/**
 * ProjectController
 * ---------------
 * The post-refactor surface. Three things a client can do:
 *   1. Capture a new project (intake)
 *   2. Generate a document for an existing project
 *   3. List all projects
 *
 * One controller, one route file. The old 6-controller pipeline is
 * gone.
 */
export class ProjectController {
  /** POST /api/projects — capture a new project (intake) */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createSchema.parse(req.body);
      const project = await ProjectModel.create(input);
      res.status(201).json({ project });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  /** GET /api/projects — list every project, newest first */
  static async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const projects = await ProjectModel.listAll();
      res.json({ projects });
    } catch (err) {
      next(err);
    }
  }

  /** GET /api/projects/:id — single project, with its documents */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Project id is required' });

      const project = await ProjectModel.findById(id);
      if (!project) return res.status(404).json({ error: `Project ${id} not found` });

      const documents = await DocumentModel.listForProject(id);
      const projectWithDocs: ProjectWithDocuments = { ...project, documents };
      res.json({ project: projectWithDocs });
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/projects/:id/documents — generate a document */
  static async generateDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Project id is required' });

      const { doc_type } = generateDocSchema.parse(req.body);
      const document = await new DocumentOrchestrator().generate(id, doc_type as DocType);
      res.status(201).json({ document });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  /** GET /api/documents/:id — fetch a single document (for downloads) */
  static async getDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Document id is required' });

      const document = await DocumentModel.findById(id);
      if (!document) return res.status(404).json({ error: `Document ${id} not found` });
      res.json({ document });
    } catch (err) {
      next(err);
    }
  }
}

// Re-export for type consumers (no extra runtime cost)
export type { Audience, DocType, ProjectWithDocuments };
