import { Router } from 'express';
import projectRoutes from './projectRoutes';
import specificationRoutes from './specificationRoutes';
import artifactRoutes from './artifactRoutes';
import intakeRoutes from './intakeRoutes';

const router = Router();

router.use('/projects', projectRoutes);
router.use('/specifications', specificationRoutes);
router.use('/artifacts', artifactRoutes);
router.use('/intake', intakeRoutes);

export default router;
