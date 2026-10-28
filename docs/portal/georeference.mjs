import { PDFArray, PDFDict, PDFName } from './vendor/pdf-lib.mjs';
import { makeModel, validCoordinate } from './core.mjs';
import { identifyMapCRS, gridCRS, automaticZone, fromWGS84, toWGS84 } from './coordinates.mjs';

const lookup=(dict,key)=>dict?.lookup?.(PDFName.of(key));
function numbers(obj){
  if(!(obj instanceof PDFArray))return null;
  const result=Array.from({length:obj.size()},(_,i)=>obj.lookup(i)?.asNumber?.());
  return result.every(Number.isFinite)?result:null;
}
const string=o=>o?.decodeText?.()||'';

export function geoPDFRegions(document,index){
  if(!document)return {regions:[],message:'GeoPDF metadata could not be read. Add reference points to align this page.'};
  const page=document.getPages()[index],vp=lookup(page?.node,'VP');
  const entries=vp instanceof PDFArray?Array.from({length:vp.size()},(_,i)=>vp.lookup(i)):vp instanceof PDFDict?[vp]:[];
  const regions=[];let unsupported='';
  for(const [viewportIndex,entry] of entries.entries()){
    try{
      const measure=lookup(entry,'Measure'),gcs=lookup(measure,'GCS');
      if(!(measure instanceof PDFDict)||lookup(measure,'Subtype')?.asString?.()!=='/GEO')continue;
      const gpts=numbers(lookup(measure,'GPTS')),lpts=numbers(lookup(measure,'LPTS')),rawBox=numbers(lookup(entry,'BBox'));
      if(!gpts||!lpts||gpts.length!==lpts.length||gpts.length<8||gpts.length%2||rawBox?.length!==4||rawBox[0]===rawBox[2]||rawBox[1]===rawBox[3]||lpts.some(n=>n<0||n>1))continue;
      const epsg=lookup(gcs,'EPSG')?.asNumber?.()||Number(string(lookup(gcs,'EPSG')));
      const source=identifyMapCRS(epsg,string(lookup(gcs,'WKT')));
      if(!source){unsupported=`This GeoPDF's datum (${epsg?`EPSG:${epsg}`:'unrecognised'}) needs WGS84 reference points.`;continue;}
      // Esri ArcMap can write [left, top, right, bottom]. Preserve that signed
      // mapping of LPTS -> page coordinates; normalise only the fit's domain.
      const toPage=(x,y)=>[rawBox[0]+x*(rawBox[2]-rawBox[0]),rawBox[1]+y*(rawBox[3]-rawBox[1])];
      const box=[Math.min(rawBox[0],rawBox[2]),Math.min(rawBox[1],rawBox[3]),Math.max(rawBox[0],rawBox[2]),Math.max(rawBox[1],rawBox[3])];
      const anchors=[];
      for(let i=0;i<gpts.length;i+=2){const[x,y]=toPage(lpts[i],lpts[i+1]);anchors.push({x,y,latitude:gpts[i],longitude:gpts[i+1]});}
      if(!anchors.every(validCoordinate))continue;
      const bounds=numbers(lookup(measure,'Bounds'))||[0,0,0,1,1,1,1,0];
      if(bounds.length<6||bounds.length%2||bounds.some(n=>n<0||n>1))continue;
      const footprint=[];for(let i=0;i<bounds.length;i+=2)footprint.push(toPage(bounds[i],bounds[i+1]));
      const native=makeModel(anchors,box,true,footprint);
      if(native.rmsMetres>10){unsupported='The GeoPDF control points do not fit a reliable bilinear alignment. Add WGS84 reference points.';continue;}
      let crs=source.crs;
      if(!crs){const centre=native.toGeo((box[0]+box[2])/2,(box[1]+box[3])/2);try{crs=gridCRS(source.datum,automaticZone(centre.latitude,centre.longitude),centre.latitude>=0);}catch{}}
      const model={...native,sourceDatum:source.datum,
        toSourceGeo:(x,y)=>native.toGeo(x,y),
        toGeo:(x,y)=>toWGS84(native.toGeo(x,y),source.datum),
        toPDF:(latitude,longitude)=>{const point=fromWGS84({latitude,longitude},source.datum);return native.toPDF(point.latitude,point.longitude);}
      };
      regions.push({name:string(lookup(entry,'Name'))||`GeoPDF region ${regions.length+1}`,model,crs,source:`${source.datumLabel} GeoPDF`,note:source.note,viewportIndex});
    }catch{/* Invalid metadata never prevents opening the PDF itself. */}
  }
  return {regions,message:regions.length?'':unsupported||'No supported GeoPDF alignment on this page. Pick at least three reference points.'};
}
