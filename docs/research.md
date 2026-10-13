# Integration research and live verification

Checked on **13 October 2026** for the Health Copilot prototype. Research used **You.com MCP `you-search` and `you-contents` first**. After `you-contents` returned a socket error for several pages, the configured local `websearch_patch` MCP `get_webpage_content` tool was used for those pages. No SearXNG search was needed. Hosted model behavior below was verified directly against NVIDIA's API using the server-side credential; credentials and account identifiers are intentionally excluded.

## Recommended model routing

| Stage | Exact hosted model ID | Live result |
| --- | --- | --- |
| Image transcription | `meta/llama-3.2-11b-vision-instruct` | Read the synthetic lab image correctly in approximately 14 seconds. |
| Structured extraction and record summaries | `nvidia/nemotron-3-super-120b-a12b` | Returned valid JSON with exact source values. Both JSON object and a small strict JSON schema request worked. |
| English record questions | `nvidia/nemotron-3.5-lightning-30b-a3b` | Produced a concise, cautious explanation in approximately 1.5 seconds. |
| Hindi translation | `nvidia/nemotron-3-super-120b-a12b` | Produced Devanagari Hindi while preserving all supplied numerical values in approximately 0.9 seconds. |

These are single smoke-test observations, not latency benchmarks or clinical accuracy measurements. Hosted availability and latency can change.

All successful tests used:

```text
POST https://integrate.api.nvidia.com/v1/chat/completions
Authorization: Bearer <server-side NVIDIA_API_KEY>
Content-Type: application/json
```

For text generation, `temperature: 0` or `0.1`, `stream: false`, and explicit `max_tokens` were accepted. Super and Lightning accepted `chat_template_kwargs: { "enable_thinking": false }`; the tested responses then reported zero reasoning tokens. Use adequate output-token limits for real records, inspect `finish_reason`, validate the resulting schema, and reject partial or ungrounded output.

## Image payload verified

The source was a locally generated **synthetic** 1200 × 650 PNG, about 23 KB. The successful request sent OCR instructions and the image in one `user` message. The image did not leave the machine except for the authorized NVIDIA inference request.

```json
{
  "model": "meta/llama-3.2-11b-vision-instruct",
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "Transcribe all text exactly as written. Preserve numerical values, units, dates, and medicine dosages. Do not infer. Output text only."
      },
      {
        "type": "image_url",
        "image_url": { "url": "data:image/png;base64,<encoded-image>" }
      }
    ]
  }],
  "max_tokens": 500,
  "temperature": 0,
  "stream": false
}
```

The response preserved every requested field in this small fixture:

| Printed fixture field | Returned transcription |
| --- | --- |
| Date | `2026-10-10` |
| HbA1c | `7.2%` |
| HbA1c report reference | `4.0 - 5.6%` |
| Hemoglobin | `12.8 g/dL` |
| Hemoglobin report reference | `12.0 - 15.5` |
| Prescription | `Metformin 500 mg twice daily` |

This test covers clean printed English text only. It does **not** establish accuracy on handwriting, bilingual documents, low-resolution scans, multi-page documents, or real medical records. Those inputs need review and a larger evaluation set. PDF text extraction or page rasterization happens before this request; the vision call does not take an arbitrary PDF blob.

The NVIDIA Llama Vision API documentation describes `content` arrays containing `text` and `image_url` parts, including base64 data URIs. Its model card states that image-plus-text applications officially support English; supported text-only languages include Hindi. The prototype therefore must distinguish tested Hindi summaries from unvalidated bilingual OCR.

## Structured extraction verified

With source text `HbA1c 7.2 percent; reference 4.0-5.6`, Super returned:

```json
{"test":"HbA1c","value":7.2,"unit":"percent","reference":"4.0-5.6"}
```

`response_format: { "type": "json_object" }` worked. A second request also accepted this strict schema shape and returned matching JSON:

```json
{
  "type": "json_schema",
  "json_schema": {
    "name": "test_record",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "test": { "type": "string" },
        "value": { "type": "number" },
        "unit": { "type": "string" }
      },
      "required": ["test", "value", "unit"],
      "additionalProperties": false
    }
  }
}
```

A small schema success does not prove support for every JSON Schema keyword. Application validation and source evidence remain necessary. Syntax constraints cannot guarantee factual correctness.

## Hindi and explanation checks

Super received a dedicated translation system instruction: `Translate English into Hindi using Devanagari script. Output ONLY Hindi translation. Keep numerical values unchanged.` For the supplied English explanation it returned:

> आपका HbA1c 7.2% है, जो रिपोर्ट के संदर्भ सीमा 4.0-5.6% से अधिक है। कृपया इस परिणाम के बारे में अपने चिकित्सक से चर्चा करें।

The numbers matched the source. This is a functional language smoke test, not review by a medical Hindi translator.

Lightning produced this English response to the same source facts:

> HbA1c 7.2% is higher than the report range of 4.0-5.6%. Please discuss this result with your clinician.

Lightning's first request to explain in Hindi returned English. The tested generic chat prompt for `nvidia/riva-translate-4b-instruct-v2` returned another language. Neither result supports using those tested prompts for the Hindi path; Super is the verified choice.

## Availability findings that changed the design

NVIDIA's unauthenticated `GET https://integrate.api.nvidia.com/v1/models` was useful for discovery but did not guarantee that every listed model could serve this account.

| Model tested | Observed outcome |
| --- | --- |
| `meta/llama-3.3-70b-instruct` | HTTP 410; API reported end of life on 26 August 2026. |
| `nvidia/nemotron-3-nano-30b-a3b` | HTTP 410; API reported end of life on 1 September 2026. |
| `nvidia/nemotron-nano-3-30b-a3b` | Listed in model catalog, but HTTP 404 function unavailable for this account. |
| `nvidia/llama-3.1-nemotron-70b-instruct` | HTTP 404 function unavailable for this account. |
| `writer/palmyra-med-70b` | HTTP 404 function unavailable for this account. |
| `meta/llama-3.2-90b-vision-instruct` | Synthetic image request exceeded the 55-second smoke-test timeout. This does not prove permanent unavailability. |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | HTTP 503; provider reported worker capacity exhausted. |
| `nvidia/nemotron-parse-2.0` | Returned unusable text and reached the token limit with the generic OCR prompt. A dedicated task format requires further investigation. |

The working defaults above are based on real requests rather than assuming old examples or catalog presence imply availability. Do not silently display synthetic answers as live AI results when an upstream request fails.

## ABDM and FHIR scope

The NRCeS FHIR Implementation Guide for ABDM pages currently identify version **6.5.0** and FHIR **R4 / 4.0.1**. The `DiagnosticReportRecord` profile describes a `Composition` with clinical attestation and mandatory core elements, vocabularies, and value sets. It points to LOINC for diagnostic measurements, tests, panels, and observations. `PrescriptionRecord` describes medication advice.

The prototype uses a FHIR-style collection with linked patient, document, observation, medication, and diagnostic-report concepts. That is a useful schema foundation. A collection Bundle alone is **not** conformance to an ABDM document profile. The mock ABHA interaction is a demo only; the prototype is not certified, validated against the complete ABDM profiles, or connected to production ABHA services. Real integration would additionally require conformant document Bundles/Composition, terminology validation, applicable identity and consent flows, and interoperability testing.

## Sources and retrieval provenance

1. [NVIDIA Llama 3.2 Vision API request reference](https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-90b-vision-instruct-infer) — found and read using You.com MCP. Documents image payload structure and request options. The model route in the page's example differs from the common route successfully tested here.
2. [NVIDIA Llama 3.2 Vision model card](https://docs.api.nvidia.com/nim/reference/meta-llama-3_2-90b-vision-instruct) — found and read using You.com MCP. Documents image/text scope and the language limitation.
3. [NVIDIA Nemotron Super model card](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b) — found with You.com search; content fallback after You.com socket errors returned a navigation-heavy excerpt. Integration claims in this document rely on actual API tests, not that truncated excerpt.
4. [NVIDIA Nemotron 3.5 Lightning model card](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-5-lightning-30b-a3b) — found with You.com search; content fallback after You.com socket errors returned a navigation-heavy excerpt. Actual response behavior was smoke-tested separately.
5. [NVIDIA NeMo Retriever Parse request reference](https://docs.api.nvidia.com/nim/reference/nvidia-nemoretriever-parse-infer) and [Nemotron Parse 2.0 catalog](https://build.nvidia.com/nvidia/nemotron-parse-2.0) — read using You.com MCP. Evaluated as alternatives; not selected based on the failed generic-prompt test.
6. [ABDM DiagnosticReportRecord](https://nrces.in/ndhm/fhir/r4/StructureDefinition-DiagnosticReportRecord.html) — found by You.com search and read with configured `websearch_patch/get_webpage_content` after a You.com socket error; the excerpt included the profile description and Composition requirement.
7. [ABDM PrescriptionRecord](https://www.nrces.in/ndhm/fhir/r4/StructureDefinition-PrescriptionRecord.html) — found using You.com search; its search excerpt describes the medication-advice scope. Full content was not retrieved successfully in this pass.
8. [NVIDIA hosted model catalog endpoint](https://integrate.api.nvidia.com/v1/models) — direct read-only API discovery followed by authenticated inference smoke tests.

