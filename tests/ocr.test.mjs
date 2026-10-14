import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { prepareOcrImages, reconcileTranscriptions, transcribeWithReview } from '../server/ocr.mjs';
import { processDocument } from '../server/pipeline.mjs';

function imageFixture() {
  const canvas = createCanvas(800, 400);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ddd9cd'; context.fillRect(0, 0, 800, 400);
  context.fillStyle = '#42398c'; context.font = '30px sans-serif';
  context.fillText('SYNTHETIC: HbA1c 6.1 %', 30, 90);
  return canvas.toBuffer('image/png');
}

test('two readings of different dosages withhold the number instead of choosing a plausible dose', () => {
  const result = reconcileTranscriptions('Date: 2026-10-14\nMetformin 500 mg twice daily\nHbA1c: 6.1 %', 'Date: 2026-10-14\nMetformin 850 mg twice daily\nHbA1c: 6.1 %');
  assert.match(result.consensus, /Metformin \[unclear\] mg twice daily/);
  assert.ok(!result.consensus.includes('500'));
  assert.ok(!result.consensus.includes('850'));
  assert.match(result.consensus, /HbA1c: 6\.1 %/);
  assert.equal(result.disagreementCount, 1);
});

test('decimal, sign, unit and omitted-line disagreements are preserved as uncertainty', () => {
  for (const [first, second] of [
    ['Medicine 0.5 mg', 'Medicine 5 mg'],
    ['Result: -1 mmol/L', 'Result: 1 mmol/L'],
    ['Medicine 25 mg', 'Medicine 25 mcg'],
    ['Medicine A 5 mg\nMedicine B 10 mg', 'Medicine A 5 mg'],
  ]) {
    const result = reconcileTranscriptions(first, second);
    assert.match(result.consensus, /\[unclear\]/);
    assert.ok(result.disagreementCount > 0);
  }
});

test('comparators, Indic numerals, fractions and missing qualifiers cannot falsely agree', () => {
  for (const [first, second] of [
    ['Result <0.5 mg/dL', 'Result 0.5 mg/dL'],
    ['Result ≤5 mg/dL', 'Result ≥5 mg/dL'],
    ['दवा १ गोली प्रतिदिन', 'दवा २ गोली प्रतिदिन'],
    ['Tablet ½ daily', 'Tablet ¼ daily'],
    ['Dilution 1:2', 'Dilution 1 2'],
    ['Take 1 tablet only if needed', 'Take 1 tablet'],
  ]) {
    const result = reconcileTranscriptions(first, second);
    assert.ok(result.disagreementCount > 0, `${first} must not agree with ${second}`);
    assert.match(result.consensus, /\[unclear\]/);
  }
});

test('format-only differences do not erase readable numbers and existing uncertainty stays visible', () => {
  const result = reconcileTranscriptions('HbA1c: 6.1 %\nMetformin [unclear] mg', 'HbA1c 6.1%\nmetformin [unclear] mg');
  assert.match(result.consensus, /HbA1c: 6.1 %/);
  assert.match(result.consensus, /\[unclear\]/);
  assert.equal(result.disagreementCount, 0);
  assert.equal(result.hasUnclear, true);
});

test('a missing second reading never silently counts as agreement', () => {
  const result = reconcileTranscriptions('Metformin 500 mg twice daily', '');
  assert.equal(result.consensus, '[unclear]');
  assert.equal(result.disagreementCount, 1);
});

test('preprocessing preserves the original and creates a separate grayscale comparison image', async () => {
  const images = await prepareOcrImages(imageFixture(), { handwriting: true });
  const original = await loadImage(images.primary);
  const comparison = await loadImage(images.verification);
  assert.equal(original.width, 800);
  assert.equal(comparison.width, 800);
  const canvas = createCanvas(800, 400);
  const context = canvas.getContext('2d'); context.drawImage(comparison, 0, 0);
  const pixel = context.getImageData(10, 10, 1, 1).data;
  assert.equal(pixel[0], pixel[1]);
  assert.equal(pixel[1], pixel[2]);
  assert.notEqual(images.primary, images.verification);
});

test('image decoder applies EXIF orientation before the two OCR images are prepared', async () => {
  const canvas = createCanvas(80, 40);
  const context = canvas.getContext('2d');
  context.fillStyle = 'red'; context.fillRect(0, 0, 40, 40);
  context.fillStyle = 'blue'; context.fillRect(40, 0, 40, 40);
  const jpeg = canvas.toBuffer('image/jpeg');
  const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex');
  const segment = Buffer.alloc(4); segment[0] = 255; segment[1] = 225; segment.writeUInt16BE(exif.length + 2, 2);
  const tagged = Buffer.concat([jpeg.subarray(0, 2), segment, exif, jpeg.subarray(2)]);
  const images = await prepareOcrImages(tagged, { handwriting: true });
  const image = await loadImage(images.primary);
  assert.equal(image.width, 40);
  assert.equal(image.height, 80);
});

test('oversized encoded dimensions are refused before native image decoding', async () => {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(50000, 16); header.writeUInt32BE(50000, 20);
  await assert.rejects(prepareOcrImages(header, { handwriting: true }), /dimensions.*large/i);
});

test('exhausted handwriting time budget stops before making a provider call', async () => {
  let calls = 0;
  const nim = { models: { vision: 'test' }, async vision() { calls++; return 'Metformin'; } };
  await assert.rejects(transcribeWithReview({ primary: 'data:image/png;base64,a' }, nim, { handwriting: true, deadline: Date.now() - 1 }), /time budget/);
  assert.equal(calls, 0);
});

test('printed image path remains a single pass with its original 90-second provider allowance', async () => {
  const calls = [];
  const nim = { models: { vision: 'test' }, async vision(_image, options) { calls.push(options); return 'Synthetic HbA1c 6.1 %'; } };
  const result = await transcribeWithReview({ primary: 'data:image/png;base64,a' }, nim);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeoutMs, 90000);
  assert.equal(result.ocr, undefined);
});

test('handwriting calls independent image passes and marks disagreements for review', async () => {
  const calls = [];
  const nim = { models: { vision: 'tested-primary' }, ocrVerificationModel: 'tested-secondary', async vision(image, options) {
    calls.push({ image, options });
    return calls.length === 1 ? 'Prescription\nMetformin 500 mg twice daily' : 'Prescription\nMetformin 850 mg twice daily';
  } };
  const images = await prepareOcrImages(imageFixture(), { handwriting: true });
  const result = await transcribeWithReview(images, nim, { handwriting: true });
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].image, calls[1].image);
  assert.equal(calls[1].options.verification, true);
  assert.ok(!JSON.stringify(calls[1].options).includes('500 mg'));
  assert.equal(result.ocr.status, 'disagreement');
  assert.match(result.text, /\[unclear\]/);
  assert.match(result.ocr.pages[0].firstPass, /500/);
  assert.match(result.ocr.pages[0].secondPass, /850/);
});

test('model presentation markup is ignored while original readings stay available for review', async () => {
  let calls = 0;
  const second = '**Transcribed Text:**\n\n* **HbA1c:** 6.1 %; reference: 4.0 - 5.6';
  const nim = { models: { vision: 'test' }, async vision() { return ++calls === 1 ? 'HbA1c: 6.1 %; reference: 4.0 - 5.6' : second; } };
  const result = await transcribeWithReview({ primary: 'data:image/png;base64,a', verification: 'data:image/png;base64,b' }, nim, { handwriting: true });
  assert.equal(result.ocr.status, 'agreement');
  assert.equal(result.text, 'HbA1c: 6.1 %; reference: 4.0 - 5.6');
  assert.equal(result.ocr.pages[0].secondPass, second);
});

test('verification service failure retains first reading with an explicit unverified warning', async () => {
  let calls = 0;
  const nim = { models: { vision: 'tested-primary' }, async vision() {
    if (++calls === 2) throw new Error('Provider unavailable');
    return 'Prescription\nMetformin 500 mg twice daily';
  } };
  const result = await transcribeWithReview({ primary: 'data:image/png;base64,a', verification: 'data:image/png;base64,b', preprocessing: [] }, nim, { handwriting: true });
  assert.equal(result.ocr.status, 'verification-unavailable');
  assert.match(result.text, /500/);
  assert.ok(result.warnings.some(warning => /verification.*unavailable|comparison.*unavailable/i.test(warning)));
});

test('image-description prose is rejected instead of treated as a medical transcription', async () => {
  const nim = { models: { vision: 'test' }, async vision() { return 'The image displays a handwritten note with the word Metformin. Here are the details of the image.'; } };
  await assert.rejects(transcribeWithReview({ primary: 'data:image/png;base64,a', verification: 'data:image/png;base64,b' }, nim, { handwriting: true }), /description|commentary|transcription/i);
});

test('text documents remain fast and bypass handwriting image processing', async () => {
  let visionCalls = 0;
  const nim = { configured: true, models: { vision: 'vision', extraction: 'extraction' }, async vision() { visionCalls++; throw new Error('Must not call vision'); }, async extract(text) {
    return { type: 'lab', observations: [{ name: 'HbA1c', value: 6.1, unit: '%', referenceLow: 4, referenceHigh: 5.6, sourceText: text }], medications: [], diagnoses: [] };
  } };
  const record = await processDocument({ buffer: Buffer.from('HbA1c: 6.1 %; reference: 4.0 - 5.6'), originalname: 'lab.txt', mimetype: 'text/plain' }, nim, () => {}, { handwriting: true });
  assert.equal(visionCalls, 0);
  assert.equal(record.observations[0].value, 6.1);
  assert.equal(record.reviewStatus, 'pending');
});

test('handwriting checkbox does not change uncertainty behavior for TXT documents', async () => {
  const source = 'Fasting glucose: <5.0 mmol/L';
  const nim = { configured: true, models: { vision: 'test', extraction: 'test' }, async vision() { throw new Error('No image processing for TXT'); }, async extract() {
    return { type: 'lab', observations: [{ name: 'Fasting glucose', value: 5, unit: 'mmol/L', sourceText: source }], medications: [], diagnoses: [] };
  } };
  const record = await processDocument({ buffer: Buffer.from(source), originalname: 'lab.txt', mimetype: 'text/plain' }, nim, () => {}, { handwriting: true });
  assert.equal(record.observations.length, 1);
  assert.equal(record.observations[0].value, null);
  assert.equal(record.provenance.ocr, undefined);
});

test('handwriting pipeline extracts only consensus text and preserves both readings for review', async () => {
  let calls = 0;
  let extractionInput;
  const nim = { configured: true, models: { vision: 'tested-vision', extraction: 'tested-extraction' }, async vision() {
    return ++calls === 1 ? 'Prescription\nMetformin 500 mg twice daily\nHbA1c: 6.1 %; reference: 4.0 - 5.6' : 'Prescription\nMetformin 850 mg twice daily\nHbA1c: 6.1 %; reference: 4.0 - 5.6';
  }, async extract(text) {
    extractionInput = text;
    return { type: 'prescription', observations: [{ name: 'HbA1c', value: 6.1, unit: '%', referenceLow: 4, referenceHigh: 5.6, sourceText: 'HbA1c: 6.1 %; reference: 4.0 - 5.6' }], medications: [], diagnoses: [] };
  } };
  const record = await processDocument({ buffer: imageFixture(), originalname: 'handwritten.png', mimetype: 'image/png' }, nim, () => {}, { handwriting: true });
  assert.equal(calls, 2);
  assert.match(extractionInput, /Metformin \[unclear\] mg/);
  assert.ok(!extractionInput.includes('500'));
  assert.ok(!extractionInput.includes('850'));
  assert.equal(record.reviewStatus, 'pending');
  assert.equal(record.provenance.ocr.status, 'disagreement');
  assert.match(record.provenance.ocr.pages[0].firstPass, /500/);
  assert.match(record.provenance.ocr.pages[0].secondPass, /850/);
});

test('unresolved medical handwriting becomes an evidence-only draft without invented fields', async () => {
  const first = 'FICTIONAL PRESCRIPTION\nPatient: Demo Patient\nDate: 2026-10-14\nProvider: Fictional Clinic\nMedicine:\nMetformin\nDose: 500 mg\nFrequency: once daily';
  const second = 'FICTIONAL PRESCRIPTION\nPatient: Demo Patient\nDate: 2026-10-14\nProvider: Fictional Clinic\nMedicine:\nDose: 500 mg\nFrequency: once daily\nMetformin';
  let calls = 0;
  const nim = { configured: true, models: { vision: 'test-vision', extraction: 'test-extraction' }, async vision() { return ++calls === 1 ? first : second; }, async extract() {
    return { title: 'Fictional prescription', type: 'prescription', observations: [], medications: [], diagnoses: [] };
  } };
  const record = await processDocument({ buffer: imageFixture(), originalname: 'mixed.png', mimetype: 'image/png' }, nim, () => {}, { handwriting: true });
  assert.equal(record.reviewStatus, 'pending');
  assert.deepEqual(record.observations, []);
  assert.deepEqual(record.medications, []);
  assert.deepEqual(record.diagnoses, []);
  assert.equal(record.provenance.ocr.pages[0].firstPass, first);
  assert.equal(record.provenance.ocr.pages[0].secondPass, second);
  assert.equal(record.provenance.ocr.status, 'disagreement');
  assert.ok(record.provenance.warnings.some(warning => /^Evidence-only draft:/i.test(warning)));
  assert.match(record.summary.en, /No clinical fields could be verified/);
  assert.match(record.summary.hi, /पुष्टि|सत्यापित/);
});

test('evidence-only fallback rejects nonmedical text even if extraction invents an ungrounded test', async () => {
  const text = 'GROCERY RECEIPT\nDate: 2026-10-14\nCustomer: Demo Person\nApples: 2 bags\nBread: 1 loaf\nTotal: 200 rupees\nThank you for shopping with us.';
  const nim = { configured: true, models: { vision: 'test-vision', extraction: 'test-extraction' }, async vision() { return text; }, async extract() {
    return { title: 'Lab report', type: 'lab', observations: [{ name: 'HbA1c', value: 6.1, unit: '%', sourceText: 'HbA1c: 6.1%' }], medications: [], diagnoses: [] };
  } };
  await assert.rejects(processDocument({ buffer: imageFixture(), originalname: 'receipt.png', mimetype: 'image/png' }, nim, () => {}, { handwriting: true }), /No source-supported medical facts/);
});

test('blank OCR and a missing second reading cannot produce an evidence-only draft', async () => {
  const file = { buffer: imageFixture(), originalname: 'blank.png', mimetype: 'image/png' };
  for (const blank of [true, false]) {
    let calls = 0;
    const nim = { configured: true, models: { vision: 'test-vision', extraction: 'test-extraction' }, async vision() {
      if (++calls === 2 && !blank) throw new Error('Unavailable');
      return blank ? '[unclear]' : 'FICTIONAL PRESCRIPTION\nPatient: Demo Patient\nDate: 2026-10-14\nProvider: Fictional Clinic\nMedicine: [unclear]\nDose: [unclear]';
    }, async extract() { return { observations: [], medications: [], diagnoses: [] }; } };
    await assert.rejects(processDocument(file, nim, () => {}, { handwriting: true }), /readable medical text|No source-supported medical facts/);
  }
});

test('a physically uniform image is rejected before a model can fabricate medical-page context', async () => {
  const canvas = createCanvas(400, 400);
  const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 400, 400);
  let calls = 0;
  const nim = { configured: true, models: { vision: 'test', extraction: 'test' }, async vision() { calls++; return 'FICTIONAL PRESCRIPTION\nPatient: Demo Patient\nDate: 2026-10-14\nProvider: Fictional Clinic\nMedicine: [unclear]\nDose: [unclear]'; } };
  await assert.rejects(processDocument({ buffer: canvas.toBuffer('image/png'), originalname: 'blank.png', mimetype: 'image/png' }, nim, () => {}, { handwriting: true }), /blank|uniform/i);
  assert.equal(calls, 0);
});
