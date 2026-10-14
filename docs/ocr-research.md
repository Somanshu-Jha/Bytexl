# Free OCR for difficult prescriptions: evidence and recommendation

**Checked 14 October 2026.** No OCR model can guarantee 100% accuracy on arbitrary doctor handwriting. Missing strokes, overlapping writing, abbreviations, blur, and ambiguous drug names can make the intended text unknowable from the image alone. A confidence score, two agreeing passes, or a good document benchmark does not remove that uncertainty.

**Recommendation:** evaluate **PaddleOCR-VL-1.6 locally** as the compact page-reading candidate, with **PP-OCRv6** for layout/text detection and printed text and **TrOCR-base-handwritten** for cropped English handwriting as an independent comparison. **Qwen3.5-4B** is a useful alternative visual reader to evaluate on the same samples. Keep unreadable/disputed medicine names, dosages, and decimals unresolved for source review. There is not enough prescription-specific evidence here to rank any of these as universally best.

“Free local” means downloadable, permissively licensed software/weights with no per-request API charge or paid signup. Hardware, electricity, download time, and maintenance remain costs. NVIDIA's existing hosted access is convenient but is not a promise of permanently free or unlimited hosting.

## Current candidates

| Candidate | Official evidence and license | Practical fit and handwriting boundary |
| --- | --- | --- |
| **PaddleOCR-VL-1.6**, about 0.96B published parameters | Publisher model card reports a 0.9B document VLM, page parsing via PaddleOCR, and structured output; model metadata declares **Apache-2.0**, ungated. PaddleOCR documents the VL family as supporting 109 languages including Hindi. [1][2] | Best compact local page-reader candidate for this app. Its reported OmniDocBench score is a document-parsing benchmark, **not accuracy on doctors' prescriptions**. Cropped-element Transformers inference differs from the complete page/layout pipeline. |
| **PP-OCRv6 medium/small/tiny** | Current PaddleOCR 3.7 documentation uses medium by default; repository is **Apache-2.0**. Detection boxes, recognition output, and CPU/GPU options are available. Its unified model covers 50 languages: Chinese, English, Japanese and Latin-script languages. [2][3] | Fast detector/printed-text baseline and useful cropping stage. **That 50-language model does not include Hindi**; select a documented Devanagari model or VL path separately. Internal general-scene metrics are not prescription-handwriting validation. Documentation expressly warns that v6 and older reported metrics use different evaluation sets. |
| **microsoft/trocr-base-handwritten**, 333M parameters | Published model metadata/card declares **MIT**, ungated; fine-tuned on IAM handwriting. The card explicitly limits raw use to **single text-line images**. [4] | Small, purpose-built English handwriting comparison after line segmentation. Do not feed a whole prescription and assume layout/dose associations survive. Not a validated Hindi or medical-abbreviation model. The larger handwritten variant exists, but its current model metadata lacks an explicit license field; base is the clearer initial choice. |
| **Qwen3.5-4B** / **Qwen3-VL-4B-Instruct** | Both publisher metadata entries declare **Apache-2.0**, ungated. Qwen3.5 includes a vision encoder and publishes OCR/document benchmark results. Qwen3-VL documents OCR in 32 languages including Hindi. [5][6] | Promising independent visual-reader candidate. Qwen3.5's “201 languages/dialects” claim is broad language coverage, **not a 201-language handwriting guarantee**. Generative visual readers can silently complete plausible text; use transcription-only prompts and explicit missingness. |
| **Existing NVIDIA Llama 3.2 Vision 11B / 90B** | Standard NVIDIA image data-URI chat payload is already integrated. Llama uses its own community license, not Apache/MIT; model card officially supports English for image-plus-text. [7] | Keep the functioning hosted route while testing local options. The actual handwritten-crop test below found an 11B recognition error. 90B timed out on all three crops; there is no evidence to switch the default to it. |
| **NVIDIA-hosted google/gemma-4-31b-it** | NVIDIA documents an image/text model with broad support for over 140 languages, standard `image_url`, and `chat_template_kwargs.enable_thinking: false`. Model/service terms are linked in the official card. [11] | Selected as the single alternative hosted model to test after checking the live catalog. The Metformin request timed out at 45 seconds; remaining crops were not sent. No default switch is justified by this result. |

This machine reports **RTX 5070 Ti Laptop GPU, 12,227 MiB total VRAM**; about 10,467 MiB was free at inspection. That makes the compact Paddle model a plausible candidate. A 4B-class VLM in full 16-bit precision can leave little memory for vision activations and context; a supported quantized build is more realistic. These are sizing judgments, **not successful local installation or performance tests**. Paddle's official Blackwell/RTX50 guide is relevant: the ordinary CUDA installation instructions should not be applied blindly. The guide documents CUDA 12.9 packages, Windows-specific dependencies, and testing on RTX 5070, while noting hardware compatibility limits. [8]

## Actual handwritten-crop smoke check

Three isolated word/digit images were selected from the publisher-MIT dataset **avi-kai/Medical_Prescription_Handwritten_Words**, pinned to revision `12f818c87b7f9727d544cbede77a03bb9b42ea61`. They were visually inspected: no visible patient, clinician, facility, or contact identifiers. They are legible isolated words, **not worst-case prescriptions or a representative sample**. [9]

Both models received the same original PNG, temperature 0, a 60-token output limit, and this instruction: “Transcribe the visible handwritten text exactly. If a character or word is ambiguous, write [unclear] rather than guessing. Return only the transcription.” Case is ignored for exact match.

| Publisher label | 11B raw output | 11B observation | 90B observation |
| --- | --- | --- | --- |
| `Amoxicillin` | `Amoxicillin` | Exact match, about 1.0 s | Timed out at 45 s |
| `Metformin` | `metformis` | One character substitution; CER 1/9 for this crop, about 0.8 s | Timed out at 45 s |
| `5` | `5` | Exact match, about 9.3 s | Timed out at 45 s |

The wrong medicine transcription contained no uncertainty marker. This directly shows why an instruction to abstain is insufficient. Do not report these three cases as an accuracy estimate for clinical handwriting. No local Paddle, TrOCR, or Qwen inference was run during this research pass, so no local winner has been measured.

### Application comparison checks

The backend builder then ran the app's actual `prepareOcrImages` and `transcribeWithReview` helpers. With the initial broad medical prompt, the Metformin crop triggered a fabricated full chart in the first pass and descriptive prose in the second; the comparison produced 32 `[unclear]` lines and a disagreement status, withholding those fields. The developer shortened the prompt to visible characters only, explicitly allowing a single word and prohibiting chart completion and descriptions. Re-running the helper with that prompt gave:

| Crop | First pass | Contrast pass | Consensus | Helper status | Elapsed |
| --- | --- | --- | --- | --- | --- |
| Metformin | `Metformin` | `Metformin` | `Metformin` | agreement, 0 disagreements | about 1.3 s |
| Amoxicillin | `Amoxicillin` | `Amoxicillin` | `Amoxicillin` | agreement, 0 disagreements | about 11.2 s |
| 5 | `5` | `5` | `5` | agreement, 0 disagreements | about 4.0 s |

These helper measurements were reported by the backend builder from live requests on the same licensed fixtures. They demonstrate a useful prompt correction on three crops, not general handwriting accuracy. The original misread and chart fabrication remain relevant failure evidence. Both comparison passes use 11B by default, so their agreement is correlated and must not be described as independent clinical verification.

A subsequent end-to-end test of the derived mixed printed/handwritten page abstained after about 11.3 seconds: the first pass returned only `Metformin.`, and the second returned descriptive prose with `Medformin.`. The API saved no record. This exposed that a prompt focused on handwriting could omit the surrounding printed date/dose/context. That result does not validate full-page extraction; the builder revised the wording to request all visible printed and handwritten text before another integration check.

The next full-page run, about 21.3 seconds, read the medicine, dose, and frequency in both passes, but the second pass regrouped the handwriting into a different section and added Markdown presentation. The comparison rejected the changed association and again saved no record. After adding presentation-only normalization and an explicit original-order instruction, the final mixed-page run still abstained after about **14.3 seconds**: the second reading again moved `Metformin` to a separate section at the end. The app did not infer its association with the printed dose. These are safe abstentions and a concrete current-model integration limitation; none counts as a successful full-page prescription extraction.

The separate **printed laboratory PNG in handwriting-comparison mode** completed the actual multipart API journey in about **37.6 seconds**. The test first confirmed rejected consent causes zero provider calls, then exercised two vision readings, extraction, validation, SQLite persistence, and pending review. Both readings agreed on the printed rows. The saved values and report-provided ranges were HbA1c `6.1%` (`4.0–5.6`), fasting glucose `112 mg/dL` (`70–99`), hemoglobin `14.2 g/dL` (`13–17`), and vitamin D `24 ng/mL` (`30–100`). Both raw readings and the comparison provenance were retained. This confirms the two-pass API path on that printed fixture; it is not evidence of full handwritten-prescription accuracy. Both tests used temporary databases and excluded real patient records.

The unchanged crops, labels, source notice, and license declaration are in `tests/fixtures/handwriting/`. The opt-in script is excluded from `npm test` and prints exact raw output, normalized exact match, edit counts, per-sample CER, and timeouts separately:

The app also includes a **derived synthetic page**, `public/samples/handwriting-demo.png`, which embeds the licensed `Metformin.png` crop among deliberately fictional typed prescription fields. It is a constructed integration fixture, not a real patient prescription or evidence of worst-case handwriting performance. The original crop attribution and publisher-declared MIT terms are preserved in `tests/fixtures/handwriting/NOTICE.md`. `tests/live-handwriting.mjs` is the separate opt-in end-to-end upload runner maintained by the backend builder.

```powershell
node scripts/benchmark-handwriting.mjs --dry-run
node --env-file-if-exists=.env scripts/benchmark-handwriting.mjs --model=meta/llama-3.2-11b-vision-instruct
node --env-file-if-exists=.env scripts/benchmark-handwriting.mjs --model=meta/llama-3.2-90b-vision-instruct
node --env-file-if-exists=.env scripts/benchmark-handwriting.mjs --compare
node --env-file-if-exists=.env tests/live-handwriting.mjs
node --env-file-if-exists=.env tests/live-handwriting.mjs --printed
```

The script uses a shared maximum 45-second budget for the entire model check and does not print credentials or provider error bodies. `--compare` runs the final application preprocessing/comparison helpers and reports first pass, second pass, consensus, disagreement status, and code hashes separately from ground-truth exact match. Its 45-second benchmark budget is deliberately shorter than the app's 120-second document budget. An alternate comparison model can be selected with `--verification-model=...`; no different verifier is recommended from the failed alternative tests. Syntax checks and dry-runs verified the script, manifest, and image hashes. The live observations above came from equivalent direct requests or the builder's helper calls rather than execution of the new script itself.

## Practical upgrade path

1. Preserve the original image. Detect rotation and text regions; retain original and processed crops because contrast/thresholding can erase decimal points or faint strokes.
2. Run the page reader; compare difficult English lines with a different recognizer. If two transformed-image passes use the same model, label this a **consistency check**, not independent verification or calibrated confidence.
3. Keep each proposed field linked to its crop and raw transcription. A drug dictionary may offer labeled candidates but must not silently replace an uncertain word. Unknown dose, decimal, route, or frequency stays unknown.
4. Show discrepancies and require review for uncertain clinical fields. Do not derive dosing advice from a guessed transcription. If the source itself is unreadable, the next step is confirmation with its prescriber/pharmacist, not another confident completion.
5. Evaluate on consented, de-identified or purpose-written prescriptions from multiple writers, with independently checked transcription. Track medicine-name exact match, dose/unit/decimal exact match, field omission, false confident substitutions, abstention, CER/WER, and latency. Keep writers and documents separated across training and evaluation.

## Dataset reuse limits

- The included tiny medical-word dataset declares MIT and original sourcing, but provides little collection/consent detail. Only the three inspected, non-identifying crops were reused; filenames supply their labels. It cannot establish performance on real clinical records.
- **IAM** is a well-documented English handwriting benchmark with writer-separated evaluation partitions, but its official terms permit **non-commercial research only** and downloads require registration. It is not prescription handwriting and is not an unrestricted fixture source for a commercial product. The TrOCR model's MIT declaration does not relicense IAM images. [10]
- Public Kaggle/Roboflow prescription collections were discoverable, but search visibility alone did not establish adequate licensing, de-identification, or collection provenance. No full clinical prescription from them was downloaded or sent to an API.

## Sources and tool provenance

All searches and webpage readings used **You.com MCP `you-search` / `you-contents` first**, through the configured local proxy. You.com supplies its own search results; no separate engine name was exposed. No SearXNG fallback was needed in this pass. Publisher Hugging Face JSON APIs were additionally read for exact licenses, ungated status, parameter metadata, and pinned revisions. Hardware came from local `nvidia-smi`; inference observations came from authenticated NVIDIA calls using the ignored server environment.

1. [PaddleOCR-VL-1.6 publisher model card](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6) and [model metadata](https://huggingface.co/api/models/PaddlePaddle/PaddleOCR-VL-1.6).
2. [PaddleOCR official repository](https://github.com/PaddlePaddle/PaddleOCR) and [Apache-2.0 license](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE).
3. [Current general OCR pipeline documentation](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html).
4. [TrOCR base handwritten model card and MIT declaration](https://huggingface.co/microsoft/trocr-base-handwritten/raw/main/README.md); [Microsoft UniLM repository license](https://github.com/microsoft/unilm/blob/master/LICENSE).
5. [Qwen3.5-4B publisher model card](https://huggingface.co/Qwen/Qwen3.5-4B) and [model metadata](https://huggingface.co/api/models/Qwen/Qwen3.5-4B).
6. [Qwen3-VL official repository and OCR capabilities](https://github.com/QwenLM/Qwen3-VL); [4B model metadata](https://huggingface.co/api/models/Qwen/Qwen3-VL-4B-Instruct).
7. [NVIDIA Llama Vision model card](https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-90b-vision-instruct). Prior successful payload verification and language scope are also recorded in `docs/research.md`.
8. [PaddleOCR Blackwell guide](http://www.paddleocr.ai/main/en/version3.x/pipeline_usage/PaddleOCR-VL-NVIDIA-Blackwell.html) and [RTX50 environment guide including Windows](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL-RTX50.html). These setup details were retrieved as official-page search excerpts; local installation was not attempted.
9. [Pinned medical-word dataset card](https://huggingface.co/datasets/avi-kai/Medical_Prescription_Handwritten_Words/blob/12f818c87b7f9727d544cbede77a03bb9b42ea61/README.md).
10. [IAM official description, partitions, and terms](https://fki.tic.heia-fr.ch/databases/iam-handwriting-database).
11. [NVIDIA Gemma 4 31B model card](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it) and [request reference](https://docs.api.nvidia.com/nim/reference/google-gemma-4-31b-it-infer), found and read with You.com before testing. Broad multilingual support is not evidence of Hindi prescription-handwriting accuracy.
