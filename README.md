# Sehat

A personal health record companion in English and Hindi. Upload a report, inspect extracted values beside their source evidence, correct the details, and follow the record in a timeline. The workspace starts with six clearly labeled synthetic records for Aarav Sharma.

Sehat is a local, single-user hackathon prototype. Use synthetic data for demonstrations. It explains recorded information and does not diagnose or prescribe. ABHA linking is a mock interaction. FHIR export is an unvalidated R4-style collection, without ABDM certification or network integration.

## One-click launch
On Windows, double-click **START_SEHAT.bat**. It checks Node 24, installs missing dependencies, builds the current interface, starts the local service in the background, waits for both the UI and API to answer, and opens **http://127.0.0.1:3001**. The built frontend and API share one server; no separate database installation is needed.

Double-click **STOP_SEHAT.bat** to stop only the instance managed by this launcher. Saved records remain. Reopening the launcher reuses a healthy managed instance. A port occupied by another application produces an error; the launcher never kills that application.

For an updated build after editing code, run **START_SEHAT.bat --restart**. Logs are in **.tmp/launcher/service.log**. Avoid sharing this folder: it includes the local launcher control token.

Cross-platform terminal equivalents:

~~~powershell
npm run launch
npm run stop
~~~

Use **node scripts/launch.mjs --background --no-open** for background startup without opening a browser, or **--status** to inspect readiness. The launcher honors PORT from the environment / .env; development Vite still uses its separately configured proxy.

## Run locally

Install **Node.js 24 or later** with npm. Node's built-in `node:sqlite` powers persistence. From the project directory:

```powershell
npm install
npm run dev
```

Open [Sehat at localhost:5173](http://127.0.0.1:5173). Vite serves the interface and proxies `/api` to the local Express service at port 3001. If PowerShell blocks `npm.ps1`, use `npm.cmd` in the same commands.

The default workspace works without an API key: you can browse and edit synthetic records, use the limited local chat summary, and extract supported laboratory rows from readable text reports. Images, scanned PDFs, prescriptions, and less structured extraction require configured NVIDIA AI.

## Enable NVIDIA AI

If `.env` does not exist, create it from the example:

```powershell
Copy-Item .env.example .env
```

Edit `.env` locally and set `NVIDIA_API_KEY`. Keep the credential on the server. Never place it in a `VITE_` variable, frontend code, screenshots, or shared files. `.env` is ignored by Git. Restart `npm run dev` after changing server configuration.

| Variable | Default / purpose |
| --- | --- |
| `NVIDIA_API_KEY` | Empty enables the limited local path. Set a valid key for hosted inference. |
| `NIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `NIM_VISION_MODEL` | `meta/llama-3.2-11b-vision-instruct` |
| `NIM_EXTRACTION_MODEL` | `nvidia/nemotron-3-super-120b-a12b` |
| `NIM_CHAT_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `PORT` / `HOST` | `3001` / `127.0.0.1`; the server accepts loopback hosts only. |
| `DATA_DIR` | `./data`, containing `sehat.sqlite` and SQLite journal files. |

The development proxy expects port 3001. If you change `PORT`, update the proxy in `vite.config.ts` to match. For chat, the model selects relevant fact IDs from saved records. The server renders the selected English/Hindi facts and derives citations from their records, rather than displaying generated medical advice. English selection uses Lightning and Hindi selection uses Super. Model configuration appears in the profile and record provenance. “Configured” indicates a credential is present, not guaranteed provider availability.

The upload dialog asks for processing consent. With AI configured, document text and necessary image content go to NVIDIA. Chat sends saved record context with the question. Raw upload bytes stay in server memory during processing and are released afterward. Extracted text, clinical fields, and provenance persist in the local database. Keep the original document separately for review.

## Build and run the production bundle

```powershell
npm run build
npm start
```

Open [Sehat at localhost:3001](http://127.0.0.1:3001). Express serves the built interface and API from one local address. “Production bundle” describes the build output, not production healthcare readiness.

## Difficult handwriting
Select **Handwritten prescription or difficult image** in the upload dialog. This opt-in path decodes EXIF orientation, retains fine grayscale detail, and compares two OCR readings: the original image and a contrast-adjusted image. It permits up to two scanned PDF pages and uses extra provider requests. Text files skip OCR.

Disagreements become [unclear] in the extraction text. Both raw readings remain visible in **Source & AI details**. Medicine names, dosages and numerical fields still require source review; matching readings are not a confidence score or proof of accuracy. When readings disagree, text is unclear, or the second pass fails, the user must explicitly acknowledge the review before marking the record reviewed. Corrections invalidate that acknowledgment. Prescription-only records support medicine/dosage/frequency/duration/instruction correction.

No model can guarantee 100% detection of arbitrary doctor handwriting. If the original is unreadable, ask its prescriber or pharmacist. See [free OCR candidates and measured handwriting failures](docs/ocr-research.md). Local PaddleOCR-VL-1.6 and TrOCR-base-handwritten are recommendations to evaluate, not installed or validated components of this prototype.

## Demonstrate the product

1. Open **Preventive health panel**, the pending October synthetic record. Expand **See source evidence** for HbA1c, then inspect **Source & AI details**.
2. Upload [the synthetic TXT sample](public/samples/aarav-blood-panel.txt). For vision OCR, use [the synthetic PNG sample](public/samples/aarav-blood-panel.png) with NVIDIA configured.
3. Compare the four values and report ranges with the original sample. Use **Correct details** if needed, save, then mark the record reviewed.
4. Switch to **हिं** for Hindi explanations. Explore the dated records in **Health timeline** and the historical prescriptions in **My medications**.
5. Ask “What does my October blood panel say?” in **Ask Sehat** and open a cited record. Answers show their live or local mode.
6. In **Profile & preferences**, try the labeled mock ABHA connection and export the FHIR-style collection.

The sample contains HbA1c 6.1%, fasting glucose 112 mg/dL, hemoglobin 14.2 g/dL, and vitamin D 24 ng/mL. Reference ranges come from the sample report. No result becomes an inferred diagnosis.

Presentation: [six-slide browser deck](public/presentation.html). It works as a local file, includes arrow-key navigation, and prints one slide per page. When the app runs, use `/presentation.html` or the **Behind Sehat** link. Presenter notes: [three-minute demo script](docs/demo-script.md).

A guided tour of every screen and control — what each one does, what the upload consent gate covers, and how the Hindi switch treats clinical values — is in [the feature guide](docs/features.md).

## Verification

```powershell
npm test          # domain, API, OCR, launcher and regression tests
npm run test:e2e  # browser journey checks (Playwright, offline-safe)
npm run build     # TypeScript project build and Vite production bundle
```

Install the browser once with `npx playwright install chromium` if it is not already available. The suite runs against the built app with NVIDIA deliberately unconfigured, so it verifies the fallback path and stays offline-safe. To exercise the real provider on synthetic samples instead, run `npm run test:live` with a credential configured.

The Node tests exercise the domain boundary and local API, including missing values, range handling, evidence checks, input validation, persistence, corrections, fallback modes, and FHIR reference integrity. What was actually executed, on what machine, with which results — including the live NIM run, secret-exposure review, and path-traversal probes — is recorded in [the latest verification record](docs/verification-2026-10-14.md). Integration findings and the distinction between smoke tests and clinical accuracy appear in [research notes](docs/research.md). See [architecture](docs/architecture.md) for the data flow and boundaries.

## Supported inputs and limits

| Input | Handling |
| --- | --- |
| UTF-8 `.txt` | Read directly. Limited laboratory parser when AI is unconfigured. |
| Text-based `.pdf` | Extract embedded text, then structured extraction. |
| Scanned `.pdf` | Render pages, then vision OCR. Requires NVIDIA. |
| `.png`, `.jpg`, `.jpeg`, `.webp` | Decode and resize for vision OCR. Requires NVIDIA. |

Handwriting mode permits at most two rendered PDF pages. Standard limits: 12 MB per file, eight total PDF pages, four PDF pages requiring OCR, 28,000 extracted source characters, images below 40 megapixels, two concurrent upload jobs, and 250 saved records. Invalid file signatures, damaged PDFs, empty text, and truncated provider responses produce visible errors.

The TXT parser only handles explicit laboratory rows with recognized units. It does not provide general offline OCR or prescription extraction. A configured upload that fails upstream becomes a failed job; it does not silently substitute demo output. Chat provider failures produce a labeled local summary. Missing or unverifiable numbers remain blank. Source review does not establish clinical verification.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Local service and model configuration |
| `GET` | `/api/bootstrap` | Patient, records, and AI configuration |
| `GET` | `/api/records/:id` | One saved record |
| `POST` | `/api/records` | Multipart `file` and `consent=true`; returns upload job with HTTP 202 |
| `GET` | `/api/jobs/:id` | Queued, processing, completed, or failed job |
| `PATCH` | `/api/records/:id` | Review status and bounded source corrections |
| `DELETE` | `/api/records/:id` | Delete one record |
| `PATCH` | `/api/patient` | Profile fields and mock ABHA state |
| `POST` | `/api/chat` | `{ "message": "...", "language": "en" }`, optional `recordIds` |
| `GET` | `/api/export/fhir` | Download `application/fhir+json` collection |
| `POST` | `/api/demo/reset` | Replace local records and profile with the synthetic seed |

Use demo reset only when you intend to discard the current workspace records. Stop pending uploads first. In PowerShell, an explicit reset is:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/api/demo/reset
```

## Scope

No authentication, encryption at rest, production access controls, live ABHA verification, ABDM conformance validation, clinical certification, or broad clinical handwriting validation is included. The safeguards combine prompts, evidence checks, conservative templates, and limited pattern checks. They do not guarantee clinically correct AI output. Secure deployment, expert evaluation, identity/consent integration, and broader document testing remain future work.
