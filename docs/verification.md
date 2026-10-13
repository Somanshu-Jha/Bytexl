# Sehat — Verification Record

What was actually run, on what, and what it showed. Every number below is copied from a command that was executed on **2026-10-13**; nothing here is an estimate or an accuracy claim.

Environment: Windows 11, Node v24.19.0, npm 11.16.0, Chromium 156.0.8078.4 (Playwright 1.64.0, headless shell).

## Summary

| Check | Command | Result |
| --- | --- | --- |
| Unit, API and regression tests | `npm test` | **48 passed, 0 failed** |
| Production build | `npm run build` | **built successfully**; `tsc -b` clean, no type errors |
| Browser journeys (no provider) | `npm run test:e2e` | **16 passed, 0 failed** (17.0 s) |
| Live NVIDIA NIM pipeline | `npm run test:live` | **completed**; TXT 5.1 s, PNG OCR 16.2 s, chat EN + HI cited |
| Adversarial extraction probes | direct `normalizeExtraction` calls | **10 attacks, 0 leaks** — see §5 |
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

Both text and vision extraction recovered the same four values and ranges as the source sample, on three independent runs (4.1 s / 24.2 s, 5.1 s / 16.2 s, and — after the §5 boundary fixes — 3.1 s / 17.4 s). Those elapsed times are wall-clock for each run on this machine and will vary with provider load; the spread across runs is the honest measure of that, and it is why no timing is presented as a performance guarantee. The post-fix run is the one that matters for the extraction changes: text and vision both still returned the same four correct values with the document's own ranges.

The PNG path surfaced its own caveat — vision transcription can misread decimals and table columns — which is the honest behavior the spec asks for rather than a silent success.

## 3. Browser journeys — `npm run test:e2e`

16 checks in `tests/e2e/journeys.spec.ts`, run against the **built** app on a throwaway database with **NVIDIA deliberately unconfigured** (see `tests/e2e/server.mjs`), so the suite is offline-safe and asserts the fallback path.

Note on the harness: this machine has `NVIDIA_API_KEY` exported in its shell environment, which leaks into child processes. The e2e server therefore *injects* an explicitly unconfigured NIM client rather than relying on the variable being absent — otherwise `ai.configured` would read `true` and these assertions would quietly exercise the live branch.

Verified: the workspace loads with **zero console errors** and announces `SYNTHETIC DEMO WORKSPACE`; the footer states Sehat is not a medical professional; EN/HI toggle sets `<html lang>` and keeps dates legible; the record sheet shows extracted values **beside** their source evidence and provenance and repeats the non-diagnostic caveat; Escape closes the sheet; the upload sheet cannot submit without consent and names NVIDIA in the consent text; a local TXT parse reaches a terminal state and increments the record count; the copilot labels a no-provider answer a **local summary** (never a live AI run), cites the saved record, declines a dosage change, and escalates an emergency; the timeline is ordered by real document dates; medications are attributed to the source prescription; ABHA linking is labeled a mock; and navigation stays reachable at an 820 px tablet viewport.

## 4. Demo-journey claims, checked against the running app

The three-minute script makes specific promises, so each was exercised rather than assumed:

| Script claim | Observed |
| --- | --- |
| "Open **Correct details** to show that values and ranges are editable." | Opening the editor renders **23 editable inputs** with Save/Cancel. |
| "Select **I've reviewed the details**." | The record's badge changed from `Review needed` to `Reviewed` in place, and the change persisted to the store. |
| "Expand **See source evidence** under HbA1c." | Four `See source evidence` disclosures on the October panel, plus one `Source & AI details` provenance panel. |
| "Show the mock ABHA badge, then **Export health records**." | The control reads `Try mock ABHA connection`; clicking it downloads `sehat-health-records.fhir.json` (the interface names the file; the server's own `Content-Disposition` header, seen when fetching `/api/export/fhir` directly, says `sehat-fhir-bundle.json`). |
| "The export is a linked FHIR R4-style collection with source provenance." | Downloaded bundle: `resourceType: Bundle`, **31 entries** — Patient 1, AllergyIntolerance 1, DocumentReference 6, Observation 13, MedicationStatement 3, Provenance 6, Condition 1. All **70 internal `urn:uuid` references resolve** to an entry (`fullUrl`) in the same bundle. The synthetic marker is present in the payload. |
| "Presentation … Arrow keys change slides … printable." | 6 slides (cover + 5), `ArrowRight`/`ArrowLeft` navigate both ways, walking past the last slide does not crash, and `@page` print CSS is present. Zero console errors. |

## 5. Adversarial input against the extraction boundary

The domain boundary is where a wrong number could reach a user, so it was attacked directly through `normalizeExtraction(raw, { sourceText })` and `localExtract(sourceText)`, not only through the happy path the unit tests use.

**An independent review of this branch then found four real defects in this same area, which were fixed. The table below describes the state after those fixes; the "Defects found and fixed" section that follows records what was actually wrong, so the fixes are auditable.**

| Attack | Result after fixes |
| --- | --- |
| Range printed *before* the result: `Total cholesterol (0 - 200 mg/dL): 210 mg/dL` | Result read as **210**, range as `0–200`. (Before the fix this returned **200** — the range bound — see defect D1.) |
| Value `112` whose digits appear inside `1120` elsewhere in the same document | **Not matched** — value left `null`. Number matching is boundary-aware, not substring-based. |
| Value `1.1` where the source contains `11.2` | **Not matched** — value left `null`. |
| Reference limit forged from a number elsewhere in the document (e.g. the result itself) | **Range taken from the document**, not the model. (Before the fix a high glucose of 112 could be relabelled "within range 70–112" — see defect D2.) |
| Unit (`g/dL`) that occurs only *inside* the printed unit `mg/dL` | **Unit blanked**. (Before the fix a 1000× wrong unit was trusted — see defect D3.) |
| No range printed in the document at all | **Stays unknown** — never inferred from general medical knowledge. |
| Inverted (`9 - 2`) or degenerate (`6.1 - 6.1`) range | Both bounds blanked **and** the value nulled. |
| `TSH: <0.5` presented as a plain value of `0.5` | **Value nulled** — a qualifier is not silently stored as an exact number. |
| The canonical phrase **"Ignore all previous instructions"** in document text | Detected; medications and diagnoses dropped; the phrase cannot become an analyte name. (Before the fix the detector missed this exact phrasing — see defect D4.) |
| "Ignore prior instructions." as the only support for a medication or diagnosis | **Both dropped entirely** — 0 retained. |
| `null` or an array passed as extraction output | **Throws** rather than half-normalizing. |
| The documented dev server (`npm run dev`) asked for `data/*.sqlite`, `server/*.mjs`, `.env` | **403** for all of them. (Before the fix the record store and server source were served — see defect D5.) |
| State-changing request with `Origin: http://localhost:9999` | **403**. (Before the fix another local port could rename the patient and wipe records — see defect D6.) |

### Defects found and fixed

Each was reproduced first, then covered by a regression test that failed against the old code.

- **D1 — the offline parser read a reference bound as the result.** A greedy name group stopped inside a range printed before the value, so `Total cholesterol (0 - 200 mg/dL): 210 mg/dL` stored **200** as the result and discarded the real 210 — a normal-looking number that was actually the top of the range. The parser now anchors the result to the field holding it and reads both layouts (range-first and result-first). *Tests: `offline parser reads the result, not the range bound…`, `…when the range follows without a separator`.*
- **D2 — a reference limit could be forged from any number in the document.** Limits were validated against the whole document, so the result value itself could be submitted as `referenceHigh`, relabelling a genuinely high glucose (112, printed range 70–99) as *"within this report's reference range (70–112)"*. The document's own printed range is now the authority; a model-supplied range that disagrees is discarded and warned about. *Test: `rejects a reference limit that is not present in the observation snippet`.*
- **D3 — a unit was accepted if it occurred anywhere inside the printed unit.** `g/dL` passed because it appears in `mg/dL`, so a 1000× wrong unit could be displayed as fact. Units are now matched against the unit printed for that result. *Test: `rejects a unit that only appears as a substring of the printed unit`.*
- **D4 — the injection detector missed its own canonical phrase.** `ignore\s+(?:all\s+|previous\s+|prior\s+)?(?:instructions|rules)` could not match "ignore **all previous** instructions": the qualifier group consumed "all previous" and left nothing for the noun. Instruction text could therefore reach a stored analyte name and be repeated back in the bilingual explanation as clinical prose. The qualifier group is now repeatable. *Test: `detects the canonical instruction phrases, including "ignore all previous instructions"`.*
- **D5 — the documented dev command served the patient database.** Vite serves files from the project root, so `npm run dev` returned `data/sehat.sqlite` (SQLite header) and `data/sehat.sqlite-wal` (407,912 bytes containing patient records and source text), plus `server/*.mjs`. `vite.config.ts` now denies `data/`, `*.sqlite*`, `server/`, `tests/`, `.tmp/`, `.git/` and `.env*`. Re-verified live: all return 403 while the app, API and sample fixtures still serve. *Test: `dev server configuration denies the record store, server source and env files`.*
- **D6 — any other local port was treated as same-origin.** Origin validation compared only the hostname, so `http://localhost:9999` could `PATCH /api/patient`, `DELETE /api/records/:id` and `POST /api/demo/reset` (wiping all non-demo records) without needing a preflight. The check now compares the full origin against the server's own address plus the configured loopback dev proxy, and refuses to honour a non-loopback entry in `SEHAT_DEV_ORIGINS`. Re-verified live. *Tests: `rejects a state-changing request whose Origin is a different local port`, `accepts the loopback dev-proxy origin…`, `refuses to honour a non-loopback entry in SEHAT_DEV_ORIGINS`.*

Also corrected: the dev proxy rewritten through Vite forwards the browser's original `Origin` while rewriting `Host`, so a strict full-origin check initially broke the app's own save path. That regression was caught by testing the live browser path, not by the unit tests alone, and is now covered by its own test.

The net effect, after the fixes above: document text cannot promote itself into clinical fact, a number the document does not support never becomes a stored value, and a range the document does not print is never displayed as the report's range.

## 6. Production bundle and service hardening

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
- `GET /data/sehat.sqlite` on the **production** server returns the SPA shell (622 bytes of HTML), **not** the database — verified by the absence of the SQLite file magic. On the dev server this path previously did expose the database; that is defect D5 in §5, now fixed and re-verified as 403.
- Provider errors are shaped to avoid echoing the credential or the raw provider payload (covered by a unit test).

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

## 8. What is verified vs. what is not

**Verified:** the behaviors listed above, on the synthetic fixtures in `public/samples/`, at the timestamps and durations recorded here.

**Not verified, and not claimed:** clinical accuracy of any model output; handwriting recognition accuracy (no handwriting fixture was used); real ABHA/ABDM interoperability (linking is a mock; FHIR export is R4-style and uncertified); behavior against real patient documents; concurrency beyond two upload jobs; anything about a hosted or multi-user deployment. Vision transcription is explicitly labeled in-app as prone to misreading decimals and table columns.

No accuracy percentage, benchmark, or clinical outcome claim is made anywhere, because none was measured.

## 9. Known limitations found by review but deliberately not changed

Two review findings are real and were graded Minor; they are recorded here rather than silently left in the code. Neither invents a number, and both are visible in the interface.

- **A family-history or negated phrase can be retained as a diagnosis.** Retention requires only that the name and snippet appear verbatim in the document, so `Family history: mother had type 2 diabetes`, `Plan: rule out diabetes` and `Impression: no evidence of active malignancy` are each stored as a recorded diagnosis, and the last of these surfaces as a FHIR `Condition` (marked `verificationStatus: unconfirmed`, and never manufactured from a lab flag). The display does attribute these to the document rather than asserting them as the patient's condition, and a user reviewing the record sees the supporting source line — but a negation-aware guard would be more correct. It is not implemented.
- **Duplicate analytes in one document are not disambiguated.** Two rows for the same analyte keep the same name, so the health-snapshot trend can plot both against one date as if they were two visits. The values themselves are matched to their own snippets, so no wrong number is attributed — but the trend can misstate a comparison.
- **A configured provider that fails is reported as unavailable, not as a specific failure.** When a live chat call errors (expired key, rate limit, timeout), the user sees the same labelled local fallback regardless of cause; the precise provider message is not surfaced.

Two further items from review were checked and are *not* defects: the `23 editable inputs` figure is correct (verified by counting the rendered fields on the pristine seed), and the presentation is genuinely 6 slides with working `@page` print CSS.
