import { Router } from 'express';
import { ProjectController } from '../controllers/ProjectController';

const router = Router();

router.get('/', ProjectController.listProjects);
router.get('/:name', ProjectController.getProjectByName);
router.get('/:name/specifications', ProjectController.listProjectSpecs);

export default router;
