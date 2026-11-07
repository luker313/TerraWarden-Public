import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFArray,PDFDict} from '../docs/portal/vendor/pdf-lib.mjs';
import {planMap,REGIONS,dimensions,validateBounds,splitDateLine,rasterPatches,volumeRange} from '../docs/portal/map-plan.mjs';
import {sourceRequest,rasterCrop} from '../docs/portal/map-source.mjs';
import {exportMapAtlas,blobSink,marginScene} from '../docs/portal/map-pdf.mjs';
import {geoPDFRegions} from '../docs/portal/georeference.mjs';
const fontBytes=await readFile(new URL('../docs/portal/vendor/standard_fonts/LiberationSans-Regular.ttf',import.meta.url)),jpeg=await readFile(new URL('./fixtures/map-pixel.jpg',import.meta.url));
const n=PDFName.of;
const options={source:'imagery',detail:'custom',metresPerPixel:1000,sheetPixels:4096};
test('map planner covers Australia, NZ, other continents and both poles without inverted bounds',()=>{
  for(const bounds of [REGIONS.australia,REGIONS.nz,REGIONS.hawkes,REGIONS.chatham,REGIONS.world,{west:-75,east:-65,south:-20,north:-5},{west:80,east:90,south:28,north:34}]){
    const plan=planMap({bounds,detail:'maximum'});assert.ok(plan.sheets.length>0);assert.ok(plan.totalPixels>0);assert.ok(plan.sheets.every(p=>p.width>0&&p.height>0&&p.bounds.east>p.bounds.west&&p.bounds.north>p.bounds.south));
    const area=plan.sheets.reduce((sum,p)=>sum+dimensions(p.bounds).area,0);assert.ok(Math.abs(area-dimensions(bounds).area)/area<1e-12,'sheets partition the exact area without omissions or overlap');
    for(const p of plan.sheets){assert.ok(p.bounds.east-p.bounds.west<=120+1e-8);assert.ok(p.bounds.north-p.bounds.south<=60+1e-8);assert.ok(Math.max(p.width,p.height)<=8192,'sheet pixels stay within the selected maximum at every latitude');}
  }
  const polar=planMap({bounds:{west:0,east:10,south:86,north:90},...options,metresPerPixel:.15});assert.equal(polar.resolution,500);assert.ok(polar.polar);
});
test('date-line regions are partitioned at 180 without wrapping across the rest of Earth',()=>{
  const bounds={west:174,east:-175,south:-45,north:-40},parts=splitDateLine(bounds);assert.deepEqual(parts.map(p=>[p.west,p.east]),[[174,180],[-180,-175]]);
  const plan=planMap({bounds,...options});assert.ok(plan.sheets.every(p=>p.bounds.east-p.bounds.west<=6));
  assert.throws(()=>validateBounds({west:0,east:0,south:-1,north:1}));assert.throws(()=>validateBounds({west:0,east:1,south:20,north:10}));assert.throws(()=>validateBounds({west:-181,east:1,south:0,north:10}));
  assert.throws(()=>validateBounds({west:'',east:1,south:0,north:10}),/four area/);
});
test('chunk planner covers every output pixel once, including partial edges',()=>{
  const sheet={bounds:{west:115,east:116,south:-33,north:-32},width:2053,height:1033},patches=[...rasterPatches(sheet)];assert.equal(patches.length,6);
  assert.equal(patches.reduce((s,p)=>s+p.width*p.height,0),sheet.width*sheet.height);
  assert.deepEqual(patches.at(-1),{x:2048,y:1024,width:5,height:9,bounds:{west:115+2048/2053,east:116,north:-32-1024/1033,south:-33}});
  const plan=planMap({bounds:REGIONS.nz,...options,metresPerPixel:10});const range=volumeRange(plan,1);assert.ok(range.end>=1&&range.end<plan.sheets.length);assert.ok(range.pixels<=128_000_000);
});
test('resolution changes preserve source constraints and reject impossible plans before fetching imagery',()=>{
  const b={west:115.8,east:115.81,south:-32,north:-31.99},fine=planMap({bounds:b,...options,metresPerPixel:.15}),coarse=planMap({bounds:b,...options,metresPerPixel:2});assert.ok(fine.totalPixels>coarse.totalPixels*100);
  assert.equal(planMap({bounds:b,...options,source:'earth',metresPerPixel:1}).resolution,500);
  assert.throws(()=>planMap({bounds:REGIONS.australia,...options,metresPerPixel:.15}),/20,000/);
  assert.throws(()=>planMap({bounds:REGIONS.australia,...options,mode:'single',metresPerPixel:.15}),/single sheet/);
  assert.throws(()=>planMap({bounds:b,...options,metresPerPixel:0}),/Resolution/);
});
test('imagery requests use returned extents instead of assuming adjusted image aspect ratios',()=>{
  const requested={west:115,south:-33,east:116,north:-32},actual={west:114.5,south:-33,east:116.5,north:-32};assert.deepEqual(rasterCrop(requested,actual,1024,512),{x:256,y:0,width:512,height:512});
  assert.throws(()=>rasterCrop(requested,{west:115.5,east:116.5,south:-33,north:-32},512,512),/does not cover/);
  const esri=new URL(sourceRequest('imagery',requested,512,1024).url);assert.equal(esri.searchParams.get('imageSR'),'4326');assert.equal(esri.searchParams.get('f'),'json');assert.equal(esri.searchParams.get('size'),'512,1024');
  const nasa=new URL(sourceRequest('earth',{west:-180,east:180,south:-90,north:90},1024,512).url);assert.equal(nasa.searchParams.get('VERSION'),'1.1.1');assert.equal(nasa.searchParams.get('SRS'),'EPSG:4326');assert.equal(nasa.searchParams.get('BBOX'),'-180,-90,180,90');
});
test('streamed GeoPDF retains precise WGS84 positions and excludes the branded margin from georeferencing',async()=>{
  const bounds={west:115.9000001,east:115.9000011,south:-32.0000001,north:-31.9999991},plan=planMap({bounds,...options,metresPerPixel:1}),sheet=plan.sheets[0];assert.equal(sheet.width,1);assert.equal(sheet.height,1);
  const result=await exportMapAtlas({plan,title:'Māori field map',fontBytes,loadTile:async()=>jpeg}),document=await PDFDocument.load(await result.blob.arrayBuffer());
  assert.equal(result.pages,1);assert.equal(document.getTitle(),'Māori field map');assert.equal(document.getAuthor(),'TerraWarden');const page=document.getPages()[0],vp=page.node.lookup(n('VP'),PDFArray).lookup(0,PDFDict),box=vp.lookup(n('BBox'),PDFArray).asArray().map(v=>v.asNumber());
  assert.ok(box[0]>0&&box[1]>0&&box[2]<page.getWidth()&&box[3]<page.getHeight());const region=geoPDFRegions(document,0).regions[0];assert.ok(region);
  for(const [x,y,lat,lon] of [[box[0],box[1],bounds.south,bounds.west],[box[2],box[3],bounds.north,bounds.east],[(box[0]+box[2])/2,(box[1]+box[3])/2,(bounds.south+bounds.north)/2,(bounds.west+bounds.east)/2]]){const p=region.model.toGeo(x,y);assert.ok(Math.abs(p.latitude-lat)<1e-10);assert.ok(Math.abs(p.longitude-lon)<1e-10);}
  const scene=marginScene({plan,sheet,title:'Māori field map',date:'2026-11-07'});assert.ok(scene.some(i=>i.type==='image'&&i.key==='wordmark'));assert.ok(scene.some(i=>i.value==='WGS84  /  EPSG:4326'));
});
test('atlas PDF sheet ranges have valid cross-references, embedded images and independent georeferences',async()=>{
  const base=planMap({bounds:{west:179.99,east:-179.99,south:-44,north:-43.99},...options}),plan={...base,sheets:base.sheets.map(p=>({...p,width:1,height:1,pixels:1}))},chunks=[];let closed=false,aborted=false;
  const sink={async write(bytes){chunks.push(bytes);},async close(){closed=true;},async abort(){aborted=true;}},progress=[];
  const result=await exportMapAtlas({plan,title:'Date line atlas',fontBytes,sink,loadTile:async()=>jpeg,progress:p=>progress.push(p)});assert.ok(closed);assert.equal(aborted,false);assert.equal(result.pages,2);assert.equal(progress.at(-1).fraction,1);
  const bytes=Buffer.concat(chunks),document=await PDFDocument.load(bytes);assert.equal(document.getPageCount(),2);
  for(let i=0;i<2;i++){const region=geoPDFRegions(document,i).regions[0];assert.ok(region);const centre=region.model.toGeo((region.model.box[0]+region.model.box[2])/2,(region.model.box[1]+region.model.box[3])/2);assert.ok(Math.abs(centre.longitude)>179);}
  const content=bytes.toString('latin1'),xref=Number(content.match(/startxref\n(\d+)\n%%EOF/)[1]);assert.equal(content.slice(xref,xref+4),'xref');
  for(const match of content.slice(xref).matchAll(/(\d{10}) 00000 n/g)){const offset=Number(match[1]);assert.match(content.slice(offset,offset+20),/^\d+ 0 obj\n/);}
  const partial=await exportMapAtlas({plan,title:'One sheet',from:2,to:2,fontBytes,loadTile:async()=>jpeg});assert.equal(partial.pages,1);const part=await PDFDocument.load(await partial.blob.arrayBuffer());assert.match(geoPDFRegions(part,0).regions[0].name,/sheet 2/);
});
test('abort and resource failures abort direct saves; bounded download buffers refuse oversized files',async()=>{
  const plan=planMap({bounds:{west:115,east:115.000001,south:-32,north:-31.999999},...options}),controller=new AbortController();let aborted=false,closed=false;
  const sink={async write(){},async close(){closed=true;},async abort(){aborted=true;}};
  await assert.rejects(exportMapAtlas({plan,fontBytes,sink,signal:controller.signal,loadTile:async()=>{controller.abort();return jpeg;}}),e=>e.name==='AbortError');assert.equal(aborted,true);assert.equal(closed,false);
  const buffer=blobSink(3);await assert.rejects(buffer.write(new Uint8Array(4)),/too large/);
  await assert.rejects(exportMapAtlas({plan,fontBytes,from:0,to:1,loadTile:async()=>jpeg}),/sheet range/);
});
