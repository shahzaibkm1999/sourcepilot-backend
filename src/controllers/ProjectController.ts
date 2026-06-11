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

/**
 * PATCH body for a project. Every field is optional; absent keys
 * are left untouched, `null` for a nullable field clears it.
 * The refine() rejects empty bodies so a PATCH with `{}` returns
 * 400 instead of a silent no-op.
 */
const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    client_name: z.string().max(200).nullable().optional(),
    audience: z.enum(['non_tecnico', 'tecnico']).optional(),
    project_type: z.string().max(100).nullable().optional(),
    raw_requirement: z.string().min(10).max(20_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

/**
 * PATCH body for a document. Only `content_markdown` is editable —
 * `doc_type` and `project_id` are intentionally not in the schema
 * (a version is forever a version of its type; a document belongs
 * to the project it was generated for).
 */
const updateDocumentSchema = z.object({
  content_markdown: z.string().min(1).max(50_000),
});

const generateDocSchema = z.object({
  doc_type: z.enum(['proposal', 'tech_scope']),
});

/**
 * Query params for `GET /api/projects`. `limit` is clamped to
 * `[1, 100]` to prevent abuse; `offset` must be `>= 0`. Express
 * gives us string values; `z.coerce.number()` parses them.
 */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
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

  /** GET /api/projects — paginated list, newest first */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { limit, offset } = listQuerySchema.parse(req.query);
      const { projects, total } = await ProjectModel.listAll({ limit, offset });
      const hasMore = offset + projects.length < total;
      res.json({ projects, total, hasMore });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
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

  /** PATCH /api/projects/:id — partial update of project fields */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Project id is required' });

      const partial = updateProjectSchema.parse(req.body);
      const project = await ProjectModel.update(id, partial);
      if (!project) return res.status(404).json({ error: `Project ${id} not found` });
      res.json({ project });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  /** DELETE /api/projects/:id — hard-delete (cascades to documents) */
  static async deleteProject(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Project id is required' });

      const deleted = await ProjectModel.delete(id);
      if (!deleted) return res.status(404).json({ error: `Project ${id} not found` });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /api/projects/documents/:id — edit a document's body */
  static async updateDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Document id is required' });

      const { content_markdown } = updateDocumentSchema.parse(req.body);
      const document = await DocumentModel.update(id, content_markdown);
      if (!document) return res.status(404).json({ error: `Document ${id} not found` });
      res.json({ document });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: err.flatten() });
      }
      next(err);
    }
  }

  /** DELETE /api/projects/documents/:id — hard-delete a single version */
  static async deleteDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: 'Document id is required' });

      const deleted = await DocumentModel.delete(id);
      if (!deleted) return res.status(404).json({ error: `Document ${id} not found` });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}

// Re-export for type consumers (no extra runtime cost)
export type { Audience, DocType, ProjectWithDocuments };
