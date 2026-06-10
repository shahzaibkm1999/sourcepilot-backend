import { Router } from 'express';
import { ProposalController } from '../controllers/ProposalController';

const router = Router();

router.post('/generate', ProposalController.generate);
router.get('/:projectId/latest', ProposalController.getLatest);

export default router;
