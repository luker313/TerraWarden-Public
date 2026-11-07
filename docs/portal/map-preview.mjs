import {planMap,validateBounds,dimensions,longitudeSpan} from './map-plan.mjs?v=20261108.1';

// A bad/oversized download must not prevent browsing its geographic area.
// The fallback is deliberately independent of export pixel counts and limits.
export function previewPlan(options,exportPlan,previous){
  if(exportPlan)return {plan:exportPlan,fallback:false};
  let bounds,previousArea=false;
  try{bounds=validateBounds(options.bounds);}catch{bounds=previous?.bounds;previousArea=true;}
  if(!bounds)return {plan:null,fallback:true,previousArea};
  const plan=planMap({...options,bounds,detail:'maximum',pixelBudget:1_000_000,mode:'single',sheetPixels:8192});
  return {plan,fallback:true,previousArea};
}

export function previewSize({width,height},bounds,mode,source){
  // Print/area previews depend on the display, never on export resolution.
  // Inspect detail uses output sampling, with a bounded display-sized raster.
  const max=source==='recent'&&mode!=='area'?500_000:1_250_000;
  if(mode==='print'){const d=dimensions(bounds),ratio=d.width/d.height,edge=Math.min(1500,Math.max(width,height));width=ratio>=1?edge:edge*ratio;height=ratio>=1?edge/ratio:edge;}
  const scale=Math.min(1,1500/Math.max(width,height),Math.sqrt(max/(width*height)));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

export function previewRequest({mode,source,bounds,size,date,catalogBounds}){
  const layer=source==='recent'&&mode!=='area'?'recent':source==='recent'?'imagery':source;
  const pixels=previewSize(size,bounds,mode,layer);
  const contentKey=JSON.stringify({layer,date:layer==='recent'?date:null});
  // No title, border, paper, sheet pixel limit, download range or DPI here.
  const key=JSON.stringify({contentKey,bounds,...pixels,catalogBounds:layer==='recent'?catalogBounds:null});
  return {key,contentKey,source:layer,mode,bounds:{...bounds},...pixels,date:date&&{...date},catalogBounds:catalogBounds&&{...catalogBounds}};
}

export function detailRasterSize(sheet,bounds,size){
  // A coarse export should look coarse in Inspect detail, even though the
  // separate print/area previews can display more useful screen detail.
  return {width:Math.min(size.width,Math.max(1,Math.ceil(sheet.width*longitudeSpan(bounds)/longitudeSpan(sheet.bounds)))),height:Math.min(size.height,Math.max(1,Math.ceil(sheet.height*(bounds.north-bounds.south)/(sheet.bounds.north-sheet.bounds.south))))};
}

// Map an existing raster geographically while the next view is loading.
export function previewPlacement(rasterBounds,bounds,width,height){
  const span=longitudeSpan(bounds),oldSpan=longitudeSpan(rasterBounds);
  let west=rasterBounds.west;const centre=bounds.west+span/2;
  while(west+oldSpan/2-centre>180)west-=360;
  while(west+oldSpan/2-centre< -180)west+=360;
  return {x:(west-bounds.west)/span*width,y:(bounds.north-rasterBounds.north)/(bounds.north-bounds.south)*height,width:oldSpan/span*width,height:(rasterBounds.north-rasterBounds.south)/(bounds.north-bounds.south)*height};
}

// A small LRU and one current request. Unchanged settings never abort work;
// superseded requests cannot replace a newer view, even if they ignore abort.
export class PreviewQueue {
  constructor({load,ready,loading=()=>{},error=()=>{},dispose=value=>{value.width=value.height=1;},maxPixels=3_000_000,maxEntries=4}){
    Object.assign(this,{load,ready,loading,error,dispose,maxPixels,maxEntries});this.cache=new Map();this.generation=0;
  }
  request(request,delay=160,{force=false}={}){
    if(!force&&this.key===request.key&&(this.timer||this.controller||this.cache.has(request.key)))return;
    this.cancel();this.key=request.key;
    const cached=this.cache.get(request.key);
    if(cached&&!force){this.cache.delete(request.key);this.cache.set(request.key,cached);this.ready(cached.value,request);return;}
    const generation=this.generation,controller=new AbortController();this.controller=controller;
    const run=async()=>{
      this.timer=null;this.loading(true,'Loading map…');
      try{
        const value=await this.load(request,controller.signal,message=>{if(generation===this.generation)this.loading(true,message);});
        if(generation!==this.generation){this.dispose(value);return;}
        const old=this.cache.get(request.key);this.cache.delete(request.key);
        this.cache.set(request.key,{value,pixels:value.width*value.height});this.ready(value,request);
        if(old&&old.value!==value)this.dispose(old.value);
        let pixels=[...this.cache.values()].reduce((n,item)=>n+item.pixels,0);
        while(this.cache.size>1&&(this.cache.size>this.maxEntries||pixels>this.maxPixels)){const [key,item]=this.cache.entries().next().value;this.cache.delete(key);pixels-=item.pixels;this.dispose(item.value);}
      }catch(error){if(generation===this.generation&&error.name!=='AbortError')this.error(error);}
      finally{if(generation===this.generation){this.controller=null;this.loading(false);}}
    };
    if(delay)this.timer=setTimeout(run,delay);else void run();
  }
  cancel(){clearTimeout(this.timer);this.timer=null;this.controller?.abort();this.controller=null;this.generation++;this.loading(false);}
}
