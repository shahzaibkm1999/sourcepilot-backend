import { Router } from 'express';
import projectRoutes from './projectRoutes';
import specificationRoutes from './specificationRoutes';

const router = Router();

router.use('/projects', projectRoutes);
router.use('/specifications', specificationRoutes);

export default router;
