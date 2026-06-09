import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import apiRoutes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

// ---- Global middleware ----
app.use(cors()); // Enable all CORS requests
app.use(express.json({ limit: '2mb' }));

// ---- Health check ----
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'ai-software-planning-assistant-backend',
    model: env.DEEPSEEK_MODEL,
    timestamp: new Date().toISOString(),
  });
});

// ---- API routes ----
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'AI Software Planning Assistant API',
    version: '0.1.0',
    endpoints: [
      'GET    /health',
      'GET    /api/projects',
      'GET    /api/projects/:name',
      'GET    /api/projects/:name/specifications',
      'GET    /api/projects/:id/completeness          (SourcePilot)',
      'GET    /api/artifacts/:projectId/lineage       (SourcePilot)',
      'POST   /api/intake                              (SourcePilot)',
      'GET    /api/intake/:projectId/latest            (SourcePilot)',
      'GET    /api/specifications',
      'GET    /api/specifications/:id',
      'GET    /api/specifications/by-name/:name',
      'POST   /api/specifications/generate',
      'POST   /api/specifications/save',
    ],
  });
});

app.use('/api', apiRoutes);

// ---- 404 + error handling (must be last) ----
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
