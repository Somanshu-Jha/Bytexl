import { createCanvas, loadImage } from '@napi-rs/canvas';
import { normalizeExtraction } from './domain.mjs';

export class DocumentError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'DocumentError'; this.status = status; }
}

export const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_PAGES = 8;
const MAX_OCR_PAGES = 4;
const MAX_SOURCE_LENGTH = 28000;

export function validateFile(file) {
  if (!file?.buffer?.length) throw new DocumentError('Choose a non-empty medical document.');
  if (file.buffer.length > MAX_FILE_SIZE) throw new DocumentError('The document is larger than 12 MB. Upload a smaller file.', 413);
  const filename = file.originalname || '';
  const extension = filename.split('.').pop()?.toLowerCase();
  const mime = file.mimetype;
  const bytes = file.buffer;
  const signature = bytes.subarray(0, 12);
  let kind;
  if (extension === 'pdf' && ['application/pdf', 'application/octet-stream'].includes(mime) && signature.subarray(0, 5).toString() === '%PDF-') kind = 'pdf';
  if (['png'].includes(extension) && ['image/png', 'application/octet-stream'].includes(mime) && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) kind = 'image';
  if (['jpg', 'jpeg'].includes(extension) && ['image/jpeg', 'application/octet-stream'].includes(mime) && signature[0] === 255 && signature[1] === 216 && signature[2] === 255) kind = 'image';
  if (extension === 'webp' && ['image/webp', 'application/octet-stream'].includes(mime) && signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WEBP') kind = 'image';
  if (extension === 'txt' && ['text/plain', 'application/octet-stream'].includes(mime)) {
    const text = bytes.toString('utf8');
    if (!text.includes('\u0000') && !text.includes('\ufffd')) kind = 'text';
  }
  if (!kind) throw new DocumentError('Unsupported or mismatched file content. Use a PDF, PNG, JPEG, WebP, or UTF-8 TXT document.', 415);
  return kind;
}

function cleanSource(text) {
  const cleaned = text.replace(/\u0000/g, '').trim();
  if (cleaned.length < 20 || !/[\p{L}\p{N}]{3}/u.test(cleaned)) throw new DocumentError('No readable medical text was found. Try a clearer scan or a text-based PDF.');
  if (cleaned.length > MAX_SOURCE_LENGTH) throw new DocumentError('This document contains too much text for one analysis. Split it into smaller documents.');
  return cleaned;
}

async function imageForOcr(buffer) {
  let image;
  try { image = await loadImage(buffer); } catch { throw new DocumentError('The image could not be decoded. Export it as a new PNG or JPEG and try again.'); }
  if (!image.width || !image.height || image.width * image.height > 40000000) throw new DocumentError('The image dimensions are too large. Resize it to below 40 megapixels.');
  const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function readPdf(buffer, nim, stage) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document;
  let loadingTask;
  try {
    loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
    document = await loadingTask.promise;
  } catch {
    if (loadingTask) await loadingTask.destroy();
    throw new DocumentError('This PDF is damaged or password protected. Upload an unlocked copy.');
  }
  try {
    if (document.numPages > MAX_PAGES) throw new DocumentError(`This prototype accepts up to ${MAX_PAGES} PDF pages. Split the document and try again.`);
    const parts = [];
    let ocrPages = 0;
    for (let number = 1; number <= document.numPages; number++) {
      stage(`Reading document · page ${number} of ${document.numPages}`);
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      let lastY = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform?.[5];
        if (lastY !== null && Math.abs(y - lastY) > 4 && text && !text.endsWith('\n')) text += '\n';
        text += item.str + (item.hasEOL ? '\n' : ' ');
        lastY = y;
      }
      if (text.replace(/\s/g, '').length < 50) {
        if (!nim.configured) throw new DocumentError('This PDF needs vision OCR. Configure the NVIDIA API key on the server, or upload a readable text document.', 503);
        if (++ocrPages > MAX_OCR_PAGES) throw new DocumentError(`Scanned PDFs are limited to ${MAX_OCR_PAGES} pages per upload. Split this document.`);
        stage(`Reading image with vision model · page ${number} of ${document.numPages}`);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(natural.width, natural.height)) });
        // PDF.js may own a different native canvas version; its factory prevents
        // incompatible native handles crossing between renderer and target.
        const target = document.canvasFactory.create(Math.round(viewport.width), Math.round(viewport.height));
        let dataUrl;
        try {
          await page.render({ canvasContext: target.context, viewport, canvas: target.canvas }).promise;
          dataUrl = target.canvas.toDataURL('image/jpeg', 0.9);
        } finally { document.canvasFactory.destroy(target); }
        text = await nim.vision(dataUrl);
      }
      parts.push(text.trim());
      page.cleanup();
    }
    return { text: parts.join('\n\n'), usedVision: ocrPages > 0 };
  } finally { await loadingTask.destroy(); }
}

/** Deliberately limited deterministic parsing for offline, machine-readable reports. */
export function localExtract(sourceText) {
  const observations = [];
  const medications = [];
  const number = '[-+]?\\d+(?:\\.\\d+)?';
  const labLine = new RegExp(`^([\\p{L}][\\p{L}\\d ()/.,%-]{1,65}?)\\s*[:|]?\\s+(${number})\\s*([\\p{L}\\dµμ%/.*^-]+)?(?:\\s*[|,(;]?\\s*(?:reference(?:\\s+range)?|ref\\.?|range|normal)?\\s*[:(]?\\s*(${number})\\s*[-–—]\\s*(${number}))?`, 'iu');
  for (const line of sourceText.split(/\r?\n/)) {
    const match = line.trim().match(labLine);
    if (!match || /^(date|patient|age|phone|id|abha|sample|report|provider|page)\b/i.test(match[1])) continue;
    // An explicit unit is required to avoid treating ordinary prose and IDs as test results.
    if (!match[3] || !/^(%|g\/dL|mg\/dL|mmol\/L|mIU\/L|uIU\/mL|IU\/L|U\/L|ng\/mL|pg\/mL|fL|pg|g\/L|mm\/hr|cells\/.*|10\^\d+\/.*|x10.*)$/i.test(match[3])) continue;
    observations.push({ name: match[1].trim().replace(/:$/, ''), value: Number(match[2]), unit: match[3], referenceLow: match[4] === undefined ? null : Number(match[4]), referenceHigh: match[5] === undefined ? null : Number(match[5]), sourceText: line.trim() });
  }
  const date = sourceText.match(/(?:date|dated|दिनांक)\s*:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || null;
  const provider = sourceText.match(/(?:provider|laboratory|clinic)\s*:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
  if (observations.length === 0) throw new DocumentError('The local parser could not extract medical values from this document. Configure NVIDIA AI for prescriptions, diagnostic reports, and less structured documents.');
  return { title: 'Uploaded laboratory report', type: 'lab', date, provider, observations, medications, diagnoses: [] };
}

export async function processDocument(file, nim, stage = () => {}) {
  const kind = validateFile(file);
  stage('Reading document');
  let sourceText;
  let usedVision = false;
  if (kind === 'text') sourceText = file.buffer.toString('utf8');
  else if (kind === 'pdf') {
    const result = await readPdf(file.buffer, nim, stage);
    sourceText = result.text; usedVision = result.usedVision;
  } else {
    if (!nim.configured) throw new DocumentError('Image OCR requires NVIDIA AI. Configure the server API key, or upload a readable text report.', 503);
    stage('Reading image with vision model');
    sourceText = await nim.vision(await imageForOcr(file.buffer));
    usedVision = true;
  }
  sourceText = cleanSource(sourceText);
  stage(nim.configured ? 'Extracting structured fields' : 'Extracting with local parser');
  const raw = nim.configured ? await nim.extract(sourceText) : localExtract(sourceText);
  stage('Validating source evidence');
  const warnings = [];
  if (!nim.configured) warnings.push('Limited local parser used; no AI model was called. Only explicit laboratory rows were extracted.');
  if (usedVision) warnings.push('Vision transcription can misread handwriting, decimals and table columns. Verify against the original document.');
  const record = normalizeExtraction(raw, {
    sourceText, fileName: file.originalname.slice(0, 180), isDemo: false, reviewStatus: 'pending',
    provenance: {
      mode: nim.configured ? 'live' : 'local',
      extractionModel: nim.configured ? nim.models.extraction : 'deterministic-lab-parser',
      ...(usedVision ? { visionModel: nim.models.vision } : {}),
      processedAt: new Date().toISOString(), warnings,
    },
  });
  if (!record.observations.length && !record.medications.length && !record.diagnoses.length) {
    throw new DocumentError('No source-supported medical facts could be extracted. Please upload a clearer medical record.');
  }
  return record;
}
