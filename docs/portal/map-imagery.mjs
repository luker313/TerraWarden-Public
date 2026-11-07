import {splitDateLine,dimensions,wrapLongitude} from './map-plan.mjs?v=20261108.1';
import {gridCRS,projectGeographic} from './coordinates.mjs';
import {abortCheck,fetchMapResource} from './map-source.mjs?v=20261108.1';

const DAY=86400000,ENDPOINT='https://earth-search.aws.element84.com/v1/search';
const trustedCOG=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['sentinel-cogs.s3.us-west-2.amazonaws.com','e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com'].includes(u.hostname);}catch{return false;}};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
export function captureRange(dates){const sorted=[...new Set(dates.filter(Boolean).map(d=>d.slice(0,10)))].sort();return sorted.length?sorted[0]===sorted.at(-1)?sorted[0]:`${sorted[0]} to ${sorted.at(-1)}`:'No capture date supplied';}
export function imagerySettings({days=90,cloud=30,endDate=new Date().toISOString().slice(0,10)}={}){
  const end=Date.parse(endDate+'T23:59:59Z');if(![30,90,365].includes(Number(days))||![10,30,60,100].includes(Number(cloud))||!Number.isFinite(end)||new Date(end).toISOString().slice(0,10)!==endDate)throw new Error('Choose a valid imagery period and cloud limit.');
  return {days:Number(days),cloud:Number(cloud),endDate,after:new Date(end-Number(days)*DAY).toISOString(),before:new Date(end).toISOString()};
}
export function stacRequest(bounds,settings,next){
  if(next){const u=new URL(next);if(u.origin!=='https://earth-search.aws.element84.com'||u.pathname!=='/v1/search')throw new Error('Unexpected imagery catalogue address.');return u.href;}
  const url=new URL(ENDPOINT);url.search=new URLSearchParams({collections:'sentinel-2-l2a',bbox:[bounds.west,bounds.south,bounds.east,bounds.north].join(','),datetime:`${settings.after}/${settings.before}`,query:JSON.stringify({'eo:cloud_cover':{lte:settings.cloud}}),sortby:'-properties.datetime',limit:'250',fields:'id,bbox,geometry,properties.datetime,properties.eo:cloud_cover,properties.proj:epsg,properties.grid:code,assets.visual,assets.scl'});return url.href;
}
export function selectScenes(items,settings,maxPerTile=2){
  const seen=new Set(),tiles=new Map();
  for(const item of [...items].sort((a,b)=>String(b.properties?.datetime||'').localeCompare(String(a.properties?.datetime||'')))){
    const p=item.properties||{},time=Date.parse(p.datetime),asset=item.assets?.visual,epsg=Number(p['proj:epsg']||String(p['proj:code']||'').replace('EPSG:','')),bbox=item.bbox;
    if(seen.has(item.id)||!asset||!trustedCOG(asset.href)||!Number.isFinite(time)||time<Date.parse(settings.after)||time>Date.parse(settings.before)||!Number.isFinite(p['eo:cloud_cover'])||p['eo:cloud_cover']>settings.cloud||!bbox||bbox.length<4||!bbox.every(Number.isFinite)||!((epsg>=32601&&epsg<=32660)||(epsg>=32701&&epsg<=32760)))continue;
    const tile=p['grid:code']||item.id?.match(/_(\d{2}[A-Z]{3})_/)?.[1]||item.id,group=tiles.get(tile)||[];
    if(group.length>=maxPerTile)continue;seen.add(item.id);
    group.push({id:item.id,tile,time:p.datetime,cloud:p['eo:cloud_cover'],bbox:[...bbox],geometry:item.geometry,epsg,visual:asset.href,scl:trustedCOG(item.assets?.scl?.href)?item.assets.scl.href:null});tiles.set(tile,group);
  }
  return [...tiles.values()].flat().sort((a,b)=>b.time.localeCompare(a.time));
}
export async function findRecentScenes(bounds,options={},signal,fetchJSON=fetchMapResource,progress=()=>{}){
  const settings=imagerySettings(options),raw=[],seenURLs=new Set();let truncated=false;
  for(const part of splitDateLine(bounds)){
    let url=stacRequest(part,settings),page=0;
    while(url){abortCheck(signal);if(seenURLs.has(url))break;seenURLs.add(url);progress(`Searching recent captures · page ${page+1}`);
      const data=await fetchJSON(url,{signal});if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('The imagery catalogue returned no usable scene list.');
      // Retain only the two raster assets needed for rendering. Keeping every
      // spectral band/JP2 link from thousands of STAC items wastes mobile RAM.
      raw.push(...data.features.map(f=>({id:f.id,bbox:f.bbox,geometry:f.geometry,properties:f.properties,assets:{visual:f.assets?.visual,scl:f.assets?.scl}})));page++;const next=data.links?.find(link=>link.rel==='next')?.href;
      if(page>=24&&next){truncated=true;break;}url=next?stacRequest(part,settings,next):null;
    }
  }
  const scenes=selectScenes(raw,settings);if(!scenes.length)throw new Error('No recent Sentinel-2 scenes meet this period and cloud limit. Increase the period or cloud limit, or choose the detailed imagery mosaic.');
  return {settings,scenes,truncated,dates:captureRange(scenes.map(s=>s.time))};
}
const intersection=(a,b)=>{const west=Math.max(a.west,b[0]),south=Math.max(a.south,b[1]),east=Math.min(a.east,b[2]),north=Math.min(a.north,b[3]);return west<east&&south<north?{west,south,east,north}:null;};
function sceneCRS(scene){return gridCRS('wgs84',scene.epsg%100,scene.epsg<32700);}
export function projectedEnvelope(bounds,crs){
  const points=[];for(let i=0;i<=8;i++){const t=i/8;for(const p of [{longitude:bounds.west+(bounds.east-bounds.west)*t,latitude:bounds.south},{longitude:bounds.west+(bounds.east-bounds.west)*t,latitude:bounds.north},{longitude:bounds.west,latitude:bounds.south+(bounds.north-bounds.south)*t},{longitude:bounds.east,latitude:bounds.south+(bounds.north-bounds.south)*t}]){const g=projectGeographic(p,crs);if(g)points.push(g);}}
  if(!points.length)return null;return [Math.min(...points.map(p=>p.easting)),Math.min(...points.map(p=>p.northing)),Math.max(...points.map(p=>p.easting)),Math.max(...points.map(p=>p.northing))];
}
export function rasterWindow(image,reference,envelope){
  let origin;try{origin=image.getOrigin();}catch{origin=reference.getOrigin();}const resolution=image.getResolution(reference),[rx,ry]=resolution;
  if(!(rx>0&&ry<0))throw new Error('Unsupported imagery grid direction.');
  const window=[Math.max(0,Math.floor((envelope[0]-origin[0])/rx)),Math.max(0,Math.floor((envelope[3]-origin[1])/ry)),Math.min(image.getWidth(),Math.ceil((envelope[2]-origin[0])/rx)),Math.min(image.getHeight(),Math.ceil((envelope[1]-origin[1])/ry))];
  if(window[2]<=window[0]||window[3]<=window[1])return null;
  return {window,x:origin[0]+window[0]*rx,y:origin[1]+window[1]*ry,rx,ry,width:window[2]-window[0],height:window[3]-window[1]};
}
const clearClasses=new Set([2,4,5,6,7]);
export function clearSCL(value){return clearClasses.has(value);}
export class RecentImagerySession {
  constructor(catalog,{openTIFF,makeCanvas}={}){Object.assign(this,catalog);this.readers=new Map();this.pages=new Map();this.openTIFF=openTIFF;this.makeCanvas=makeCanvas||(()=>document.createElement('canvas'));}
  async reader(url,signal){
    abortCheck(signal);let value=this.readers.get(url);if(value){this.readers.delete(url);this.readers.set(url,value);return value;}
    value=(async()=>{const fromUrl=this.openTIFF||(await import('./vendor/geotiff.mjs')).fromUrl,tiff=await fromUrl(url,{allowFullFile:false,blockSize:65536,cacheSize:16},signal),base=await tiff.getImage();return {tiff,base,count:await tiff.getImageCount()};})();
    this.readers.set(url,value);if(this.readers.size>16)this.readers.delete(this.readers.keys().next().value);
    try{return await value;}catch(error){this.readers.delete(url);throw error;}
  }
  async read(url,envelope,metres,samples,signal){
    const reader=await this.reader(url,signal);let image=reader.base;
    for(let i=1;i<reader.count;i++){abortCheck(signal);const next=await reader.tiff.getImage(i),r=next.getResolution(reader.base);if(Math.max(Math.abs(r[0]),Math.abs(r[1]))<=metres*1.05)image=next;else break;}
    let grid=rasterWindow(image,reader.base,envelope);if(!grid)return null;
    if(grid.width*grid.height>8_000_000)throw new Error('This imagery patch is too large to decode safely. Select a coarser output resolution.');
    const data=await image.readRasters({window:grid.window,samples,interleave:true,signal});return {...grid,data};
  }
  informationForSheet(number){const p=this.pages.get(number),dates=p?[...p.dates]:this.scenes.map(s=>s.time);return {label:dates.length?`Captured ${captureRange(dates)}`:'No clear capture in the selected period',dates:captureRange(dates),recent:true,missing:p&&p.total?1-p.filled/p.total:null,note:'Hatching: no clear capture in the selected period'};}
  async render({bounds,width,height,signal,sheetNumber,progress=()=>{}}){
    abortCheck(signal);const canvas=this.makeCanvas();canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),output=ctx.createImageData(width,height),pixels=output.data,mask=new Uint8Array(width*height),used=new Set();let filled=0;
    const ground=dimensions(bounds),metres=Math.max(10,Math.min(ground.width/width,ground.height/height));
    let candidate=0;
    for(const scene of this.scenes){
      abortCheck(signal);const hit=intersection(bounds,scene.bbox);if(!hit)continue;
      const x0=Math.max(0,Math.floor((hit.west-bounds.west)/(bounds.east-bounds.west)*width)),x1=Math.min(width,Math.ceil((hit.east-bounds.west)/(bounds.east-bounds.west)*width)),y0=Math.max(0,Math.floor((bounds.north-hit.north)/(bounds.north-bounds.south)*height)),y1=Math.min(height,Math.ceil((bounds.north-hit.south)/(bounds.north-bounds.south)*height));
      let needed=false;for(let y=y0;y<y1&&!needed;y++)for(let x=x0;x<x1;x++)if(!mask[y*width+x]){needed=true;break;}if(!needed)continue;
      progress(`Reading capture ${scene.time.slice(0,10)} · scene ${++candidate}`);const crs=sceneCRS(scene),envelope=projectedEnvelope(hit,crs);if(!envelope)continue;
      const rgb=await this.read(scene.visual,envelope,metres,[0,1,2],signal);if(!rgb)continue;
      const scl=scene.scl?await this.read(scene.scl,envelope,Math.max(20,metres),[0],signal):null;
      for(let y=y0;y<y1;y++){
        if((y-y0)%24===0){await tick();abortCheck(signal);}const latitude=bounds.north-(y+.5)/height*(bounds.north-bounds.south);
        for(let x=x0;x<x1;x++){
          const index=y*width+x;if(mask[index])continue;const longitude=bounds.west+(x+.5)/width*(bounds.east-bounds.west),p=projectGeographic({latitude,longitude:wrapLongitude(longitude)},crs);if(!p)continue;
          const gx=Math.floor((p.easting-rgb.x)/rgb.rx),gy=Math.floor((p.northing-rgb.y)/rgb.ry);if(gx<0||gy<0||gx>=rgb.width||gy>=rgb.height)continue;
          if(scl){const sx=Math.floor((p.easting-scl.x)/scl.rx),sy=Math.floor((p.northing-scl.y)/scl.ry);if(sx<0||sy<0||sx>=scl.width||sy>=scl.height||!clearSCL(scl.data[sy*scl.width+sx]))continue;}
          const source=(gy*rgb.width+gx)*3,r=rgb.data[source],g=rgb.data[source+1],b=rgb.data[source+2];if(!(r|g|b))continue;
          pixels[index*4]=r;pixels[index*4+1]=g;pixels[index*4+2]=b;pixels[index*4+3]=255;mask[index]=1;filled++;used.add(scene.time);
        }
      }
      if(filled===width*height)break;
    }
    // Missing/cloudy pixels are conspicuous. Never substitute an older basemap
    // beneath a fresh capture date or hide gaps as if they were current data.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(mask[i])continue;const value=(x+y)%14<3?159:222;pixels[i*4]=value;pixels[i*4+1]=value+4;pixels[i*4+2]=value+1;pixels[i*4+3]=255;}
    ctx.putImageData(output,0,0);canvas.imageryInfo={label:filled?`Captured ${captureRange([...used])}`:'No clear capture for this view',dates:captureRange([...used]),recent:true,missing:1-filled/(width*height),note:'Hatching: no clear capture in the selected period'};
    if(sheetNumber){const page=this.pages.get(sheetNumber)||{dates:new Set(),total:0,filled:0};for(const date of used)page.dates.add(date);page.total+=width*height;page.filled+=filled;this.pages.set(sheetNumber,page);}
    abortCheck(signal);return canvas;
  }
}
export function esriCaptureDate(attributes={}){
  const raw=String(attributes.SRC_DATE||'');if(/^\d{8}$/.test(raw)){const date=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`,parsed=new Date(date);if(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date)return date;}
  const match=String(attributes.SRC_DATE2||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(match)return `${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;return null;
}
export async function inspectMosaic(bounds,resolution,signal,fetchJSON=fetchMapResource){
  const d=dimensions(bounds),dy=resolution*160/111195,dx=dy/Math.max(.1,Math.cos(d.latitude*Math.PI/180)),url=new URL('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify');
  url.search=new URLSearchParams({f:'json',geometry:`${d.longitude},${d.latitude}`,geometryType:'esriGeometryPoint',sr:'4326',layers:'visible:5,6,7,8,9,10,11,12,13,14,15,16,17,18',tolerance:'0',mapExtent:[d.longitude-dx,d.latitude-dy,d.longitude+dx,d.latitude+dy].join(','),imageDisplay:'320,320,96',returnGeometry:'false'});
  const data=await fetchJSON(url.href,{signal,retries:0}),attributes=data.results?.find(result=>esriCaptureDate(result.attributes))?.attributes,date=attributes&&esriCaptureDate(attributes);
  return {label:date?`Centre capture: ${date}; mosaic dates vary`:'Capture date unavailable; mosaic dates vary',dates:date||null,centreOnly:true,description:attributes?.NICE_NAME||attributes?.SRC_DESC||''};
}
