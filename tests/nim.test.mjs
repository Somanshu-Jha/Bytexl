import test from 'node:test';
import assert from 'node:assert/strict';
import { createNimClient } from '../server/nim.mjs';

test('verification model selection is explicit and the second prompt cannot see first-pass text', async () => {
  const payloads = [];
  const nim = createNimClient({ apiKey: 'test-only', models: { vision: 'tested-primary' }, verificationModel: 'tested-secondary', fetchImpl: async (_url, init) => {
    payloads.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Metformin [unclear] mg' } }] }));
  } });
  await nim.vision('data:image/png;base64,a', { handwriting: true });
  await nim.vision('data:image/png;base64,b', { handwriting: true, verification: true, timeoutMs: 2000 });
  assert.equal(payloads[0].model, 'tested-primary');
  assert.match(payloads[0].messages[0].content[0].text, /printed.*handwriting/i);
  assert.equal(payloads[1].model, 'tested-secondary');
  assert.match(payloads[1].messages[0].content[0].text, /independent|fresh/i);
  assert.match(payloads[1].messages[0].content[0].text, /never guess|do not guess/i);
  assert.match(payloads[1].messages[0].content[0].text, /\[unclear\]/);
  assert.ok(!JSON.stringify(payloads[1]).includes('Metformin'));
});

test('extraction is instructed to retain ambiguity rather than reconstruct an unreadable dose', async () => {
  let payload;
  const nim = createNimClient({ apiKey: 'test-only', fetchImpl: async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"medications":[],"observations":[],"diagnoses":[]}' } }] }));
  } });
  await nim.extract('Metformin [unclear] mg twice daily');
  assert.match(payload.messages[0].content, /\[unclear\]/);
  assert.match(payload.messages[0].content, /reconstruct|complete|guess/i);
});
