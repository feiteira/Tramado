// pdf.js's worker module has no type declarations; extract.worker.ts only hands it to pdf.js.
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}
