import { normalizeExtraction } from './domain.mjs';
import { prepareOcrImages, transcribeWithReview, HANDWRITING_OCR_BUDGET_MS, OcrInputError } from './ocr.mjs';

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

function hasMedicalReviewEvidence(ocr, sourceText) {
  if (ocr?.mode !== 'verified' || !ocr.pages?.length || !ocr.pages.every(page => page.firstPass?.trim() && page.secondPass?.trim())) return false;
  // Use only agreed readable context. Raw alternative readings must not turn a
  // blank/nonmedical upload into a medical draft because a model invented a chart.
  const clearLines = sourceText.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/\[unclear\]/i.test(line));
  const context = clearLines.join('\n').normalize('NFKC');
  if (context.length < 80 || clearLines.length < 4) return false;
  const identity = /(?:^|\n)\s*(?:patient|provider|report date|date|clinic|hospital|रोगी|मरीज़|मरीज|दिनांक)\s*[:|]/i.test(context);
  const documentKind = /\b(?:prescription|discharge summary|diagnostic report|laboratory report|lab report)\b|प्रिस्क्रिप्शन|चिकित्सकीय पर्चा|जाँच रिपोर्ट|जांच रिपोर्ट|डिस्चार्ज/i.test(context);
  const medicineSections = /\b(?:medicine|medication|drug|rx)\b|दवा/i.test(context) && /\b(?:dose|dosage|frequency|duration)\b|खुराक/i.test(context);
  const laboratorySections = /\b(?:test|analyte|laboratory|lab)\b|जाँच|जांच/i.test(context) && /\b(?:result|reference range)\b|परिणाम|संदर्भ सीमा/i.test(context);
  return identity && (documentKind || medicineSections || laboratorySections);
}

async function readImage(buffer, nim, stage, { handwriting, page = 1, deadline }) {
  try {
    const images = await prepareOcrImages(buffer, { handwriting });
    return await transcribeWithReview(images, nim, { handwriting, page, deadline, stage });
  } catch (error) {
    if (error instanceof OcrInputError) throw new DocumentError(error.message);
    throw error;
  }
}

async function readPdf(buffer, nim, stage, { handwriting = false, deadline } = {}) {
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
    if (handwriting && document.numPages > 2) throw new DocumentError('Handwriting comparison supports up to 2 PDF pages per upload. Split this document into smaller files.');
    const parts = [];
    const warnings = [];
    const comparedPages = [];
    let ocrPages = 0;
    for (let number = 1; number <= document.numPages; number++) {
      stage(`Reading document · page ${number} of ${document.numPages}`);
      const page = await document.getPage(number);
      let text = '';
      let lastY = null;
      const content = handwriting ? { items: [] } : await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform?.[5];
        if (lastY !== null && Math.abs(y - lastY) > 4 && text && !text.endsWith('\n')) text += '\n';
        text += item.str + (item.hasEOL ? '\n' : ' ');
        lastY = y;
      }
      if (handwriting || text.replace(/\s/g, '').length < 50) {
        if (!nim.configured) throw new DocumentError('This PDF needs vision OCR. Configure the NVIDIA API key on the server, or upload a readable text document.', 503);
        if (++ocrPages > MAX_OCR_PAGES) throw new DocumentError(`Scanned PDFs are limited to ${MAX_OCR_PAGES} pages per upload. Split this document.`);
        stage(`Reading image with vision model · page ${number} of ${document.numPages}`);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(handwriting ? 3 : 2, (handwriting ? 2200 : 1800) / Math.max(natural.width, natural.height)) });
        // PDF.js may own a different native canvas version; its factory prevents
        // incompatible native handles crossing between renderer and target.
        const target = document.canvasFactory.create(Math.round(viewport.width), Math.round(viewport.height));
        let dataUrl;
        try {
          await page.render({ canvasContext: target.context, viewport, canvas: target.canvas }).promise;
          dataUrl = target.canvas.toDataURL('image/jpeg', 0.9);
        } finally { document.canvasFactory.destroy(target); }
        const result = await readImage(dataUrl, nim, stage, { handwriting, page: number, deadline });
        text = result.text;
        warnings.push(...result.warnings);
        if (result.ocr) comparedPages.push(result.ocr);
      }
      parts.push(text.trim());
      page.cleanup();
    }
    let ocr;
    if (comparedPages.length) ocr = {
      mode: 'verified', verificationModel: comparedPages[0].verificationModel,
      status: comparedPages.some(result => result.status === 'verification-unavailable') ? 'verification-unavailable' : comparedPages.some(result => result.status === 'disagreement') ? 'disagreement' : 'agreement',
      disagreementCount: comparedPages.reduce((total, result) => total + result.disagreementCount, 0),
      pages: comparedPages.flatMap(result => result.pages),
      preprocessing: [...new Set(comparedPages.flatMap(result => result.preprocessing))],
    };
    return { text: parts.join('\n\n'), usedVision: ocrPages > 0, warnings: [...new Set(warnings)], ocr };
  } finally { await loadingTask.destroy(); }
}

/** Deliberately limited deterministic parsing for offline, machine-readable reports. */
export function localExtract(sourceText) {
  const observations = [];
  const medications = [];
  const number = '[-+]?\\d+(?:\\.\\d+)?';
  const unitPattern = /^(%|g\/dL|mg\/dL|mmol\/L|mIU\/L|uIU\/mL|IU\/L|U\/L|ng\/mL|pg\/mL|fL|pg|g\/L|mm\/hr|cells\/.*|10\^\d+\/.*|x10.*)$/i;
  const labelPattern = /^(date|patient|age|phone|id|abha|sample|report|provider|page)\b/i;
  // A name that still carries a "number - number" fragment is a range the greedy name group ran into.
  const rangeFragment = /\d\s*[-–—]\s*\d/;

  // Two layouts, tried in order:
  //   "Name: value unit; reference range: low - high"   (result first)
  //   "Name (low - high unit): value unit"              (range printed first)
  // The second is common in Indian lab reports, and a naive greedy name group reads the range's
  // upper bound as the result, discarding the real value. Parsing left-to-right from the field
  // separator keeps the result anchored to the field that actually holds it.
  const resultFirst = new RegExp(`^([\\p{L}][\\p{L}\\d ()/.,%'-]{1,65}?)\\s*[:|]?\\s+(${number})\\s*([\\p{L}\\dµμ%/.*^-]+)?(?:\\s*[|,(;]?\\s*(?:reference(?:\\s+range)?|ref\\.?|range|normal)?\\s*[:(]?\\s*(${number})\\s*[-–—]\\s*(${number}))?`, 'iu');
  const rangeFirst = new RegExp(`^([\\p{L}][\\p{L}\\d ()/.,%'-]{1,65}?)\\s*\\(\\s*(${number})\\s*[-–—]\\s*(${number})\\s*([\\p{L}\\dµμ%/.*^-]*)\\s*\\)\\s*[:|]?\\s*(${number})\\s*([\\p{L}\\dµμ%/.*^-]+)?`, 'iu');

  for (const line of sourceText.split(/\r?\n/)) {
    const text = line.trim();
    let parsed = null;

    const before = text.match(rangeFirst);
    if (before && !rangeFragment.test(before[1]) && !labelPattern.test(before[1])) {
      const unit = before[6] || before[4] || '';
      if (unitPattern.test(unit)) {
        parsed = { name: before[1], value: Number(before[5]), unit, referenceLow: Number(before[2]), referenceHigh: Number(before[3]) };
      }
    }

    if (!parsed) {
      const match = text.match(resultFirst);
      // The name must not have swallowed a range fragment, or the "value" is that range's bound.
      if (match && !rangeFragment.test(match[1]) && !labelPattern.test(match[1]) && match[3] && unitPattern.test(match[3])) {
        parsed = { name: match[1], value: Number(match[2]), unit: match[3], referenceLow: match[4] === undefined ? null : Number(match[4]), referenceHigh: match[5] === undefined ? null : Number(match[5]) };
      }
    }

    if (!parsed) continue;
    observations.push({ ...parsed, name: parsed.name.trim().replace(/:$/, '').trim(), sourceText: text });
  }
  const date = sourceText.match(/(?:date|dated|दिनांक)\s*:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || null;
  const provider = sourceText.match(/(?:provider|laboratory|clinic)\s*:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
  if (observations.length === 0) throw new DocumentError('The local parser could not extract medical values from this document. Configure NVIDIA AI for prescriptions, diagnostic reports, and less structured documents.');
  return { title: 'Uploaded laboratory report', type: 'lab', date, provider, observations, medications, diagnoses: [] };
}

export async function processDocument(file, nim, stage = () => {}, { handwriting = false } = {}) {
  const kind = validateFile(file);
  handwriting = handwriting === true && kind !== 'text';
  stage('Reading document');
  let sourceText;
  let usedVision = false;
  const warnings = [];
  let ocr;
  const deadline = handwriting ? Date.now() + HANDWRITING_OCR_BUDGET_MS : undefined;
  if (kind === 'text') sourceText = file.buffer.toString('utf8');
  else if (kind === 'pdf') {
    const result = await readPdf(file.buffer, nim, stage, { handwriting, deadline });
    sourceText = result.text; usedVision = result.usedVision;
    warnings.push(...result.warnings); ocr = result.ocr;
  } else {
    if (!nim.configured) throw new DocumentError('Image OCR requires NVIDIA AI. Configure the server API key, or upload a readable text report.', 503);
    const result = await readImage(file.buffer, nim, stage, { handwriting, deadline });
    sourceText = result.text; warnings.push(...result.warnings); ocr = result.ocr;
    usedVision = true;
  }
  sourceText = cleanSource(sourceText);
  stage(nim.configured ? 'Extracting structured fields' : 'Extracting with local parser');
  const raw = nim.configured ? await nim.extract(sourceText) : localExtract(sourceText);
  stage('Validating source evidence');
  if (!nim.configured) warnings.push('Limited local parser used; no AI model was called. Only explicit laboratory rows were extracted.');
  if (usedVision) warnings.push('Vision transcription can misread handwriting, decimals and table columns. Verify against the original document.');
  const record = normalizeExtraction(raw, {
    sourceText, fileName: file.originalname.slice(0, 180), isDemo: false, reviewStatus: 'pending',
    provenance: {
      mode: nim.configured ? 'live' : 'local',
      extractionModel: nim.configured ? nim.models.extraction : 'deterministic-lab-parser',
      ...(usedVision ? { visionModel: nim.models.vision } : {}),
      ...(ocr ? { ocr } : {}),
      processedAt: new Date().toISOString(), warnings,
    },
  });
  const anyFields = record.observations.length || record.medications.length || record.diagnoses.length;
  const reliableFields = record.observations.some(observation => typeof observation.value === 'number' && Number.isFinite(observation.value)) || record.medications.length || record.diagnoses.length;
  if (!anyFields || (handwriting && !reliableFields)) {
    if (handwriting && hasMedicalReviewEvidence(ocr, sourceText)) {
      record.observations = []; record.medications = []; record.diagnoses = []; record.keyPoints = [];
      record.reviewStatus = 'pending';
      record.summary = {
        en: 'No clinical fields could be verified. Review the original or upload a clearer image. Ask the prescriber about any unreadable medicine name or dose; do not guess.',
        hi: 'किसी भी चिकित्सकीय विवरण की पुष्टि नहीं हो सकी। मूल दस्तावेज़ देखें या अधिक स्पष्ट तस्वीर अपलोड करें। अस्पष्ट दवा के नाम या खुराक के बारे में लिखने वाले चिकित्सक से पूछें; अनुमान न लगाएँ।',
      };
      record.provenance.warnings.push('Evidence-only draft: no clinical fields could be verified. Both OCR readings are retained only for original-document review; do not use them as medication or dosing instructions.');
      return record;
    }
    throw new DocumentError('No source-supported medical facts could be extracted. Please upload a clearer medical record.');
  }
  return record;
}
