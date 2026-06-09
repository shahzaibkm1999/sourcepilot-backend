import { Router } from 'express';
import { ProjectController } from '../controllers/ProjectController';
import { ProjectStageController } from '../controllers/ProjectStageController';

const router = Router();

router.get('/', ProjectController.listProjects);
router.get('/:name', ProjectController.getProjectByName);
router.get('/:name/specifications', ProjectController.listProjectSpecs);
// SourcePilot: completeness by project id (UUID).
// NOTE: this is a separate path from `/api/projects/:name` (which uses
// the human-readable name). Clients must look up the id from
// `GET /api/projects`.
router.get('/:id/completeness', ProjectStageController.getCompleteness);

export default router;
