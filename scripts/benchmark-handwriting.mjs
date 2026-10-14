/**
 * Manual, opt-in network smoke check; intentionally excluded from npm test.
 * Uses only the three non-identifying, publisher-MIT crops documented in NOTICE.md.
 * node --env-file-if-exists=.env scripts/benchmark-handwriting.mjs --model=meta/llama-3.2-11b-vision-instruct
 * node --env-file-if-exists=.env scripts/benchmark-handwriting.mjs --compare
 * node scripts/benchmark-handwriting.mjs --dry-run
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const fixtureRoot = fileURLToPath(new URL('../tests/fixtures/handwriting/', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(fixtureRoot, 'ground-truth.json'), 'utf8'));
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const model = option('model', 'meta/llama-3.2-11b-vision-instruct');
const compare = process.argv.includes('--compare');
const verificationModel = option('verification-model', model);
const timeoutMs = Number(option('timeout-ms', '45000'));
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 45000) throw new Error('timeout-ms must be 1000..45000');
const dryRun = process.argv.includes('--dry-run');
const apiKey = process.env.NVIDIA_API_KEY?.trim();
if (!dryRun && !apiKey) throw new Error('Set NVIDIA_API_KEY in the server environment or use --env-file-if-exists=.env.');
const normalize = text => text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
const distance = (left, right) => {
  const a = Array.from(left), b = Array.from(right);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
};

const prompt = 'Transcribe the visible handwritten text exactly. If a character or word is ambiguous, write [unclear] rather than guessing. Return only the transcription.';
const inputs = await Promise.all(manifest.samples.map(async sample => {
  if (!/^[A-Za-z0-9]+\.png$/.test(sample.file)) throw new Error('Invalid fixture filename');
  const image = await readFile(resolve(fixtureRoot, sample.file));
  return { ...sample, image, sha256: createHash('sha256').update(image).digest('hex') };
}));

const report = {
  checkedAt: new Date().toISOString(),
  dataset: manifest.dataset, revision: manifest.revision, model, timeoutMs,
  mode: compare ? 'application-comparison' : 'single-pass',
  ...(compare ? { verificationModel } : {}),
  normalization: 'NFKC, lowercase, trim, collapse whitespace; punctuation and uncertain text are not removed.',
  warning: 'Tiny nonrepresentative handwriting smoke test. Exact match or model agreement is not clinical accuracy or certainty.',
  prompt: compare ? 'Current application handwriting prompts in server/nim.mjs; original and contrast images prepared by server/ocr.mjs.' : prompt,
};
if (compare) report.applicationSourceSha256 = Object.fromEntries(await Promise.all(['nim.mjs', 'ocr.mjs'].map(async name => [name, createHash('sha256').update(await readFile(new URL(`../server/${name}`, import.meta.url))).digest('hex')])));

if (dryRun) {
  console.log(JSON.stringify({ ...report, dryRun: true, samples: inputs.map(({ image, ...sample }) => ({ ...sample, bytes: image.length })) }, null, 2));
} else {
  // The three requests share one 45-second maximum budget for this model.
  const signal = AbortSignal.timeout(timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const ocr = compare ? await import('../server/ocr.mjs') : null;
  const nim = compare ? (await import('../server/nim.mjs')).createNimClient({ apiKey, baseUrl: 'https://integrate.api.nvidia.com/v1', models: { vision: model }, verificationModel, timeoutMs }) : null;
  const results = await Promise.all(inputs.map(async ({ file, text, image, sha256 }) => {
    const started = performance.now();
    const row = { file, groundTruth: text, sha256 };
    try {
      if (compare) {
        const prepared = await ocr.prepareOcrImages(image, { handwriting: true });
        const reading = await ocr.transcribeWithReview(prepared, nim, { handwriting: true, page: 1, deadline });
        const page = reading.ocr?.pages?.[0];
        const actual = normalize(reading.text), expected = normalize(text);
        const edits = distance(actual, expected);
        return { ...row, status: 'complete', rawOutput: reading.text, normalizedOutput: actual, exactMatch: actual === expected, characterEdits: edits, groundTruthCharacters: Array.from(expected).length, cer: edits / Array.from(expected).length, elapsedMs: Math.round(performance.now() - started), comparisonStatus: reading.ocr?.status, firstPass: page?.firstPass, secondPass: page?.secondPass, consensus: page?.consensus, disagreementCount: reading.ocr?.disagreementCount, preprocessing: prepared.preprocessing };
      }
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 60, stream: false, ...(model === 'google/gemma-4-31b-it' ? { chat_template_kwargs: { enable_thinking: false } } : {}), messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } }] }] }),
      });
      if (!response.ok) return { ...row, status: 'error', httpStatus: response.status, elapsedMs: Math.round(performance.now() - started) };
      const payload = await response.json();
      const choice = payload?.choices?.[0];
      if (typeof choice?.message?.content !== 'string' || choice.finish_reason !== 'stop') return { ...row, status: 'incomplete', finishReason: choice?.finish_reason ?? null, elapsedMs: Math.round(performance.now() - started) };
      const rawOutput = choice.message.content;
      const actual = normalize(rawOutput), expected = normalize(text);
      const edits = distance(actual, expected);
      return { ...row, status: 'complete', rawOutput, normalizedOutput: actual, exactMatch: actual === expected, characterEdits: edits, groundTruthCharacters: Array.from(expected).length, cer: edits / Array.from(expected).length, elapsedMs: Math.round(performance.now() - started) };
    } catch (error) {
      const status = error.name === 'TimeoutError' || error.name === 'AbortError' || (error.name === 'ProviderError' && error.status === 504) ? 'timeout' : error.name === 'OcrInputError' ? 'rejected-transcription' : error.name === 'ProviderError' ? 'provider-error' : 'network-error';
      return { ...row, status, elapsedMs: Math.round(performance.now() - started) };
    }
  }));
  const complete = results.filter(row => row.status === 'complete');
  const totalCharacters = complete.reduce((sum, row) => sum + row.groundTruthCharacters, 0);
  console.log(JSON.stringify({ ...report, results, summary: { attempted: inputs.length, completed: complete.length, exactMatches: complete.filter(row => row.exactMatch).length, cerCompletedSamplesOnly: totalCharacters ? complete.reduce((sum, row) => sum + row.characterEdits, 0) / totalCharacters : null, errorsExcludedFromCer: results.length - complete.length } }, null, 2));
  if (complete.length !== inputs.length) process.exitCode = 2;
}
