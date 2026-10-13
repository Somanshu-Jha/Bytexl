// Manual integration smoke; uses synthetic fixtures only and never prints credentials.
// Run: node --env-file-if-exists=.env tests/live-smoke.mjs
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';

const folder = await mkdtemp(join(tmpdir(), 'sehat-live-'));
const { app, store } = createApp({ databasePath: join(folder, 'smoke.sqlite'), seed: false });
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  if (!bootstrap.ai.configured) throw new Error('NVIDIA_API_KEY is not configured.');
  console.log(JSON.stringify({ models: bootstrap.ai.models }));
  for (const extension of ['txt', 'png']) {
    const bytes = await readFile(new URL(`../public/samples/aarav-blood-panel.${extension}`, import.meta.url));
    const form = new FormData();
    form.append('consent', 'true');
    form.append('file', new Blob([bytes], { type: extension === 'txt' ? 'text/plain' : 'image/png' }), `synthetic-smoke.${extension}`);
    const started = Date.now();
    const response = await fetch(`${base}/api/records`, { method: 'POST', body: form });
    const initial = await response.json();
    if (response.status !== 202) throw new Error(JSON.stringify(initial));
    let previousStage = '';
    let job;
    for (let i = 0; i < 180; i++) {
      job = await (await fetch(`${base}/api/jobs/${initial.id}`)).json();
      if (job.stage !== previousStage) { console.log(`${extension}: ${job.stage}`); previousStage = job.stage; }
      if (job.status === 'completed' || job.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (job.status !== 'completed') throw new Error(`${extension}: ${job.error || 'Processing timed out'}`);
    const record = store.getRecord(job.recordId);
    console.log(JSON.stringify({ type: extension, elapsedSeconds: Math.round((Date.now() - started) / 100) / 10, mode: record.provenance.mode, observations: record.observations.map(({ name, value, unit, referenceLow, referenceHigh, status }) => ({ name, value, unit, referenceLow, referenceHigh, status })), warnings: record.provenance.warnings }));
  }
  for (const language of ['en', 'hi']) {
    const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: language === 'en' ? 'What does the report say about HbA1c?' : 'मेरी रिपोर्ट में HbA1c के बारे में क्या लिखा है?', language }) });
    const chat = await response.json();
    console.log(JSON.stringify({ language, mode: chat.mode, model: chat.model, citations: chat.citations?.length, answer: chat.answer }));
    if (chat.mode !== 'live' || !chat.citations?.length) throw new Error(`${language} chat did not return a live cited response.`);
  }
} finally {
  await new Promise(resolve => server.close(resolve)); store.close(); await rm(folder, { recursive: true, force: true });
}
