import {
  PDFDocument,PDFPage,PDFObjectCopier,PDFName,PDFString,PDFArray,PDFDict,
  rgb,degrees,LineCapStyle,LineJoinStyle,TextRenderingMode,
  pushGraphicsState,popGraphicsState,moveTo,lineTo,closePath,clip,endPath,
  setStrokingColor,setFillingColor,setLineWidth,setLineCap,setLineJoin,
  setDashPattern,stroke,beginText,endText,setFontAndSize,setTextMatrix,
  setTextRenderingMode,showText
} from './vendor/pdf-lib.mjs';
import fontkit from './vendor/fontkit.mjs';
import {inPolygon,validCoordinate} from './core.mjs';
import {geoPDFRegions} from './georeference.mjs?v=20261028.3';
import {filterFeatures} from './feature-visibility.mjs';

const name=PDFName.of,white=rgb(1,1,1),ink=rgb(52/255,75/255,44/255);
const colour=hex=>/^#[a-f\d]{6}$/i.test(hex||'')?rgb(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)):ink;
const near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7;
const checkAbort=signal=>{if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');};

// Clip the footprint to the PDF's visible CropBox, including shifted origins.
export function clipFootprint(polygon,box) {
  let result=polygon.map(p=>[...p]);
  for(const [axis,edge,direction] of [[0,box[0],1],[0,box[2],-1],[1,box[1],1],[1,box[3],-1]]) {
    const input=result;result=[];
    for(let i=0;i<input.length;i++) {
      const a=input[i],b=input[(i+1)%input.length],insideA=(a[axis]-edge)*direction>=-1e-9,insideB=(b[axis]-edge)*direction>=-1e-9;
      if(insideA)result.push(a);
      if(insideA!==insideB) {
        const t=(edge-a[axis])/(b[axis]-a[axis]);
        result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
      }
    }
    if(!result.length)break;
  }
  return result;
}

// Retain only the portions actually visible in the map footprint; the PDF
// does not carry the rest of a route concealed behind a clipping path.
export function clipPolyline(points,polygon) {
  const paths=[];let last=null;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i];
    if(!a||!b){last=null;continue;}
    const dx=b[0]-a[0],dy=b[1]-a[1],cuts=[0,1];
    if(Math.hypot(dx,dy)<1e-10)continue;
    for(let j=0;j<polygon.length;j++) {
      const c=polygon[j],d=polygon[(j+1)%polygon.length],ex=d[0]-c[0],ey=d[1]-c[1],det=dx*ey-dy*ex;
      if(Math.abs(det)<1e-12)continue;
      const cx=c[0]-a[0],cy=c[1]-a[1],t=(cx*ey-cy*ex)/det,u=(cx*dy-cy*dx)/det;
      if(t>0&&t<1&&u>=-1e-9&&u<=1+1e-9)cuts.push(t);
    }
    cuts.sort((x,y)=>x-y);
    for(let j=1;j<cuts.length;j++) {
      const lo=cuts[j-1],hi=cuts[j];if(hi-lo<1e-10)continue;
      const mid=(lo+hi)/2;
      if(!inPolygon([a[0]+dx*mid,a[1]+dy*mid],polygon)){last=null;continue;}
      const p=[a[0]+dx*lo,a[1]+dy*lo],q=[a[0]+dx*hi,a[1]+dy*hi];
      if(last&&near(last.at(-1),p))last.push(q);else{last=[p,q];paths.push(last);}
    }
  }
  return paths;
}

function manualViewport(document,model) {
  const c=document.context,b=model.box;
  const local=[0,0,0,1,1,1,1,0],geographic=[];
  for(let i=0;i<local.length;i+=2) {
    const p=model.toGeo(b[0]+local[i]*(b[2]-b[0]),b[1]+local[i+1]*(b[3]-b[1]));
    if(!validCoordinate(p))throw new Error('The map alignment cannot be represented as a GeoPDF.');
    geographic.push(p.latitude,p.longitude);
  }
  const polygon=model.footprint||[[b[0],b[1]],[b[0],b[3]],[b[2],b[3]],[b[2],b[1]]];
  const bounds=polygon.flatMap(([x,y])=>[(x-b[0])/(b[2]-b[0]),(y-b[1])/(b[3]-b[1])]);
  const wkt='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';
  const measure=c.obj({Type:name('Measure'),Subtype:name('GEO'),Bounds:bounds,LPTS:local,GPTS:geographic,GCS:c.register(c.obj({Type:name('GEOGCS'),EPSG:4326,WKT:PDFString.of(wkt)}))});
  return c.obj([c.register(c.obj({Type:name('Viewport'),Name:PDFString.of('TerraWarden map alignment'),BBox:b,Measure:c.register(measure)}))]);
}

function clipOperators(polygon,origin) {
  return [moveTo(polygon[0][0]-origin.x,polygon[0][1]-origin.y),...polygon.slice(1).map(p=>lineTo(p[0]-origin.x,p[1]-origin.y)),closePath(),clip(),endPath()];
}
function pathOperators(paths,origin) {
  return paths.flatMap(path=>[moveTo(path[0][0]-origin.x,path[0][1]-origin.y),...path.slice(1).map(p=>lineTo(p[0]-origin.x,p[1]-origin.y))]);
}

// The viewport already includes page rotation, CropBox offset and UserUnit.
// Rotate labels around their pin in screen space, then convert back to PDF.
export function exportLabelPlacement(point,viewport,scale,angle) {
  const [x,y]=viewport.convertToViewportPoint(...point),a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const anchor=viewport.convertToPdfPoint(x+(10*c-3*s)/scale,y+(10*s+3*c)/scale);
  const end=viewport.convertToPdfPoint(x+c,y+s),base=viewport.convertToPdfPoint(x,y);
  return {point:anchor,angle:Math.atan2(end[1]-base[1],end[0]-base[0])};
}

async function drawLabel(page,font,fontKey,text,placement,size,halo,origin,rasterizeLabel) {
  const supported=new Set(font.getCharacterSet());
  if([...text].some(char=>!supported.has(char.codePointAt(0)))) {
    if(!rasterizeLabel)throw new Error('A pin label needs the browser font fallback. Export this map from the Web Portal.');
    const image=await rasterizeLabel(text,size,halo),embedded=await page.doc.embedPng(image.bytes),a=placement.angle;
    const x=placement.point[0]-origin.x+image.left*Math.cos(a)-image.bottom*Math.sin(a);
    const y=placement.point[1]-origin.y+image.left*Math.sin(a)+image.bottom*Math.cos(a);
    page.drawImage(embedded,{x,y,width:image.width,height:image.height,rotate:degrees(a*180/Math.PI)});
    return;
  }
  const a=placement.angle,matrix=[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),placement.point[0]-origin.x,placement.point[1]-origin.y];
  const encoded=font.encodeText(text);
  page.pushOperators(pushGraphicsState(),setLineWidth(halo*2),setLineJoin(LineJoinStyle.Round),setStrokingColor(white),setFillingColor(ink),beginText(),setFontAndSize(fontKey,size),setTextMatrix(...matrix),setTextRenderingMode(TextRenderingMode.Outline),showText(encoded),setTextMatrix(...matrix),setTextRenderingMode(TextRenderingMode.Fill),showText(encoded),endText(),popGraphicsState());
}

export function geoPDFFilename(filename,pageNumber) {
  const base=String(filename||'TerraWarden map').replace(/\.pdf$/i,'').replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').trim().slice(0,120)||'TerraWarden map';
  return `${base}-page-${pageNumber}-web-geopdf.pdf`;
}

export async function exportGeoPDF({source,pageIndex=0,model,pageBox,viewport,features=[],hidden=new Set(),search='',opacity=1,labelAngle=0,scale=1,sourceRegion=0,usePDFAlignment=true,fontBytes,rasterizeLabel,signal,title='TerraWarden map'}) {
  if(!source||!model||!viewport||!pageBox)throw new Error('Open and align the PDF before exporting a GeoPDF.');
  if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(opacity)||opacity<0||opacity>1||!Number.isFinite(labelAngle))throw new Error('The map display settings are invalid.');
  checkAbort(signal);
  const sourcePage=source.getPages()[pageIndex];if(!sourcePage)throw new Error('This PDF page is unavailable.');
  const document=await PDFDocument.create(),copier=PDFObjectCopier.for(source.context,document.context);
  const leaf=copier.copy(sourcePage.node),page=PDFPage.of(leaf,document.context.register(leaf),document);document.addPage(page);
  // The same copier preserves the relationship between existing OCG resources
  // and the catalog's visibility settings without copying other PDF pages.
  for(const key of ['OCProperties','Extensions']) {
    const value=source.catalog.get(name(key));if(value)document.catalog.set(name(key),copier.copy(value));
  }
  if(usePDFAlignment) {
    const region=geoPDFRegions(source,pageIndex).regions[sourceRegion];
    const vp=sourcePage.node.lookup(name('VP'));
    const entry=vp instanceof PDFArray?vp.lookup(region?.viewportIndex):vp;
    if(!region||!(entry instanceof PDFDict))throw new Error('The selected GeoPDF alignment is unavailable.');
    page.node.set(name('VP'),document.context.obj([copier.copy(entry)]));
  } else page.node.set(name('VP'),manualViewport(document,model));
  page.node.delete(name('LGIDict'));
  let extensions=document.catalog.lookup(name('Extensions'));
  if(!(extensions instanceof PDFDict)){extensions=document.context.obj({});document.catalog.set(name('Extensions'),extensions);}
  const existing=extensions.lookup(name('ADBE'));
  if(!(existing instanceof PDFDict)||!(existing.lookup(name('ExtensionLevel'))?.asNumber?.()>=3))extensions.set(name('ADBE'),document.context.obj({BaseVersion:name('1.7'),ExtensionLevel:3}));

  const b=model.box,footprint=clipFootprint(model.footprint||[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]],pageBox);
  if(footprint.length<3)throw new Error('The alignment does not cover this PDF page.');
  const selected=filterFeatures(features,{hidden,search}),pins=[],routes=[];
  for(const feature of selected) {
    if(feature.type==='pin') {
      const point=model.toPDF(feature.latitude,feature.longitude);
      if(point?.every(Number.isFinite)&&inPolygon(point,footprint))pins.push({feature,point});
    } else {
      const paths=(feature.segments||[]).flatMap(segment=>clipPolyline(segment.points.map(p=>model.toPDF(p.latitude,p.longitude)),footprint));
      if(paths.length)routes.push({feature,paths});
    }
  }
  checkAbort(signal);
  const origin=page.getMediaBox(),overlayDocument=await PDFDocument.create(),overlay=overlayDocument.addPage([origin.width,origin.height]);
  overlay.pushOperators(pushGraphicsState(),...clipOperators(footprint,origin));
  const units=scale*Math.hypot(viewport.transform[0],viewport.transform[1]);
  for(const {feature,paths} of [...routes].reverse()) {
    const width=(feature.drawingAppearance?.lineWidth==='thin'?2:feature.drawingAppearance?.lineWidth==='thick'?6:3)/units;
    const dash=feature.drawingAppearance?.lineStyle==='dashed'?[8/units,6/units]:feature.drawingAppearance?.lineStyle==='dotted'?[1/units,5/units]:[];
    const path=pathOperators(paths,origin),halo=feature.color==='#ffffff'?colour('#29402f'):white;
    overlay.pushOperators(pushGraphicsState(),setLineCap(LineCapStyle.Round),setLineJoin(LineJoinStyle.Round),setStrokingColor(halo),setLineWidth(width+3/units),setDashPattern([],0),...path,stroke(),setStrokingColor(colour(feature.color)),setLineWidth(width),setDashPattern(dash,0),...path,stroke(),popGraphicsState());
    checkAbort(signal);
  }
  let font,fontKey;
  if(pins.length&&scale>.3) {
    if(!fontBytes) {
      const response=await fetch(new URL('./vendor/standard_fonts/LiberationSans-Regular.ttf',import.meta.url),{signal});
      if(!response.ok)throw new Error('The PDF export font could not be loaded. Try again.');
      fontBytes=await response.arrayBuffer();
    }
    overlayDocument.registerFontkit(fontkit);font=await overlayDocument.embedFont(fontBytes,{subset:true});
    fontKey=overlay.node.newFontDictionary(font.name,font.ref);
  }
  for(const {feature,point} of pins) {
    const x=point[0]-origin.x,y=point[1]-origin.y;
    overlay.drawCircle({x,y,size:8/units,color:white,opacity:.7});
    overlay.drawCircle({x,y,size:5/units,color:colour(feature.color),borderColor:white,borderWidth:1.8/units});
    if(font) {
      const label=feature.name.length>35?feature.name.slice(0,33)+'…':feature.name;
      await drawLabel(overlay,font,fontKey,label,exportLabelPlacement(point,viewport,scale,labelAngle),10/units,1.25/units,origin,rasterizeLabel);
    }
    checkAbort(signal);
  }
  overlay.pushOperators(popGraphicsState());
  if((pins.length||routes.length)&&opacity>0) {
    // A transparency group composites opacity once, matching the SVG overlay.
    await overlayDocument.flush();
    const embedded=await document.embedPage(overlay);await embedded.embed();
    document.context.lookup(embedded.ref).dict.set(name('Group'),document.context.obj({S:name('Transparency'),I:true,K:false}));
    page.drawPage(embedded,{x:origin.x,y:origin.y,opacity});
  }
  document.setTitle(`${title} - TerraWarden Web Portal`);document.setCreator('TerraWarden Web Portal');document.setProducer('TerraWarden Web Portal / pdf-lib');
  document.setSubject('Current PDF page with the visible shared layers. Original artwork and georeferencing retained.');
  document.setKeywords(['TerraWarden','Web Portal','GeoPDF']);
  checkAbort(signal);const bytes=await document.save({useObjectStreams:true,addDefaultPage:false});
  // Check that the selected geographic alignment survives writing, not just
  // that a normal PDF viewer can display the file.
  const verified=await PDFDocument.load(bytes,{updateMetadata:false}),roundtrip=geoPDFRegions(verified,0).regions[0];
  if(!roundtrip)throw new Error('The exported geographic alignment failed validation. No file was downloaded.');
  for(const point of [...footprint,[(b[0]+b[2])/2,(b[1]+b[3])/2]]) {
    const geo=model.toGeo(...point),p=roundtrip.model.toPDF(geo.latitude,geo.longitude);
    if(!p||Math.hypot(p[0]-point[0],p[1]-point[1])>.01)throw new Error('The exported map alignment did not round-trip. No file was downloaded.');
  }
  checkAbort(signal);return {bytes,pinCount:pins.length,routeCount:routes.length};
}

// Browser font fallback retains labels outside Liberation Sans's repertoire
// (for example emoji/CJK) at up to 600 dpi; all other labels remain PDF text.
export async function rasterizeExportLabel(text,size,halo) {
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
  const font=`550 ${size}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
  context.font=font;const measure=context.measureText(text),padding=halo+1;
  const left=Math.max(0,measure.actualBoundingBoxLeft||0),right=Math.max(measure.width,measure.actualBoundingBoxRight||0),ascent=measure.actualBoundingBoxAscent||size,descent=measure.actualBoundingBoxDescent||size*.3;
  const width=left+right+2*padding,height=ascent+descent+2*padding;
  const density=Math.min(600/72,4096/width,4096/height,Math.sqrt(4_000_000/(width*height)));
  canvas.width=Math.ceil(width*density);canvas.height=Math.ceil(height*density);
  context.scale(density,density);context.font=font;context.lineJoin='round';context.lineWidth=halo*2;context.strokeStyle='#fff';context.fillStyle='#344b2c';
  context.strokeText(text,padding+left,padding+ascent);context.fillText(text,padding+left,padding+ascent);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('A pin label could not be rendered for export.');
  const bytes=await blob.arrayBuffer();canvas.width=0;canvas.height=0;
  return {bytes,width,height,left:-padding-left,bottom:-padding-descent};
}
