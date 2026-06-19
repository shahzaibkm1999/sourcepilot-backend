import { env } from '../config/env';
import { DocumentModel } from '../models/DocumentModel';

/**
 * QueueReaper
 * -----------
 * The document "queue" is in-process: DocumentOrchestrator inserts
 * a `pending` row, kicks off a fire-and-forget AI call, and flips
 * the row to `ready` or `failed` when done. If the Node process
 * dies mid-call (deploy, crash, kill -9), the row stays `pending`
 * forever and the frontend poller spins indefinitely.
 *
 * This reaper runs on a timer and flips every `pending` row older
 * than `QUEUE_REAPER_MAX_AGE_MS` to `failed`. The cutoff is well
 * past the longest legitimate generation (capped at
 * DEEPSEEK_TIMEOUT_MS * (1 + DEEPSEEK_MAX_RETRIES) plus backoff).
 *
 * One reaper per process. The REST server and the MCP server each
 * start their own (they run as separate processes).
 *
 * Not persistent / not transactional: this is best-effort cleanup.
 * If two processes are running (e.g. dev + prod accidentally), both
 * will reap; that's fine because `markStalePendingAsFailed` is
 * idempotent — a row that's already `failed` won't be touched.
 */
export class QueueReaper {
  private handle: NodeJS.Timeout | null = null;
  private running = false;

  /**
   * Start the periodic sweep. Also runs one sweep immediately so a
   * server that's just been restarted picks up orphans from the
   * previous run within seconds instead of waiting for the first
   * interval tick.
   */
  start(): void {
    if (this.handle !== null) return; // idempotent
    // Fire and forget; sweep() never throws.
    void this.sweep();
    this.handle = setInterval(
      () => void this.sweep(),
      env.QUEUE_REAPER_INTERVAL_MS,
    );
    // Don't hold the event loop open just for the reaper — the
    // server's listen() / MCP transport keep the process alive
    // already, and `unref` lets Node exit on a real shutdown.
    this.handle.unref?.();
  }

  /** Stop the periodic sweep. Idempotent. */
  stop(): void {
    if (this.handle === null) return;
    clearInterval(this.handle);
    this.handle = null;
  }

  /**
   * One sweep. Safe to call concurrently — `running` guards against
   * a slow Supabase round-trip overlapping the next interval tick.
   */
  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const reaped = await DocumentModel.markStalePendingAsFailed(
        env.QUEUE_REAPER_MAX_AGE_MS,
      );
      if (reaped > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[queue-reaper] flipped ${reaped} stale pending row(s) to failed ` +
            `(older than ${env.QUEUE_REAPER_MAX_AGE_MS}ms)`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[queue-reaper] sweep failed:', err);
    } finally {
      this.running = false;
    }
  }
}

/** Singleton — one reaper per process. */
export const queueReaper = new QueueReaper();
