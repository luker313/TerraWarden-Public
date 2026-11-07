import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument} from '../docs/portal/vendor/pdf-lib.mjs';
import {planMap,dimensions,pageLayout,REGIONS} from '../docs/portal/map-plan.mjs';
import {geoPDFRegions} from '../docs/portal/georeference.mjs';
import {exportMapAtlas,marginScene} from '../docs/portal/map-pdf.mjs';
import {imagerySettings,stacRequest,selectScenes,findRecentScenes,captureRange,RecentImagerySession,rasterWindow,clearSCL,esriCaptureDate} from '../docs/portal/map-imagery.mjs';
import {gridCRS,projectGeographic} from '../docs/portal/coordinates.mjs';
const b={west:176.83,east:176.84,south:-39.65,north:-39.64};
test('fit-map pages follow tall, wide and square geographic areas without spare side bands',()=>{
  for(const bounds of [b,{west:115,east:125,south:-32,north:-31.9},{west:115,east:115.1,south:-32,north:-12},REGIONS.nz]){
    const plan=planMap({bounds,paper:'fit',mode:'single'}),p=plan.sheets[0],map=p.layout.map;
    assert.ok(Math.abs(p.frame.x-map.x)<1e-8&&Math.abs(p.frame.y-map.y)<1e-8);assert.ok(Math.abs(p.frame.width-map.width)<1e-8&&Math.abs(p.frame.height-map.height)<1e-8);
    const d=dimensions(p.bounds);assert.ok(Math.abs(p.frame.width/p.frame.height-d.width/d.height)<1e-12);
    assert.ok(Math.max(p.layout.width,p.layout.height)<=14000+1e-6);
    assert.ok(Math.abs(Math.min(p.frame.width/650,p.frame.height/600)-p.layout.unit)<1e-8);
  }
  const fixed=pageLayout('a3','landscape','terrain',b);assert.equal(fixed.width,1190.551);assert.equal(fixed.height,841.89);
});
test('every automatic atlas page uses its own matching paper shape and retains geographic corners',async()=>{
  const fontBytes=await readFile(new URL('../docs/portal/vendor/standard_fonts/LiberationSans-Regular.ttf',import.meta.url)),jpeg=await readFile(new URL('./fixtures/map-pixel.jpg',import.meta.url));
  const original=planMap({bounds:REGIONS.nz,paper:'fit',sheetPixels:4096}),plan={...original,sheets:original.sheets.slice(0,3).map(p=>({...p,width:1,height:1,pixels:1}))};
  const result=await exportMapAtlas({plan,title:'Proportional atlas',fontBytes,loadTile:async()=>jpeg}),pdf=await PDFDocument.load(await result.blob.arrayBuffer());
  for(let i=0;i<pdf.getPageCount();i++){const p=plan.sheets[i],page=pdf.getPages()[i],r=geoPDFRegions(pdf,i).regions[0];assert.ok(Math.abs(page.getWidth()-p.layout.width)<.00001);assert.ok(Math.abs(page.getHeight()-p.layout.height)<.00001);const southWest=r.model.toGeo(...r.model.box.slice(0,2));assert.ok(Math.abs(southWest.longitude-p.bounds.west)<1e-8&&Math.abs(southWest.latitude-p.bounds.south)<1e-8);}
});
const settings=imagerySettings({days:90,cloud:30,endDate:'2026-11-07'});
const item=(id,date,cloud=5,tile='A')=>({id,bbox:[b.west,b.south,b.east,b.north],properties:{datetime:date,'eo:cloud_cover':cloud,'proj:epsg':32760,'grid:code':tile},assets:{visual:{href:`https://sentinel-cogs.s3.us-west-2.amazonaws.com/${id}/TCI.tif`},scl:{href:`https://sentinel-cogs.s3.us-west-2.amazonaws.com/${id}/SCL.tif`}}});
test('recent scene selection enforces actual acquisition dates, cloud threshold, trusted assets and newest-per-tile order',()=>{
  const inputs=[item('older','2026-10-01T00:00:00Z'),item('newer','2026-11-01T00:00:00Z'),item('third','2026-09-01T00:00:00Z'),item('old','2020-01-01T00:00:00Z'),item('future','2027-01-01T00:00:00Z'),item('cloudy','2026-11-06T00:00:00Z',99),item('elsewhere','2026-11-02T00:00:00Z',5,'B')];
  assert.deepEqual(selectScenes(inputs,settings).map(s=>s.id),['elsewhere','newer','older']);const unsafe=item('unsafe','2026-11-06T00:00:00Z');unsafe.assets.visual.href='https://untrusted.example/data.tif';assert.equal(selectScenes([unsafe],settings).length,0);
  assert.equal(captureRange(['2026-11-02T00:00:00Z','2026-10-01T00:00:00Z']),'2026-10-01 to 2026-11-02');assert.throws(()=>imagerySettings({days:2}),/valid imagery/);
  const url=new URL(stacRequest(b,settings));assert.equal(url.searchParams.get('sortby'),'-properties.datetime');assert.equal(JSON.parse(url.searchParams.get('query'))['eo:cloud_cover'].lte,30);assert.ok(url.searchParams.get('datetime').startsWith('2026-08-'));
});
test('recent catalogue follows trusted pagination and rejects no-match results and unsafe next links',async()=>{
  let calls=0;const result=await findRecentScenes(b,{days:90,cloud:30,endDate:'2026-11-07'},null,async()=>++calls===1?{type:'FeatureCollection',features:[item('a','2026-11-01T00:00:00Z')],links:[{rel:'next',href:'https://earth-search.aws.element84.com/v1/search?next=x'}]}:{type:'FeatureCollection',features:[item('b','2026-10-01T00:00:00Z')],links:[]});assert.equal(calls,2);assert.equal(result.scenes.length,2);
  await assert.rejects(findRecentScenes(b,{},null,async()=>({type:'FeatureCollection',features:[],links:[]})),/No recent/);
  assert.throws(()=>stacRequest(b,settings,'https://example.com/private'),/Unexpected/);
  const controller=new AbortController();controller.abort();await assert.rejects(findRecentScenes(b,{},controller.signal),e=>e.name==='AbortError');
});
test('imagery grid windows honour integer source boundaries and north-to-south raster rows',()=>{
  const image={getOrigin:()=>[1000,2000],getResolution:()=>[10,-10],getWidth:()=>100,getHeight:()=>100};
  assert.deepEqual(rasterWindow(image,image,[1015,1955,1045,1985]),{window:[1,1,5,5],x:1010,y:1990,rx:10,ry:-10,width:4,height:4});
  assert.equal(rasterWindow(image,image,[4000,2000,5000,3000]),null);assert.ok(clearSCL(4)&&clearSCL(6));assert.equal(clearSCL(3),false);assert.equal(clearSCL(9),false);
});
function fakeCanvas(){const canvas={};canvas.getContext=()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>{canvas.pixels=image.data;}});return canvas;}
function makeSceneReader({allCloud=false}={}){
  const c=projectGeographic({latitude:(b.north+b.south)/2,longitude:(b.west+b.east)/2},gridCRS('wgs84',60,false));
  return async url=>{const old=url.includes('old'),mask=url.includes('SCL');const image={getOrigin:()=>[c.easting-2000,c.northing+2000],getResolution:()=>[10,-10],getWidth:()=>400,getHeight:()=>400,readRasters:async({window})=>{const w=window[2]-window[0],h=window[3]-window[1],data=new Uint8Array(w*h*(mask?1:3));for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(mask)data[i]=allCloud||(!old&&(x+window[0])%2===0)?9:4;else data.set(old?[20,80,200]:[200,70,40],i*3);}return data;}};return {getImage:async()=>image,getImageCount:async()=>1};};
}
test('recent render fills masked clouds from another in-period scene and records dates actually used',async()=>{
  const scenes=selectScenes([item('new','2026-11-01T00:00:00Z'),item('old','2026-10-01T00:00:00Z')],settings),session=new RecentImagerySession({scenes,settings},{makeCanvas:fakeCanvas,openTIFF:makeSceneReader()});
  const image=await session.render({bounds:b,width:32,height:32,sheetNumber:1}),colours=new Set();for(let i=0;i<image.pixels.length;i+=4)colours.add(Array.from(image.pixels.slice(i,i+3)).join(','));assert.ok(colours.has('20,80,200')&&colours.has('200,70,40'));assert.equal(image.imageryInfo.missing,0);assert.equal(session.informationForSheet(1).dates,'2026-10-01 to 2026-11-01');
});
test('unavailable recent pixels stay hatched and are never described as a dated old basemap',async()=>{
  const scenes=selectScenes([item('new','2026-11-01T00:00:00Z')],settings),session=new RecentImagerySession({scenes,settings},{makeCanvas:fakeCanvas,openTIFF:makeSceneReader({allCloud:true})});
  const image=await session.render({bounds:b,width:16,height:16,sheetNumber:2});assert.equal(image.imageryInfo.missing,1);assert.match(image.imageryInfo.label,/No clear/);assert.match(session.informationForSheet(2).label,/No clear/);
  const original=planMap({bounds:b,paper:'fit',source:'recent'}),plan={...original,sheets:original.sheets.map(p=>({...p,width:1,height:1,pixels:1}))},fontBytes=await readFile(new URL('../docs/portal/vendor/standard_fonts/LiberationSans-Regular.ttf',import.meta.url)),jpeg=await readFile(new URL('./fixtures/map-pixel.jpg',import.meta.url));
  await assert.rejects(exportMapAtlas({plan,fontBytes,loadTile:async()=>jpeg,getImageryInfo:async()=>session.informationForSheet(2)}),/No clear imagery/);
});
test('mosaic capture date parsing and printed dates distinguish capture time from export time',()=>{
  assert.equal(esriCaptureDate({SRC_DATE:'20241213'}),'2024-12-13');assert.equal(esriCaptureDate({SRC_DATE2:'12/13/2024'}),'2024-12-13');assert.equal(esriCaptureDate({SRC_DATE:'20249999'}),null);
  const plan=planMap({bounds:b,paper:'fit'}),scene=marginScene({plan,sheet:plan.sheets[0],title:'Map',date:'2026-11-07',imageryInfo:{label:'Centre capture: 2024-12-13; mosaic dates vary'}});assert.ok(scene.some(i=>i.type==='text'&&i.value.includes('2024-12-13')&&i.value.includes('Exported 2026-11-07')));
});
