# Sehat — Verification Record

What was actually run, on what, and what it showed. Every number below is copied from a command that was executed on **2026-10-13**; nothing here is an estimate or an accuracy claim.

Environment: Windows 11, Node v24.19.0, npm 11.16.0, Chromium 156.0.8078.4 (Playwright 1.55, headless shell).

## Summary

| Check | Command | Result |
| --- | --- | --- |
| Domain + API + provider unit tests | `npm test` | **35 passed, 0 failed** (1.54 s) |
| Production build | `npm run build` | **built successfully**; `tsc -b` clean, no type errors |
| Browser journeys (no provider) | `npm run test:e2e` | **15 passed, 0 failed** (16.1 s) |
| Live NVIDIA NIM pipeline | `npm run test:live` | **completed**; TXT 5.1 s, PNG OCR 16.2 s, chat EN + HI cited |
| Secret exposure review | greps + live HTTP probes | **no credential in tracked files, bundle, or any HTTP response** |
| Loopback-only binding | `HOST=0.0.0.0 node server/index.mjs` | **refused to start** (throws) |

## 1. Unit and integration tests — `npm test`

35 tests across `tests/domain.test.mjs`, `tests/api.test.mjs`, `tests/provider.test.mjs`. Node's built-in `node:test`; no network required.

The suite covers: values at and beyond reference boundaries; a missing range staying unknown (never inferred from medical knowledge); invalid numbers never becoming `0`; FHIR cross-references resolving as URN UUIDs; missing values staying absent in FHIR rather than manufacturing `Condition` or active `MedicationStatement`; model output treated as untrusted data (instruction-like text inside a document cannot become control metadata); evidence matching that does not fire on a substring inside a different number; an unsupported unit being blanked for review rather than trusted; comparison qualifiers preserved; real ISO dates accepted while invalid/missing dates stay unknown; oversized and binary-disguised-as-text uploads rejected before processing; provider failures returning useful messages without echoing the credential or the provider payload; and interrupted jobs (server restart mid-processing) being marked failed rather than being reported as complete.

## 2. Live NVIDIA NIM — real provider, synthetic sample

Run against the real `integrate.api.nvidia.com` endpoint using the configured credential. Only synthetic fixtures from `public/samples/` were sent.

```
{"models":{"vision":"meta/llama-3.2-11b-vision-instruct",
           "extraction":"nvidia/nemotron-3-super-120b-a12b",
           "chat":"nvidia/nemotron-3.5-lightning-30b-a3b"}}

txt: Extracting structured fields → Saved to timeline
{"type":"txt","elapsedSeconds":5.1,"mode":"live","warnings":[],
 "observations":[HbA1c 6.1 % (4–5.6, high), Fasting glucose 112 mg/dL (70–99, high),
                 Hemoglobin 14.2 g/dL (13–17, normal), Vitamin D 24 ng/mL (30–100, low)]}

png: Reading image with vision model → Extracting structured fields → Saved to timeline
{"type":"png","elapsedSeconds":16.2,"mode":"live",
 "warnings":["Vision transcription can misread handwriting, decimals and table columns.
              Verify against the original document."]}

{"language":"en","mode":"live","model":"nvidia/nemotron-3.5-lightning-30b-a3b","citations":2}
{"language":"hi","mode":"live","model":"nvidia/nemotron-3-super-120b-a12b","citations":1}
```

**Tested model IDs** (recorded as required; no accuracy claim is made): vision `meta/llama-3.2-11b-vision-instruct`, extraction `nvidia/nemotron-3-super-120b-a12b`, chat EN `nvidia/nemotron-3.5-lightning-30b-a3b`, chat HI `nvidia/nemotron-3-super-120b-a12b`.

Both text and vision extraction recovered the same four values and ranges as the source sample, on two independent runs (4.1 s / 24.2 s and 5.1 s / 16.2 s). Those elapsed times are wall-clock for each run on this machine and will vary with provider load — the spread between runs is the honest measure of that, and it is why no timing is presented as a performance guarantee.

The PNG path surfaced its own caveat — vision transcription can misread decimals and table columns — which is the honest behavior the spec asks for rather than a silent success.

## 3. Browser journeys — `npm run test:e2e`

15 checks in `tests/e2e/journeys.spec.ts`, run against the **built** app on a throwaway database with **NVIDIA deliberately unconfigured** (see `tests/e2e/server.mjs`), so the suite is offline-safe and asserts the fallback path.

Note on the harness: this machine has `NVIDIA_API_KEY` exported in its shell environment, which leaks into child processes. The e2e server therefore *injects* an explicitly unconfigured NIM client rather than relying on the variable being absent — otherwise `ai.configured` would read `true` and these assertions would quietly exercise the live branch.

Verified: the workspace loads with **zero console errors** and announces `SYNTHETIC DEMO WORKSPACE`; the footer states Sehat is not a medical professional; EN/HI toggle sets `<html lang>` and keeps dates legible; the record sheet shows extracted values **beside** their source evidence and provenance and repeats the non-diagnostic caveat; Escape closes the sheet; the upload sheet cannot submit without consent and names NVIDIA in the consent text; a local TXT parse reaches a terminal state and increments the record count; the copilot labels a no-provider answer a **local summary** (never a live AI run), cites the saved record, declines a dosage change, and escalates an emergency; the timeline is ordered by real document dates; medications are attributed to the source prescription; ABHA linking is labeled a mock; and navigation stays reachable at an 820 px tablet viewport.

## 4. Demo-journey claims, checked against the running app

The three-minute script makes specific promises, so each was exercised rather than assumed:

| Script claim | Observed |
| --- | --- |
| "Open **Correct details** to show that values and ranges are editable." | Opening the editor renders **23 editable inputs** with Save/Cancel. |
| "Select **I've reviewed the details**." | The record's badge changed from `Review needed` to `Reviewed` in place, and the change persisted to the store. |
| "Expand **See source evidence** under HbA1c." | Four `See source evidence` disclosures on the October panel, plus one `Source & AI details` provenance panel. |
| "Show the mock ABHA badge, then **Export health records**." | The control reads `Try mock ABHA connection`, and export downloads `sehat-fhir-bundle.json`. |
| "The export is a linked FHIR R4-style collection with source provenance." | Downloaded bundle: `resourceType: Bundle`, **31 entries** — Patient 1, AllergyIntolerance 1, DocumentReference 6, Observation 13, MedicationStatement 3, Provenance 6, Condition 1. All **70 internal `urn:uuid` references resolve** to an entry (`fullUrl`) in the same bundle. The synthetic marker is present in the payload. |
| "Presentation … Arrow keys change slides … printable." | 6 slides (cover + 5), `ArrowRight`/`ArrowLeft` navigate both ways, walking past the last slide does not crash, and `@page` print CSS is present. Zero console errors. |

## 5. Production bundle and service hardening

`npm run build` then `npm start` on port 3001:

| Probe | Result |
| --- | --- |
| `GET /api/health` | `200` JSON |
| Deep link `GET /some/deep/link` | `200 text/html` (SPA fallback, as intended) |
| `GET /assets/index-*.js` | `200 text/javascript` (build asset served) |
| `GET /api/nope` | `404 {"error":"API endpoint not found."}` |
| `HOST=0.0.0.0 node server/index.mjs` | **throws** — refuses a non-loopback bind |

### Secret exposure

- No `nvapi-` token appears anywhere outside `.env` (git-ignored: confirmed via `git check-ignore`).
- No `VITE_`-prefixed credential exists, so nothing ships to the browser bundle; `grep nvapi- dist/` returns nothing.
- Live HTTP probes for `/.env`, `/../.env`, `/..%2f.env`, `/%2e%2e/.env`, `/server/nim.mjs`, `/package.json` and `/data/../.env` all returned the SPA HTML shell, none contained a credential or any source file. Traversal is not exploitable here because only `dist/` is mounted, with `dotfiles: 'deny'`.
- `GET /data/sehat.sqlite` returns the SPA shell (622 bytes of HTML), **not** the database — verified by the absence of the SQLite file magic. The database is not web-reachable.
- Provider errors are shaped to avoid echoing the credential or the raw provider payload (covered by a unit test).

## 6. What is verified vs. what is not

**Verified:** the behaviors listed above, on the synthetic fixtures in `public/samples/`, at the timestamps and durations recorded here.

**Not verified, and not claimed:** clinical accuracy of any model output; handwriting recognition accuracy (no handwriting fixture was used); real ABHA/ABDM interoperability (linking is a mock; FHIR export is R4-style and uncertified); behavior against real patient documents; concurrency beyond two upload jobs; anything about a hosted or multi-user deployment. Vision transcription is explicitly labeled in-app as prone to misreading decimals and table columns.

No accuracy percentage, benchmark, or clinical outcome claim is made anywhere, because none was measured.

## 7. Screenshots

Captured from the running development server (`npm run dev`, port 5173) at 1440×900 @2x, on the **pristine seeded workspace** after `POST /api/demo/reset` — six synthetic records, the October panel pending review, ABHA unlinked. All eleven captured with zero page errors.

| File | Shows |
| --- | --- |
| `docs/screenshots/01-overview.png` | Overview: six records, one awaiting review, health snapshot trend |
| `docs/screenshots/02-record-evidence.png` | Record sheet: HbA1c 6.1 % beside its raw source line and report range |
| `docs/screenshots/03-records.png` | Record list with filters and review status |
| `docs/screenshots/04-timeline.png` | Timeline grouped by real document dates |
| `docs/screenshots/05-medications.png` | Medication history with source prescription links |
| `docs/screenshots/06-hindi.png` | Hindi interface — numbers and analyte names preserved |
| `docs/screenshots/07-upload-consent.png` | Upload sheet with the NVIDIA consent statement and a selected file |
| `docs/screenshots/08-copilot.png` | Grounded answer citing the saved record, labeled for its mode |
| `docs/screenshots/09-profile.png` | Profile with the labeled mock ABHA control and FHIR export |
| `docs/screenshots/10-presentation.png` | Browser presentation deck (6 slides, print-ready) |
| `docs/screenshots/11-tablet-nav.png` | Tablet viewport with the collapsed navigation open |

These are real captures of this build, not mockups. The corpus is synthetic, so nothing in them is real patient data.
