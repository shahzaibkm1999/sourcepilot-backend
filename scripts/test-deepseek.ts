/**
 * test-deepseek.ts
 * ----------------
 * One-off script to verify the DeepSeek API key in backend/.env works
 * against the OpenAI-compatible chat/completions endpoint.
 *
 * Run with:  npx ts-node backend/scripts/test-deepseek.ts
 */

import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const url = 'https://api.deepseek.com/v1/chat/completions';

if (!apiKey) {
  console.error('❌ DEEPSEEK_API_KEY missing in .env');
  process.exit(1);
}

interface AttemptResult {
  ok: boolean;
  model: string;
  status?: number;
  statusText?: string;
  text?: string;
  errorBody?: string;
  errorMessage?: string;
}

async function tryModel(modelName: string): Promise<AttemptResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Reply with exactly: pong' },
        ],
        max_tokens: 16,
        temperature: 0,
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        model: modelName,
        status: res.status,
        statusText: res.statusText,
        errorBody: bodyText.slice(0, 500),
      };
    }

    const json = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '(no content)';
    return { ok: true, model: modelName, status: res.status, text };
  } catch (err) {
    return {
      ok: false,
      model: modelName,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DeepSeek verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Endpoint: ${url}`);
  // apiKey is verified non-empty above; assert for TS narrowing.
  const key = apiKey as string;
  console.log(`Key:      ${key.slice(0, 7)}…${key.slice(-4)} (${key.length} chars)`);
  console.log('');

  // Try the model from .env first
  console.log(`[1/2] Trying model from .env: "${model}"`);
  const first = await tryModel(model);
  if (first.ok) {
    console.log(`  ✓ ${first.status} OK — response: "${first.text}"`);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ DeepSeek verification PASSED');
    console.log(`   Using model: ${model}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }

  if (first.status) {
    console.log(`  ✗ ${first.status} ${first.statusText}`);
    if (first.errorBody) console.log(`    body: ${first.errorBody}`);
  } else {
    console.log(`  ✗ network/error: ${first.errorMessage}`);
  }

  // Fallback to deepseek-chat
  console.log('');
  console.log('[2/2] Falling back to "deepseek-chat"');
  const second = await tryModel('deepseek-chat');
  if (second.ok) {
    console.log(`  ✓ ${second.status} OK — response: "${second.text}"`);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ DeepSeek verification PASSED (using fallback deepseek-chat)');
    console.log(`   Your .env has "${model}" which DeepSeek rejected,`);
    console.log(`   but "deepseek-chat" works. Update .env accordingly.`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }

  if (second.status) {
    console.log(`  ✗ ${second.status} ${second.statusText}`);
    if (second.errorBody) console.log(`    body: ${second.errorBody}`);
  } else {
    console.log(`  ✗ network/error: ${second.errorMessage}`);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('❌ DeepSeek verification FAILED on both models');
  console.log('   Check the key, network, or DeepSeek account status.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}

main();
