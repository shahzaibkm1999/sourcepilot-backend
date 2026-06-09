/**
 * Local entry point: `node dist/server.js` (or `ts-node src/server.ts` in dev).
 * Kept separate from `app.ts` so `app.ts` stays importable for tests.
 */
import app from './app';
import { env } from './config/env';

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `🚀 AI Software Planning Assistant API listening on http://localhost:${env.PORT}  (${env.NODE_ENV})`,
  );
  // eslint-disable-next-line no-console
  console.log(`   Using model: ${env.DEEPSEEK_MODEL}`);
  // eslint-disable-next-line no-console
  console.log(`   Supabase:    ${env.SUPABASE_URL}`);
});
