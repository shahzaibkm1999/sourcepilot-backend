import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.DEEPSEEK_API_KEY!;

async function tryModel(m: string) {
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: m,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Reply with exactly: pong' },
      ],
      max_tokens: 16,
      temperature: 0,
    }),
  });
  const text = await r.text();
  console.log(`--- model=${m} status=${r.status} ---`);
  console.log(text.slice(0, 400));
  console.log();
}

(async () => {
  await tryModel('deepseek-chat');
  await tryModel('deepseek-reasoner');
  await tryModel('deepseek-v4-pro');
})();
