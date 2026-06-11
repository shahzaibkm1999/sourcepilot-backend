import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import apiRoutes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

// ---- Global middleware ----
app.use(
  cors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: false,
  }),
);
app.use(express.json({ limit: '2mb' }));

// ---- Health check ----
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'docforge-backend',
    model: env.DEEPSEEK_MODEL,
    timestamp: new Date().toISOString(),
  });
});

// ---- API routes ----
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'docforge API',
    version: '0.2.0',
    description:
      'Audience-aware client document generator. Two templates: ' +
      '`proposal` (non-technical client) and `tech_scope` (technical client).',
    endpoints: [
      'GET    /health',
      'GET    /api/projects',
      'POST   /api/projects                       — capture a new project (intake)',
      'GET    /api/projects/:id                  — single project + its documents',
      'POST   /api/projects/:id/documents        — generate a document (proposal|tech_scope)',
      'GET    /api/projects/documents/:id        — fetch a single document',
    ],
  });
});

app.use('/api', apiRoutes);

// ---- 404 + error handling (must be last) ----
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
