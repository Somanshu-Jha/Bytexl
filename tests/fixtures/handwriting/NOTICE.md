# Handwriting fixture source and permission

These three isolated crops come from **avi-kai / Medical Prescription Handwritten Words**, published on Hugging Face. The publisher declares **MIT** and `source_datasets: [original]` in its dataset card. No separate LICENSE file or copyright year is supplied in the pinned dataset repository; attribution is preserved here without inventing one.

- Publisher: [avi-kai](https://huggingface.co/avi-kai)
- [Dataset card at the pinned revision](https://huggingface.co/datasets/avi-kai/Medical_Prescription_Handwritten_Words/blob/12f818c87b7f9727d544cbede77a03bb9b42ea61/README.md)
- Revision: `12f818c87b7f9727d544cbede77a03bb9b42ea61`
- Original directory: `Prescription_Content/images/`
- Unmodified files: `Amoxicillin.png`, `Metformin.png`, `5.png`
- Retrieved and visually inspected: 14 October 2026. The selected crops contain only an isolated medicine name or digit, with no visible patient, clinician, facility, or contact identifiers.
- Ground truth comes from the publisher's image filenames. These three labels were also visually checked; no independent clinical annotation is claimed.

This deliberately small fixture tests execution and exposes individual recognition errors. It is not representative of full prescriptions, handwriting difficulty, multiple writers, drug/dose combinations, Hindi, or clinical deployment. A pass is not a claim of perfect OCR. The original dataset card does not establish detailed consent/collection provenance; do not generalize this fixture's reuse assessment to arbitrary clinical images or the entire dataset.

## Derived demonstration image

`public/samples/handwriting-demo.png` embeds the `Metformin.png` crop in a constructed prescription page with fictional typed patient, date, provider, and medication instruction fields. The page is labeled synthetic. The embedded handwriting remains attributed to avi-kai and retains the publisher-declared MIT terms below. The surrounding layout and fictional text are prototype demonstration content. This derived page must not be presented as a real patient's prescription or a representative difficult-handwriting evaluation set.

## MIT license terms

The dataset publisher declares the MIT license. The corresponding terms are reproduced below; source attribution appears above.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
