import { Router } from 'express';
import { ProjectController } from '../controllers/ProjectController';

const router = Router();

router.get('/', ProjectController.list);
router.post('/', ProjectController.create);
router.get('/:id', ProjectController.getById);
router.patch('/:id', ProjectController.update);
router.delete('/:id', ProjectController.deleteProject);
router.post('/:id/documents', ProjectController.generateDocument);
router.get('/documents/:id', ProjectController.getDocument);
router.patch('/documents/:id', ProjectController.updateDocument);
router.delete('/documents/:id', ProjectController.deleteDocument);

export default router;
