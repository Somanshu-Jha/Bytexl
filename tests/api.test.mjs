import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { createStore } from '../server/store.mjs';
import { localExtract } from '../server/pipeline.mjs';
import { createCanvas } from '@napi-rs/canvas';

const noNim = { configured: false, models: { vision: 'test-vision', extraction: 'test-extraction', chat: 'test-chat' } };

async function fixture(t, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'sehat-api-'));
  const { app, store } = createApp({ databasePath: join(folder, 'test.sqlite'), nim: noNim, ...options });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); await rm(folder, { recursive: true, force: true }); });
  return { base, store, request: (path, opts) => fetch(base + path, opts) };
}

function upload(text, { consent = 'true', filename = 'lab.txt', type = 'text/plain' } = {}) {
  const body = new FormData();
  if (consent !== null) body.append('consent', consent);
  body.append('file', new Blob([text], { type }), filename);
  return { method: 'POST', body };
}

async function completed(request, id) {
  for (let i = 0; i < 100; i++) {
    const job = await (await request(`/api/jobs/${id}`)).json();
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Upload job did not finish');
}

test('bootstrap exposes seeded records and configured model roles without credentials', async t => {
  const { request } = await fixture(t);
  const response = await request('/api/bootstrap');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.patient.name);
  assert.ok(body.records.length >= 3);
  assert.ok(body.records.every(r => r.isDemo));
  assert.equal(body.ai.configured, false);
  assert.equal(body.ai.models.vision, 'test-vision');
  assert.ok(!JSON.stringify(body).includes('apiKey'));
});

test('upload rejects absent consent, deceptive file content and unsupported types', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/records', upload('HbA1c 7.2 %', { consent: null }))).status, 400);
  assert.equal((await request('/api/records', upload('not a png', { filename: 'lab.png', type: 'image/png' }))).status, 415);
  assert.equal((await request('/api/records', upload('<script>x</script>', { filename: 'lab.html', type: 'text/html' }))).status, 415);
});

test('readable text creates source-linked local record, persists corrections and deletion', async t => {
  const { request, store } = await fixture(t);
  const source = 'SYNTHETIC LAB REPORT\nDate: 2026-10-09\nProvider: Example Laboratory\nHemoglobin: 10.8 g/dL (reference: 12.0 - 15.5)\nHbA1c: 7.2 % (reference: 4.0 - 5.6)';
  const result = await request('/api/records', upload(source));
  assert.equal(result.status, 202);
  const job = await completed(request, (await result.json()).id);
  assert.equal(job.status, 'completed', job.error);
  const record = store.getRecord(job.recordId);
  assert.equal(record.isDemo, false);
  assert.equal(record.provenance.mode, 'local');
  assert.equal(record.sourceText, source);
  assert.equal(record.observations.find(o => o.name === 'Hemoglobin').value, 10.8);
  assert.equal(record.observations.find(o => o.name === 'Hemoglobin').status, 'low');
  assert.equal(record.observations.find(o => o.name === 'HbA1c').status, 'high');
  const edited = await request(`/api/records/${job.recordId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Reviewed report', reviewStatus: 'reviewed', isDemo: true, sourceText: 'tampered' }) });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).reviewStatus, 'reviewed');
  assert.equal(store.getRecord(job.recordId).sourceText, source);
  assert.equal(store.getRecord(job.recordId).isDemo, false);
  assert.equal((await request(`/api/records/${job.recordId}`, { method: 'DELETE' })).status, 204);
  assert.equal(store.getRecord(job.recordId), undefined);
});

test('empty and unreadable uploads fail clearly without creating fabricated records', async t => {
  const { request, store } = await fixture(t);
  const originalCount = store.listRecords().length;
  assert.equal((await request('/api/records', upload(''))).status, 400);
  const result = await request('/api/records', upload('This is a recipe for a green vegetable soup.'));
  assert.equal(result.status, 202);
  const job = await completed(request, (await result.json()).id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /extract|medical|readable/i);
  assert.equal(store.listRecords().length, originalCount);
});

test('cross-site mutations are denied and mock ABHA rejects malformed IDs', async t => {
  const { request } = await fixture(t);
  const opts = { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ abhaId: '123' }) };
  assert.equal((await request('/api/patient', { ...opts, headers: { ...opts.headers, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/patient', opts)).status, 400);
  const valid = await request('/api/patient', { ...opts, body: JSON.stringify({ abhaId: '12-3456-7890-1234', abhaLinked: true }) });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).abhaLinked, true);
});

test('chat emergencies and medication changes are handled before any provider call', async t => {
  const brokenProvider = { ...noNim, configured: true, chat() { throw new Error('Should not reach provider'); } };
  const { request } = await fixture(t, { nim: brokenProvider });
  const chat = async (message, language = 'en') => (await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, language }) })).json();
  const urgent = await chat('I have chest pain and cannot breathe');
  assert.match(urgent.answer, /emergency|urgent/i);
  assert.equal(urgent.mode, 'local');
  const medication = await chat('Should I double my metformin dose?');
  assert.match(medication.answer, /prescriber|clinician|doctor/i);
  const hindi = await chat('क्या मैं अपनी दवा की खुराक दोगुनी करूँ?', 'hi');
  assert.match(hindi.answer, /डॉक्टर|चिकित्सक/);
});

test('chat fallback citations resolve to stored records and FHIR export resolves references', async t => {
  const { request, store } = await fixture(t);
  const result = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'What should I discuss with my doctor?', language: 'en' }) });
  const response = await result.json();
  assert.equal(response.mode, 'local');
  assert.ok(response.citations.length > 0);
  assert.ok(response.citations.every(c => store.getRecord(c.recordId)));
  const exported = await (await request('/api/export/fhir')).json();
  assert.equal(exported.resourceType, 'Bundle');
  assert.ok(exported.entry.some(e => e.resource.resourceType === 'Patient'));
});

test('unresolvable model citations fall back to stored evidence', async t => {
  const nim = { ...noNim, configured: true, async chat() { return { answer: 'An invented diagnosis from an invented report.', recordIds: ['nonexistent-record'], model: 'test' }; } };
  const { request, store } = await fixture(t, { nim });
  const result = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Explain my records', language: 'en' }) });
  const body = await result.json();
  assert.equal(body.mode, 'local');
  assert.ok(!body.answer.includes('invented diagnosis'));
  assert.ok(body.citations.every(c => store.getRecord(c.recordId)));
});

test('valid record citations cannot launder new medication advice or diagnoses', async t => {
  let unsafe = 'Take 20 units of insulin tonight.';
  let recordId;
  const nim = { ...noNim, configured: true, async chat() { return { answer: unsafe, recordIds: [recordId], model: 'test' }; } };
  const { request, store } = await fixture(t, { nim });
  recordId = store.listRecords()[0].id;
  for (const answer of ['Take 20 units of insulin tonight.', 'Start metformin 500 mg twice daily.', 'You have pneumonia.']) {
    unsafe = answer;
    const response = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Explain my records' }) });
    const body = await response.json();
    assert.equal(body.mode, 'local');
    assert.ok(!body.answer.includes(answer));
  }
});

test('live selection renders only a verified fact and ignores freeform model medical advice', async t => {
  const nim = { ...noNim, configured: true, async chat(_message, _language, facts) {
    return { factIds: [facts.find(fact => fact.kind === 'observation').id], insufficientEvidence: false, answer: 'Take 20 units of insulin tonight. You have pneumonia.', model: 'test-selector' };
  } };
  const { request, store } = await fixture(t, { nim });
  for (const language of ['en', 'hi']) {
    const response = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Explain the report', language }) });
    const body = await response.json();
    assert.equal(body.mode, 'live');
    assert.equal(body.citations.length, 1);
    assert.ok(!body.answer.includes('insulin'));
    assert.ok(!body.answer.includes('pneumonia'));
    const record = store.getRecord(body.citations[0].recordId);
    assert.ok(record.observations.some(observation => body.answer.includes(observation.explanation[language])));
  }
});

test('manual numeric correction recomputes flag and summary without changing original evidence', async t => {
  const { request, store } = await fixture(t);
  const record = store.listRecords().find(r => r.observations.length > 0);
  const observation = record.observations[0];
  const result = await request(`/api/records/${record.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewStatus: 'reviewed', observations: [{ id: observation.id, value: 1, referenceLow: 2, referenceHigh: 4 }] }) });
  assert.equal(result.status, 200);
  const corrected = await result.json();
  assert.equal(corrected.observations[0].status, 'low');
  assert.match(corrected.observations[0].explanation.en, /below/);
  assert.equal(corrected.sourceText, record.sourceText);
  assert.equal(corrected.observations[0].sourceText, observation.sourceText);
  assert.ok(corrected.provenance.warnings.some(w => /reviewer corrected/i.test(w)));
});

test('SQLite reopening retains records and marks interrupted uploads failed', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'sehat-store-'));
  const path = join(folder, 'test.sqlite');
  const store = createStore(path, { patient: { id: 'p', name: 'Test' }, records: [] });
  store.saveRecord({ id: 'r', title: 'Original', date: '2026-10-01' });
  store.saveJob({ id: 'j', status: 'processing', stage: 'OCR' });
  store.close();
  const reopened = createStore(path);
  t.after(async () => { reopened.close(); await rm(folder, { recursive: true, force: true }); });
  assert.equal(reopened.getRecord('r').title, 'Original');
  assert.equal(reopened.getJob('j').status, 'failed');
  assert.match(reopened.getJob('j').error, /restarted/);
});

function textPdf(lines) {
  const stream = 'BT /F1 12 Tf 50 750 Td ' + lines.map((line, i) => (i ? '0 -20 Td ' : '') + '(' + line.replace(/[()\\]/g, '\\$&') + ') Tj').join(' ') + ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return text;
}

test('PDF text extraction preserves numeric rows through the asynchronous API', async t => {
  const { request, store } = await fixture(t);
  const pdf = textPdf(['SYNTHETIC LAB REPORT', 'Date: 2026-10-09', 'HbA1c: 6.1 % (reference: 4.0 - 5.6)', 'Hemoglobin: 14.2 g/dL (reference: 13 - 17)']);
  const response = await request('/api/records', upload(pdf, { filename: 'synthetic.pdf', type: 'application/pdf' }));
  assert.equal(response.status, 202);
  const job = await completed(request, (await response.json()).id);
  assert.equal(job.status, 'completed', job.error);
  const record = store.getRecord(job.recordId);
  assert.equal(record.observations.find(o => o.name === 'HbA1c').value, 6.1);
  assert.equal(record.observations.find(o => o.name === 'HbA1c').status, 'high');
});

function imagePdf() {
  const canvas = createCanvas(600, 300);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 600, 300);
  context.fillStyle = 'black'; context.font = '24px sans-serif';
  context.fillText('SYNTHETIC LAB REPORT', 20, 45);
  context.fillText('HbA1c: 6.1 %; reference: 4.0 - 5.6', 20, 100);
  const jpeg = canvas.toBuffer('image/jpeg');
  const draw = 'q 600 0 0 300 0 0 cm /Im1 Do Q';
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.from(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 600 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
  ];
  let buffer = Buffer.from('%PDF-1.4\n');
  const offsets = [];
  objects.forEach((object, i) => { offsets.push(buffer.length); buffer = Buffer.concat([buffer, Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); });
  const start = buffer.length;
  return Buffer.concat([buffer, Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`)]);
}

test('scanned PDF is rasterized for vision and saved with vision provenance', async t => {
  const nim = { ...noNim, configured: true,
    async vision(dataUrl) {
      assert.match(dataUrl, /^data:image\/jpeg;base64,/);
      assert.ok(Buffer.from(dataUrl.split(',')[1], 'base64').length > 1000);
      return 'SYNTHETIC LAB REPORT\nHbA1c: 6.1 %; reference: 4.0 - 5.6';
    },
    async extract(text) { return localExtract(text); },
  };
  const { request, store } = await fixture(t, { nim });
  const response = await request('/api/records', upload(imagePdf(), { filename: 'scanned.pdf', type: 'application/pdf' }));
  assert.equal(response.status, 202);
  const job = await completed(request, (await response.json()).id);
  assert.equal(job.status, 'completed', job.error);
  const record = store.getRecord(job.recordId);
  assert.equal(record.provenance.visionModel, 'test-vision');
  assert.equal(record.observations[0].value, 6.1);
  assert.equal(record.observations[0].status, 'high');
});
