import test from 'node:test';
import assert from 'node:assert/strict';
import {planPDFRender,PDFViewportRenderer} from '../docs/portal/pdf-render.mjs';

test('PDF detail renders at device resolution even at 1200% zoom',()=>{
  const plan=planPDFRender({pageWidth:2400,pageHeight:1800,width:393,height:720,x:-7200,y:-3600,scale:12,dpr:3,padding:0});
  assert.equal(plan.pixelWidth,1179);assert.equal(plan.pixelHeight,2160);
  assert.equal(plan.left,600);assert.equal(plan.top,300);
  const t=plan.transform;
  assert.equal(t[0]*600+t[4],0);assert.equal(t[3]*300+t[5],0);
  assert.equal(t[0]*(600+393/12)+t[4],1179);
});

test('PDF crop clips page edges and bounds memory for huge maps and screens',()=>{
  assert.equal(planPDFRender({pageWidth:100,pageHeight:100,width:400,height:800,x:500,y:100,scale:12}),null);
  const clipped=planPDFRender({pageWidth:100,pageHeight:100,width:400,height:800,x:50,y:80,scale:1,dpr:2,padding:0});
  assert.equal(clipped.left,0);assert.equal(clipped.top,0);assert.equal(clipped.width,100);assert.equal(clipped.height,100);
  const huge=planPDFRender({pageWidth:200000,pageHeight:200000,width:8000,height:6000,x:-50000,y:-50000,scale:12,dpr:4});
  assert.ok(huge.pixelWidth<=4096&&huge.pixelHeight<=4096);
  assert.ok(huge.pixelWidth*huge.pixelHeight<=6_000_000);
  // Raster density depends on the visible region, not the full page's size.
  const normal=planPDFRender({pageWidth:200000,pageHeight:200000,width:800,height:600,x:-50000,y:-50000,scale:12,dpr:2,padding:0});
  assert.equal(normal.resolution,24);
});

test('switching PDF pages cancels old sharpening and cannot install stale pixels',async()=>{
  const host={children:[],replaceChildren(...next){this.children=next;}},pending=[];
  const renderer=new PDFViewportRenderer(host,{createCanvas:()=>({style:{},getContext:()=>({})})});
  const page={getViewport:()=>({}),render:()=>{let resolve;const promise=new Promise(r=>resolve=r),task={promise,cancel(){task.cancelled=true;}};pending.push({resolve,task});return task;}};
  const plan=planPDFRender({pageWidth:600,pageHeight:800,width:400,height:600,x:0,y:0,scale:4,dpr:2});
  renderer.setPage(page);const old=renderer.render(plan,renderer.generation);
  renderer.setPage(page);assert.equal(pending[0].task.cancelled,true);
  const current=renderer.render(plan,renderer.generation);
  pending[1].resolve();await current;const canvas=host.children[0];assert.ok(canvas.width>0);
  pending[0].resolve();await old;assert.equal(host.children[0],canvas);
  renderer.clear();assert.equal(canvas.width,0);assert.equal(host.children.length,0);
});
