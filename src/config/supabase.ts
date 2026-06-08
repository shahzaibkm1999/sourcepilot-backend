import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Singleton Supabase client.
 * Used by every model that talks to the database.
 */
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false },
  },
);
