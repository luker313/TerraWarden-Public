import {SOURCES,splitDateLine,longitudeSpan} from './map-plan.mjs?v=20261107.2';
export const abortCheck=signal=>{if(signal?.aborted)throw new DOMException('Map creation cancelled.','AbortError');};
const pause=(ms,signal)=>new Promise((resolve,reject)=>{abortCheck(signal);const done=()=>{signal?.removeEventListener('abort',cancel);resolve();},timer=setTimeout(done,ms),cancel=()=>{clearTimeout(timer);reject(new DOMException('Map creation cancelled.','AbortError'));};signal?.addEventListener('abort',cancel,{once:true});});
export async function fetchMapResource(url,{signal,type='json',retries=2}={}){
  for(let attempt=0;attempt<=retries;attempt++){
    abortCheck(signal);const controller=new AbortController(),forward=()=>controller.abort();signal?.addEventListener('abort',forward,{once:true});
    const timer=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(url,{signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin'});
      if(!response.ok)throw new Error(`Map service returned ${response.status}.`);
      if(type==='json'){const value=await response.json();if(value.error)throw new Error(value.error.message||value.reason||'The map service could not render this area.');return value;}
      const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('The map service returned an error instead of imagery.');return blob;
    }catch(error){abortCheck(signal);if(attempt===retries)throw new Error(`${error.name==='AbortError'?'The map service timed out.':error.message} Try again or choose another source.`);await pause(600*(attempt+1),signal);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',forward);}
  }
}
export function sourceRequest(source,bounds,width,height){
  const config=SOURCES[source];if(!config)throw new Error('Unknown map source.');
  if(config.layer){const url=new URL('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi');url.search=new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',LAYERS:config.layer,STYLES:'',SRS:'EPSG:4326',BBOX:[bounds.west,bounds.south,bounds.east,bounds.north].join(','),WIDTH:String(width),HEIGHT:String(height),FORMAT:'image/jpeg'});return {url:url.href,type:'blob'};}
  const url=new URL(`https://services.arcgisonline.com/ArcGIS/rest/services/${config.service}/MapServer/export`);
  url.search=new URLSearchParams({bbox:[bounds.west,bounds.south,bounds.east,bounds.north].join(','),bboxSR:'4326',imageSR:'4326',size:`${width},${height}`,format:'jpg',dpi:'96',transparent:'false',f:'json'});
  return {url:url.href,type:'json'};
}
export function rasterCrop(requested,actual,imageWidth,imageHeight){
  const dx=actual.east-actual.west,dy=actual.north-actual.south;
  if(![dx,dy].every(v=>Number.isFinite(v)&&v>0))throw new Error('The imagery service returned an invalid extent.');
  const crop={x:(requested.west-actual.west)/dx*imageWidth,y:(actual.north-requested.north)/dy*imageHeight,width:(requested.east-requested.west)/dx*imageWidth,height:(requested.north-requested.south)/dy*imageHeight};
  if(crop.x<-.5||crop.y<-.5||crop.x+crop.width>imageWidth+.5||crop.y+crop.height>imageHeight+.5)throw new Error('The returned imagery does not cover the requested map area.');
  return crop;
}
async function decodeImage(blob){
  if(typeof createImageBitmap==='function')try{return await createImageBitmap(blob);}catch{/* Safari can use a regular image element. */}
  const url=URL.createObjectURL(blob),img=new Image();try{img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}
}
async function paintPart(context,source,bounds,width,height,signal,fetcher){
  abortCheck(signal);
  // Esri's export endpoint adjusts the bounding box to match the integer image
  // aspect ratio. Read its returned extent, then crop to the exact requested
  // WGS84 rectangle; assuming the input extent would move GPS positions.
  const ratio=(bounds.east-bounds.west)/(bounds.north-bounds.south);
  // Geographic imagery is stretched to the page's ground aspect ratio. Retain
  // enough source samples on BOTH axes, especially at high latitudes. Esri
  // limits an export to 4096px; subdivide instead of silently undersampling.
  const requestWidth=source==='earth'?width:Math.max(width,Math.ceil(height*ratio)),requestHeight=source==='earth'?height:Math.max(height,Math.ceil(width/ratio));
  if(requestWidth>4096||requestHeight>4096){
    const horizontal=requestWidth>requestHeight,cut=horizontal?Math.floor(width/2):Math.floor(height/2);
    if(cut<1)throw new Error('This map region is too narrow to render at this resolution.');
    for(let part=0;part<2;part++){
      const offset=part?cut:0,w=horizontal?(part?width-cut:cut):width,h=horizontal?height:(part?height-cut:cut),b={...bounds};
      if(horizontal){b.west=bounds.west+(bounds.east-bounds.west)*offset/width;b.east=bounds.west+(bounds.east-bounds.west)*(offset+w)/width;}
      else{b.north=bounds.north-(bounds.north-bounds.south)*offset/height;b.south=bounds.north-(bounds.north-bounds.south)*(offset+h)/height;}
      const c=document.createElement('canvas');c.width=w;c.height=h;try{await paintPart(c.getContext('2d',{alpha:false}),source,b,w,h,signal,fetcher);context.drawImage(c,horizontal?offset:0,horizontal?0:offset);}finally{c.width=c.height=1;}
    }return;
  }
  const request=sourceRequest(source,bounds,requestWidth,requestHeight),response=await fetcher(request.url,{signal,type:request.type});
  let actual=bounds,blob=response;
  if(request.type==='json'){
    if(!response.href||!response.extent)throw new Error('The imagery service returned no usable map.');
    const href=new URL(response.href);if(href.protocol!=='https:'||href.hostname!=='services.arcgisonline.com')throw new Error('The map service returned an unexpected image address.');
    const extent=response.extent;actual={west:extent.xmin,south:extent.ymin,east:extent.xmax,north:extent.ymax};
    blob=await fetcher(href.href,{signal,type:'blob'});
  }
  abortCheck(signal);const image=await decodeImage(blob);
  try{const crop=rasterCrop(bounds,actual,image.width,image.height);context.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,width,height);}
  finally{image.close?.();}
}
export async function loadMapRaster({source='imagery',bounds,width,height,signal,fetcher=fetchMapResource}){
  abortCheck(signal);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));
  const context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('This browser could not create a map image.');context.fillStyle='#dce5db';context.fillRect(0,0,canvas.width,canvas.height);
  const fullSpan=longitudeSpan(bounds);let longitudeOffset=0;
  for(const part of splitDateLine(bounds)){
    const latitudes=[part.south,...[-85,85].filter(lat=>lat>part.south&&lat<part.north),part.north];
    const x=longitudeOffset/fullSpan*canvas.width,w=(part.east-part.west)/fullSpan*canvas.width;
    for(let i=1;i<latitudes.length;i++){
      abortCheck(signal);const b={...part,south:latitudes[i-1],north:latitudes[i]},h=(b.north-b.south)/(bounds.north-bounds.south)*canvas.height,y=(bounds.north-b.north)/(bounds.north-bounds.south)*canvas.height;
      const segment=document.createElement('canvas');segment.width=Math.max(1,Math.ceil(w));segment.height=Math.max(1,Math.ceil(h));
      try{await paintPart(segment.getContext('2d',{alpha:false}),b.south>=85||b.north<=-85?'earth':source,b,segment.width,segment.height,signal,fetcher);context.drawImage(segment,x,y,w,h);}
      finally{segment.width=segment.height=1;}
    }
    longitudeOffset+=part.east-part.west;
  }
  abortCheck(signal);return canvas;
}
export async function rasterJPEG(canvas,quality=.95){const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('The browser could not encode this map image.')),'image/jpeg',quality));return new Uint8Array(await blob.arrayBuffer());}
const searchCache=new Map();let searchAfter=0;
export async function searchPlaces(query,{signal,focus='world'}={}){
  const text=String(query).trim();if(text.length<2)throw new Error('Enter at least two letters, or use latitude, longitude.');
  const key=text.toLowerCase();let results=searchCache.get(key);
  if(!results){await pause(Math.max(0,searchAfter-Date.now()),signal);searchAfter=Date.now()+1100;
    const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:text,count:'20',language:'en',format:'json'});
    const data=await fetchMapResource(url.href,{signal,retries:1});results=data.results||[];searchCache.set(key,results);
  }
  return [...results].sort((a,b)=>focus==='anz'?Number(['AU','NZ'].includes(b.country_code))-Number(['AU','NZ'].includes(a.country_code)):0).slice(0,8);
}
