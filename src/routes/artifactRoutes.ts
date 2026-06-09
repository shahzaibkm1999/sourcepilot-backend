import { Router } from 'express';
import { ProjectStageController } from '../controllers/ProjectStageController';

const router = Router();

router.get('/:projectId/lineage', ProjectStageController.getLineage);

export default router;
