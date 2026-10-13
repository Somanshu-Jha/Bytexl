# Sehat: three-minute demo

Use only synthetic records. The six seeded records belong to fictional Aarav Sharma. The intent is to show traceable document understanding and a useful record workspace, without claiming a diagnosis or clinical accuracy metric.

## Before presenting

- Run `npm run dev` and open `http://127.0.0.1:5173`. Keep the app in English and the October **Preventive health panel** pending review.
- Keep `public/samples/aarav-blood-panel.txt` and `public/samples/aarav-blood-panel.png` available. The TXT route is quickest. The PNG route demonstrates vision when NVIDIA is configured.
- Confirm `/api/health` responds and inspect the configured models. A present credential does not guarantee service availability. Try the synthetic sample before the session.
- Open `http://127.0.0.1:5173/presentation.html` in a second tab. Arrow keys change slides. The print button produces one slide per page.
- If you need a fresh workspace, intentionally call `POST /api/demo/reset` before presenting. It replaces current records and the profile with the synthetic seed. Do not use it on work you intend to keep.

## 0:00–0:25 · The record workspace

Show **Overview**.

> “Sehat is a personal health record companion in English and Hindi. This is Aarav’s fictional workspace, with six synthetic records. The aim is to keep medical information understandable and connected to the document it came from.”

Point to the recent October panel and the timeline. Do not describe falling lab values as proven health improvement.

## 0:25–1:00 · Upload and provenance

Open the upload dialog. Choose `aarav-blood-panel.txt`, explain the consent checkbox, then start processing. Use the PNG instead if the vision path has already been rehearsed and time permits.

> “With NVIDIA configured, the server sends this synthetic source for extraction after consent. Image documents first pass through vision transcription. The app shows the actual processing stage and saves both the extracted facts and the source evidence.”

If processing is still running, move to the seeded October panel and return later. Do not imply that a seed record is the upload result. Open **Source & AI details** on the completed upload to show its live or local provenance and actual model.

## 1:00–1:35 · Check the evidence

Show the four result rows and expand **See source evidence** under HbA1c.

> “The source says HbA1c 6.1%, with a range of 4.0 to 5.6%. Sehat compares only with that report’s range. It does not turn the result into a diagnosis. Missing values stay blank.”

Open **Correct details** to show that values and ranges are editable. If everything matches, cancel edits and select **I’ve reviewed the details**. If rehearsing a correction, change only a known synthetic transcription mistake, save it, then mark it reviewed. The original source remains available.

## 1:35–2:00 · A connected history

Switch to **हिं** briefly, show the same summary and numbers in Hindi, then return to English. Open **Health timeline**, followed by **My medications**.

> “The same record has a Hindi explanation. The timeline groups actual document dates, and the medication view keeps written prescription instructions and source links. A historical prescription does not prove current use.”

## 2:00–2:35 · Ask a record question

Open **Ask Sehat** and ask: **“What does my October blood panel say?”** Open a returned record citation.

> “The copilot uses AI to select relevant saved facts. The app displays those facts and links the records they came from. The answer labels live selection or the local fallback. Dosage changes and diagnosis requests are directed back to a clinician.”

If time permits, ask **“Should I double my medicine dose?”** to demonstrate the local safety response. Do not use an emergency question as a clinical triage accuracy demonstration.

## 2:35–3:00 · Data that can leave the prototype

Open **Profile & preferences**. Show the mock ABHA badge, then **Export health records**.

> “The ABHA connection is visibly a mock. The export is a linked FHIR R4-style collection with source provenance. It is unvalidated and not ABDM-certified. This local prototype demonstrates the record journey; clinical evaluation, production security, and real interoperability are the next steps.”

## If the provider is unavailable

For a configured upload, a provider failure produces a failed job and a retry message. Show that error honestly and continue with the labeled seed records. Chat provider failures automatically return a labeled local saved-record summary. Do not call either path live AI.

For a deliberate offline rehearsal, leave `NVIDIA_API_KEY` empty in the local server configuration and restart the app. Upload the TXT sample. The app uses a limited laboratory parser and records **Local extraction**. It will not OCR the PNG or a scanned PDF without NVIDIA. General prescriptions and diagnostic documents also need the configured extraction route.

Avoid editing credentials or restarting services during the three-minute presentation. The offline HTML slides and seeded records are the fallback material. The presentation contains no claim of accuracy percentages, patient outcomes, real ABHA connectivity, or clinical certification.
