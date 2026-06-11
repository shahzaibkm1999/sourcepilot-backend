import { Router } from 'express';
import { ProjectController } from '../controllers/ProjectController';

const router = Router();

router.get('/', ProjectController.list);
router.post('/', ProjectController.create);
router.get('/:id', ProjectController.getById);
router.post('/:id/documents', ProjectController.generateDocument);
router.get('/documents/:id', ProjectController.getDocument);

export default router;
