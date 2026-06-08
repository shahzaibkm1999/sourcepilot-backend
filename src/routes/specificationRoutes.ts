import { Router } from 'express';
import { SpecificationController } from '../controllers/SpecificationController';

const router = Router();

router.post('/generate', SpecificationController.generate);
router.post('/save', SpecificationController.save);
router.get('/', SpecificationController.listAll);
router.get('/by-name/:name', SpecificationController.getByProjectName);
router.get('/:id', SpecificationController.getById);

export default router;
