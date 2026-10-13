/** The model selects relevance; only these validated bilingual facts reach the answer. */
export function buildFactCatalog(records, language) {
  const facts = [];
  const add = (record, kind, text) => facts.push({ id: `F${facts.length + 1}`, recordId: record.id, title: record.title, date: record.date, kind, text });
  for (const record of records) {
    add(record, 'summary', record.summary[language]);
    for (const observation of record.observations) add(record, 'observation', observation.explanation[language]);
    for (const medication of record.medications) {
      const details = [medication.name, medication.dosage, medication.frequency, medication.duration, medication.instructions].filter(Boolean).join(' · ');
      add(record, 'medication', language === 'hi'
        ? `प्रिस्क्रिप्शन में दर्ज विवरण: ${details}। यह वर्तमान उपयोग की पुष्टि नहीं करता। अस्पष्ट निर्देश डॉक्टर या फार्मासिस्ट से स्पष्ट करें।`
        : `The prescription records: ${details}. This does not confirm current use. Clarify unclear instructions with the prescriber or pharmacist.`);
    }
    for (const diagnosis of record.diagnoses) add(record, 'diagnosis', language === 'hi'
      ? `इस दस्तावेज़ में “${diagnosis.name}” दर्ज है। यह मूल रिकॉर्ड की जानकारी है, नया निदान नहीं।`
      : `This document records “${diagnosis.name}”. This is a transcription of the record, not a new diagnosis.`);
    if (facts.length > 100) break;
  }
  return facts.slice(0, 120);
}

export function renderSelectedFacts(reply, catalog, language) {
  if (!Array.isArray(reply.factIds) || reply.factIds.length > 6 || reply.factIds.some(id => typeof id !== 'string' || !catalog.some(fact => fact.id === id))) throw new Error('Unsupported fact selection');
  if (!reply.factIds.length) {
    if (reply.insufficientEvidence !== true) throw new Error('No evidence selected');
    return { answer: language === 'hi'
      ? 'आपके सहेजे गए रिकॉर्ड में इस प्रश्न का उत्तर देने के लिए पर्याप्त जानकारी नहीं मिली। मैं अनुपलब्ध जानकारी का अनुमान नहीं लगाऊँगा। किसी विशेष रिपोर्ट या परिणाम के बारे में पूछें।'
      : 'I could not find enough information in your saved records to answer that question. I will not infer missing medical details. Try asking about a specific report or result.', citations: [] };
  }
  const selected = [...new Set(reply.factIds)].map(id => catalog.find(fact => fact.id === id));
  const intro = language === 'hi' ? 'आपके रिकॉर्ड से संबंधित जानकारी:\n\n' : 'Relevant information from your records:\n\n';
  const answer = intro + selected.map(fact => `${fact.date || (language === 'hi' ? 'तारीख दर्ज नहीं' : 'Date not recorded')} · ${fact.text}`).join('\n\n');
  const cited = [...new Set(selected.map(fact => fact.recordId))];
  return { answer, citations: cited.map(recordId => ({ recordId, title: selected.find(fact => fact.recordId === recordId).title })) };
}
