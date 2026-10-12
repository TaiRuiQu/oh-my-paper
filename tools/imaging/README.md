# Imaging tools

`src/server/exams/documents.ts` validates input bytes, renders PDF pages with Poppler and normalizes JPEG/PNG inputs with Sharp. This preparation does not perform question recognition.

The recognition Agent chooses `inspect_image` regions and operations itself. `image_tool.py` uses Pillow for crop/autocontrast/sharpen and OpenCV for adaptive thresholding. Install `requirements.txt` in the project's virtual environment; configure `PYTHON_PATH` for Web/Worker/CLI. Docker workers install the distribution's Pillow/OpenCV packages and use `/usr/bin/python3`.

Only server-validated page paths, crop coordinates, operation names and generated destination paths reach Python. Model-generated code is never executed. Enhanced views are reading aids; saved question/figure/answer evidence always comes from original normalized pages. Rotation is an explicit Agent tool; Tesseract orientation detection is available through its `auto` option.

Configure `PDFINFO_PATH`, `PDFTOPPM_PATH` and `PDFTOTEXT_PATH` as needed. Perspective correction and reconstruction of contaminated diagrams are not currently implemented.

The optional `read_text` tool invokes Tesseract with `chi_sim+eng` on an agent-selected region. Install Chinese and English language data (Docker includes `tesseract-ocr-chi-sim`), or point `TESSERACT_DATA_PATH` at their directory. OCR text remains untrusted evidence and must be checked against the returned source crop.
