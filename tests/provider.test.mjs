import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNimClient, parseModelJson } from '../server/nim.mjs';
import { validateFile, localExtract } from '../server/pipeline.mjs';

test('model JSON parser accepts wrappers without executing instructions and rejects incomplete output', () => {
  assert.deepEqual(parseModelJson('```json\n{"observations":[]}\n```'), { observations: [] });
  assert.deepEqual(parseModelJson('<think>private reasoning</think>{"value":12}'), { value: 12 });
  assert.throws(() => parseModelJson('Some prose with no JSON'), /structured data/);
  assert.throws(() => parseModelJson('{"observations":['), /structured data/);
});

test('provider failures return useful errors without revealing server credentials or provider payload', async () => {
  const key = 'test-secret-never-expose';
  for (const status of [401, 404, 410, 429, 503]) {
    const nim = createNimClient({ apiKey: key, fetchImpl: async () => new Response(JSON.stringify({ error: key }), { status }) });
    await assert.rejects(nim.extract('synthetic test'), error => !error.message.includes(key) && /credential|model|rate|capacity/i.test(error.message));
  }
  const nim = createNimClient({ apiKey: key, fetchImpl: async () => { throw new DOMException('timed out ' + key, 'TimeoutError'); } });
  await assert.rejects(nim.extract('synthetic test'), /too long/);
});

test('NIM extraction sends source as untrusted user data and model output is parsed', async () => {
  let request;
  const nim = createNimClient({ apiKey: 'test-only', models: { extraction: 'nvidia/nemotron-test-extraction' }, fetchImpl: async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"title":"Lab","observations":[]}' } }] }));
  } });
  assert.equal((await nim.extract('HbA1c 6.1 %')).title, 'Lab');
  assert.equal(request.model, 'nvidia/nemotron-test-extraction');
  assert.equal(request.messages[0].role, 'system');
  assert.match(request.messages[0].content, /UNTRUSTED/);
  assert.match(request.messages[1].content, /HbA1c 6.1 %/);
  assert.equal(request.chat_template_kwargs.enable_thinking, false);
});

test('oversized files and binary pretending to be text never enter processing', () => {
  assert.throws(() => validateFile({ originalname: 'big.txt', mimetype: 'text/plain', buffer: Buffer.alloc(12 * 1024 * 1024 + 1, 65) }), error => error.status === 413);
  assert.throws(() => validateFile({ originalname: 'bad.txt', mimetype: 'text/plain', buffer: Buffer.from([65, 0, 66]) }), error => error.status === 415);
});

test('local parser preserves missing ranges instead of importing medical reference knowledge', () => {
  const result = localExtract('Date: 2026-10-09\nHbA1c: 6.1 %\nHemoglobin: 14.2 g/dL');
  assert.equal(result.observations[0].value, 6.1);
  assert.equal(result.observations[0].referenceLow, null);
  assert.equal(result.observations[0].referenceHigh, null);
  assert.equal(result.diagnoses.length, 0);
  assert.throws(() => localExtract('Patient ID: 12345\nAge 32 years\nPage 1 of 3'), /could not extract/);
});

test('offline sample extracts the four ranges printed after semicolon delimiters', async () => {
  const source = await readFile(new URL('../public/samples/aarav-blood-panel.txt', import.meta.url), 'utf8');
  const result = localExtract(source);
  assert.equal(result.observations.length, 4);
  assert.equal(result.observations[0].referenceLow, 4);
  assert.equal(result.observations[0].referenceHigh, 5.6);
  assert.equal(result.observations[3].referenceLow, 30);
  assert.equal(result.observations[3].referenceHigh, 100);
});
