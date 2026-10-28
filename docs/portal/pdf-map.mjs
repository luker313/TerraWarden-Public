import * as pdfjs from './vendor/pdf.min.mjs';
import { PDFDocument, PDFArray, PDFDict, PDFName } from './vendor/pdf-lib.mjs';
import { makeModel, validCoordinate } from './core.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const asset = (name) => new URL(`./vendor/${name}/`, import.meta.url).href;
export async function openPDF(bytes) {
  const task = pdfjs.getDocument({ data:bytes.slice(), cMapUrl:asset('cmaps'), cMapPacked:true, standardFontDataUrl:asset('standard_fonts'), wasmUrl:asset('wasm'), isEvalSupported:false, enableXfa:false });
  const pdf = await task.promise;
  let metadata;
  try { metadata = await PDFDocument.load(bytes, { updateMetadata:false }); } catch { metadata = null; }
  return { pdf, metadata };
}
const lookup = (dict, key) => dict?.lookup?.(PDFName.of(key));
function numbers(obj) {
  if (!(obj instanceof PDFArray)) return null;
  const result = Array.from({length:obj.size()}, (_,i) => obj.lookup(i)?.asNumber?.());
  return result.every(Number.isFinite) ? result : null;
}
const string = (o) => o?.decodeText?.() || '';
export function geoPDFRegions(document, index) {
  if (!document) return { regions:[], message:'GeoPDF metadata could not be read. Add reference points to align this page.' };
  const page = document.getPages()[index];
  const vp = lookup(page.node,'VP');
  const entries = vp instanceof PDFArray ? Array.from({length:vp.size()},(_,i)=>vp.lookup(i)) : vp instanceof PDFDict ? [vp] : [];
  const regions = []; let unsupported = '';
  for (const entry of entries) {
    try {
      const measure = lookup(entry,'Measure'), gcs = lookup(measure,'GCS');
      if (!(measure instanceof PDFDict) || lookup(measure,'Subtype')?.asString?.() !== '/GEO') continue;
      const gpts = numbers(lookup(measure,'GPTS')), lpts = numbers(lookup(measure,'LPTS')), box = numbers(lookup(entry,'BBox'));
      if (!gpts || !lpts || gpts.length !== lpts.length || gpts.length < 8 || gpts.length % 2 || box?.length !== 4 || lpts.some(n=>n<0||n>1)) continue;
      const epsg = lookup(gcs,'EPSG')?.asNumber?.() || Number(string(lookup(gcs,'EPSG')));
      const wkt = string(lookup(gcs,'WKT'));
      // GPTS always uses geographic lat/lon, including projected WGS84 GCSs.
      // Other datums need a real transformation; do not relabel them WGS84.
      const wgs84 = [4326,4979,3857].includes(epsg) || (epsg>=32601&&epsg<=32660) || (epsg>=32701&&epsg<=32760) || (!epsg && /(?:DATUM|ENSEMBLE)\s*\[\s*"(?:WGS_?1984|World Geodetic System 1984)/i.test(wkt));
      if (!wgs84) { unsupported = `This GeoPDF's datum (${epsg ? `EPSG:${epsg}` : 'unrecognised'}) needs WGS84 reference points in this starter.`; continue; }
      const anchors = [];
      for(let i=0;i<gpts.length;i+=2) anchors.push({x:box[0]+lpts[i]*(box[2]-box[0]), y:box[1]+lpts[i+1]*(box[3]-box[1]), latitude:gpts[i],longitude:gpts[i+1]});
      if (!anchors.every(validCoordinate)) continue;
      const bounds = numbers(lookup(measure,'Bounds')) || [0,0,0,1,1,1,1,0];
      const footprint=[];
      for(let i=0;i<bounds.length-1;i+=2) footprint.push([box[0]+bounds[i]*(box[2]-box[0]),box[1]+bounds[i+1]*(box[3]-box[1])]);
      const model=makeModel(anchors,box,true,footprint);
      if(model.rmsMetres>10) { unsupported='The GeoPDF control points do not fit a reliable bilinear alignment. Add WGS84 reference points.'; continue; }
      regions.push({name:string(lookup(entry,'Name'))||`GeoPDF region ${regions.length+1}`,model,source:'WGS84 GeoPDF'});
    } catch { /* An invalid region never prevents opening the PDF itself. */ }
  }
  return {regions,message:regions.length ? '' : unsupported || 'No supported GeoPDF alignment on this page. Pick at least three reference points.'};
}
