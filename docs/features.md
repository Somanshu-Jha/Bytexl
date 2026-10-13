# Sehat — Using the app, feature by feature

A guided tour of every screen and control, written from the running application. For setup and the API surface, see [the README](../README.md). For what has actually been tested versus claimed, see [the verification record](verification.md).

Everything you see by default belongs to **Aarav Sharma, a fictional patient**. The six seed records are synthetic. The app labels itself `SYNTHETIC DEMO WORKSPACE` throughout, and the footer states it is a health information companion rather than a medical professional. Keep using synthetic data until you have deliberately replaced the workspace.

## Starting it

```powershell
npm install
npm run dev
```

Then open **http://127.0.0.1:5173**. Two processes start together: the interface (Vite, port 5173) and the local API (Express, port 3001). Vite proxies `/api` to the API, so the browser only talks to one origin. The API binds to loopback only — starting it with a non-loopback `HOST` throws rather than exposing the service on your network.

Requires Node 24 or newer; persistence uses Node's built-in `node:sqlite`, so there is no database to install.

---

## Overview

The landing screen after start-up.

- **Greeting and status strip** — patient name, record count, how many records await review, how many medicines are recorded, and the date of the most recent document.
- **"A second look makes a difference"** panel — appears when something is pending review, counts it in words, and links straight into the record. With nothing pending it switches to a calmer "Your records, understood" message.
- **Your recent records** — newest first, each with provider, date, and a `To review` / `Reviewed` badge. Click any row to open it.
- **Your health snapshot** — tracks one repeated measurement (HbA1c here) across records with a small trend line, labelled `Reported results`. It plots what the documents say; it does not interpret the direction as improvement or decline.
- **Add a health record** — opens the upload sheet.

## My health records

The full list, with a search box and filters.

- **Search** matches titles, providers and medicines. Typing narrows the list live; the header search box on every other screen jumps here and carries the term with it.
- **Filters** — `Needs review`, `All records`, then one chip per record type: `Lab report`, `Prescription`, `Discharge summary`, `Diagnostic record`.
- Each row shows type icon, title, provider, date, and review state. Selecting a row opens the record sheet.

## The record sheet

Opened from any record row. This is where a document becomes understandable and verifiable.

- **Two tabs.**
  - **The simple version** — a plain-language summary and the key points, each written in English and Hindi.
  - **Source & AI details** — the processing provenance: whether the extraction was a live model run or a local parse, which model was used, and any warnings the pipeline raised.
- **Here's what your record says** — the summary. Results are described as *above / below / within this report's range*, followed by the standing caveat that a result alone does not establish a diagnosis.
- **Your results, unpacked** — each observation as its own card: analyte name, value with unit, a `Report range` chip when the document supplied one, a plain-language explanation, and an **Above range / Below range / Within range** badge that is driven by the report's own numbers. A value with no printed range is marked unknown instead of being compared against general medical knowledge.
- **See source evidence** — expands to the raw line lifted from the document, so you can check the extraction against its origin. This is the trust mechanism: the number and its evidence are never separated in the interface.
- **Correct details** — switches the extracted values, units, reference limits and dates into editable fields. Corrections are saved to the record; the original source text stays available.
- **I've reviewed the details** — marks the record reviewed and clears it from the pending count. You can reopen it later.
- **Still have questions? Ask your copilot** — hands this record to the chat as context.
- **Delete** — removes the record from the workspace. This is an application-level delete, not certified secure erasure.

## Uploading a document

Opened by **Add a health record** / **Add your next record**.

1. **Choose a file** — drag and drop, click the drop zone, or use **Just exploring? Try a synthetic sample report** to load the bundled sample. Accepted: PDF, PNG, JPG, JPEG, WebP, TXT, up to 12 MB.
2. **Read the consent line.** Nothing is sent anywhere until you tick **"I agree to send the document content to NVIDIA for AI processing. I have permission to use this record."** Until then the submit button stays disabled, and the server rejects an upload that arrives without `consent=true`.
3. **Read my record** starts the job.

While it runs, the sheet shows the **actual** stage the server reports — validating, reading text or rendering pages, transcribing with vision, extracting structured fields, saving to the timeline. Image OCR is the slow step and can take a minute. The window is deliberately not dismissible mid-job.

When it finishes, the sheet closes and the new record opens for review.

**What the pipeline does with each input type:**

| Input | Handling |
| --- | --- |
| UTF-8 `.txt` | Read directly. Without a provider, a limited laboratory parser handles explicit lab rows. |
| Text-based `.pdf` | Embedded text is extracted, then structured. |
| Scanned `.pdf` | Pages are rendered and sent for vision transcription. Requires NVIDIA. |
| `.png`, `.jpg`, `.jpeg`, `.webp` | Decoded and resized for vision transcription. Requires NVIDIA. |

**Honest failure.** A document that cannot be read produces a failed job with a plain explanation and no record — for example "No readable medical text was found." That is verified in the verification record; the app does not substitute sample output to look successful. Provider failures are reported the same way and do not silently become local parses.

## Health timeline

Records grouped and ordered by their **actual document date**, not by upload order. Records whose date could not be read are labelled as missing rather than being quietly filed under today. Selecting an entry opens the record.

## My medications

A history drawn from your prescriptions, not a medication schedule.

- Each entry shows the medicine name, dosage, frequency and duration exactly as written in the source, with a **view original prescription** link to the record it came from.
- The heading states that this is a history of medicines recorded in your documents and that a historical prescription does not prove the medicine is currently being taken.
- Sehat never suggests starting, stopping or changing a medicine.

## Ask Sehat

A record-grounded assistant, not a general medical chatbot.

- Ask in your own words, in English or Hindi — for example *"What does my October blood panel say?"*
- Answers are built from your **saved records**. The answer displays the facts it used and links the records those facts came from, so you can check them.
- **Mode is always labelled.** With NVIDIA configured, the model selects which saved facts are relevant and the app renders those facts and derives the citations — the model's own prose is not shown as medical advice. Without a provider, or if the provider fails, you get a clearly labelled local summary of your saved records instead. A fallback is never presented as a live AI answer.
- **It declines what it must.** Requests to change a medicine or dose are refused, pointing you to your prescriber or pharmacist. Emergency symptoms are met with advice to contact local emergency services (112 in India) or attend an emergency department, and a statement that it cannot assess an emergency.

## Profile & preferences

- **Your health profile** — name, date of birth, gender, blood group, and allergies, with a standard button to save. The allergies field is deliberately labelled to record only what is confirmed in your records or by your clinician, and removing an allergy still needs an explicit save.
- **Mock connection** — the ABHA panel is visibly a mock: an exploration of how a linked profile *could* work. There is no live ABHA or ABDM connection, and the app does not imply one.
- **Export health records** — downloads `sehat-fhir-bundle.json`, an R4-style FHIR `Bundle` containing `Patient`, `DocumentReference`, `Observation`, `MedicationStatement`, `Condition`, `AllergyIntolerance` and `Provenance` resources, cross-referenced by internal `urn:uuid`. On the seeded workspace it contains 31 entries and every internal reference resolves. It is an unvalidated prototype export, **not** ABDM-certified interoperability.

## Language

The **EN / हिं** switch in the top bar translates the whole interface and sets the document language.

Clinical content is deliberately preserved rather than translated: medicine names, analyte names, numerical values, units, and reference ranges stay in their original form — only the explanatory prose becomes Hindi. The medications screen shows `Cholecalciferol (Vitamin D3)`, `1000 IU` and `once daily` unchanged while its surrounding labels are Hindi. The choice is remembered between visits.

## Search, notifications and the workspace shell

- The **search box** in the top bar is available on every screen; using it opens the records list.
- The **bell** lists records awaiting review and links directly to them.
- The **sidebar** is the primary navigation; on narrow screens it collapses behind a labelled menu button, and the layout stays usable down to tablet width.
- Keyboard users can move through the interface, and dialog sheets close with **Escape**.

## Resetting the workspace

To return to the six synthetic records and the demo profile after experimenting:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/api/demo/reset
```

This **replaces** your current records and profile with the seed. Anything you uploaded is discarded, so do not run it against a workspace you intend to keep.

## What Sehat does not do

It does not diagnose, recommend or alter medication, or claim clinical certification, certified ABHA/ABDM interoperability, or demonstrated handwriting accuracy. Missing or unreadable information stays visibly missing. Vision transcription can misread handwriting, decimals and column order — the app says so on every image-derived record, and you should check the source evidence against the original document. This is a local single-user prototype: there is no authentication, no encryption at rest, and no production access control, so do not put real medical records in it or expose the port to a network.
