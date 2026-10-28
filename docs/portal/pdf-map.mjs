import * as pdfjs from './vendor/pdf.min.mjs';
import { PDFDocument } from './vendor/pdf-lib.mjs';
export { geoPDFRegions } from './georeference.mjs?v=20261028.3';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const asset = (name) => new URL(`./vendor/${name}/`, import.meta.url).href;
export async function openPDF(bytes) {
  const task = pdfjs.getDocument({ data:bytes.slice(), cMapUrl:asset('cmaps'), cMapPacked:true, standardFontDataUrl:asset('standard_fonts'), wasmUrl:asset('wasm'), isEvalSupported:false, enableXfa:false });
  const pdf = await task.promise;
  let metadata;
  try { metadata = await PDFDocument.load(bytes, { updateMetadata:false }); } catch { metadata = null; }
  return { pdf, metadata };
}
