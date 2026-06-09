import { Router } from 'express';
import { ClarificationController } from '../controllers/ClarificationController';

const router = Router();

router.post('/generate', ClarificationController.generate);
router.post('/save', ClarificationController.save);
router.get('/:projectId', ClarificationController.listForProject);

export default router;
