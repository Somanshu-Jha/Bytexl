// Every person, provider, result and prescription in this module is synthetic.
// Fixtures are hand-authored examples, not an AI accuracy or clinical validation claim.
export const demoPatient = {
  id: 'demo-patient-aarav', name: 'Aarav Sharma', dateOfBirth: '1992-08-15', gender: 'male',
  bloodGroup: 'O+', allergies: ['Penicillin'], abhaId: null, abhaLinked: false,
};

function observation(id, name, value, unit, referenceLow, referenceHigh, status, sourceText) {
  const number = `${value} ${unit}`;
  const direction = status === 'high' ? 'above' : status === 'low' ? 'below' : 'within';
  const directionHi = status === 'high' ? 'से ऊपर' : status === 'low' ? 'से नीचे' : 'के भीतर';
  return {
    id, name, value, unit, referenceLow, referenceHigh, status, sourceText,
    explanation: status === 'unknown' ? {
      en: `${name}: ${number}. This document does not give a reference range; no comparison is made.`,
      hi: `${name}: ${number}। दस्तावेज़ में संदर्भ सीमा नहीं दी गई है; तुलना नहीं की गई।`,
    } : {
      en: `${name}: ${number}, ${direction} this report's reference range (${referenceLow}–${referenceHigh} ${unit}). This result alone does not establish a diagnosis.`,
      hi: `${name}: ${number}, इस रिपोर्ट की संदर्भ सीमा (${referenceLow}–${referenceHigh} ${unit}) ${directionHi} है। केवल इस परिणाम से निदान नहीं होता।`,
    },
  };
}

const sourceLatest = `SYNTHETIC DEMO — NOT A REAL PATIENT REPORT
GREENFIELD DIAGNOSTICS (FICTIONAL)
Patient: Aarav Sharma | Date of birth: 1992-08-15 | Sex: Male
Report date: 2026-10-10
Test: Preventive health blood panel
HbA1c: 6.1 %; reference range: 4.0 - 5.6 %
Fasting glucose: 112 mg/dL; reference range: 70 - 99 mg/dL
Hemoglobin: 14.2 g/dL; reference range: 13.0 - 17.0 g/dL
Vitamin D: 24 ng/mL; reference range: 30 - 100 ng/mL
Laboratory note: Interpret results with clinical history. A laboratory result alone does not establish a diagnosis.
This fictional sample is provided only to demonstrate document extraction.`;

function base(id, title, type, date, provider, fileName, reviewStatus = 'reviewed') {
  return {
    id, title, type, date, provider, fileName,
    summary: { en: '', hi: '' }, keyPoints: [], observations: [], medications: [], diagnoses: [], sourceText: '',
    reviewStatus, isDemo: true, createdAt: `${date}T09:30:00.000Z`,
    provenance: { mode: 'demo', extractionModel: 'Hand-authored synthetic fixture', processedAt: `${date}T09:30:00.000Z`, warnings: ['Synthetic demonstration data. No real patient or clinical validation.'] },
  };
}

const latest = {
  ...base('demo-lab-oct', 'Preventive health panel', 'lab', '2026-10-10', 'Greenfield Diagnostics', 'aarav-blood-panel-oct-2026.pdf', 'pending'),
  sourceText: sourceLatest,
  summary: {
    en: 'Four results, one clearer picture. HbA1c and fasting glucose are above this report’s ranges; vitamin D is below its range. Hemoglobin is within range. These flags are a starting point for a conversation with your clinician, not a diagnosis.',
    hi: 'चार परिणामों का सार: HbA1c और फास्टिंग ग्लूकोज़ इस रिपोर्ट की सीमाओं से ऊपर हैं; विटामिन D अपनी सीमा से नीचे है। हीमोग्लोबिन सीमा के भीतर है। इन परिणामों पर चिकित्सक से चर्चा करें; ये निदान नहीं हैं।',
  },
  keyPoints: [
    { en: 'HbA1c 6.1% · above the report range of 4.0–5.6%.', hi: 'HbA1c 6.1% · रिपोर्ट की 4.0–5.6% सीमा से ऊपर।' },
    { en: 'Fasting glucose 112 mg/dL · above the report range of 70–99.', hi: 'फास्टिंग ग्लूकोज़ 112 mg/dL · रिपोर्ट की 70–99 सीमा से ऊपर।' },
    { en: 'Vitamin D 24 ng/mL · below the report range of 30–100.', hi: 'विटामिन D 24 ng/mL · रिपोर्ट की 30–100 सीमा से नीचे।' },
  ],
  observations: [
    observation('demo-oct-hba1c', 'HbA1c', 6.1, '%', 4, 5.6, 'high', 'HbA1c: 6.1 %; reference range: 4.0 - 5.6 %'),
    observation('demo-oct-glucose', 'Fasting glucose', 112, 'mg/dL', 70, 99, 'high', 'Fasting glucose: 112 mg/dL; reference range: 70 - 99 mg/dL'),
    observation('demo-oct-hb', 'Hemoglobin', 14.2, 'g/dL', 13, 17, 'normal', 'Hemoglobin: 14.2 g/dL; reference range: 13.0 - 17.0 g/dL'),
    observation('demo-oct-vitd', 'Vitamin D', 24, 'ng/mL', 30, 100, 'low', 'Vitamin D: 24 ng/mL; reference range: 30 - 100 ng/mL'),
  ],
};

const prescription = {
  ...base('demo-rx-oct', 'Clinic prescription', 'prescription', '2026-10-10', 'Dr. Nisha Rao · Greenfield Clinic', 'aarav-prescription-oct-2026.pdf'),
  sourceText: `SYNTHETIC DEMO — NOT A REAL PRESCRIPTION
GREENFIELD CLINIC (FICTIONAL) | Dr. Nisha Rao (fictional)
Patient: Aarav Sharma | Prescription date: 2026-10-10
Recorded allergy: Penicillin
Cholecalciferol (Vitamin D3): 1000 IU; once daily; for 8 weeks; Take after lunch.
Cetirizine: 10 mg; once at night as needed for sneezing; for 5 days; May cause drowsiness.
Follow-up: Review the laboratory report with the prescribing clinician.
Only demonstrate transcription of the written prescription; current use is not confirmed.`,
  summary: {
    en: 'The source prescription lists Vitamin D3 and a short, as-needed course of cetirizine. Instructions below are transcribed from the document. Confirm questions with the prescriber; current use is unknown.',
    hi: 'मूल प्रिस्क्रिप्शन में Vitamin D3 और आवश्यकता अनुसार थोड़े समय के लिए cetirizine दर्ज हैं। नीचे के निर्देश दस्तावेज़ से लिए गए हैं। प्रश्न चिकित्सक से स्पष्ट करें; वर्तमान उपयोग ज्ञात नहीं है।',
  },
  keyPoints: [
    { en: 'Recorded penicillin allergy appears on the prescription.', hi: 'प्रिस्क्रिप्शन पर पेनिसिलिन एलर्जी दर्ज है।' },
    { en: 'Medication instructions are source-prescribed, with no new dosage advice.', hi: 'दवा के निर्देश मूल प्रिस्क्रिप्शन के हैं; खुराक की नई सलाह नहीं दी गई है।' },
  ],
  medications: [
    { id: 'demo-med-vitd', name: 'Cholecalciferol (Vitamin D3)', dosage: '1000 IU', frequency: 'once daily', duration: '8 weeks', instructions: 'Take after lunch.', sourceText: 'Cholecalciferol (Vitamin D3): 1000 IU; once daily; for 8 weeks; Take after lunch.' },
    { id: 'demo-med-cetirizine', name: 'Cetirizine', dosage: '10 mg', frequency: 'once at night as needed for sneezing', duration: '5 days', instructions: 'May cause drowsiness.', sourceText: 'Cetirizine: 10 mg; once at night as needed for sneezing; for 5 days; May cause drowsiness.' },
  ],
};

const diagnostic = {
  ...base('demo-scan-aug', 'Abdominal ultrasound', 'diagnostic', '2026-08-21', 'Greenfield Imaging Centre', 'aarav-ultrasound-aug-2026.pdf'),
  sourceText: `SYNTHETIC DEMO — NOT A REAL IMAGING REPORT
GREENFIELD IMAGING CENTRE (FICTIONAL)
Patient: Aarav Sharma | Report date: 2026-08-21
Study: Abdominal ultrasound
Findings: No focal liver lesion identified. No gallstones seen.
Right kidney length: 10.8 cm. No reference interval supplied.
Impression: No acute sonographic abnormality identified in this study.
Reporting note: Correlate with symptoms and the referring clinician's assessment.`,
  summary: {
    en: 'The radiology report states “No acute sonographic abnormality identified in this study.” A right kidney measurement is recorded without a reference range. Review symptoms and next steps with the referring clinician.',
    hi: 'रेडियोलॉजी रिपोर्ट में लिखा है: “इस जाँच में कोई तीव्र सोनोग्राफिक असामान्यता नहीं मिली।” दाईं किडनी का माप बिना संदर्भ सीमा के दर्ज है। लक्षणों और आगे के कदमों पर चिकित्सक से चर्चा करें।',
  },
  keyPoints: [{ en: 'Imaging findings are quoted from the source report.', hi: 'इमेजिंग के निष्कर्ष मूल रिपोर्ट से लिए गए हैं।' }],
  observations: [observation('demo-scan-kidney', 'Right kidney length', 10.8, 'cm', null, null, 'unknown', 'Right kidney length: 10.8 cm. No reference interval supplied.')],
};

function priorPanel({ id, date, month, hba1c, glucose, hemoglobin, vitaminD }) {
  const rows = [
    ['HbA1c', hba1c, '%', 4, 5.6, 'high'], ['Fasting glucose', glucose, 'mg/dL', 70, 99, 'high'],
    ['Hemoglobin', hemoglobin, 'g/dL', 13, 17, 'normal'], ['Vitamin D', vitaminD, 'ng/mL', 30, 100, 'low'],
  ];
  const observations = rows.map(([name, value, unit, low, high, status], index) => observation(`${id}-obs-${index}`, name, value, unit, low, high, status, `${name}: ${value} ${unit}; reference range: ${low} - ${high} ${unit}`));
  return {
    ...base(id, `${month} blood panel`, 'lab', date, 'Greenfield Diagnostics', `aarav-blood-panel-${month.toLowerCase()}-2026.pdf`),
    sourceText: `SYNTHETIC DEMO — NOT A REAL PATIENT REPORT\nGREENFIELD DIAGNOSTICS (FICTIONAL)\nPatient: Aarav Sharma | Report date: ${date}\n${observations.map(obs => obs.sourceText).join('\n')}\nInterpret results with clinical history. A result alone does not establish a diagnosis.`,
    summary: {
      en: `An earlier panel for your timeline: HbA1c ${hba1c}% and fasting glucose ${glucose} mg/dL are above this report's ranges; vitamin D ${vitaminD} ng/mL is below its range. These are reported values, without an inferred diagnosis.`,
      hi: `समयरेखा की पिछली रिपोर्ट: HbA1c ${hba1c}% और फास्टिंग ग्लूकोज़ ${glucose} mg/dL इस रिपोर्ट की सीमाओं से ऊपर हैं; विटामिन D ${vitaminD} ng/mL अपनी सीमा से नीचे है। ये दर्ज मान हैं; कोई निदान अनुमानित नहीं है।`,
    },
    keyPoints: [observations[0].explanation, observations[3].explanation], observations,
  };
}

const discharge = {
  ...base('demo-discharge-may', 'Day-care discharge summary', 'discharge', '2026-05-17', 'Greenfield Community Hospital', 'aarav-discharge-may-2026.pdf'),
  sourceText: `SYNTHETIC DEMO — NOT A REAL DISCHARGE SUMMARY
GREENFIELD COMMUNITY HOSPITAL (FICTIONAL)
Patient: Aarav Sharma | Admission: 2026-05-16 | Discharge: 2026-05-17
Diagnosis recorded by the treating clinician: Acute gastroenteritis.
Discharge note: Tolerating oral fluids at discharge. Follow-up with the clinic if symptoms persist.
Oral rehydration salts: 1 sachet in 1 litre water; small frequent sips; for 2 days; Prepare fresh daily.
The above medicine is a historical prescription. Current use is not confirmed.`,
  summary: {
    en: 'A historical discharge note records the treating clinician’s diagnosis of acute gastroenteritis and an oral rehydration prescription. This is a transcription of that encounter, not a statement about your current condition.',
    hi: 'पुरानी डिस्चार्ज रिपोर्ट में चिकित्सक द्वारा दर्ज तीव्र गैस्ट्रोएंटेराइटिस का निदान और ओरल रिहाइड्रेशन का प्रिस्क्रिप्शन है। यह उस समय की जानकारी है, वर्तमान स्थिति का बयान नहीं।',
  },
  keyPoints: [{ en: 'Discharged on 17 May 2026; historical prescription only.', hi: '17 मई 2026 को डिस्चार्ज; केवल उस समय का प्रिस्क्रिप्शन।' }],
  diagnoses: [{ name: 'Acute gastroenteritis', sourceText: 'Diagnosis recorded by the treating clinician: Acute gastroenteritis.' }],
  medications: [{ id: 'demo-med-ors', name: 'Oral rehydration salts', dosage: '1 sachet in 1 litre water', frequency: 'small frequent sips', duration: '2 days', instructions: 'Prepare fresh daily.', sourceText: 'Oral rehydration salts: 1 sachet in 1 litre water; small frequent sips; for 2 days; Prepare fresh daily.' }],
};

export const demoRecords = [
  latest, prescription, diagnostic,
  priorPanel({ id: 'demo-lab-jul', date: '2026-07-08', month: 'July', hba1c: 6.3, glucose: 118, hemoglobin: 14.0, vitaminD: 18 }),
  discharge,
  priorPanel({ id: 'demo-lab-apr', date: '2026-04-06', month: 'April', hba1c: 6.5, glucose: 126, hemoglobin: 13.8, vitaminD: 16 }),
];
