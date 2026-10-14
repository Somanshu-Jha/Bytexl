// Manual live integration smoke, deliberately excluded from npm test.
// node --env-file-if-exists=.env tests/live-handwriting.mjs
// node --env-file-if-exists=.env tests/live-handwriting.mjs --printed
// node tests/live-handwriting.mjs --generate-only
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createApp } from '../server/index.mjs';
import { createNimClient } from '../server/nim.mjs';
import { requiresOcrAcknowledgment } from '../server/domain.mjs';

const sampleUrl = new URL('../public/samples/handwriting-demo.png', import.meta.url);
const canvas = createCanvas(1400, 1550);
const context = canvas.getContext('2d');
context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1400, 1550);
context.fillStyle = '#e7f0ea'; context.fillRect(0, 0, 1400, 210);
context.fillStyle = '#163c2e'; context.font = 'bold 40px Arial';
context.fillText('SEHAT / FICTIONAL PRESCRIPTION', 80, 88);
context.font = 'bold 31px Arial';
context.fillText('SYNTHETIC DEMO — NOT FOR CLINICAL USE', 80, 153);
context.fillStyle = '#202020'; context.font = '34px Arial';
context.fillText('Patient: Demo Patient (fictional)', 80, 310);
context.fillText('Date: 2026-10-14', 80, 380);
context.fillText('Provider: Fictional Demo Clinic', 80, 450);
context.strokeStyle = '#bdc9c0'; context.lineWidth = 2;
context.beginPath(); context.moveTo(80, 505); context.lineTo(1320, 505); context.stroke();
context.font = '31px Arial'; context.fillText('Medicine:', 80, 610);
const word = await loadImage(await readFile(new URL('./fixtures/handwriting/Metformin.png', import.meta.url)));
context.drawImage(word, 300, 545, 580, Math.round(580 * word.height / word.width));
context.font = '34px Arial';
context.fillText('Dose: 500 mg', 80, 850);
context.fillText('Frequency: once daily', 80, 925);
context.font = '28px Arial';
context.fillText('Purpose: OCR demonstration only.', 80, 1090);
context.fillText('Fictional example. Do not take or change any medicine', 80, 1145);
context.fillText('based on this image.', 80, 1190);
context.fillStyle = '#536258'; context.font = '20px Arial';
context.fillText('Handwritten word: avi-kai / Medical Prescription Handwritten Words (publisher-declared MIT).', 80, 1360);
context.fillText('Source: huggingface.co/datasets/avi-kai/Medical_Prescription_Handwritten_Words', 80, 1400);
context.fillText('Full attribution and license: tests/fixtures/handwriting/NOTICE.md', 80, 1440);
context.fillText('A mixed printed/handwritten fixture, not a clinical handwriting benchmark.', 80, 1480);
await writeFile(sampleUrl, canvas.toBuffer('image/png'));
console.log('Generated public/samples/handwriting-demo.png (synthetic, visibly labeled).');

if (!process.argv.includes('--generate-only')) {
  const printed = process.argv.includes('--printed');
  const inputUrl = printed ? new URL('../public/samples/aarav-blood-panel.png', import.meta.url) : sampleUrl;
  const realNim = createNimClient();
  assert.equal(realNim.configured, true, 'NVIDIA_API_KEY is not configured on the server.');
  const readings = [];
  const nim = { ...realNim, async vision(image, options) {
    try {
      const text = await realNim.vision(image, options);
      readings.push({ pass: options?.verification ? 'comparison' : 'first', text });
      return text;
    } catch (error) {
      readings.push({ pass: options?.verification ? 'comparison' : 'first', error: error.message });
      throw error;
    }
  } };
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'sehat-handwriting-live-'));
  const { app, store } = createApp({ databasePath: join(folder, 'smoke.sqlite'), nim, seed: false });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bytes = await readFile(inputUrl);
    const form = consent => {
      const data = new FormData(); data.append('consent', consent); data.append('handwriting', 'true');
      data.append('file', new Blob([bytes], { type: 'image/png' }), printed ? 'printed-handwriting-mode.png' : 'handwriting-demo.png'); return data;
    };
    const denied = await fetch(`${base}/api/records`, { method: 'POST', body: form('false') });
    assert.equal(denied.status, 400, 'Consent must be required.');
    assert.equal(readings.length, 0, 'No image should reach NVIDIA before consent.');
    const start = Date.now();
    const response = await fetch(`${base}/api/records`, { method: 'POST', body: form('true') });
    const initial = await response.json();
    assert.equal(response.status, 202, JSON.stringify(initial));
    let job; let previousStage = '';
    for (let attempt = 0; attempt < 230; attempt++) {
      job = await (await fetch(`${base}/api/jobs/${initial.id}`)).json();
      if (job.stage !== previousStage) { console.log(job.stage); previousStage = job.stage; }
      if (job.status === 'completed' || job.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const elapsedSeconds = Math.round((Date.now() - start) / 100) / 10;
    if (job.status === 'failed') {
      assert.equal(store.listRecords().length, 0, 'An unreadable image must not create fabricated clinical records.');
      assert.ok(job.error);
      console.log(JSON.stringify({ fixture: printed ? 'printed-lab-in-handwriting-mode' : 'mixed-prescription', outcome: 'abstained', elapsedSeconds, error: job.error, readings }, null, 2));
    } else {
      assert.equal(job.status, 'completed', 'The bounded upload job did not finish.');
      const record = store.getRecord(job.recordId);
      assert.equal(record.provenance.mode, 'live');
      assert.equal(record.provenance.ocr?.mode, 'verified');
      assert.equal(record.reviewStatus, 'pending');
      assert.equal(record.provenance.ocr.pages.length, 1);
      assert.ok(record.provenance.ocr.pages[0].firstPass);
      if (record.provenance.ocr.status !== 'verification-unavailable') assert.ok(record.provenance.ocr.pages[0].secondPass);
      assert.equal(record.diagnoses.length, 0, 'There is no diagnosis on this fixture.');
      let extracted = false;
      if (printed) {
        assert.equal(record.medications.length, 0, 'There are no medication instructions on the printed laboratory fixture.');
        const expected = { hba1c: [6.1, 4, 5.6], 'fasting glucose': [112, 70, 99], hemoglobin: [14.2, 13, 17], 'vitamin d': [24, 30, 100] };
        for (const observation of record.observations) {
          const values = expected[observation.name.toLowerCase()];
          assert.ok(values, 'An unexpected laboratory result was accepted.');
          for (const [index, key] of ['value', 'referenceLow', 'referenceHigh'].entries()) if (observation[key] !== null) assert.equal(observation[key], values[index], `Incorrect ${key} for ${observation.name}`);
        }
        extracted = Object.entries(expected).every(([name, values]) => record.observations.some(observation => observation.name.toLowerCase() === name && observation.value === values[0] && observation.referenceLow === values[1] && observation.referenceHigh === values[2]));
      } else {
        assert.equal(record.observations.length, 0, 'There are no laboratory values on the prescription fixture.');
        for (const medication of record.medications) {
          assert.equal(medication.name.toLowerCase(), 'metformin', 'A non-fixture medicine was accepted.');
          if (medication.dosage) assert.match(medication.dosage, /^500\s*mg$/i, 'An incorrect dose was accepted.');
          if (medication.frequency) assert.match(medication.frequency, /^once daily$/i, 'An incorrect frequency was accepted.');
          extracted ||= Boolean(medication.dosage && medication.frequency);
        }
      }
      if (!extracted) assert.ok(record.provenance.warnings.length, 'An abstained field needs a visible uncertainty warning.');
      if (requiresOcrAcknowledgment(record)) {
        const review = await fetch(`${base}/api/records/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewStatus: 'reviewed' }) });
        assert.equal(review.status, 400, 'Unresolved OCR must require explicit original-document review acknowledgment.');
      }
      const evidenceOnly = record.provenance.warnings.some(warning => /^Evidence-only draft:/i.test(warning));
      console.log(JSON.stringify({ fixture: printed ? 'printed-lab-in-handwriting-mode' : 'mixed-prescription', outcome: evidenceOnly ? 'evidence-only-draft' : extracted ? 'extracted-fixture-fields' : 'saved-with-abstained-fields', elapsedSeconds, reviewStatus: record.reviewStatus, comparison: record.provenance.ocr.status, disagreements: record.provenance.ocr.disagreementCount, summary: record.summary, medications: record.medications, observations: record.observations, ocr: record.provenance.ocr, warnings: record.provenance.warnings }, null, 2));
    }
  } finally {
    await new Promise(resolve => server.close(resolve)); store.close();
    if (!folder.startsWith(tempRoot + sep) || !basename(folder).startsWith('sehat-handwriting-live-')) throw new Error('Refusing cleanup outside the generated test directory.');
    await rm(folder, { recursive: true, force: true });
  }
}
