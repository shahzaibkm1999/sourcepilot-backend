import { Router } from 'express';
import { IntakeController } from '../controllers/IntakeController';

const router = Router();

router.post('/', IntakeController.create);
router.get('/:projectId/latest', IntakeController.getLatest);

export default router;
