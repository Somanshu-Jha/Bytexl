import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoPatient, demoRecords } from '../shared/demo.mjs';
import { createStore } from './store.mjs';
import { createNimClient } from './nim.mjs';
import { processDocument, validateFile, MAX_FILE_SIZE, DocumentError } from './pipeline.mjs';
import { classifyObservation, explainObservation, requiresOcrAcknowledgment } from './domain.mjs';
import { buildFhirBundle } from './fhir.mjs';
import { buildFactCatalog, renderSelectedFacts } from './chat.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const clean = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '';
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const localHostname = value => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(value);

/**
 * The Vite dev proxy that the documented `npm run dev` workflow uses. It rewrites Host but forwards
 * the browser's original Origin, so the app's own requests would otherwise look cross-site to the
 * full-origin check. Both are loopback-only, and this list never widens beyond loopback hosts.
 * Override with SEHAT_DEV_ORIGINS (comma separated) when running the interface on another port.
 */
function defaultDevOrigins() {
  const configured = String(process.env.SEHAT_DEV_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (configured.length) return configured.filter(value => { try { return localHostname(new URL(value).hostname); } catch { return false; } });
  return ['http://127.0.0.1:5173', 'http://localhost:5173'];
}

function correction(record, body) {
  if (!isObject(body)) throw new DocumentError('Provide an object containing record corrections.');
  if ('acknowledgeOcrWarnings' in body && typeof body.acknowledgeOcrWarnings !== 'boolean') throw new DocumentError('OCR warning acknowledgment must be true or false.');
  const result = structuredClone(record);
  let fieldsCorrected = false;
  for (const field of ['title', 'provider']) if (field in body) {
    if (typeof body[field] !== 'string') throw new DocumentError(`${field} must be text.`);
    const value = clean(body[field]);
    if (field === 'title' && !value) throw new DocumentError('title cannot be empty.');
    result[field] = value;
    if (value !== record[field]) fieldsCorrected = true;
  }
  if ('date' in body) {
    if (body.date !== null && !validDate(body.date)) throw new DocumentError('Use a valid document date in YYYY-MM-DD format, or leave it blank.');
    result.date = body.date;
    if (body.date !== record.date) fieldsCorrected = true;
  }
  if ('reviewStatus' in body) {
    if (!['pending', 'reviewed'].includes(body.reviewStatus)) throw new DocumentError('Invalid review status.');
    result.reviewStatus = body.reviewStatus;
  }
  for (const key of ['observations', 'medications']) if (key in body) {
    if (!Array.isArray(body[key]) || body[key].length > 100) throw new DocumentError(`Invalid ${key} corrections.`);
    for (const update of body[key]) {
      if (!isObject(update)) throw new DocumentError('Each corrected field must be an object with its existing ID.');
      const current = result[key].find(item => item.id === update?.id);
      if (!current) throw new DocumentError('A corrected field does not belong to this record.');
      const strings = key === 'observations' ? ['name', 'unit'] : ['name', 'dosage', 'frequency', 'duration', 'instructions'];
      for (const field of strings) if (field in update) {
        if (typeof update[field] !== 'string') throw new DocumentError('Medicine and observation text fields must be strings.');
        const text = clean(update[field], field === 'instructions' ? 350 : 120);
        if (field === 'name' && !text) throw new DocumentError('A medicine or observation name cannot be empty.');
        current[field] = text;
      }
      if (key === 'observations') {
        for (const field of ['value', 'referenceLow', 'referenceHigh']) if (field in update) {
          if (update[field] !== null && (typeof update[field] !== 'number' || !Number.isFinite(update[field]) || Math.abs(update[field]) > 1e12)) throw new DocumentError('Test values and reference limits must be finite numbers or blank.');
          current[field] = update[field];
        }
        if (current.referenceLow !== null && current.referenceHigh !== null && current.referenceLow > current.referenceHigh) throw new DocumentError('The lower reference limit cannot exceed the upper limit.');
        current.status = classifyObservation(current);
        current.explanation = explainObservation(current);
      }
      fieldsCorrected = true;
    }
  }
  if (fieldsCorrected) {
    if (!('reviewStatus' in body)) result.reviewStatus = 'pending';
    delete result.provenance.ocrWarningsAcknowledgedAt;
    const warning = 'A reviewer corrected extracted fields. Check these corrections against the original document; the original OCR text is retained.';
    result.provenance.warnings = [...new Set([...result.provenance.warnings, warning])];
    if (result.observations.length) {
      const count = result.observations.length;
      const outside = result.observations.filter(o => ['high', 'low'].includes(o.status)).length;
      result.summary = {
        en: `${count} reported results reviewed. ${outside} are outside the entered reference ranges. Verify corrections against the source and discuss questions with your clinician; these results do not establish a diagnosis.`,
        hi: `${count} दर्ज परिणामों की समीक्षा की गई। ${outside} परिणाम दर्ज संदर्भ सीमाओं से बाहर हैं। संशोधन मूल दस्तावेज़ से जाँचें और चिकित्सक से चर्चा करें; इन परिणामों से निदान नहीं होता।`,
      };
      result.keyPoints = result.observations.slice(0, 6).map(o => o.explanation);
    } else if (result.medications.length) {
      result.summary = {
        en: `${result.medications.length} medication entries were corrected from the source prescription. Confirm unclear instructions with the prescriber; current use is not confirmed.`,
        hi: `मूल प्रिस्क्रिप्शन की ${result.medications.length} दवाओं के विवरण में सुधार किया गया है। अस्पष्ट निर्देश चिकित्सक से स्पष्ट करें; वर्तमान उपयोग की पुष्टि नहीं है।`,
      };
      result.keyPoints = [];
    }
  }
  if (result.reviewStatus === 'pending') delete result.provenance.ocrWarningsAcknowledgedAt;
  if (result.reviewStatus === 'reviewed' && requiresOcrAcknowledgment(result)) {
    if (body.acknowledgeOcrWarnings !== true) throw new DocumentError('Acknowledge the unresolved OCR warnings after checking the original document before marking this record reviewed.');
    result.provenance.ocrWarningsAcknowledgedAt = new Date().toISOString();
  }
  return result;
}

export function safetyResponse(message, language) {
  const urgent = /chest\s*pain|can(?:not|'t)\s*breathe|difficulty\s*breathing|severe\s*(?:bleeding|breathlessness)|stroke|overdose|suicid|kill\s*myself|सीने\s*में\s*दर्द|छाती\s*में\s*दर्द|सांस\s*(?:नहीं|लेने\s*में)|साँस\s*(?:नहीं|लेने\s*में)|आत्महत्या|ज़हर|जहर/i;
  if (urgent.test(message)) return language === 'hi'
    ? 'ये लक्षण आपात स्थिति के संकेत हो सकते हैं। अभी स्थानीय आपातकालीन सेवा (भारत में 112) से संपर्क करें या निकटतम आपात विभाग जाएँ। चैट के उत्तर की प्रतीक्षा न करें। मैं आपात स्थिति का आकलन नहीं कर सकता।'
    : 'These symptoms may be an emergency. Contact local emergency services now (112 in India) or seek the nearest emergency department. Do not wait for a chat reply. I cannot assess an emergency.';
  const change = /(?:double|increase|decrease|reduce|stop|start|skip|change|adjust|switch|halve)\b.{0,60}\b(?:dose|dosage|medication|medicine|metformin|insulin|tablet|drug|taking)|(?:can|should|may)\s+i\s+(?:take|stop|start|use|double|increase|reduce)|what\s+(?:dose|dosage|medicine|drug)\s+should|prescribe|खुराक|दोगुन|दवा.{0,25}(?:बंद|बदल|लूँ|लेना|शुरू)|कौन\s*सी\s*दवा/i;
  if (change.test(message)) return language === 'hi'
    ? 'मैं दवा शुरू करने, बंद करने या खुराक बदलने की सलाह नहीं दे सकता। प्रिस्क्रिप्शन के निर्देश और अपने डॉक्टर या फार्मासिस्ट से इसकी पुष्टि करें। मैं आपके सहेजे गए रिकॉर्ड में लिखी दवाएँ और निर्देश दिखा सकता हूँ।'
    : 'I cannot recommend starting, stopping, or changing a medicine or dose. Confirm the prescription instructions with your prescriber or pharmacist. I can help you find the medicines and instructions written in your saved records.';
  if (/do\s+i\s+have\b|diagnose\s+me|what\s+(?:disease|illness)\s+(?:do\s+i\s+have|is\s+this)|am\s+i\s+(?:diabet|sick)|क्या\s*मुझे.{0,35}(?:है|हुआ)|कौन\s*सी\s*बीमारी/i.test(message)) return language === 'hi'
    ? 'केवल रिकॉर्ड या एक जाँच परिणाम से मैं निदान नहीं कर सकता। चिकित्सक आपके लक्षण, इतिहास और अन्य जानकारी के साथ परिणामों का मूल्यांकन कर सकते हैं। मैं रिकॉर्ड में दर्ज परिणाम और संदर्भ सीमाएँ समझा सकता हूँ।'
    : 'I cannot diagnose a condition from a record or a test result alone. A clinician can interpret the findings alongside your symptoms and history. I can explain the recorded values and the reference ranges printed on your report.';
  return null;
}

function localAnswer(records, language, unavailable = false) {
  const selected = records.slice(0, 3);
  if (!selected.length) return { answer: language === 'hi' ? 'इस प्रश्न के लिए कोई सहेजा गया रिकॉर्ड उपलब्ध नहीं है। पहले दस्तावेज़ अपलोड करें।' : 'There are no saved records available for this question. Upload a document first.', citations: [], mode: 'local', model: 'record-summary-fallback' };
  const intro = language === 'hi'
    ? (unavailable ? 'लाइव AI अभी उपलब्ध नहीं है। सहेजे गए रिकॉर्ड का स्थानीय सारांश:\n\n' : 'सहेजे गए रिकॉर्ड का स्थानीय सारांश:\n\n')
    : (unavailable ? 'Live AI is unavailable right now. Here is a local summary of your saved records:\n\n' : 'Here is a local summary of your saved records:\n\n');
  const text = selected.map(record => {
    const observations = record.observations.filter(o => o.status === 'high' || o.status === 'low').slice(0, 2);
    return `${record.title}${record.date ? ` (${record.date})` : ''}: ${observations.length ? observations.map(o => o.explanation[language]).join(' ') : record.summary[language]}`;
  }).join('\n\n');
  return { answer: intro + text, citations: selected.map(r => ({ recordId: r.id, title: r.title })), mode: 'local', model: 'record-summary-fallback' };
}

export function createApp({ databasePath = resolve(process.env.DATA_DIR || resolve(root, 'data'), 'sehat.sqlite'), nim = createNimClient(), seed = true, devOrigins = defaultDevOrigins() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const store = createStore(databasePath, { patient: demoPatient, records: seed ? demoRecords : [] });
  const bootstrap = () => ({ patient: store.getPatient(), records: store.listRecords(), ai: { configured: nim.configured, models: nim.models } });
  let runningJobs = 0;
  let runningChats = 0;
  const isCloud = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.SEHAT_ALLOW_REMOTE === 'true');
  if (isCloud) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    if (!isCloud && !localHostname(req.hostname)) return res.status(403).json({ error: 'This local prototype accepts only localhost requests.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      // Compare the FULL origin (scheme + host + port), not just the hostname: matching only the
      // hostname would treat http://localhost:<any-port> — another local dev server, or any page
      // served from a local port — as same-origin and let it mutate records with a simple request
      // that needs no preflight. Requests without an Origin header (curl, the documented reset
      // command) are unaffected, since only browsers send Origin.
      //
      // In the documented dev workflow the browser talks to Vite (5173), which proxies to this
      // server (3001) and rewrites Host while forwarding the original Origin. So the accepted set
      // is this server's own address plus the dev proxy, which is loopback-only by construction.
      const own = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`]);
      const forwarded = String(req.headers['x-forwarded-host'] || '').trim();
      if (forwarded) { own.add(`http://${forwarded}`); own.add(`https://${forwarded}`); }
      if (process.env.RENDER_EXTERNAL_URL) own.add(process.env.RENDER_EXTERNAL_URL);
      for (const candidate of devOrigins) own.add(candidate);
      try {
        const origin = new URL(req.headers.origin);
        if (!isCloud && !localHostname(origin.hostname)) throw new Error();
        if (!['http:', 'https:'].includes(origin.protocol) || !own.has(origin.origin)) throw new Error();
      } catch { return res.status(403).json({ error: 'Cross-site requests are not allowed.' }); }
    }
    next();
  });
  app.use(express.json({ limit: '200kb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 4, parts: 6, fieldSize: 200 } });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Sehat local API', ai: { configured: nim.configured, models: nim.models } }));
  app.get('/api/bootstrap', (_req, res) => res.json(bootstrap()));
  app.get('/api/records/:id', (req, res) => {
    const record = store.getRecord(req.params.id);
    return record ? res.json(record) : res.status(404).json({ error: 'Record not found.' });
  });
  app.post('/api/records', upload.single('file'), (req, res) => {
    if (req.body?.consent !== 'true') throw new DocumentError('Consent is required before processing a medical document with NVIDIA AI.');
    if (req.body?.handwriting !== undefined && !['true', 'false'].includes(req.body.handwriting)) throw new DocumentError('The handwriting option must be true or false.');
    validateFile(req.file);
    if (runningJobs >= 2) return res.status(429).json({ error: 'Two documents are already processing. Wait for one to finish before uploading another.' });
    if (store.listRecords().length >= 250) return res.status(409).json({ error: 'The local prototype supports 250 records. Delete an unneeded record before uploading.' });
    let job = store.saveJob({ id: randomUUID(), status: 'queued', stage: 'Queued for processing' });
    runningJobs++;
    res.status(202).json(job);
    const file = req.file;
    setImmediate(async () => {
      const update = changes => { job = store.saveJob({ ...job, ...changes }); };
      try {
        update({ status: 'processing', stage: 'Reading document' });
        const record = await processDocument(file, nim, stage => update({ stage }), { handwriting: req.body?.handwriting === 'true' });
        store.saveRecord(record);
        update({ status: 'completed', stage: 'Saved to timeline', recordId: record.id });
      } catch (error) {
        update({ status: 'failed', stage: 'Processing stopped', error: error instanceof DocumentError || error.name === 'ProviderError' ? error.message : 'The document could not be processed. Try a clearer or smaller document.' });
      } finally { file.buffer = null; runningJobs--; }
    });
  });
  app.get('/api/jobs/:id', (req, res) => {
    const job = store.getJob(req.params.id);
    return job ? res.json(job) : res.status(404).json({ error: 'Upload job not found.' });
  });
  app.patch('/api/records/:id', (req, res) => {
    const record = store.getRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    res.json(store.saveRecord(correction(record, req.body)));
  });
  app.delete('/api/records/:id', (req, res) => {
    if (!store.deleteRecord(req.params.id)) return res.status(404).json({ error: 'Record not found.' });
    res.status(204).end();
  });
  app.patch('/api/patient', (req, res) => {
    if (!isObject(req.body)) throw new DocumentError('Provide valid profile fields.');
    const body = req.body;
    const patient = structuredClone(store.getPatient());
    for (const field of ['name', 'gender', 'bloodGroup']) if (field in body) {
      const value = clean(body[field], 100);
      if (field === 'name' && !value) throw new DocumentError('Your name cannot be empty.');
      patient[field] = value;
    }
    if ('dateOfBirth' in body) {
      if (!validDate(body.dateOfBirth)) throw new DocumentError('Use a valid birth date in YYYY-MM-DD format.');
      patient.dateOfBirth = body.dateOfBirth;
    }
    if ('allergies' in body) {
      if (!Array.isArray(body.allergies) || body.allergies.length > 20) throw new DocumentError('Provide an allergy list with at most 20 entries.');
      patient.allergies = body.allergies.map(value => clean(value, 100)).filter(Boolean);
    }
    if ('abhaId' in body) {
      if (body.abhaId === null || body.abhaId === '') { patient.abhaId = null; patient.abhaLinked = false; }
      else {
        const digits = typeof body.abhaId === 'string' ? body.abhaId.replace(/[- ]/g, '') : '';
        if (!/^\d{14}$/.test(digits)) throw new DocumentError('Enter a 14-digit mock ABHA number. No real ABHA verification is performed.');
        patient.abhaId = `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`;
      }
    }
    if ('abhaLinked' in body) {
      if (typeof body.abhaLinked !== 'boolean' || (body.abhaLinked && !patient.abhaId)) throw new DocumentError('A mock ABHA number is required before linking.');
      patient.abhaLinked = body.abhaLinked;
    }
    res.json(store.savePatient(patient));
  });
  app.post('/api/chat', async (req, res) => {
    const message = clean(req.body?.message, 2000);
    if (!message) throw new DocumentError('Enter a question about your records.');
    const language = req.body?.language === 'hi' ? 'hi' : 'en';
    const safety = safetyResponse(message, language);
    if (safety) return res.json({ answer: safety, citations: [], mode: 'local', model: 'safety-guardrail' });
    if (runningChats >= 2) return res.status(429).json({ error: 'Please wait for the current answers before sending another question.' });
    const allRecords = store.listRecords();
    const ids = req.body?.recordIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string'))) throw new DocumentError('Invalid record selection.');
    const records = (ids ? allRecords.filter(record => ids.includes(record.id)) : allRecords).slice(0, 10);
    if (!nim.configured || !records.length) return res.json(localAnswer(records, language));
    runningChats++;
    try {
      const evidence = buildFactCatalog(records, language);
      const reply = await nim.chat(message, language, evidence);
      const grounded = renderSelectedFacts(reply, evidence, language);
      res.json({ ...grounded, mode: 'live', model: reply.model || (language === 'hi' ? nim.models.extraction : nim.models.chat) });
    } catch { res.json(localAnswer(records, language, true)); }
    finally { runningChats--; }
  });
  app.get('/api/export/fhir', (_req, res) => {
    res.set({ 'Content-Type': 'application/fhir+json; charset=utf-8', 'Content-Disposition': 'attachment; filename="sehat-fhir-bundle.json"' });
    res.json(buildFhirBundle(store.getPatient(), store.listRecords()));
  });
  app.post('/api/demo/reset', (_req, res) => {
    if (runningJobs) return res.status(409).json({ error: 'Wait for document processing to finish before resetting demo data.' });
    store.reset(); res.json(bootstrap());
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  const dist = resolve(root, 'dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist, { dotfiles: 'deny' }));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The document is larger than 12 MB. Upload a smaller file.' : 'Upload one document at a time using the file field.' });
    if (error instanceof DocumentError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
    res.status(500).json({ error: 'The local service could not complete this request.' });
  });
  return { app, store };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, store } = createApp();
  const port = Number(process.env.PORT) || 3001;
  const isCloud = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.SEHAT_ALLOW_REMOTE === 'true');
  const host = process.env.HOST || (isCloud ? '0.0.0.0' : '127.0.0.1');
  if (!isCloud && !localHostname(host)) throw new Error('This single-user prototype must bind to a loopback address.');
  const server = app.listen(port, host, () => console.log(`Sehat API is ready at http://${host}:${port}`));
  const shutdown = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
