import { Request, Response, NextFunction } from 'express';

/**
 * Catches anything thrown downstream and returns a clean JSON error.
 * Without this, Express would default to a blank 500 with an HTML body.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  const status = (err as Error & { status?: number }).status ?? 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
}

/**
 * 404 catch-all for unknown routes.
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}
