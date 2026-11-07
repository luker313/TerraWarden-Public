// All bounds are WGS84. East < west explicitly means crossing the date line.
export const SOURCES = Object.freeze({
  imagery: {name:'Satellite imagery', minimum:.15, credit:'Esri, Vantor, Earthstar Geographics and the GIS User Community', service:'World_Imagery'},
  topo: {name:'Topographic map', minimum:1, credit:'Esri, HERE, Garmin, USGS and the GIS User Community', service:'World_Topo_Map'},
  earth: {name:'NASA Blue Marble', minimum:500, credit:'NASA GIBS / Blue Marble; imagery by NASA Earth Observatory', layer:'BlueMarble_ShadedRelief_Bathymetry'}
});
export const REGIONS = Object.freeze({
  australia:{name:'Australia',west:112,south:-44,east:154,north:-10},
  wa:{name:'Western Australia',west:112,south:-36,east:129.1,north:-13},
  pilbara:{name:'Pilbara',west:114.8,south:-24,east:122.5,north:-20},
  nz:{name:'New Zealand',west:166,south:-48,east:179.8,north:-33.5},
  north:{name:'North Island',west:172.4,south:-41.8,east:179.5,north:-34},
  south:{name:'South Island',west:166,south:-47.5,east:174.7,north:-40.4},
  hawkes:{name:"Hawke's Bay",west:175.7,south:-40.6,east:178.3,north:-38.5},
  chatham:{name:'Chatham Islands',west:-177.1,south:-44.6,east:-175.7,north:-43.5},
  world:{name:'World',west:-180,south:-90,east:180,north:90}
});
export const PAPERS={a3:[1190.551,841.89],a2:[1683.78,1190.551],a1:[2383.937,1683.78]};
const RAD=Math.PI/180,R=6371008.8;
export const wrapLongitude=lon=>((lon+180)%360+360)%360-180;
export function longitudeSpan(bounds){return bounds.east>bounds.west?bounds.east-bounds.west:bounds.east+360-bounds.west;}
export function validateBounds(value){
  if(['west','south','east','north'].some(k=>value[k]===null||value[k]===undefined||String(value[k]).trim()===''))throw new Error('Enter all four area coordinates.');
  const b=Object.fromEntries(['west','south','east','north'].map(k=>[k,Number(value[k])]));
  if(!Object.values(b).every(Number.isFinite))throw new Error('Enter all four area coordinates.');
  if(b.south< -90||b.north>90||b.south>=b.north)throw new Error('South must be below north, between -90 and 90 degrees.');
  if(b.west< -180||b.west>180||b.east< -180||b.east>180||b.west===b.east||longitudeSpan(b)<=0)throw new Error('Use longitudes between -180 and 180; east below west crosses the date line.');
  if(b.north-b.south<1e-7||longitudeSpan(b)<1e-7)throw new Error('Choose a larger area.');
  return b;
}
export function dimensions(bounds){
  const b=validateBounds(bounds),lat=(b.north+b.south)/2,span=longitudeSpan(b);
  return {width:R*RAD*span*Math.max(.01,Math.cos(lat*RAD)),height:R*RAD*(b.north-b.south),area:R*R*span*RAD*(Math.sin(b.north*RAD)-Math.sin(b.south*RAD)),latitude:lat,longitude:wrapLongitude(b.west+span/2)};
}
export function splitDateLine(bounds){
  const b=validateBounds(bounds);return b.east>b.west?[b]:[
    ...(b.west<180?[{...b,east:180}]:[]),...(b.east> -180?[{...b,west:-180}]:[])
  ];
}
export function pageLayout(paper='a3',orientation='landscape',margin='terrain'){
  const size=PAPERS[paper];if(!size)throw new Error('Choose a supported page size.');
  const [width,height]=orientation==='portrait'?[size[1],size[0]]:size;
  // A real map viewport excludes the decorative border in both preview and PDF.
  const unit=width/1190.551;
  return {width,height,unit,margin,map:{x:34*unit,y:87*unit,width:width-68*unit,height:height-207*unit}};
}
export function fitMapFrame(layout,bounds){
  const d=dimensions(bounds),available=layout.map,ratio=d.width/d.height;
  let width=available.width,height=width/ratio;if(height>available.height){height=available.height;width=height*ratio;}
  return {x:available.x+(available.width-width)/2,y:available.y+(available.height-height)/2,width,height};
}
// Geographic partitions, rather than a single giant bitmap, keep each page
// usable on a phone. Partitions also prevent ambiguous >180-degree GeoPDF fits.
export function planMap(options={}){
  const bounds=validateBounds(options.bounds),source=SOURCES[options.source||'imagery'];if(!source)throw new Error('Choose a map source.');
  const layout=pageLayout(options.paper||'a3',options.orientation||'landscape',options.margin||'terrain');
  const detail=options.detail||'maximum',budget=options.pixelBudget||256_000_000;
  const d=dimensions(bounds),onlyPolar=bounds.north<=-85||bounds.south>=85;
  const nativeMinimum=onlyPolar?500:source.minimum;
  const requested=detail==='maximum'?Math.max(nativeMinimum,Math.sqrt(d.width*d.height/budget)):Number(options.metresPerPixel);
  if(!Number.isFinite(requested)||requested<.1||requested>100000)throw new Error('Resolution must be between 0.1 and 100,000 metres per pixel.');
  const resolution=Math.max(requested,nativeMinimum),sheetPixels=Number(options.sheetPixels)||8192;
  if(![4096,8192,16384].includes(sheetPixels))throw new Error('Choose a supported sheet detail.');
  const mode=options.mode==='single'?'single':'atlas';
  const sheets=[];let totalPixels=0;
  for(const part of splitDateLine(bounds)){
    const ground=dimensions(part),targetRatio=layout.map.width/layout.map.height;
    // Pixel limits are independent from the paper size. A3/A1 retain the same
    // ground resolution; the PDF image density changes with paper dimensions.
    const maxWidth=sheetPixels*(targetRatio<1?targetRatio:1),maxHeight=sheetPixels*(targetRatio>1?1/targetRatio:1);
    const nearestEquator=part.south<=0&&part.north>=0?0:Math.min(Math.abs(part.south),Math.abs(part.north)),maximumGroundWidth=R*RAD*longitudeSpan(part)*Math.cos(nearestEquator*RAD);
    const columns=Math.max(1,Math.ceil(longitudeSpan(part)/120),mode==='atlas'?Math.ceil(maximumGroundWidth/(resolution*maxWidth)):1);
    const rows=Math.max(1,Math.ceil((part.north-part.south)/60),mode==='atlas'?Math.ceil(ground.height/(resolution*maxHeight)):1);
    if(sheets.length+rows*columns>20000)throw new Error('This resolution needs more than 20,000 sheets. Increase metres per pixel or select a smaller area.');
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
      const b={west:part.west+(part.east-part.west)*col/columns,east:part.west+(part.east-part.west)*(col+1)/columns,north:part.north-(part.north-part.south)*row/rows,south:part.north-(part.north-part.south)*(row+1)/rows};
      const dim=dimensions(b),localMinimum=b.north<=-85||b.south>=85?500:source.minimum;
      const mpp=Math.max(resolution,localMinimum),width=Math.max(1,Math.ceil(dim.width/mpp)),height=Math.max(1,Math.ceil(dim.height/mpp));
      // Prevent pathological dimensions while retaining chunked single pages.
      if(width*height>1_100_000_000||Math.max(width,height)>1_000_000)throw new Error('This single sheet is too large. Choose atlas pages or a coarser resolution.');
      const pixels=width*height;totalPixels+=pixels;
      sheets.push({number:sheets.length+1,bounds:b,width,height,pixels,resolution:mpp,frame:fitMapFrame(layout,b),row,col});
    }
  }
  return {bounds,source:options.source||'imagery',sourceInfo:source,layout,resolution,requested,mode,sheets,totalPixels,estimatedBytes:Math.round(totalPixels*.55+sheets.length*380000+50000),polar:bounds.south< -85||bounds.north>85};
}
export function* rasterPatches(sheet,chunkSize=1024){
  const b=sheet.bounds,dx=b.east-b.west,dy=b.north-b.south;
  for(let y=0;y<sheet.height;y+=chunkSize)for(let x=0;x<sheet.width;x+=chunkSize){
    const width=Math.min(chunkSize,sheet.width-x),height=Math.min(chunkSize,sheet.height-y);
    yield {x,y,width,height,bounds:{west:b.west+dx*x/sheet.width,east:b.west+dx*(x+width)/sheet.width,north:b.north-dy*y/sheet.height,south:b.north-dy*(y+height)/sheet.height}};
  }
}
export function volumeRange(plan,start=1,limit=128_000_000){
  let pixels=0,end=Math.max(1,start)-1;
  for(const sheet of plan.sheets.slice(end)){if(pixels&&pixels+sheet.pixels>limit)break;pixels+=sheet.pixels;end=sheet.number;}
  return {start:Math.max(1,start),end,pixels};
}
export function niceDistance(metres){const power=10**Math.floor(Math.log10(Math.max(1,metres)));return [5,2,1].map(n=>n*power).find(n=>n<=metres)||power/2;}
export const resolutionText=mpp=>mpp>=1000?`${Number((mpp/1000).toFixed(2))} km/px`:`${Number(mpp.toFixed(mpp<1?2:1))} m/px`;
export function mapFilename(title,start,end){return `${String(title||'TerraWarden map').replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').trim().slice(0,100)||'TerraWarden map'}${start===end?'':`-sheets-${start}-${end}`}.geopdf.pdf`;}
