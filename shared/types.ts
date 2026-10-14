export type Language = 'en' | 'hi';
export type Localized = { en: string; hi: string };
export type RecordType = 'lab' | 'prescription' | 'discharge' | 'diagnostic';
export type ObservationStatus = 'normal' | 'high' | 'low' | 'unknown';
export interface Observation { id: string; name: string; value: number | null; unit: string; referenceLow: number | null; referenceHigh: number | null; status: ObservationStatus; sourceText: string; explanation: Localized; code?: string; }
export interface Medication { id: string; name: string; dosage: string; frequency: string; duration: string; instructions: string; sourceText: string; }
export interface Diagnosis { name: string; sourceText: string; }
export interface OcrPage { page: number; firstPass: string; secondPass: string; consensus: string; disagreementCount: number; }
export interface OcrProvenance { mode: 'single' | 'verified'; verificationModel?: string; status: 'agreement' | 'disagreement' | 'verification-unavailable'; disagreementCount: number; pages: OcrPage[]; preprocessing: string[]; }
export interface Provenance { mode: 'live' | 'demo' | 'local'; extractionModel: string; visionModel?: string; processedAt: string; warnings: string[]; ocr?: OcrProvenance; ocrWarningsAcknowledgedAt?: string; }
export interface HealthRecord { id: string; title: string; type: RecordType; date: string | null; provider: string; fileName: string; summary: Localized; keyPoints: Localized[]; observations: Observation[]; medications: Medication[]; diagnoses: Diagnosis[]; sourceText: string; reviewStatus: 'pending' | 'reviewed'; isDemo: boolean; createdAt: string; provenance: Provenance; }
export interface Patient { id: string; name: string; dateOfBirth: string; gender: string; bloodGroup: string; allergies: string[]; abhaId: string | null; abhaLinked: boolean; }
export interface Bootstrap { patient: Patient; records: HealthRecord[]; ai: { configured: boolean; models: { vision: string; extraction: string; chat: string } }; }
export interface UploadJob { id: string; status: 'queued' | 'processing' | 'completed' | 'failed'; stage: string; error?: string; recordId?: string; }
export interface ChatResponse { answer: string; citations: { recordId: string; title: string }[]; mode: 'live' | 'local'; model: string; }
