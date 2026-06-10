import { Router } from 'express';
import { ScopeController } from '../controllers/ScopeController';

const router = Router();

router.post('/generate', ScopeController.generate);
router.get('/:projectId/latest', ScopeController.getLatest);

export default router;
