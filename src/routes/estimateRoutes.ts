import { Router } from 'express';
import { EstimateController } from '../controllers/EstimateController';

const router = Router();

router.post('/generate', EstimateController.generate);
router.get('/:projectId/latest', EstimateController.getLatest);

export default router;
