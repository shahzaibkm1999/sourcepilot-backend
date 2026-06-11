import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import apiRoutes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

/**
 * Parse the CORS_ORIGIN env var into the shape `cors` expects.
 *
 * Supported forms (comma-separated values, or a single value):
 *   - '*'           → reflect any request origin (dev / fully open)
 *   - 'https://x'   → exact-origin allow-list entry
 *   - 'https://*.x' → wildcard sub-pattern, e.g.
 *                     'https://sourcepilot-frontend-*.vercel.app'
 *                     matches every Vercel preview + production
 *                     deployment of that project
 *
 * Wildcard entries are compiled to anchored RegExps; the
 * `cors` middleware accepts an array of mixed strings and
 * RegExps, so we can hand it through unchanged.
 */
function parseCorsOrigin(
  value: string,
): true | string | RegExp | (string | RegExp)[] {
  if (value === '*') return true;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      if (!entry.includes('*')) return entry;
      // Escape regex metachars (except `*`), then turn `*` into `.*`.
      const pattern = entry
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return new RegExp(`^${pattern}$`);
    });
}

// ---- Global middleware ----
app.use(
  cors({
    origin: parseCorsOrigin(env.CORS_ORIGIN),
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
      'GET    /api/projects?limit=&offset=         — paginated list, newest first (limit: 1-100, default 20)',
      'POST   /api/projects                       — capture a new project (intake)',
      'GET    /api/projects/:id                  — single project + its documents',
      'PATCH  /api/projects/:id                  — partial update of project fields',
      'DELETE /api/projects/:id                  — hard-delete (cascades to documents)',
      'POST   /api/projects/:id/documents        — generate a document (proposal|tech_scope)',
      'GET    /api/projects/documents/:id        — fetch a single document',
      'PATCH  /api/projects/documents/:id        — edit a document\'s body',
      'DELETE /api/projects/documents/:id        — hard-delete a single document version',
    ],
  });
});

app.use('/api', apiRoutes);

// ---- 404 + error handling (must be last) ----
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
