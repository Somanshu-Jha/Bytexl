import { randomUUID } from 'node:crypto';

const RECORD_TYPES = new Set(['lab', 'prescription', 'discharge', 'diagnostic']);
const MODES = new Set(['live', 'local', 'demo']);
const INSTRUCTION_TEXT = /ignore\s+(?:all\s+|previous\s+|prior\s+)?(?:instructions|rules)|system\s*prompt|\[INST\]|<\/?(?:script|system)>|reveal\s+(?:the\s+)?(?:secret|api\s*key)/i;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, limit = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit) : '';
const comparable = value => clean(value, 100000).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
const safeText = (value, limit) => INSTRUCTION_TEXT.test(clean(value, limit)) ? '' : clean(value, limit);

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) && Math.abs(number) <= 1e12 ? number : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function validTimestamp(value, fallback) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function includesEvidence(source, snippet) {
  return Boolean(snippet) && comparable(source).includes(comparable(snippet));
}

function hasNumber(source, number) {
  if (number === null) return false;
  const text = source.normalize('NFKC').replace(/[−–—]/g, '-');
  for (const match of text.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g)) {
    // In 70-99 the hyphen separates range endpoints; in "-99" it is a sign.
    const token = match[0].startsWith('-') && /\d/.test(text[(match.index ?? 0) - 1] ?? '') ? match[0].slice(1) : match[0];
    if (Number(token) === number) return true;
  }
  return false;
}

function hasResultNumber(source, name, value) {
  const text = comparable(source);
  const printedName = comparable(name);
  const index = text.indexOf(printedName);
  if (index < 0) return false;
  const tail = text.slice(index + printedName.length).replace(/[−–—]/g, '-');
  const firstNumber = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/.exec(tail);
  if (!firstNumber) return false;
  const prefix = tail.slice(0, firstNumber.index);
  // Qualified values must remain text evidence rather than becoming exact numbers.
  if (/[<>≤≥]|less than|greater than|below|above/i.test(prefix)) return false;
  return Number(firstNumber[0]) === value;
}

/** A flag describes only the two-sided range printed on this particular report. */
export function classifyObservation(observation = {}) {
  const { value, referenceLow: low, referenceHigh: high } = observation;
  if (![value, low, high].every(item => typeof item === 'number' && Number.isFinite(item)) || low > high) return 'unknown';
  return value < low ? 'low' : value > high ? 'high' : 'normal';
}

export function explainObservation(observation = {}) {
  const name = safeText(observation.name, 120) || 'Result';
  const value = finiteNumber(observation.value);
  const unit = safeText(observation.unit, 40);
  if (value === null) return { en: `${name}: a readable numeric value is not available. Check the source document.`, hi: `${name}: पढ़ने योग्य संख्यात्मक मान उपलब्ध नहीं है। मूल दस्तावेज़ देखें।` };
  const display = `${value}${unit ? ` ${unit}` : ''}`;
  const status = classifyObservation(observation);
  if (status === 'unknown') return { en: `${name} is reported as ${display}. A complete, usable reference range is not available; no range comparison was made.`, hi: `${name} का दर्ज मान ${display} है। पूरी और उपयोग योग्य संदर्भ सीमा उपलब्ध नहीं है; सीमा से तुलना नहीं की गई।` };
  const range = `${observation.referenceLow}–${observation.referenceHigh}${unit ? ` ${unit}` : ''}`;
  const position = status === 'normal' ? 'within' : status === 'high' ? 'above' : 'below';
  const hindi = status === 'normal' ? 'के भीतर' : status === 'high' ? 'से ऊपर' : 'से नीचे';
  return {
    en: `${name} is ${display}, ${position} this report's reference range (${range}). A result alone does not establish a diagnosis.`,
    hi: `${name} का मान ${display} है, जो इस रिपोर्ट की संदर्भ सीमा (${range}) ${hindi} है। केवल एक परिणाम से निदान नहीं होता।`,
  };
}

/** Model JSON is untrusted. Metadata comes only from the upload pipeline or reviewed API. */
export function normalizeExtraction(raw, metadata = {}) {
  if (!isObject(raw)) throw new TypeError('Extraction output must be a JSON object.');
  if (!isObject(metadata)) throw new TypeError('Extraction metadata must be an object.');
  const warnings = [];
  const warn = message => { if (warnings.length < 40 && !warnings.includes(message)) warnings.push(message); };
  const sourceText = clean(metadata.sourceText, 100000);
  if (!sourceText) warn('Source text is unavailable; extracted clinical fields need source review.');
  if (typeof metadata.sourceText === 'string' && metadata.sourceText.length > 100000) warn('Source text was limited to 100,000 characters.');
  if (INSTRUCTION_TEXT.test(sourceText)) warn('Instruction-like text in the document was treated as source content only.');
  const date = validDate(raw.date);
  if (!date) warn('Document date is missing or invalid; it has not been inferred from the upload date.');
  const bounded = (value, max, label) => {
    if (!Array.isArray(value)) return [];
    if (value.length > max) warn(`${label} exceeded the extraction limit and was truncated.`);
    return value.slice(0, max).filter(isObject);
  };
  const observations = bounded(raw.observations, 100, 'Observations').map((item, index) => {
    const name = safeText(item.name, 120) || `Unidentified result ${index + 1}`;
    const source = clean(item.sourceText, 1500);
    const supported = includesEvidence(sourceText, source) && includesEvidence(source, name) && !INSTRUCTION_TEXT.test(source);
    if (!supported) warn('One or more observation snippets could not be verified against the source text.');
    const numeric = (value, label) => {
      const result = finiteNumber(value);
      if (result === null) return null;
      if (supported && (label === 'observation value' ? hasResultNumber(source, name, result) : hasNumber(source, result))) return result;
      warn(`An unsupported ${label} was left blank for review.`);
      return null;
    };
    let referenceLow = numeric(item.referenceLow, 'reference limit');
    let referenceHigh = numeric(item.referenceHigh, 'reference limit');
    if (referenceLow !== null && referenceHigh !== null && referenceLow > referenceHigh) {
      referenceLow = null; referenceHigh = null;
      warn('An inverted reference range was left blank for review.');
    }
    const candidateUnit = safeText(item.unit, 40);
    const unit = supported && includesEvidence(source, candidateUnit) ? candidateUnit : '';
    if (candidateUnit && !unit) warn('An unsupported observation unit was left blank for review.');
    const observation = {
      id: randomUUID(), name, value: numeric(item.value, 'observation value'), unit,
      referenceLow, referenceHigh, sourceText: source, status: 'unknown', explanation: { en: '', hi: '' },
    };
    observation.status = classifyObservation(observation);
    observation.explanation = explainObservation(observation);
    return observation;
  });
  const medications = bounded(raw.medications, 30, 'Medications').flatMap(item => {
    const name = safeText(item.name, 120);
    const source = clean(item.sourceText, 1500);
    if (!name || !includesEvidence(sourceText, source) || !includesEvidence(source, name) || INSTRUCTION_TEXT.test(source)) {
      warn('A medication without verifiable source evidence was omitted.'); return [];
    }
    const supportedField = field => {
      const text = safeText(item[field], 350);
      if (!text || includesEvidence(source, text)) return text;
      warn('An unsupported medication instruction was left blank for review.'); return '';
    };
    return [{ id: randomUUID(), name, dosage: supportedField('dosage'), frequency: supportedField('frequency'), duration: supportedField('duration'), instructions: supportedField('instructions'), sourceText: source }];
  });
  const diagnoses = bounded(raw.diagnoses, 20, 'Diagnoses').flatMap(item => {
    const name = safeText(item.name, 120); const source = clean(item.sourceText, 1500);
    if (!name || !includesEvidence(sourceText, source) || !includesEvidence(source, name) || INSTRUCTION_TEXT.test(source)) {
      warn('A diagnosis without verifiable source evidence was omitted; results were not converted into diagnoses.'); return [];
    }
    return [{ name, sourceText: source }];
  });
  const outside = observations.filter(observation => ['high', 'low'].includes(observation.status)).length;
  const summary = observations.length ? {
    en: `${observations.length} reported result${observations.length === 1 ? '' : 's'} extracted. ${outside} ${outside === 1 ? 'is' : 'are'} outside this report's reference ranges. Review the source and discuss questions with your clinician; these results do not establish a diagnosis.`,
    hi: `${observations.length} दर्ज परिणाम निकाले गए। ${outside} परिणाम इस रिपोर्ट की संदर्भ सीमाओं से बाहर हैं। मूल दस्तावेज़ की जाँच करें और प्रश्न अपने चिकित्सक से पूछें; इन परिणामों से निदान नहीं होता।`,
  } : medications.length ? {
    en: `${medications.length} source-prescribed medication${medications.length === 1 ? '' : 's'} transcribed. Confirm unclear instructions with the prescriber; this record does not confirm current use.`,
    hi: `मूल प्रिस्क्रिप्शन की ${medications.length} दवाओं का विवरण दर्ज है। अस्पष्ट निर्देश लिखने वाले चिकित्सक से स्पष्ट करें; यह रिकॉर्ड वर्तमान उपयोग की पुष्टि नहीं करता।`,
  } : {
    en: 'Document saved for review. Read the source text for clinical findings and instructions; no diagnosis has been inferred.',
    hi: 'दस्तावेज़ समीक्षा के लिए सहेजा गया है। चिकित्सकीय निष्कर्षों और निर्देशों के लिए मूल पाठ पढ़ें; कोई निदान अनुमानित नहीं किया गया है।',
  };
  const now = new Date().toISOString();
  const trustedProvenance = isObject(metadata.provenance) ? metadata.provenance : metadata;
  for (const warning of Array.isArray(trustedProvenance.warnings) ? trustedProvenance.warnings.slice(0, 30) : []) {
    const text = clean(warning, 500); if (text) warn(text);
  }
  const provenance = {
    mode: MODES.has(trustedProvenance.mode) ? trustedProvenance.mode : 'local',
    extractionModel: clean(trustedProvenance.extractionModel, 200) || 'unspecified',
    processedAt: validTimestamp(trustedProvenance.processedAt, now), warnings,
  };
  if (clean(trustedProvenance.visionModel, 200)) provenance.visionModel = clean(trustedProvenance.visionModel, 200);
  return {
    id: clean(metadata.id, 120) || randomUUID(), title: safeText(raw.title, 200) || 'Uploaded health record',
    type: RECORD_TYPES.has(raw.type) ? raw.type : 'lab', date, provider: safeText(raw.provider, 200) || 'Provider not recorded',
    fileName: clean(metadata.fileName, 200) || 'uploaded-document', summary,
    keyPoints: observations.slice(0, 6).map(observation => observation.explanation), observations, medications, diagnoses, sourceText,
    reviewStatus: metadata.reviewStatus === 'reviewed' ? 'reviewed' : 'pending', isDemo: metadata.isDemo === true,
    createdAt: validTimestamp(metadata.createdAt, now), provenance,
  };
}
