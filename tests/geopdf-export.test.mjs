import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PDFDocument,PDFName,PDFString,PDFArray,degrees} from '../docs/portal/vendor/pdf-lib.mjs';
import {geoPDFRegions} from '../docs/portal/georeference.mjs';
import {makeModel} from '../docs/portal/core.mjs';
import {exportGeoPDF,exportLabelPlacement,geoPDFFilename,clipPolyline} from '../docs/portal/geopdf-export.mjs';
import {filterFeatures} from '../docs/portal/feature-visibility.mjs';
const fontBytes=await readFile(new URL('../docs/portal/vendor/standard_fonts/LiberationSans-Regular.ttf',import.meta.url));
const n=PDFName.of;

export function testViewport(box,rotation=0,unit=1) {
  const [x,y,right,top]=box;
  const t=rotation===90?[0,unit,unit,0,-y*unit,-x*unit]:rotation===180?[-unit,0,0,unit,right*unit,-y*unit]:rotation===270?[0,-unit,-unit,0,top*unit,right*unit]:[unit,0,0,-unit,-x*unit,top*unit];
  const [a,b,c,d,e,f]=t,det=a*d-b*c;
  return {transform:t,convertToViewportPoint:(x,y)=>[a*x+c*y+e,b*x+d*y+f],convertToPdfPoint:(x,y)=>[(d*(x-e)-c*(y-f))/det,(-b*(x-e)+a*(y-f))/det]};
}
const anchors=[{x:50,y:50,latitude:-32.02,longitude:115.9},{x:50,y:700,latitude:-32,longitude:115.9},{x:950,y:700,latitude:-32,longitude:115.94},{x:950,y:50,latitude:-32.02,longitude:115.94}];
async function fixture({rotation=0,manual=false,unit=1}={}) {
  const source=await PDFDocument.create(),page=source.addPage([1000,750]),c=source.context;
  page.setRotation(degrees(rotation));page.setCropBox(25,25,950,700);page.node.set(n('UserUnit'),c.obj(unit));
  const image=await source.embedPng(await readFile(new URL('../docs/portal/assets/terrawarden-mark.png',import.meta.url)));page.drawImage(image,{x:100,y:100,width:100,height:100});
  source.addPage().drawText('ONLY ON THE OTHER PAGE');
  if(!manual) {
    const measure=c.obj({Type:n('Measure'),Subtype:n('GEO'),Bounds:[0,0,0,1,1,1,1,0],LPTS:[0,0,0,1,1,1,1,0],GPTS:anchors.flatMap(p=>[p.latitude,p.longitude]),GCS:c.obj({Type:n('GEOGCS'),EPSG:4326})});
    const bad=c.obj({Type:n('Viewport'),BBox:[0,0,100,100],Measure:c.obj({Type:n('Measure'),Subtype:n('GEO'),LPTS:[0,0,0,1,1,1,1,0],GPTS:anchors.flatMap(p=>[p.latitude,p.longitude]),GCS:c.obj({Type:n('GEOGCS'),EPSG:999999})})});
    const vp=c.obj({Type:n('Viewport'),Name:PDFString.of('Selected map'),BBox:[50,50,950,700],Measure:c.register(measure)});
    page.node.set(n('VP'),c.obj([c.register(bad),c.register(vp)]));
  }
  const group=c.register(c.obj({Type:n('OCG'),Name:PDFString.of('Original map visibility')}));
  page.node.Resources().set(n('Properties'),c.obj({Original:group}));source.catalog.set(n('OCProperties'),c.obj({OCGs:[group],D:{ON:[group],OFF:[]}}));
  const model=manual?makeModel(anchors,[25,25,975,725]):geoPDFRegions(source,0).regions[0].model;
  const point=model.toGeo(400,400),end=model.toGeo(700,550);
  const features=[{id:'pin1',layerID:'shown',type:'pin',name:'Māori δ survey',color:'#547c44',...point},{id:'pin2',layerID:'hidden',type:'pin',name:'Hidden pin',color:'#bd8055',...end},{id:'line1',layerID:'shown',type:'line',name:'Survey line',color:'#3a85c6',drawingAppearance:{lineStyle:'dashed'},segments:[{points:[point,end]}]}];
  return {source,model,features,pageBox:[25,25,975,725],viewport:testViewport([25,25,975,725],rotation,unit),hidden:new Set(['hidden']),scale:1,labelAngle:45,fontBytes,usePDFAlignment:!manual};
}
function imageStreams(document) {
  return document.context.enumerateIndirectObjects().flatMap(([,value])=>typeof value.dict?.lookup==='function'&&value.dict.lookup(n('Subtype'))?.asString?.()==='/Image'?[`${value.dict.lookup(n('Width')).asNumber()}x${value.dict.lookup(n('Height')).asNumber()}:${createHash('sha256').update(value.getContents()).digest('hex')}`]:[]).sort();
}
function pageContentHashes(page){const contents=page.node.lookup(n('Contents')),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,i)=>contents.lookup(i)):[contents];return streams.filter(Boolean).map(stream=>createHash('sha256').update(stream.getContents()).digest('hex'));}
test('GeoPDF export keeps only the selected page/layers and retains source image bytes and OCG visibility',async()=>{
  const settings=await fixture(),before=await settings.source.save(),originalImages=imageStreams(settings.source),originalContent=pageContentHashes(settings.source.getPages()[0]);
  const result=await exportGeoPDF({...settings,opacity:.55}),output=await PDFDocument.load(result.bytes);
  assert.equal(result.pinCount,1);assert.equal(result.routeCount,1);assert.equal(output.getPageCount(),1);assert.equal(settings.source.getPageCount(),2);
  assert.equal(output.getPages()[0].node.lookup(n('VP'),PDFArray).size(),1);
  assert.equal(geoPDFRegions(output,0).regions[0].name,'Selected map');
  for(const stream of originalImages)assert.ok(imageStreams(output).includes(stream),'source image is not resampled/recompressed');
  for(const hash of originalContent)assert.ok(pageContentHashes(output.getPages()[0]).includes(hash),'original vector/text content streams remain unchanged');
  const refs=output.catalog.lookup(n('OCProperties')).lookup(n('OCGs')).get(0),property=output.getPages()[0].node.Resources().lookup(n('Properties')).get(n('Original'));
  assert.equal(String(refs),String(property));assert.ok(result.bytes.length>before.length/4);
  const region=geoPDFRegions(output,0).regions[0];for(const p of anchors){const geo=settings.model.toGeo(p.x,p.y),roundtrip=region.model.toPDF(geo.latitude,geo.longitude);assert.ok(Math.hypot(roundtrip[0]-p.x,roundtrip[1]-p.y)<.001);}
});
test('manual alignment becomes a valid WGS84 GeoPDF on rotated, cropped pages with UserUnit',async()=>{
  const settings=await fixture({manual:true,rotation:90,unit:2}),result=await exportGeoPDF(settings),output=await PDFDocument.load(result.bytes),page=output.getPages()[0];
  assert.equal(page.getRotation().angle,90);assert.deepEqual(page.getCropBox(),{x:25,y:25,width:950,height:700});assert.equal(page.node.lookup(n('UserUnit')).asNumber(),2);
  const model=geoPDFRegions(output,0).regions[0].model;
  for(const p of anchors){const geo=model.toGeo(p.x,p.y);assert.ok(Math.abs(geo.latitude-p.latitude)<1e-9&&Math.abs(geo.longitude-p.longitude)<1e-9);}
});
test('export uses the same search/visibility boundary as the map and requires alignment',async()=>{
  const settings=await fixture();assert.equal(filterFeatures(settings.features,{hidden:settings.hidden,search:'Māori'}).length,1);
  const result=await exportGeoPDF({...settings,search:'Māori'});assert.equal(result.pinCount,1);assert.equal(result.routeCount,0);
  await assert.rejects(exportGeoPDF({...settings,model:null}),/align/);
});
test('rotated export labels keep their screen-space pin anchor at every page rotation',()=>{
  for(const rotation of [0,90,180,270])for(const angle of [-90,0,45,180]) {
    const viewport=testViewport([25,50,975,725],rotation,2),scale=.7,point=[400,300],placement=exportLabelPlacement(point,viewport,scale,angle),start=viewport.convertToViewportPoint(...point),label=viewport.convertToViewportPoint(...placement.point),a=angle*Math.PI/180;
    assert.ok(Math.abs((label[0]-start[0])*scale-(10*Math.cos(a)-3*Math.sin(a)))<1e-8);
    assert.ok(Math.abs((label[1]-start[1])*scale-(10*Math.sin(a)+3*Math.cos(a)))<1e-8);
  }
});
test('route export clips outside geometry and preserves genuine segment gaps',()=>{
  const polygon=[[0,0],[10,0],[10,10],[0,10]];
  assert.deepEqual(clipPolyline([[-5,5],[15,5]],polygon),[[[0,5],[10,5]]]);
  assert.deepEqual(clipPolyline([[1,1],[2,2],null,[8,8],[9,9]],polygon),[[[1,1],[2,2]],[[8,8],[9,9]]]);
  assert.equal(clipPolyline([[-5,-5],[-1,-1]],polygon).length,0);
  assert.equal(geoPDFFilename('test/map.PDF',3),'test_map-page-3-web-geopdf.pdf');
});
test('cancelled exports cannot finish after the user switches map or group',async()=>{
  const settings=await fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(exportGeoPDF({...settings,signal:controller.signal}),error=>error.name==='AbortError');
});
