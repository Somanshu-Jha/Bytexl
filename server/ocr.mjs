import { createCanvas, loadImage } from '@napi-rs/canvas';

export const HANDWRITING_OCR_BUDGET_MS = 120000;
export const OCR_PASS_TIMEOUT_MS = 45000;
const MAX_PAGE_CHARS = 12000;
const MAX_PIXELS = 40000000;
const UNCLEAR = '[unclear]';

export class OcrInputError extends Error {
  constructor(message) { super(message); this.name = 'OcrInputError'; }
}

function encodedDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  if (buffer[0] === 255 && buffer[1] === 216) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 255) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5)];
      offset += length + 2;
    }
  }
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') {
    const kind = buffer.subarray(12, 16).toString();
    if (kind === 'VP8X') return [1 + buffer.readUIntLE(24, 3), 1 + buffer.readUIntLE(27, 3)];
    if (kind === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (kind === 'VP8 ' && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
  }
  return null;
}

/** Decoder honors JPEG EXIF orientation. No inferred deskew or hard thresholding. */
export async function prepareOcrImages(input, { handwriting = false } = {}) {
  const buffer = typeof input === 'string' && input.startsWith('data:') ? Buffer.from(input.split(',')[1] || '', 'base64') : input;
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 16 * 1024 * 1024) throw new OcrInputError('The image could not be read within the OCR size limit.');
  const dimensions = encodedDimensions(buffer);
  if (dimensions && (!dimensions[0] || !dimensions[1] || dimensions[0] * dimensions[1] > MAX_PIXELS)) throw new OcrInputError('The image dimensions are too large. Resize it to below 40 megapixels.');
  let image;
  try { image = await loadImage(buffer); } catch { throw new OcrInputError('The image could not be decoded. Export it as a new PNG or JPEG and try again.'); }
  if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new OcrInputError('The image dimensions are too large. Resize it to below 40 megapixels.');
  const maximum = handwriting ? 2200 : 1800;
  const scale = Math.min(1, maximum / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const primary = canvas.toDataURL('image/jpeg', 0.95);
  const preprocessing = ['EXIF-aware image decode', `Aspect-preserving resize, maximum ${maximum} pixels`, 'White transparency background'];
  if (!handwriting) return { primary, preprocessing };

  // Stretch luminance gently between the first/99th percentiles. Keeping continuous
  // grays rather than binary thresholding preserves fine decimal points and strokes.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  let uniform = true;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    if (pixels.data[offset] !== pixels.data[0] || pixels.data[offset + 1] !== pixels.data[1] || pixels.data[offset + 2] !== pixels.data[2]) uniform = false;
    const gray = Math.round(0.2126 * pixels.data[offset] + 0.7152 * pixels.data[offset + 1] + 0.0722 * pixels.data[offset + 2]);
    histogram[gray]++;
  }
  if (uniform) throw new OcrInputError('The image is blank or uniformly colored. Upload a readable medical document.');
  const count = canvas.width * canvas.height;
  const percentile = fraction => {
    let total = 0;
    for (let value = 0; value < 256; value++) { total += histogram[value]; if (total >= count * fraction) return value; }
    return 255;
  };
  const low = percentile(0.01); const high = percentile(0.99);
  const stretch = high - low >= 50;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    let gray = Math.round(0.2126 * pixels.data[offset] + 0.7152 * pixels.data[offset + 1] + 0.0722 * pixels.data[offset + 2]);
    if (stretch) gray = Math.max(0, Math.min(255, Math.round((gray - low) * 255 / (high - low))));
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = gray;
  }
  context.putImageData(pixels, 0, 0);
  preprocessing.push('Independent grayscale/continuous-contrast comparison image; no binary threshold');
  return { primary, verification: canvas.toDataURL('image/png'), preprocessing };
}

function transcription(value, handwriting = false) {
  if (typeof value !== 'string' || !value.trim()) throw new OcrInputError('The vision model returned no readable text. Retake the photograph in good light.');
  if (value.length > MAX_PAGE_CHARS) throw new OcrInputError('The OCR transcription is too long for one page. Split the document or use a closer crop.');
  let text = value.replace(/\u0000/g, '').replace(/^```(?:text|plaintext|markdown)?\s*\n?|\n?```$/gi, '').replace(/\[(?:unreadable|illegible|unknown|uncertain|not legible)\]/gi, UNCLEAR).trim();
  if (handwriting && /^(?:the (?:image|picture|photo) (?:shows|displays|contains|depicts)|here (?:are|is) (?:the )?(?:details|description) of the (?:image|picture))/i.test(text)) throw new OcrInputError('The vision model returned image commentary instead of a transcription. Try a clearer, closer photograph; no medical facts were accepted.');
  if (handwriting) text = text.split(/\r?\n/).map(line => line.trim().replace(/^(?:\*|•)\s+/, '').replace(/\*\*([^*\n]+)\*\*/g, '$1')).filter(line =>
    !/^(?:transcribed text|printed text|handwritten text):?$/i.test(line)
    && !/^the text in (?:this|the) (?:image|picture)[^:\n]{0,120}:$/i.test(line)
  ).join('\n').trim();
  if (!text) throw new OcrInputError('The vision model returned no readable text after its presentation headings were removed.');
  return text;
}

function tokens(line) {
  // Keep every non-whitespace symbol unless it is an unambiguous label colon.
  // Dropping comparators, fractions or non-ASCII digits would create false agreement.
  return [...line.matchAll(/\[unclear\]|[\p{L}\p{M}]+|\p{N}+(?:[.,]\p{N}+)?|[.,]\p{N}+|[^\s]/gu)].filter(match => {
    if (match[0] !== ':') return true;
    return /\p{N}\s*$/u.test(line.slice(0, match.index)) && /^\s*\p{N}/u.test(line.slice(match.index + 1));
  }).map(match => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
    key: match[0].normalize('NFKC').toLowerCase().replace(/[−–—]/g, '-'),
  }));
}

function similarity(first, second) {
  if (!first.length || !second.length) return 0;
  const counts = new Map();
  for (const token of first) counts.set(token.key, (counts.get(token.key) || 0) + 1);
  let overlap = 0;
  for (const token of second) if (counts.get(token.key)) { overlap++; counts.set(token.key, counts.get(token.key) - 1); }
  return overlap / Math.max(first.length, second.length);
}

function compareLine(line, first, second) {
  if (first.map(token => token.key).join('|') === second.map(token => token.key).join('|')) return { text: line, changed: false };
  if (first.length > 400 || second.length > 400) return { text: UNCLEAR, changed: true };
  const cols = second.length + 1;
  const lengths = new Uint16Array((first.length + 1) * cols);
  for (let i = 1; i <= first.length; i++) for (let j = 1; j <= second.length; j++) {
    lengths[i * cols + j] = first[i - 1].key === second[j - 1].key ? 1 + lengths[(i - 1) * cols + j - 1] : Math.max(lengths[(i - 1) * cols + j], lengths[i * cols + j - 1]);
  }
  const agreed = new Set();
  let i = first.length; let j = second.length;
  while (i && j) {
    if (first[i - 1].key === second[j - 1].key) { agreed.add(i - 1); i--; j--; }
    else if (lengths[(i - 1) * cols + j] >= lengths[i * cols + j - 1]) i--;
    else j--;
  }
  let text = ''; let position = 0; let inMask = false;
  first.forEach((token, index) => {
    if (agreed.has(index)) { text += line.slice(position, token.end); inMask = false; }
    else {
      const separator = line.slice(position, token.start);
      text += separator;
      if (!inMask) text += UNCLEAR;
      inMask = true;
    }
    position = token.end;
  });
  text += line.slice(position);
  if (agreed.size < second.length && agreed.size === first.length) text += ` ${UNCLEAR}`;
  return { text: text.trim() || UNCLEAR, changed: true };
}

/** Conservative textual comparison, never medical plausibility or a confidence score. */
export function reconcileTranscriptions(firstText, secondText) {
  const firstLines = firstText.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const secondLines = secondText.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (firstLines.length > 240 || secondLines.length > 240) throw new OcrInputError('Too many OCR lines to compare safely. Split the document into smaller pages.');
  const first = firstLines.map(tokens); const second = secondLines.map(tokens);
  const cols = second.length + 1;
  const scores = new Float32Array((first.length + 1) * cols);
  const pairs = new Float32Array(first.length * second.length);
  for (let i = 1; i <= first.length; i++) scores[i * cols] = -i * 0.2;
  for (let j = 1; j <= second.length; j++) scores[j] = -j * 0.2;
  for (let i = 1; i <= first.length; i++) for (let j = 1; j <= second.length; j++) {
    const match = similarity(first[i - 1], second[j - 1]);
    pairs[(i - 1) * second.length + j - 1] = match;
    scores[i * cols + j] = Math.max(scores[(i - 1) * cols + j] - 0.2, scores[i * cols + j - 1] - 0.2, scores[(i - 1) * cols + j - 1] + (match >= 0.35 ? match : -1));
  }
  let i = first.length; let j = second.length;
  const aligned = [];
  while (i || j) {
    const match = i && j ? pairs[(i - 1) * second.length + j - 1] : 0;
    const diagonal = i && j ? scores[(i - 1) * cols + j - 1] + (match >= 0.35 ? match : -1) : -Infinity;
    if (i && j && match >= 0.35 && Math.abs(scores[i * cols + j] - diagonal) < 0.001) { aligned.push([--i, --j]); }
    else if (i && (!j || scores[(i - 1) * cols + j] >= scores[i * cols + j - 1])) aligned.push([--i, null]);
    else aligned.push([null, --j]);
  }
  let disagreementCount = 0;
  const consensus = aligned.reverse().map(([a, b]) => {
    if (a === null || b === null) { disagreementCount++; return UNCLEAR; }
    const result = compareLine(firstLines[a], first[a], second[b]);
    if (result.changed) disagreementCount++;
    return result.text;
  }).join('\n');
  return { consensus, disagreementCount, hasUnclear: /\[unclear\]/i.test(consensus) };
}

export async function transcribeWithReview(images, nim, {
  handwriting = false, page = 1, deadline = Date.now() + HANDWRITING_OCR_BUDGET_MS, stage = () => {},
} = {}) {
  const timeLeft = () => Math.max(0, Math.min(handwriting ? OCR_PASS_TIMEOUT_MS : 90000, deadline - Date.now()));
  if (timeLeft() < 1000) throw new OcrInputError('The OCR time budget was reached. Split the document or retry a clearer photograph.');
  stage(handwriting ? `Reading handwriting · first pass · page ${page}` : `Reading image with vision model · page ${page}`);
  const firstRaw = await nim.vision(images.primary, { handwriting, timeoutMs: timeLeft() });
  const firstPass = transcription(firstRaw, handwriting);
  if (!handwriting) return { text: firstPass, warnings: [], ocr: undefined };
  const warnings = ['Handwriting OCR is experimental. Two readings can agree and still be wrong; agreement is not a medical accuracy or confidence score. Verify every medicine, dose, decimal and unit against the original.'];
  let secondRaw = ''; let secondPass = ''; let consensus = firstPass; let disagreementCount = 0; let status = 'verification-unavailable';
  stage(`Comparing handwriting · independent second pass · page ${page}`);
  try {
    if (timeLeft() < 1000 || !images.verification) throw new OcrInputError('No time remains for the comparison.');
    secondRaw = await nim.vision(images.verification, { handwriting: true, verification: true, timeoutMs: timeLeft() });
    secondPass = transcription(secondRaw, true);
    const compared = reconcileTranscriptions(firstPass, secondPass);
    consensus = compared.consensus; disagreementCount = compared.disagreementCount;
    status = disagreementCount ? 'disagreement' : 'agreement';
    if (disagreementCount) warnings.push(`The two OCR readings differ on ${disagreementCount} line${disagreementCount === 1 ? '' : 's'}. Disputed text was replaced with [unclear]; review the original before using these fields.`);
    if (compared.hasUnclear) warnings.push('Unreadable text remains [unclear]. Missing medicine names or instructions must be confirmed with the prescriber; do not guess them.');
  } catch {
    warnings.push('The independent OCR comparison was unavailable. This is an unverified first reading; mandatory review against the original is needed.');
  }
  return {
    text: consensus, warnings,
    ocr: {
      mode: 'verified', verificationModel: nim.ocrVerificationModel || nim.models.vision,
      status, disagreementCount, preprocessing: images.preprocessing || [],
      pages: [{ page, firstPass: firstRaw.trim().slice(0, MAX_PAGE_CHARS), secondPass: secondRaw.trim().slice(0, MAX_PAGE_CHARS), consensus, disagreementCount }],
    },
  };
}
