import { Router } from 'express';
import { DiscoveryController } from '../controllers/DiscoveryController';

const router = Router();

router.post('/generate', DiscoveryController.generate);
router.get('/:projectId/latest', DiscoveryController.getLatest);

export default router;
