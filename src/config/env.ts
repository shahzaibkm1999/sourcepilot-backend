import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Centralised, validated environment configuration.
 * The app refuses to start if a required value is missing.
 *
 * SourcePilot — uses DeepSeek as the AI provider.
 * DeepSeek is OpenAI-compatible; we hit
 *   https://api.deepseek.com/v1/chat/completions
 * with a plain `fetch` (see backend/src/services/DeepSeekService.ts).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'staging', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  DEEPSEEK_API_KEY: z.string().min(1, 'DEEPSEEK_API_KEY is required'),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4-pro'),

  /**
   * Hard timeout on each DeepSeek HTTP call. The reasoning model
   * occasionally spends 60-80s on long prompts; 90s is generous
   * without letting a hung fetch sit forever and leave a row
   * `pending` indefinitely.
   */
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  /**
   * Total retries on transient failures (429, 5xx, network, abort).
   * 2 retries = up to 3 attempts. Each retry uses exponential
   * backoff with jitter (see DocumentOrchestrator.withRetry).
   */
  DEEPSEEK_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  /**
   * Max concurrent in-flight DeepSeek calls across the whole
   * process. Back-pressure to avoid self-rate-limiting at the
   * upstream API when many regenerate clicks land at once.
   * This is NOT user rate limiting (post-MVP per Article V).
   */
  DEEPSEEK_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),

  /**
   * A `pending` row older than this is considered orphaned (the
   * Node process must have died mid-generation) and is flipped to
   * `failed` by the queue reaper. 5 min is well past the longest
   * legitimate generation (limited by DEEPSEEK_TIMEOUT_MS).
   */
  QUEUE_REAPER_MAX_AGE_MS: z.coerce.number().int().positive().default(5 * 60_000),

  /** How often the reaper sweeps for orphaned rows. */
  QUEUE_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, 'SUPABASE_PUBLISHABLE_KEY is required'),

  CORS_ORIGIN: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
