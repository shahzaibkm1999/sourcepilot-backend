import { Router } from 'express';
import projectRoutes from './projectRoutes';

const router = Router();

router.use('/projects', projectRoutes);

export default router;
