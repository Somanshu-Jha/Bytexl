import { randomUUID } from 'node:crypto';

const RECORD_TYPES = new Set(['lab', 'prescription', 'discharge', 'diagnostic']);
const MODES = new Set(['live', 'local', 'demo']);
// Instruction-like text in a document is treated as source content only (never as control metadata).
// The qualifier group must not consume the following noun, or the canonical phrase
// "ignore all previous instructions" slips through: "all previous" matches the group and then
// "instructions" has nothing left to match.
const INSTRUCTION_TEXT = /ignore\s+(?:(?:all|any|the|these|those)\s+|(?:previous|prior|earlier|above|preceding)\s+)*(?:instructions|rules|prompts?)\b|system\s*prompt|\b\[INST\]|<\/?(?:script|system)>|reveal\s+(?:the\s+)?(?:secret|api\s*key)|disregard\s+(?:(?:all|any|the)\s+|(?:previous|prior|earlier|above)\s+)*(?:instructions|rules)\b/i;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, limit = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit) : '';
const digits = value => value.replace(/[०-९]/g, digit => String(digit.charCodeAt(0) - 0x966));
const comparable = value => digits(clean(value, 100000).normalize('NFKC')).replace(/\s+/g, ' ').toLowerCase();
const safeText = (value, limit) => INSTRUCTION_TEXT.test(clean(value, limit)) ? '' : clean(value, limit);
const UNCLEAR = /\[(?:unclear|illegible|unreadable|unknown)[^\]]*\]|अस्पष्ट|अपठनीय/i;
const RANGE_LABEL = '(?:reference(?:\\s+(?:range|interval))?|ref\\.?|range|normal|संदर्भ(?:\\s+(?:सीमा|अंतराल))?|सामान्य(?:\\s+सीमा)?)';
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const RANGE_PAIR = `(${NUMBER})\\s*(?:-|to|से)\\s*(${NUMBER})`;
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Curated definitions, exact-name matches only. Sources: MedlinePlus lab-test pages
// hemoglobin-a1c-hba1c-test, blood-glucose-test, hemoglobin-test and vitamin-d-test.
const TEST_EDUCATION = {
  hba1c: { en: 'HbA1c reflects average blood glucose over the past 2–3 months.', hi: 'HbA1c पिछले 2–3 महीनों की औसत रक्त शर्करा दर्शाता है।' },
  'fasting glucose': { en: 'Fasting glucose measures blood sugar after fasting.', hi: 'फास्टिंग ग्लूकोज़ उपवास के बाद रक्त शर्करा का माप है।' },
  hemoglobin: { en: 'Hemoglobin is the protein in red blood cells that carries oxygen around the body.', hi: 'हीमोग्लोबिन लाल रक्त कोशिकाओं का प्रोटीन है, जो शरीर में ऑक्सीजन पहुँचाता है।' },
  'vitamin d': { en: 'Vitamin D helps the body absorb calcium for healthy bones and teeth.', hi: 'विटामिन D स्वस्थ हड्डियों और दाँतों के लिए शरीर को कैल्शियम अवशोषित करने में मदद करता है।' },
};

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(digits(value.trim()))) return null;
  const number = Number(digits(value.trim()));
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

function includesPhrase(source, phrase) {
  const text = comparable(phrase);
  if (!text) return false;
  const left = /^[\p{L}\p{M}\d]/u.test(text) ? '(?<![\\p{L}\\p{M}\\d])' : '';
  const right = /[\p{L}\p{M}\d]$/u.test(text) ? '(?![\\p{L}\\p{M}\\d])' : '';
  return new RegExp(left + escaped(text) + right, 'u').test(comparable(source));
}

/** Keep source context, including negation outside a model's shortened quote. */
function sourceContexts(source, snippet) {
  const lines = clean(source, 100000).split(/\r?\n/);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (!includesEvidence(lines[i], snippet)) continue;
    const previous = i ? lines[i - 1] : '';
    // A preceding section label is part of the statement (e.g. Family history:\nDiabetes).
    result.push((/[:：]\s*$/.test(previous) ? `${previous} ` : '') + lines[i]);
  }
  return result.length ? result : [snippet];
}

export function supportedDiagnosis(sourceText, snippet, name) {
  if (!includesEvidence(sourceText, snippet) || !includesPhrase(snippet, name) || UNCLEAR.test(snippet) || INSTRUCTION_TEXT.test(snippet)) return false;
  const excluded = /\b(?:no|not|without|negative|denies|denied|suspected|possible|possibly|probable|rule\s*out|ruled\s*out|r\s*\/\s*o|family|familial|father|mother|sibling|brother|sister)\b|\?|नहीं|नकारात्मक|अनुपस्थित|संभावित|संदेह|पारिवारिक|परिवार|पिता|माता/i;
  const affirmative = /\b(?:diagnos(?:is|es|ed)|impression|assessment|dx|known\s+case\s+of|history\s+of)\b|निदान|आकलन/i;
  return sourceContexts(sourceText, snippet).some(context => {
    const sentences = context.split(/(?<=[.!।])\s+/).filter(sentence => includesPhrase(sentence, name));
    return sentences.some(sentence => !excluded.test(sentence) && !UNCLEAR.test(sentence) && affirmative.test(sentence));
  });
}

function sourceDate(rawDate, sourceText) {
  const date = validDate(rawDate);
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  const months = ['jan(?:uary)?|जनवरी','feb(?:ruary)?|फ़रवरी|फरवरी','mar(?:ch)?|मार्च','apr(?:il)?|अप्रैल','may|मई','jun(?:e)?|जून','jul(?:y)?|जुलाई','aug(?:ust)?|अगस्त','sep(?:t(?:ember)?)?|सितंबर','oct(?:ober)?|अक्टूबर','nov(?:ember)?|नवंबर','dec(?:ember)?|दिसंबर'];
  for (const line of clean(sourceText, 100000).split(/\r?\n/)) {
    for (const segment of line.split(/[|;]/)) {
      if (/\bdob\b|birth|जन्म|admission|admitted|भर्ती/i.test(segment)) continue;
      const text = comparable(segment);
      if (new RegExp(`(?<!\\d)${year}[-/.]0?${month}[-/.]0?${day}(?!\\d)`).test(text)) return date;
      // Ambiguous numeric day/month order is never guessed, including Indian-looking forms.
      if (day > 12 || day === month) {
        if (new RegExp(`(?<!\\d)0?${day}[-/.]0?${month}[-/.]${year}(?!\\d)`).test(text)) return date;
      }
      if (day > 12 && new RegExp(`(?<!\\d)0?${month}[-/.]0?${day}[-/.]${year}(?!\\d)`).test(text)) return date;
      const named = `(?:${months[month - 1]})`;
      if (new RegExp(`(?<!\\d)0?${day}\\s*[- ]\\s*${named}[, -]+${year}|${named}\\s+0?${day}(?:st|nd|rd|th)?[, ]+${year}`, 'iu').test(text)) return date;
    }
  }
  return null;
}

/** Restrict evidence to this analyte's row, plus an immediately following range line. */
function observationTail(snippet, name) {
  const lines = clean(snippet, 1500).split(/\r?\n/);
  const rowIndex = lines.findIndex(line => includesPhrase(line, name));
  if (rowIndex < 0) return '';
  let row = lines[rowIndex];
  if (lines[rowIndex + 1] && new RegExp(`^\\s*${RANGE_LABEL}\\s*[:：]`, 'iu').test(lines[rowIndex + 1])) row += `; ${lines[rowIndex + 1]}`;
  const text = comparable(row).replace(/[−–—]/g, '-');
  const tail = text.slice(text.indexOf(comparable(name)) + comparable(name).length);
  const sections = tail.split(/;\s*/);
  const kept = [sections[0]];
  for (const section of sections.slice(1)) {
    if (/^[\p{L}\p{M}][\p{L}\p{M}\d ()/+.-]*\s*[:：]/u.test(section) && !new RegExp(`^${RANGE_LABEL}\\s*[:：]`, 'iu').test(section)) break;
    kept.push(section);
  }
  return kept.join('; ');
}

/**
 * Read the reference range that this result's own snippet prints, if any.
 *
 * Returns `[low, high]` for a two-sided range, `null` when the snippet prints no range, and
 * `[null, null]` when it prints one we cannot use (incomplete or inverted) — which is different
 * from "no range printed", because a printed-but-unusable range must not be replaced by a
 * model-supplied one.
 */
function printedRange(snippet, name, unit) {
  const tail = observationTail(snippet, name);
  const pair = new RegExp(RANGE_PAIR, 'iu').exec(tail);
  if (!pair) return null;
  const before = tail.slice(0, pair.index);
  const keyword = new RegExp(`${RANGE_LABEL}\\s*[:：(]?\\s*$`, 'iu').test(before);
  const leadingParenthesis = /^\s*\(\s*$/.test(before);
  const afterResult = unit && new RegExp(`^\\s*[:=|]?\\s*${NUMBER}\\s*${escaped(comparable(unit))}\\s*[|,(]?\\s*$`, 'iu').test(before);
  if ((!keyword && !leadingParenthesis && !afterResult) || UNCLEAR.test(before)) return null;
  const low = finiteNumber(pair[1]); const high = finiteNumber(pair[2]);
  return low !== null && high !== null && low < high ? [low, high] : [null, null];
}

/** A unit is accepted only when it is the unit printed for THIS result, not merely a substring of it. */
function matchesPrintedUnit(snippet, unit, name) {
  if (!unit) return false;
  const text = resultEvidence(snippet, name);
  // The unit must sit immediately after the result number (optionally across spaces/punctuation)
  // and be bounded by a non-unit character, so "g/dL" cannot be accepted from inside "mg/dL".
  const anchored = new RegExp(`^\\s*${escaped(comparable(unit))}(?![\\p{L}\\p{M}\\d/^])`, 'iu').test(text?.suffix || '');
  return anchored;
}

function resultEvidence(source, name) {
  let tail = observationTail(source, name);
  // A directly parenthesised range is a header, not this observation's measured value.
  const leadingRange = new RegExp(`^\\s*\\(\\s*${RANGE_PAIR}[^)]*\\)`, 'iu');
  if (leadingRange.test(tail)) tail = tail.replace(leadingRange, '');
  const firstNumber = new RegExp(NUMBER).exec(tail);
  if (!firstNumber) return null;
  const prefix = tail.slice(0, firstNumber.index);
  const suffix = tail.slice(firstNumber.index + firstNumber[0].length);
  const measuredSuffix = suffix.split(/[;|]/)[0];
  if (UNCLEAR.test(prefix) || UNCLEAR.test(measuredSuffix) || /[<>≤≥?]|less than|greater than|below|above|से कम|से अधिक/i.test(prefix) || /\?/.test(measuredSuffix) || /^\s*(?:[\[/:<>≤≥±~]|[,.]\s*\d|[-−–—]\s*\d|[eE][+-]?\d)/.test(suffix)) return null;
  if (!/^\s*[:：=|]?\s*(?:(?:result|value|परिणाम|मान)\s*[:：]?\s*)?$/i.test(prefix)) return null;
  return { value: finiteNumber(firstNumber[0]), suffix };
}

/** Only this medicine's row and recognisable instruction continuations are evidence. */
function medicationClauses(source, name) {
  const sections = clean(source, 1500).split(/[;\n]/);
  const at = sections.findIndex(section => includesPhrase(section, name));
  if (at < 0) return [];
  const first = comparable(sections[at]);
  const tail = first.slice(first.indexOf(comparable(name)) + comparable(name).length).replace(/^\s*[:：=]\s*/, '');
  const parts = [tail, ...sections.slice(at + 1)].flatMap(section => section.split(/,(?!\s*\d)|\s+(?:and|और)\s+/iu)).map(comparable);
  const instruction = /^(?:(?:frequency|duration|instructions?)\s*[:：]|take\s+(?:after|before|with|without|at|\d+\s+(?:tablets?|capsules?|drops?))\b|(?:once|twice|thrice|daily|weekly|every|for|after|before|with|without|morning|evening|at\s+(?:night|bedtime)|od|bd|tid|tds|qid|prn)\b|आवृत्ति|अवधि|निर्देश|दिन में|रोज|प्रतिदिन|सुबह|रात|भोजन|खाने|लें)/iu;
  const doseUnits = '(?:mg|mcg|µg|g|ml|iu|units?|tablets?|capsules?|drops?)';
  const leadingDose = new RegExp(`^(?:(?:dose|dosage|strength|खुराक)\\s*[:：]?\\s*)?${NUMBER}\\s*${doseUnits}\\b`, 'iu');
  const namedDose = new RegExp(`([\\p{L}\\p{M}][\\p{L}\\p{M}\\d-]*)\\s*[:：]?\\s+${NUMBER}\\s*${doseUnits}\\b`, 'giu');
  const kept = [];
  let hasDose = false;
  for (let index = 0; index < parts.length; index++) {
    let part = parts[index];
    if (!part) continue;
    // A newly named medicine can also appear after "take" or without punctuation.
    const otherMedicine = [...part.matchAll(namedDose)].find(match => !/^(?:dose|dosage|strength|take|for|खुराक)$/iu.test(match[1]));
    if (otherMedicine) part = part.slice(0, otherMedicine.index).trim();
    const dose = leadingDose.exec(part);
    if (dose) {
      if (hasDose) break;
      hasDose = true;
      const rest = part.slice(dose[0].length).trim();
      if (rest && !instruction.test(rest)) { kept.push(dose[0]); break; }
    } else if (UNCLEAR.test(part)) {
      hasDose = true;
    } else if (!instruction.test(part)) break;
    kept.push(part);
    if (otherMedicine) break;
  }
  return kept;
}

function normalizeOcr(raw, warn) {
  if (!isObject(raw)) return undefined;
  const integer = value => Number.isInteger(value) && value >= 0 ? Math.min(value, 10000) : 0;
  if (Array.isArray(raw.pages) && raw.pages.length > 4) warn('OCR comparison evidence exceeded four pages and was truncated.');
  const pages = (Array.isArray(raw.pages) ? raw.pages : []).slice(0, 4).filter(isObject).map((page, index) => {
    const text = field => {
      if (typeof page[field] === 'string' && page[field].length > 12000) warn('An OCR evidence passage exceeded 12,000 characters and was truncated.');
      return clean(page[field], 12000);
    };
    return { page: integer(page.page) || index + 1, firstPass: text('firstPass'), secondPass: text('secondPass'), consensus: text('consensus'), disagreementCount: integer(page.disagreementCount) };
  });
  const disagreementCount = Math.max(integer(raw.disagreementCount), pages.reduce((sum, page) => sum + page.disagreementCount, 0));
  const status = disagreementCount ? 'disagreement' : ['agreement', 'disagreement', 'verification-unavailable'].includes(raw.status) ? raw.status : 'verification-unavailable';
  const result = {
    mode: raw.mode === 'verified' ? 'verified' : 'single', status, disagreementCount, pages,
    preprocessing: (Array.isArray(raw.preprocessing) ? raw.preprocessing : []).slice(0, 10).map(value => clean(value, 150)).filter(Boolean),
  };
  const verificationModel = clean(raw.verificationModel, 200);
  if (verificationModel) result.verificationModel = verificationModel;
  if (status !== 'agreement') warn('OCR comparison has unresolved differences or could not be completed. Check the original document and acknowledge the warning before marking reviewed.');
  return result;
}

export function requiresOcrAcknowledgment(record) {
  const ocr = record?.provenance?.ocr;
  return Boolean(ocr && (ocr.status !== 'agreement' || ocr.disagreementCount > 0 || UNCLEAR.test(record.sourceText || '') || ocr.pages?.some(page => UNCLEAR.test(page.consensus || '')) || record.provenance.warnings?.some(warning => warning.startsWith('Evidence-only draft:'))));
}

/** A flag describes only the two-sided range printed on this particular report. */
export function classifyObservation(observation = {}) {
  const { value, referenceLow: low, referenceHigh: high } = observation;
  if (![value, low, high].every(item => typeof item === 'number' && Number.isFinite(item)) || low > high) return 'unknown';
  // Equal bounds are a degenerate range, not a comparison: "within 6.1–6.1" would misstate the report.
  if (low === high) return 'unknown';
  return value < low ? 'low' : value > high ? 'high' : 'normal';
}

export function explainObservation(observation = {}) {
  const name = safeText(observation.name, 120) || 'Result';
  const value = finiteNumber(observation.value);
  const unit = safeText(observation.unit, 40);
  const education = TEST_EDUCATION[comparable(name)];
  const explain = message => ({ en: `${education ? `${education.en} ` : ''}${message.en}`, hi: `${education ? `${education.hi} ` : ''}${message.hi}` });
  if (value === null) return explain({ en: `${name}: a readable numeric value is not available. Check the source document.`, hi: `${name}: पढ़ने योग्य संख्यात्मक मान उपलब्ध नहीं है। मूल दस्तावेज़ देखें।` });
  const display = `${value}${unit ? ` ${unit}` : ''}`;
  const status = classifyObservation(observation);
  if (status === 'unknown') return explain({ en: `${name} is reported as ${display}. A complete, usable reference range is not available; no range comparison was made.`, hi: `${name} का दर्ज मान ${display} है। पूरी और उपयोग योग्य संदर्भ सीमा उपलब्ध नहीं है; सीमा से तुलना नहीं की गई।` });
  const range = `${observation.referenceLow}–${observation.referenceHigh}${unit ? ` ${unit}` : ''}`;
  const position = status === 'normal' ? 'within' : status === 'high' ? 'above' : 'below';
  const hindi = status === 'normal' ? 'के भीतर' : status === 'high' ? 'से ऊपर' : 'से नीचे';
  return explain({
    en: `${name} is ${display}, ${position} this report's reference range (${range}). A result alone does not establish a diagnosis.${status !== 'normal' ? ' Discuss what this means for you with your clinician.' : ''}`,
    hi: `${name} का मान ${display} है, जो इस रिपोर्ट की संदर्भ सीमा (${range}) ${hindi} है। केवल एक परिणाम से निदान नहीं होता।${status !== 'normal' ? ' आपके लिए इसका क्या अर्थ है, यह अपने चिकित्सक से समझें।' : ''}`,
  });
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
  const date = sourceDate(raw.date, sourceText);
  if (!date) warn('Document date is missing, ambiguous, or unsupported by the source; it has not been inferred from the upload date.');
  const candidateProvider = safeText(raw.provider, 200);
  const provider = candidateProvider && includesPhrase(sourceText, candidateProvider) && !UNCLEAR.test(candidateProvider) ? candidateProvider : 'Provider not recorded';
  if (candidateProvider && provider !== candidateProvider) warn('An unsupported provider name was left blank for review.');
  const bounded = (value, max, label) => {
    if (!Array.isArray(value)) return [];
    if (value.length > max) warn(`${label} exceeded the extraction limit and was truncated.`);
    return value.slice(0, max).filter(isObject);
  };
  const observations = bounded(raw.observations, 100, 'Observations').map((item, index) => {
    const name = safeText(item.name, 120) || `Unidentified result ${index + 1}`;
    const source = clean(item.sourceText, 1500);
    const supported = includesEvidence(sourceText, source) && includesPhrase(source, name) && !UNCLEAR.test(name) && !INSTRUCTION_TEXT.test(source);
    if (!supported) warn('One or more observation snippets could not be verified against the source text.');
    const numeric = (value, label) => {
      const result = finiteNumber(value);
      if (result === null) return null;
      if (supported && resultEvidence(source, name)?.value === result) return result;
      warn(`An unsupported ${label} was left blank for review.`);
      return null;
    };
    const result = numeric(item.value, 'observation value');
    // The report's OWN printed range is the authority for the range. If the snippet prints one, we
    // derive the limits from it and disregard the model's claim entirely — otherwise a forged limit
    // (e.g. the result value itself) could relabel a genuinely high result as "within range".
    const printed = supported ? printedRange(source, name, safeText(item.unit, 40)) : null;
    let referenceLow;
    let referenceHigh;
    if (printed) {
      [referenceLow, referenceHigh] = printed;
      if (finiteNumber(item.referenceLow) !== referenceLow || finiteNumber(item.referenceHigh) !== referenceHigh) {
        warn('A model-supplied reference range disagreed with the range printed in the document; the document range was used.');
      }
    } else {
      referenceLow = null; referenceHigh = null;
      if (item.referenceLow != null || item.referenceHigh != null) warn('Reference limits without an identifiable source range were left blank for review.');
    }
    if (referenceLow !== null && referenceHigh !== null && referenceLow >= referenceHigh) {
      referenceLow = null; referenceHigh = null;
      warn('An inverted or degenerate reference range was left blank for review.');
    }
    const candidateUnit = safeText(item.unit, 40);
    const unit = supported && matchesPrintedUnit(source, candidateUnit, name) ? candidateUnit : '';
    if (candidateUnit && !unit) warn('An unsupported observation unit was left blank for review.');
    const observation = {
      id: randomUUID(), name, value: result, unit,
      referenceLow, referenceHigh, sourceText: source, status: 'unknown', explanation: { en: '', hi: '' },
    };
    observation.status = classifyObservation(observation);
    observation.explanation = explainObservation(observation);
    return observation;
  });
  const medications = bounded(raw.medications, 30, 'Medications').flatMap(item => {
    const name = safeText(item.name, 120);
    const source = clean(item.sourceText, 1500);
    const context = sourceContexts(sourceText, name);
    const nameFragment = new RegExp(`${escaped(comparable(name))}\\[|\\]${escaped(comparable(name))}`, 'iu').test(comparable(source));
    if (!name || !includesEvidence(sourceText, source) || !includesPhrase(source, name) || UNCLEAR.test(name) || nameFragment || INSTRUCTION_TEXT.test(source) || context.every(text => /allerg(?:y|ies|ic)|एलर्जी/i.test(text))) {
      warn('A medication without verifiable source evidence was omitted.'); return [];
    }
    const evidence = medicationClauses(source, name);
    const supportedField = field => {
      const text = safeText(item[field], 350);
      if (!text) return '';
      const clauses = evidence.filter(clause => includesPhrase(clause, text));
      const doseClause = evidence.map(clause => clause.replace(/^(?:dose|dosage|strength|खुराक)\s*[:：]?\s*/iu, '')).find(clause => /^[+-.\d\[]/.test(clause));
      const doseMatches = field !== 'dosage' || Boolean(doseClause && !UNCLEAR.test(doseClause) && new RegExp(`^${escaped(comparable(text))}(?![\\p{L}\\p{M}\\d/]|[,.:?]\\s*\\d)`, 'u').test(doseClause));
      if (!UNCLEAR.test(text) && doseMatches && clauses.some(clause => !UNCLEAR.test(clause))) return text;
      warn('An unsupported medication instruction was left blank for review.'); return '';
    };
    return [{ id: randomUUID(), name, dosage: supportedField('dosage'), frequency: supportedField('frequency'), duration: supportedField('duration'), instructions: supportedField('instructions'), sourceText: source }];
  });
  const diagnoses = bounded(raw.diagnoses, 20, 'Diagnoses').flatMap(item => {
    const name = safeText(item.name, 120); const source = clean(item.sourceText, 1500);
    if (!name || !supportedDiagnosis(sourceText, source, name) || INSTRUCTION_TEXT.test(source)) {
      warn('A disease mention without an unambiguous patient diagnosis was omitted; negated, uncertain and family-history mentions stay in the source text.'); return [];
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
  const ocr = normalizeOcr(trustedProvenance.ocr, warn);
  if (ocr) provenance.ocr = ocr;
  return {
    id: clean(metadata.id, 120) || randomUUID(), title: safeText(raw.title, 200) || 'Uploaded health record',
    type: RECORD_TYPES.has(raw.type) ? raw.type : 'lab', date, provider,
    fileName: clean(metadata.fileName, 200) || 'uploaded-document', summary,
    keyPoints: observations.slice(0, 6).map(observation => observation.explanation), observations, medications, diagnoses, sourceText,
    reviewStatus: metadata.reviewStatus === 'reviewed' ? 'reviewed' : 'pending', isDemo: metadata.isDemo === true,
    createdAt: validTimestamp(metadata.createdAt, now), provenance,
  };
}
