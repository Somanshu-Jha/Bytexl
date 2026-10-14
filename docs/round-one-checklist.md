# Round 1 coverage

This checklist maps the challenge to working prototype behavior. A completed software feature is not a clinical accuracy or hackathon-score claim.

| Requirement | Implemented evidence | Boundary |
| --- | --- | --- |
| Upload prescriptions, labs, discharge summaries and diagnostic records | PDF, PNG, JPEG, WebP and text upload; async jobs; record-type extraction; samples | 12 MB; standard PDFs 8 pages, at most 4 needing OCR |
| Medicines, dosage, test values, diagnoses and dates | Source-linked schema, evidence validation, original text, manual correction | Unsupported values remain missing; negated/family/uncertain diagnoses are omitted |
| Plain-language summary and abnormal values | English/Hindi summaries; report-specific range explanations; source disclosures | Uses the document's own ranges; no diagnosis inferred from a flag |
| Unified profile and timeline | SQLite profile, document dates, timeline, medication history, trend chart | Single user; duplicate/conflicting same-day HbA1c observations are excluded from the trend |
| Regional language bonus | Hindi interface and summaries; bilingual source normalization with Devanagari numerals | Handwritten/bilingual image recognition depends on provider; no broad accuracy claim |
| Handwriting bonus | Opt-in two-reading OCR comparison, image preprocessing, unclear-text masking, review gate, raw-pass inspection | Experimental; two agreeing readings can be wrong; unreadable prescriptions need their prescriber |
| ABDM/ABHA bonus | Mock ABHA link/unlink; FHIR R4-style collection with linked Patient, clinical records and Provenance | No live ABDM network, certification or profile conformance claim |
| Architecture deliverable | docs/architecture.md and browser presentation | Separates hosted AI, local storage and review boundaries |
| Demo/slides deliverable | public/presentation.html, six printable slides; docs/demo-script.md; synthetic samples | Demonstrates actual features without fabricated clinical metrics |
| Easy launcher | START_SEHAT.bat, STOP_SEHAT.bat, cross-platform npm run launch | Node 24 required; initial package download and build need working tools |
| AI role separation | Tested NVIDIA vision, extraction and fact-selection chat models; Hindi selection via Super | Hosted service availability/quotas can change; failures are visible |
| Safety and control | Consent, deletion, source correction, uncertainty and citation validation, emergency/dosage guardrails | Local prototype lacks production authentication and encryption at rest |

Handwriting research, explicit counterexamples and free local candidates: [OCR research](ocr-research.md). Current executed checks: [verification](verification-2026-10-14.md).
