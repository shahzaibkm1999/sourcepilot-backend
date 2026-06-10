import { Router } from 'express';
import projectRoutes from './projectRoutes';
import specificationRoutes from './specificationRoutes';
import artifactRoutes from './artifactRoutes';
import intakeRoutes from './intakeRoutes';
import discoveryRoutes from './discoveryRoutes';
import clarificationRoutes from './clarificationRoutes';
import scopeRoutes from './scopeRoutes';
import estimateRoutes from './estimateRoutes';
import timelineRoutes from './timelineRoutes';

const router = Router();

router.use('/projects', projectRoutes);
router.use('/specifications', specificationRoutes);
router.use('/artifacts', artifactRoutes);
router.use('/intake', intakeRoutes);
router.use('/discoveries', discoveryRoutes);
router.use('/clarifications', clarificationRoutes);
router.use('/scope', scopeRoutes);
router.use('/estimate', estimateRoutes);
router.use('/timeline', timelineRoutes);

export default router;
