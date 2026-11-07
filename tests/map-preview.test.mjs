import test from 'node:test';
import assert from 'node:assert/strict';
import {planMap,REGIONS,validateBounds} from '../docs/portal/map-plan.mjs';
import {previewPlan,previewRequest,previewPlacement,detailRasterSize,PreviewQueue} from '../docs/portal/map-preview.mjs';

const bounds={west:176.78,east:176.93,south:-39.70,north:-39.59};
const options={bounds,source:'imagery',paper:'fit',mode:'single'};
const size={width:1600,height:1100},date={days:90,cloud:30,endDate:'2026-11-07'};
const request=(overrides={})=>previewRequest({mode:'print',source:'imagery',bounds,size,date,catalogBounds:bounds,...overrides});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const raster=(id,width=600,height=500)=>({id,width,height});

test('oversized and unfinished export settings still produce a bounded preview of the selected area',()=>{
  for(const bad of [
    {...options,bounds:REGIONS.world,detail:'custom',metresPerPixel:.15,mode:'atlas'},
    {...options,bounds:REGIONS.australia,detail:'custom',metresPerPixel:.15},
    {...options,detail:'custom',metresPerPixel:''}
  ]){
    assert.throws(()=>planMap(bad));
    const result=previewPlan(bad,null);assert.equal(result.fallback,true);assert.deepEqual(result.plan.bounds,validateBounds(bad.bounds));
    assert.ok(result.plan.sheets.length<=9);assert.ok(result.plan.totalPixels<5_000_000);
  }
  const actual=planMap(options);assert.equal(previewPlan(options,actual).plan,actual);
});

test('incomplete coordinates retain the last valid preview area, never inventing export coordinates',()=>{
  const previous=planMap(options),result=previewPlan({...options,bounds:{...bounds,north:''}},null,previous);
  assert.equal(result.previousArea,true);assert.deepEqual(result.plan.bounds,bounds);
  assert.equal(previewPlan({...options,bounds:{}},null).plan,null);
});

test('print requests do not depend on export resolution, border, title, paper or download range',()=>{
  const requests=[.5,10,500].map(metresPerPixel=>{
    const plan=planMap({...options,detail:'custom',metresPerPixel,paper:metresPerPixel===10?'a1':'fit',margin:'paper'});
    return request({bounds:plan.sheets[0].bounds});
  });
  assert.equal(new Set(requests.map(r=>r.key)).size,1);
  assert.ok(requests[0].width*requests[0].height<=1_251_500);
  const recent=request({source:'recent'});assert.ok(recent.width*recent.height<=501_500);
  // Recent-image filters don't restart the independent navigation overview.
  assert.equal(request({mode:'area',source:'recent'}).key,request({mode:'area',source:'recent',date:{...date,cloud:60}}).key);
  assert.notEqual(recent.key,request({source:'recent',date:{...date,cloud:60}}).key);
});

test('old preview pixels move geographically during pan and zoom, including across the date line',()=>{
  assert.deepEqual(previewPlacement({west:170,east:-170,south:-10,north:10},{west:175,east:-175,south:-5,north:5},100,80),{x:-50,y:-40,width:200,height:160});
  const moved=previewPlacement(bounds,{...bounds,west:bounds.west+.01,east:bounds.east+.01},1000,600);
  assert.ok(Math.abs(moved.x+1000/15)<1e-8);assert.ok(Math.abs(moved.width-1000)<1e-8);
});

test('Inspect detail samples actual export pixels, including tiny/coarse output and magnified crops',()=>{
  const coarse=planMap({...options,detail:'custom',metresPerPixel:500}).sheets[0];
  assert.deepEqual(detailRasterSize(coarse,bounds,size),{width:coarse.width,height:coarse.height});
  const fine=planMap({...options,detail:'custom',metresPerPixel:2}).sheets[0],crop={...bounds,east:(bounds.east+bounds.west)/2};
  assert.ok(Math.abs(detailRasterSize(fine,crop,{width:10000,height:10000}).width-Math.ceil(fine.width/2))<=1);
});

test('unrelated settings do not cancel or duplicate an in-flight preview',async()=>{
  const work=deferred(),calls=[],ready=[];
  const queue=new PreviewQueue({load:(r,signal)=>{calls.push({r,signal});return work.promise;},ready:r=>ready.push(r.id)});
  queue.request(request(),0);queue.request(request(),0);
  assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);
  work.resolve(raster('first'));await settle();assert.deepEqual(ready,['first']);
  queue.request(request(),0);assert.equal(calls.length,1);
});

test('superseded work cannot overwrite the current preview or its progress',async()=>{
  const work=[deferred(),deferred()],calls=[],ready=[],progress=[],disposed=[];
  const queue=new PreviewQueue({load:(r,signal,report)=>{const i=calls.length;calls.push({signal,report});return work[i].promise;},ready:r=>ready.push(r.id),loading:(busy,message)=>{if(message)progress.push(message);},dispose:r=>disposed.push(r.id)});
  queue.request(request(),0);queue.request(request({bounds:{...bounds,east:177}}),0);
  assert.equal(calls[0].signal.aborted,true);
  calls[0].report('stale progress');work[1].resolve(raster('current'));await settle();work[0].resolve(raster('stale'));await settle();
  assert.deepEqual(ready,['current']);assert.deepEqual(disposed,['stale']);assert.ok(!progress.includes('stale progress'));
});

test('returning to a cached preview is immediate, while a failed request can be retried',async()=>{
  const calls=[],ready=[],errors=[];let fail=false;
  const queue=new PreviewQueue({load:async r=>{calls.push(r.key);if(fail)throw Error('offline');return raster(calls.length);},ready:r=>ready.push(r.id),error:e=>errors.push(e.message)});
  const first=request(),second=request({bounds:{...bounds,east:177}});
  queue.request(first,0);await settle();queue.request(second,0);await settle();queue.request(first,0);
  assert.equal(calls.length,2);assert.deepEqual(ready,[1,2,1]);
  fail=true;queue.request(first,0,{force:true});await settle();assert.deepEqual(errors,['offline']);
  fail=false;queue.request(first,0,{force:true});await settle();assert.equal(ready.at(-1),4);
});

test('preview cache releases old rasters within the memory budget; closing stops late results',async()=>{
  const disposed=[],ready=[];let n=0;
  const queue=new PreviewQueue({maxPixels:700_000,load:async()=>raster(++n),ready:r=>ready.push(r.id),dispose:r=>disposed.push(r.id)});
  for(let i=0;i<4;i++){queue.request(request({bounds:{...bounds,east:177+i}}),0);await settle();}
  assert.deepEqual(disposed,[1,2]);assert.equal(queue.cache.size,2);assert.deepEqual(ready,[1,2,3,4]);
  const work=deferred();queue.load=()=>work.promise;queue.request(request({bounds:{...bounds,east:178.5}}),0);queue.cancel();work.resolve(raster('closed'));await settle();
  assert.ok(disposed.includes('closed'));assert.equal(ready.at(-1),4);
});
