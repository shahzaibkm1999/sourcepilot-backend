/**
 * Local entry point: `node dist/server.js` (or `ts-node src/server.ts` in dev).
 * Kept separate from `app.ts` so `app.ts` stays importable for tests.
 */
import app from './app';
import { env } from './config/env';
import { queueReaper } from './services/QueueReaper';

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `🚀 AI Software Planning Assistant API listening on http://localhost:${env.PORT}  (${env.NODE_ENV})`,
  );
  // eslint-disable-next-line no-console
  console.log(`   Using model: ${env.DEEPSEEK_MODEL}`);
  // eslint-disable-next-line no-console
  console.log(`   Supabase:    ${env.SUPABASE_URL}`);

  // Start the orphan-pending sweeper. Runs one pass immediately so
  // a restart picks up rows from the previous (crashed) instance
  // within seconds.
  queueReaper.start();
  // eslint-disable-next-line no-console
  console.log(
    `   Queue reaper: every ${env.QUEUE_REAPER_INTERVAL_MS}ms, max-age ${env.QUEUE_REAPER_MAX_AGE_MS}ms`,
  );
});

/**
 * Graceful shutdown on SIGTERM (deploy / container stop) and
 * SIGINT (Ctrl-C). Stop the reaper, then close the HTTP server so
 * in-flight requests get a chance to finish.
 *
 * Note: in-flight DeepSeek calls (fire-and-forget Promises) are
 * NOT awaited — that's what the reaper is for. If we awaited them
 * a slow generation could block shutdown for 90s+ (the DeepSeek
 * timeout). The reaper sweeps the orphans next boot.
 */
function shutdown(signal: NodeJS.Signals): void {
  // eslint-disable-next-line no-console
  console.log(`\n[server] ${signal} received, shutting down…`);
  queueReaper.stop();
  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('[server] close error:', err);
      process.exit(1);
    }
    process.exit(0);
  });
  // Hard exit if close() hangs for more than 10s (e.g. a stuck
  // long-lived connection). Real deploys want this.
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error('[server] graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
