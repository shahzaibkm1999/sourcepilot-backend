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
