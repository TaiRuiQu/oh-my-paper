# Imaging tools

Exam normalization is implemented in `src/server/exams/documents.ts`: Poppler renders PDFs and supplies text hints, while Sharp rotates, scales, tiles and crops images. Configure `PDFINFO_PATH`, `PDFTOPPM_PATH` and `PDFTOTEXT_PATH` as needed. Perspective correction and reconstruction of contaminated diagrams are not implemented.
