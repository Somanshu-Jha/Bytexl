import { randomUUID } from 'node:crypto';
import { classifyObservation, supportedDiagnosis } from './domain.mjs';

const interpretationCodes = { normal: 'N', high: 'H', low: 'L' };
const documentTypes = { lab: 'Laboratory report', prescription: 'Prescription', discharge: 'Discharge summary', diagnostic: 'Diagnostic report' };
const annotation = text => ({ text });

/** FHIR R4-style collection for demonstration. Not validated against an ABDM profile. */
export function buildFhirBundle(patient, records = []) {
  const entry = [];
  const add = resource => {
    const id = randomUUID(); const fullUrl = `urn:uuid:${id}`;
    entry.push({ fullUrl, resource: { resourceType: resource.resourceType, id, ...resource } });
    return { reference: fullUrl };
  };
  const patientResource = {
    resourceType: 'Patient', identifier: [{ system: 'urn:sehat:local-patient-id', value: patient.id }],
    name: [{ text: patient.name }], gender: ['male', 'female', 'other', 'unknown'].includes(patient.gender) ? patient.gender : 'unknown',
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(patient.dateOfBirth)) patientResource.birthDate = patient.dateOfBirth;
  const subject = add(patientResource);
  // Profile allergies are patient-reported, without asserting clinical verification.
  for (const allergy of patient.allergies ?? []) add({
    resourceType: 'AllergyIntolerance', patient: subject, code: { text: allergy },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'unconfirmed' }] },
    note: [annotation('Patient profile entry; not independently clinically verified.')],
  });
  for (const record of records) {
    const doc = {
      resourceType: 'DocumentReference', status: 'current', subject,
      identifier: [{ system: 'urn:sehat:local-record-id', value: record.id }],
      type: { text: documentTypes[record.type] || 'Health record' }, description: record.title,
      content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(record.sourceText ?? '', 'utf8').toString('base64'), title: record.fileName || record.title } }],
    };
    if (record.createdAt) doc.date = record.createdAt;
    if (record.date) doc.context = { period: { start: record.date } };
    const source = add(doc);
    const targets = [source];
    for (const observation of record.observations ?? []) {
      const resource = {
        resourceType: 'Observation', status: 'unknown', subject, code: { text: observation.name },
        derivedFrom: [source], note: [annotation(observation.sourceText || 'Source snippet unavailable.'), annotation('Transcribed result; source review is not clinical verification.')],
      };
      if (record.type === 'lab') resource.category = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }];
      if (record.date) resource.effectiveDateTime = record.date;
      if (typeof observation.value === 'number' && Number.isFinite(observation.value)) {
        resource.valueQuantity = { value: observation.value };
        if (observation.unit) resource.valueQuantity.unit = observation.unit;
      } else resource.dataAbsentReason = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }] };
      const range = {};
      if (typeof observation.referenceLow === 'number' && Number.isFinite(observation.referenceLow)) range.low = { value: observation.referenceLow, ...(observation.unit ? { unit: observation.unit } : {}) };
      if (typeof observation.referenceHigh === 'number' && Number.isFinite(observation.referenceHigh)) range.high = { value: observation.referenceHigh, ...(observation.unit ? { unit: observation.unit } : {}) };
      if (Object.keys(range).length) resource.referenceRange = [{ ...range, text: 'Reference limits transcribed from the source report.' }];
      const status = classifyObservation(observation);
      if (interpretationCodes[status]) resource.interpretation = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: interpretationCodes[status] }], text: `Compared only with this report's range: ${status}` }];
      targets.push(add(resource));
    }
    for (const medication of record.medications ?? []) {
      const resource = {
        resourceType: 'MedicationStatement', status: 'unknown', subject, medicationCodeableConcept: { text: medication.name },
        derivedFrom: [source], note: [annotation(medication.sourceText || 'Source snippet unavailable.'), annotation('Source-prescribed medication; current use and adherence are unknown.')],
      };
      const instructions = [medication.dosage, medication.frequency, medication.duration, medication.instructions].filter(Boolean).join('; ');
      if (instructions) resource.dosage = [{ text: instructions }];
      targets.push(add(resource));
    }
    // Conditions are created only from explicitly recorded diagnoses, never lab flags.
    for (const diagnosis of (record.diagnoses ?? []).filter(item => supportedDiagnosis(record.sourceText, item.sourceText, item.name))) targets.push(add({
      resourceType: 'Condition', subject, code: { text: diagnosis.name },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'unconfirmed' }] },
      evidence: [{ detail: [source] }], note: [annotation(diagnosis.sourceText), annotation('Diagnosis transcribed from the source; not independently clinically verified.')],
    }));
    add({
      resourceType: 'Provenance', target: targets, recorded: record.provenance?.processedAt || record.createdAt || new Date().toISOString(),
      activity: { text: `Health record transcription; ${record.isDemo ? 'synthetic demo' : record.provenance?.mode || 'local'}; ${record.reviewStatus || 'pending'} source review` },
      agent: [{ who: { display: `Sehat prototype · ${record.provenance?.extractionModel || 'unspecified model'}` } }],
      entity: [{ role: 'source', what: source }],
    });
  }
  return {
    resourceType: 'Bundle', id: randomUUID(), type: 'collection', timestamp: new Date().toISOString(),
    meta: { tag: [{ system: 'urn:sehat:export-status', code: 'unvalidated-prototype', display: 'FHIR R4-style prototype; not validated or certified for ABDM exchange' }] },
    entry,
  };
}
