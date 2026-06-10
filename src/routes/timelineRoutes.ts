import { Router } from 'express';
import { TimelineController } from '../controllers/TimelineController';

const router = Router();

router.post('/generate', TimelineController.generate);
router.get('/:projectId/latest', TimelineController.getLatest);

export default router;
