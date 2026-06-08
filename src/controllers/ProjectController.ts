import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';
import { ProjectModel } from '../models/ProjectModel';
import { Specification } from '../types';

/**
 * ProjectController
 * -----------------
 * Thin HTTP layer for project + spec listing endpoints.
 * All real work happens in the models / services.
 */
export class ProjectController {
  /**
   * GET /api/projects
   * Returns every project, newest first.
   */
  static async listProjects(_req: Request, res: Response, next: NextFunction) {
    try {
      const projects = await ProjectModel.listAll();
      res.json({ projects });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/projects/:name
   * Returns one project by its unique name.
   */
  static async getProjectByName(req: Request, res: Response, next: NextFunction) {
    try {
      const name = req.params.name;
      if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
      }
      const project = await ProjectModel.findByName(name);
      if (!project) {
        return res.status(404).json({ error: `Project "${name}" not found` });
      }
      res.json({ project });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/projects/:name/specifications
   * Returns every spec version for a given project, newest first.
   */
  static async listProjectSpecs(req: Request, res: Response, next: NextFunction) {
    try {
      const name = req.params.name;
      if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
      }
      const project = await ProjectModel.findByName(name);
      if (!project) {
        return res.status(404).json({ error: `Project "${name}" not found` });
      }

      const { data, error } = await supabase
        .from('specifications')
        .select('*')
        .eq('project_id', project.id)
        .order('version', { ascending: false });

      if (error) throw new Error(error.message);
      res.json({ project, specifications: (data ?? []) as Specification[] });
    } catch (err) {
      next(err);
    }
  }
}
