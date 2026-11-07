import {REGIONS,planMap,dimensions,longitudeSpan,wrapLongitude,volumeRange,resolutionText,mapFilename} from './map-plan.mjs?v=20261108.1';
import {loadMapRaster,rasterJPEG,searchPlaces,abortCheck} from './map-source.mjs?v=20261108.1';
import {marginScene,paintMargin,featureScene,paintFeatures,exportMapAtlas,blobSink} from './map-pdf.mjs?v=20261108.1';
import {findRecentScenes,RecentImagerySession,inspectMosaic,imagerySettings} from './map-imagery.mjs?v=20261108.1';
import {previewPlan,previewRequest,previewPlacement,previewSize,detailRasterSize,PreviewQueue} from './map-preview.mjs?v=20261108.1';
const $=id=>document.getElementById(id),dialog=$('map-studio'),canvas=$('studio-canvas'),context=canvas.getContext('2d');
const ids=['north','west','south','east','source','quality','mpp','layout','sheet-pixels','map-title','paper','orientation','margin','layers','days','cloud'];
const fileSize=bytes=>bytes>=1e9?`${(bytes/1e9).toFixed(1)} GB`:bytes>=1e6?`${(bytes/1e6).toFixed(bytes<10e6?1:0)} MB`:`${Math.ceil(bytes/1000)} KB`;
const canonical=view=>{const span=Math.min(360,view.east-view.west);if(span>=359.999999)return {west:-180,east:180,south:view.south,north:view.north};const west=wrapLongitude(view.west),east=west+span;return {west,east:east>180?east-360:east,south:view.south,north:view.north};};
const smallArea=(latitude,longitude,radius=.16)=>({south:Math.max(-90,latitude-radius),north:Math.min(90,latitude+radius),west:wrapLongitude(longitude-radius/Math.max(.1,Math.cos(latitude*Math.PI/180))),east:wrapLongitude(longitude+radius/Math.max(.1,Math.cos(latitude*Math.PI/180)))});
const img=async url=>{const value=new Image();value.src=url;await value.decode();return value;};
export function createMapStudio({onOpenMap,getFeatures=()=>[],toast=()=>{}}={}){
  const s={mode:'area',sheet:1,plan:null,exportPlan:null,planSettingsKey:null,previewDate:null,view:{west:100,east:184,south:-53,north:-3},selecting:false,busy:false,images:{},raster:null,rasterBounds:null,rasterContentKey:'',previewFallback:false,exportController:null,previewZoom:1,printPan:{x:0,y:0},detailZoom:1,detailCentre:{x:.5,y:.5},download:null,resize:null};
  let drawFrame,planTimer,drag=null,pinch=null,assetPromise,fontBytes,resultBlob,resultHandle,resultFilename,lastRange=null,metadataTimer,metadataController,metadataPromise,metadataKey,recentSession,recentKey,imageryInfo,lastResultKey;
  const pointers=new Map();
  function settings(){return {bounds:Object.fromEntries(['north','west','south','east'].map(k=>[k,$('studio-'+k).value])),source:$('studio-source').value,detail:$('studio-quality').value==='maximum'?'maximum':'custom',metresPerPixel:$('studio-quality').value==='custom'?$('studio-mpp').value:$('studio-quality').value,mode:$('studio-layout').value,paper:$('studio-paper').value,orientation:$('studio-orientation').value,margin:$('studio-margin').value,sheetPixels:Number($('studio-sheet-pixels').value)};}
  const title=()=>$('studio-map-title').value.trim()||'TerraWarden field map';
  const resultKey=()=>JSON.stringify({settings:settings(),title:title(),layers:$('studio-layers').checked,date:dateOptions()});
  function invalidateResult(){if(lastResultKey&&lastResultKey!==resultKey()){if(s.download)URL.revokeObjectURL(s.download);s.download=null;resultBlob=null;resultHandle=null;lastResultKey=null;$('studio-download').hidden=true;$('studio-open-map').hidden=true;}}
  const sheet=()=>s.plan?.sheets[s.sheet-1];
  function save(){try{localStorage.setItem('tw.portal.mapStudio.v1',JSON.stringify({...Object.fromEntries(ids.map(id=>[id,$('studio-'+id).type==='checkbox'?$('studio-'+id).checked:$('studio-'+id).value])),shapeVersion:2}));}catch{/* Preferences do not affect map creation. */}}
  function restore(){let data;try{data=JSON.parse(localStorage.getItem('tw.portal.mapStudio.v1'));}catch{}if(data&&typeof data==='object'){for(const id of ids){const el=$('studio-'+id);if(data[id]!==undefined){if(el.type==='checkbox')el.checked=!!data[id];else el.value=String(data[id]);}}if(data.shapeVersion!==2)$('studio-paper').value='fit';}else setBounds(REGIONS.australia,false);}
  const dateOptions=()=>({days:Number($('studio-days').value),cloud:Number($('studio-cloud').value),endDate:$('studio-date-end').value});
  const sessionKey=(plan,bounds=plan.bounds,date=s.previewDate||dateOptions())=>JSON.stringify({bounds,...date});
  function showImageryInfo(info){imageryInfo=info;$('studio-imagery-date').textContent=info.label;const recent=s.plan?.source==='recent';$('studio-imagery-note').textContent=recent?`10 m native detail. Cloud/shadow pixels are masked; hatched gaps have no clear capture in this period.${info.missing!=null?` ${Math.round(info.missing*100)}% of this preview is uncovered.`:''}${recentSession?.truncated?' Catalogue limit reached; split the selection for fuller coverage.':''}`:s.plan?.source==='imagery'?(info.description?`${info.description}. `:'')+'Dates vary across the map and by output sampling. Use recent Sentinel-2 when the capture date matters.':s.plan?.source==='earth'?'Historical global overview, including poles. This is not recent satellite imagery.':'A cartographic basemap; no single imagery capture date applies.';draw();}
  function updateImagery(){
    const plan=s.plan;if(!plan)return;$('studio-date-controls').hidden=plan.source!=='recent';$('studio-recent').hidden=plan.source==='recent';
    const page=sheet(),key=JSON.stringify({source:plan.source,bounds:page.bounds,resolution:plan.source==='imagery'?page.resolution:null,date:plan.source==='recent'?s.previewDate:null});
    if(metadataKey===key)return;metadataKey=key;clearTimeout(metadataTimer);metadataController?.abort();metadataPromise=null;
    if(plan.source==='recent'){showImageryInfo({label:'Dated captures load in Print preview or Inspect detail',recent:true});return;}
    showImageryInfo({label:plan.source==='imagery'?'Checking capture date at map centre…':plan.source==='earth'?'Historic composite · not current imagery':'Cartographic basemap · capture date not applicable'});
    if(plan.source==='imagery')metadataTimer=setTimeout(()=>{const controller=new AbortController();metadataController=controller;metadataPromise=inspectMosaic(page.bounds,page.resolution,controller.signal).then(info=>{if(metadataKey===key&&!controller.signal.aborted)showImageryInfo(info);return info;}).catch(()=>{const info={label:'Capture date unavailable; mosaic may be years old'};if(metadataKey===key&&!controller.signal.aborted)showImageryInfo(info);return info;});},400);
  }
  async function recent(plan,signal,progress,bounds=plan.bounds,date=s.previewDate||dateOptions(),isolated=false){
    const key=sessionKey(plan,bounds,date);if(!isolated&&recentSession&&recentKey===key)return recentSession;
    const catalog=await findRecentScenes(bounds,date,signal,undefined,progress);abortCheck(signal);const session=new RecentImagerySession(catalog);
    if(!isolated){recentSession=session;recentKey=key;}return session;
  }
  async function assets(){if(!assetPromise)assetPromise=Promise.all([
    img(new URL('../assets/branding/terrawarden-logo.png',import.meta.url).href),
    img(new URL('../assets/branding/terrawarden-wordmark-dark.png',import.meta.url).href),
    img(new URL('../assets/branding/terrawarden-wordmark-light.png',import.meta.url).href),
    fetch(new URL('./vendor/standard_fonts/LiberationSans-Regular.ttf',import.meta.url)).then(r=>{if(!r.ok)throw new Error('The map font could not be loaded.');return r.arrayBuffer();}),document.fonts.load('12px MapPrint')
  ]).then(([logo,darkWord,lightWord,font])=>{s.images={logo,darkWord,lightWord};fontBytes=font;draw();}).catch(error=>{assetPromise=null;throw error;});return assetPromise;}
  function currentImages(){return {logo:s.images.logo,wordmark:s.plan?.layout.margin==='paper'?s.images.lightWord:s.images.darkWord};}
  function setBounds(value,update=true){for(const k of ['north','west','south','east'])$('studio-'+k).value=Number(value[k].toFixed(8));if(update)replan(true);}
  function fitArea(bounds){
    const d=dimensions(bounds),w=canvas.clientWidth||900,h=canvas.clientHeight||500,cos=Math.max(.08,Math.cos(d.latitude*Math.PI/180));let dx=longitudeSpan(bounds)*1.2,dy=(bounds.north-bounds.south)*1.2;
    if(dx*cos/dy<w/h)dx=dy*w/h/cos;else dy=dx*cos*h/w;
    dx=Math.min(360,dx);dy=Math.min(180,dy);const centreLat=Math.max(-90+dy/2,Math.min(90-dy/2,d.latitude)),centreLon=bounds.west+longitudeSpan(bounds)/2;
    s.view={west:centreLon-dx/2,east:centreLon+dx/2,south:centreLat-dy/2,north:centreLat+dy/2};
  }
  function resetRange(start=1){if(!s.exportPlan)return;const range=$('studio-direct').checked?{start,end:s.exportPlan.sheets.length}:volumeRange(s.exportPlan,start);$('studio-from').value=range.start;$('studio-to').value=range.end;rangeMessage();}
  function rangeMessage(){
    if(!s.exportPlan||s.busy)return;const from=Number($('studio-from').value),to=Number($('studio-to').value),pages=s.exportPlan.sheets.length,valid=Number.isInteger(from)&&Number.isInteger(to)&&from>=1&&to>=from&&to<=pages;
    $('studio-export').disabled=!valid;
    $('studio-next-volume').hidden=!(lastRange&&lastRange.to<pages);
    if(!valid){$('studio-progress-text').textContent=`Enter a sheet range from 1 to ${pages}.`;return;}
    const pixels=s.exportPlan.sheets.slice(from-1,to).reduce((sum,p)=>sum+p.pixels,0),estimated=pixels*.55+(to-from+1)*380000+50000;
    $('studio-progress-text').textContent=`${to-from+1} sheet${to===from?'':'s'} · approximately ${fileSize(estimated)}${to<pages?' · export the remaining sheets in the next part':''}${$('studio-direct').checked?' · writes directly to your file':''}`;
    if(!$('studio-direct').checked&&pixels>280_000_000){$('studio-progress-text').textContent+=' · reduce this range for a mobile download';}
  }
  function replan(refit=false){
    if(s.busy)return;clearTimeout(planTimer);planTimer=null;invalidateResult();for(const option of $('studio-quality').options)option.disabled=$('studio-source').value==='recent'&&Number(option.value)>0&&Number(option.value)<10;if($('studio-quality').selectedOptions[0]?.disabled)$('studio-quality').value='10';$('studio-custom-field').hidden=$('studio-quality').value!=='custom';$('studio-sheet-pixels').disabled=$('studio-layout').value==='single';$('studio-orientation').disabled=$('studio-paper').value==='fit';
    const options=settings();s.planSettingsKey=JSON.stringify({options,date:dateOptions()});let exportError;
    try{if(options.source==='recent')imagerySettings(dateOptions());s.exportPlan=planMap(options);}catch(error){s.exportPlan=null;exportError=error;}
    const preview=previewPlan(options,s.exportPlan,s.plan||{bounds:REGIONS.australia});s.plan=preview.plan;s.previewFallback=preview.fallback;
    try{imagerySettings(dateOptions());s.previewDate=dateOptions();}catch{s.previewDate??={days:90,cloud:30,endDate:new Date().toISOString().slice(0,10)};}
    if(!s.plan)return;
    s.sheet=refit?1:Math.max(1,Math.min(s.sheet,s.plan.sheets.length));const d=dimensions(s.plan.bounds);
    $('studio-stat-resolution').textContent=s.exportPlan?resolutionText(s.exportPlan.resolution):'—';$('studio-stat-area').textContent=d.area<1e6?`${Math.round(d.area).toLocaleString('en')} m²`:`${Math.round(d.area/1e6).toLocaleString('en')} km²`;$('studio-stat-pages').textContent=s.exportPlan?s.exportPlan.sheets.length.toLocaleString('en'):'—';$('studio-stat-size').textContent=s.exportPlan?`~${fileSize(s.exportPlan.estimatedBytes)}`:'—';
    for(const id of ['from','to'])$('studio-'+id).max=s.exportPlan?.sheets.length||1;
    $('studio-sheet').max=s.plan.sheets.length;$('studio-sheet').value=s.sheet;$('studio-sheet-total').textContent=`of ${s.plan.sheets.length}`;$('studio-prev-sheet').disabled=s.sheet===1;$('studio-next-sheet').disabled=s.sheet===s.plan.sheets.length;
    const messages=[];
    if(exportError){messages.push(`Export: ${exportError.message}`,preview.previousArea?'Preview keeps the last valid area while you edit coordinates.':'Preview remains available at screen resolution; export settings still need adjusting.');if(options.source==='recent'&&JSON.stringify(dateOptions())!==JSON.stringify(s.previewDate))messages.push('Preview keeps the last valid imagery period.');}
    else{
      if(s.plan.sheets.length>1)messages.push(`${s.plan.sheets.length} individually georeferenced sheets. A shared border and sheet numbers keep the atlas organised.`);
      else messages.push('The border, coordinates and north arrow stay sharp at every zoom.');
      if(s.plan.polar&&s.plan.source!=='earth')messages.push(s.plan.source==='recent'?'Sentinel-2 has limited polar/ocean coverage; unavailable pixels are hatched.':'Beyond 85° latitude, NASA Blue Marble supplies 500 m polar imagery.');
      if(s.plan.requested<s.plan.resolution)messages.push(`This source is limited to ${resolutionText(s.plan.resolution)} output.`);
      if(s.plan.mode==='single'&&s.plan.sheets.length>1)messages.push('Very wide areas and date-line crossings are split to keep geographic alignment reliable.');
      if(s.plan.layout.paper==='fit')messages.push('Page shape follows each map; the border scales with its shorter edge.');
      messages.push('File sizes are estimates; imagery detail varies by location.');
    }
    $('studio-plan-note').classList.toggle('error',!!exportError);$('studio-plan-note').textContent=messages.join(' ');
    $('studio-export').disabled=!s.exportPlan;$('studio-next-volume').hidden=true;
    if(refit){fitArea(s.plan.bounds);s.printPan={x:0,y:0};s.previewZoom=1;s.detailCentre={x:.5,y:.5};}
    lastRange=null;if(s.exportPlan)resetRange();else $('studio-progress-text').textContent='Adjust export settings to create the GeoPDF. You can still browse the preview.';
    save();updateImagery();schedulePreview();
  }
  function viewportPixels(){const dpr=Math.min(2,window.devicePixelRatio||1);return {width:Math.max(16,Math.round(canvas.clientWidth*dpr)),height:Math.max(16,Math.round(canvas.clientHeight*dpr))};}
  function detailBounds(){
    const p=sheet(),size=previewSize(viewportPixels(),p.bounds,'detail',s.plan.source),b=p.bounds,fx=Math.min(1,size.width/p.width/s.detailZoom),fy=Math.min(1,size.height/p.height/s.detailZoom),x=Math.max(fx/2,Math.min(1-fx/2,s.detailCentre.x)),y=Math.max(fy/2,Math.min(1-fy/2,s.detailCentre.y));s.detailCentre={x,y};
    return {west:b.west+(x-fx/2)*(b.east-b.west),east:b.west+(x+fx/2)*(b.east-b.west),north:b.north-(y-fy/2)*(b.north-b.south),south:b.north-(y+fy/2)*(b.north-b.south)};
  }
  function requestPreview(){
    if(!s.plan)return null;const p=sheet(),bounds=s.mode==='area'?canonical(s.view):s.mode==='print'?p.bounds:detailBounds();
    return previewRequest({mode:s.mode,source:s.plan.source,bounds,size:s.mode==='detail'?detailRasterSize(p,bounds,previewSize(viewportPixels(),p.bounds,'detail',s.plan.source)):viewportPixels(),date:s.previewDate,catalogBounds:p.bounds});
  }
  const previews=new PreviewQueue({
    load:async(request,signal,progress)=>{
      if(request.source!=='recent')return loadMapRaster({...request,signal});
      const session=await recent(s.plan,signal,progress,request.catalogBounds,request.date);
      return session.render({...request,signal,progress});
    },
    ready:(raster,request)=>{s.raster=raster;s.rasterBounds=request.bounds;s.rasterContentKey=request.contentKey;if(raster.imageryInfo)showImageryInfo(raster.imageryInfo);draw();},
    loading:(busy,message)=>{$('studio-preview-loading').hidden=!busy;if(message)$('studio-preview-loading').textContent=message;},
    error:error=>{$('studio-preview-error').querySelector('span').textContent=error.message;$('studio-preview-error').hidden=false;}
  });
  function schedulePreview(delay=160,force=false){
    if(!dialog.open)return;const request=requestPreview();$('studio-preview-error').hidden=true;draw();if(request)previews.request(request,delay,{force});
  }
  function paintRaster(bounds,width,height){
    const request=requestPreview();if(!s.raster||s.rasterContentKey!==request?.contentKey)return false;
    const r=previewPlacement(s.rasterBounds,bounds,width,height);context.save();context.beginPath();context.rect(0,0,width,height);context.clip();context.drawImage(s.raster,r.x,r.y,r.width,r.height);context.restore();return true;
  }
  function screenPoint(e){const rect=canvas.getBoundingClientRect();return {x:e.clientX-rect.left,y:e.clientY-rect.top};}
  function geographic(p,view=s.view){return {longitude:view.west+p.x/canvas.clientWidth*(view.east-view.west),latitude:view.north-p.y/canvas.clientHeight*(view.north-view.south)};}
  function screenGeo(lon,lat){const centre=(s.view.west+s.view.east)/2;while(lon-centre>180)lon-=360;while(lon-centre< -180)lon+=360;return {x:(lon-s.view.west)/(s.view.east-s.view.west)*canvas.clientWidth,y:(s.view.north-lat)/(s.view.north-s.view.south)*canvas.clientHeight};}
  function areaRect(b){const centre=(s.view.west+s.view.east)/2;let west=b.west;const span=longitudeSpan(b);while(west+span/2-centre>180)west-=360;while(west+span/2-centre< -180)west+=360;return {x:(west-s.view.west)/(s.view.east-s.view.west)*canvas.clientWidth,y:(s.view.north-b.north)/(s.view.north-s.view.south)*canvas.clientHeight,width:span/(s.view.east-s.view.west)*canvas.clientWidth,height:(b.north-b.south)/(s.view.north-s.view.south)*canvas.clientHeight};}
  function drawArea(){
    const w=canvas.clientWidth,h=canvas.clientHeight;context.fillStyle='#dbe7df';context.fillRect(0,0,w,h);
    if(s.raster&&s.rasterContentKey===requestPreview()?.contentKey){const r=areaRect(s.rasterBounds);context.drawImage(s.raster,r.x,r.y,r.width,r.height);}
    else {context.fillStyle='#bfd5ca';for(let x=0;x<w;x+=40)context.fillRect(x,0,.6,h);for(let y=0;y<h;y+=40)context.fillRect(0,y,w,.6);}
    if(!s.plan)return;
    const selection=areaRect(s.plan.bounds);context.fillStyle='#071e1860';context.beginPath();context.rect(0,0,w,h);context.rect(selection.x,selection.y,selection.width,selection.height);context.fill('evenodd');
    context.strokeStyle='#00ee54';context.lineWidth=2;context.strokeRect(selection.x,selection.y,selection.width,selection.height);
    for(const p of s.plan.sheets.length<=500?s.plan.sheets:[sheet()]){const r=areaRect(p.bounds);if(r.x+r.width<0||r.x>w||r.y+r.height<0||r.y>h)continue;context.strokeStyle=p.number===s.sheet?'#ffffff':'#c7ffd8a0';context.lineWidth=p.number===s.sheet?2.5:.8;context.strokeRect(r.x,r.y,r.width,r.height);if(r.width>35&&r.height>25){context.font='11px Arial';const text=String(p.number),tw=context.measureText(text).width;context.fillStyle=p.number===s.sheet?'#174d3a':'#174d3ab8';context.fillRect(r.x+5,r.y+5,tw+12,21);context.fillStyle='#fff';context.fillText(text,r.x+11,r.y+20);}}
    if(drag?.select&&drag.end){context.setLineDash([5,4]);context.strokeStyle='#fff';context.lineWidth=2;context.strokeRect(drag.start.x,drag.start.y,drag.end.x-drag.start.x,drag.end.y-drag.start.y);context.setLineDash([]);}
  }
  function drawPrint(){
    if(!s.plan)return;const p=sheet(),l=p.layout||s.plan.layout,w=canvas.clientWidth,h=canvas.clientHeight,scale=Math.min((w-45)/l.width,(h-45)/l.height)*s.previewZoom,x=(w-l.width*scale)/2+s.printPan.x,y=(h+l.height*scale)/2+s.printPan.y;
    context.save();context.translate(x,y);context.scale(scale,-scale);context.shadowColor='#0003';context.shadowBlur=16;context.shadowOffsetY=3;context.fillStyle='#f7f8f3';context.fillRect(0,0,l.width,l.height);context.shadowColor='transparent';
    context.beginPath();context.rect(0,0,l.width,l.height);context.clip();paintMargin(context,marginScene({plan:s.plan,sheet:p,title:title(),imageryInfo}),currentImages());const f=p.frame;
    if(s.raster&&s.rasterContentKey===requestPreview()?.contentKey){context.fillStyle='#d1dfd3';context.fillRect(f.x,f.y,f.width,f.height);context.save();context.translate(f.x,f.y+f.height);context.scale(1,-1);paintRaster(p.bounds,f.width,f.height);context.restore();}
    else{context.fillStyle='#d1dfd3';context.fillRect(f.x,f.y,f.width,f.height);context.save();context.translate(f.x+f.width/2,f.y+f.height/2);context.scale(1,-1);context.font='12px MapPrint, Arial';context.textAlign='center';context.fillStyle='#456653';context.fillText('Map imagery preview',0,0);context.restore();}
    if($('studio-layers').checked)paintFeatures(context,featureScene(getFeatures(),p),f);context.restore();
  }
  function drawDetail(){
    context.fillStyle='#d1dfd3';context.fillRect(0,0,canvas.clientWidth,canvas.clientHeight);paintRaster(detailBounds(),canvas.clientWidth,canvas.clientHeight);
    const x=canvas.clientWidth/2,y=canvas.clientHeight/2;context.strokeStyle='#ffffffb0';context.lineWidth=1;context.beginPath();context.moveTo(x-12,y);context.lineTo(x+12,y);context.moveTo(x,y-12);context.lineTo(x,y+12);context.stroke();
  }
  function draw(){if(!drawFrame)drawFrame=requestAnimationFrame(()=>{drawFrame=null;drawNow();});}
  function drawNow(){
    if(!dialog.open)return;const w=canvas.clientWidth,h=canvas.clientHeight;if(w<1||h<1)return;const dpr=Math.min(2,window.devicePixelRatio||1);const pw=Math.round(w*dpr),ph=Math.round(h*dpr);if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,w,h);
    if(s.mode==='area')drawArea();else if(s.mode==='print')drawPrint();else drawDetail();
    $('studio-preview-badge').textContent=s.mode==='area'?(s.selecting?'Drag a rectangle to select your map area':s.plan?.source==='recent'?'Navigation basemap · Print preview shows dated imagery':'Drag to move · scroll to zoom · click a sheet'):s.mode==='print'?`Full border preview · ${Math.round(s.previewZoom*100)}% of fit`:s.previewFallback?'Screen sampling · drag to inspect':`${Math.round(s.detailZoom*100)}% output pixels · drag to inspect · ${sheet()?resolutionText(sheet().resolution/s.detailZoom):''}`;
    $('studio-source-credit').textContent=s.mode==='area'&&s.plan?.source==='recent'?'Navigation basemap: Esri, Vantor, Earthstar Geographics and the GIS User Community':(s.plan?.sourceInfo.credit||'');
    $('studio-preview-note').textContent=s.mode==='area'?(s.plan?.source==='recent'?'Navigation overview only; Print preview loads dated imagery':'Coverage and atlas sheet boundaries'):s.mode==='print'?s.previewFallback?'Screen-resolution preview · export settings need adjusting':'Screen-resolution preview · inspect detail for output pixels':s.previewFallback?'Preview sampling only · export settings need adjusting':'Samples the chosen output resolution; native detail may be lower';
  }
  function changeMode(mode){if(!['area','print','detail'].includes(mode))return;s.mode=mode;s.selecting=false;canvas.dataset.select='false';$('studio-select').setAttribute('aria-pressed','false');for(const b of dialog.querySelectorAll('[data-preview]'))b.setAttribute('aria-pressed',String(b.dataset.preview===mode));schedulePreview(20);}
  function selectSheet(number){if(!s.plan)return;s.sheet=Math.max(1,Math.min(s.plan.sheets.length,Math.floor(Number(number))||1));$('studio-sheet').value=s.sheet;$('studio-prev-sheet').disabled=s.sheet===1;$('studio-next-sheet').disabled=s.sheet===s.plan.sheets.length;s.detailCentre={x:.5,y:.5};updateImagery();schedulePreview(20);}
  function zoom(factor,point){
    if(!s.plan)return;
    if(s.mode==='area'){const p=point||{x:canvas.clientWidth/2,y:canvas.clientHeight/2},g=geographic(p),old=s.view,dx=Math.max(.000005,Math.min(360,(old.east-old.west)/factor)),dy=Math.max(.000005,Math.min(180,(old.north-old.south)/factor)),cy=Math.max(-90+dy/2,Math.min(90-dy/2,g.latitude+(p.y/canvas.clientHeight-.5)*dy)),cx=g.longitude+(.5-p.x/canvas.clientWidth)*dx;s.view={west:cx-dx/2,east:cx+dx/2,south:cy-dy/2,north:cy+dy/2};}
    else if(s.mode==='print')s.previewZoom=Math.max(.5,Math.min(8,s.previewZoom*factor));
    else s.detailZoom=Math.max(.125,Math.min(8,s.detailZoom*factor));
    if(s.mode==='print')draw();else schedulePreview(300);
  }
  function endDrag(e){
    pointers.delete(e.pointerId);if(pinch){if(pointers.size<2)pinch=null;drag=null;if(s.mode!=='print')schedulePreview();return;}
    if(!drag)return;const d=drag;drag=null;
    if(!s.busy&&d.select&&d.end&&Math.hypot(d.end.x-d.start.x,d.end.y-d.start.y)>8){const a=geographic(d.start),b=geographic(d.end),value=canonical({west:Math.min(a.longitude,b.longitude),east:Math.max(a.longitude,b.longitude),south:Math.min(a.latitude,b.latitude),north:Math.max(a.latitude,b.latitude)});s.selecting=false;canvas.dataset.select='false';$('studio-select').setAttribute('aria-pressed','false');setBounds(value,false);replan(false);}
    else if(d.moved&&s.mode!=='print')schedulePreview(40);
    else if(s.mode==='area'&&!s.selecting&&s.plan){const g=geographic(d.start),p=s.plan.sheets.find(p=>{let lon=wrapLongitude(g.longitude);return lon>=p.bounds.west&&lon<=p.bounds.east&&g.latitude>=p.bounds.south&&g.latitude<=p.bounds.north;});if(p&&p.number!==s.sheet)selectSheet(p.number);}
    draw();
  }
  canvas.addEventListener('pointerdown',e=>{if(!s.plan)return;canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,screenPoint(e));if(pointers.size===2){const a=[...pointers.values()];pinch={distance:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)};drag=null;return;}drag={start:screenPoint(e),view:{...s.view},centre:{...s.detailCentre},pan:{...s.printPan},select:!s.busy&&s.selecting&&s.mode==='area'};});
  canvas.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;const p=screenPoint(e);pointers.set(e.pointerId,p);
    if(pinch&&pointers.size===2){const a=[...pointers.values()],distance=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);if(pinch.distance>0)zoom(distance/pinch.distance);pinch.distance=distance;return;}
    if(!drag)return;drag.end=p;const dx=p.x-drag.start.x,dy=p.y-drag.start.y;if(Math.hypot(dx,dy)>4)drag.moved=true;
    if(!drag.select){if(s.mode==='area'){const v=drag.view,spanY=v.north-v.south,sy=Math.max(-90-v.south,Math.min(90-v.north,dy/canvas.clientHeight*spanY));s.view={west:v.west-dx/canvas.clientWidth*(v.east-v.west),east:v.east-dx/canvas.clientWidth*(v.east-v.west),south:v.south+sy,north:v.north+sy};}
      else if(s.mode==='print')s.printPan={x:drag.pan.x+dx,y:drag.pan.y+dy};
      else{const p=sheet(),size=previewSize(viewportPixels(),p.bounds,'detail',s.plan.source);s.detailCentre={x:drag.centre.x-dx/canvas.clientWidth*size.width/p.width/s.detailZoom,y:drag.centre.y-dy/canvas.clientHeight*size.height/p.height/s.detailZoom};}}
    draw();
  });
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-Math.max(-200,Math.min(200,e.deltaY))*.002),screenPoint(e));},{passive:false});
  canvas.addEventListener('keydown',e=>{if(!s.plan)return;if(['+','=','-'].includes(e.key)){e.preventDefault();zoom(e.key==='-'?.8:1.25);}else if(e.key==='0'){e.preventDefault();fit();}else if(e.key.startsWith('Arrow')){e.preventDefault();if(s.mode==='area'){const dx=(s.view.east-s.view.west)*.15*(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0),dy=(s.view.north-s.view.south)*.15*(e.key==='ArrowDown'?-1:e.key==='ArrowUp'?1:0);s.view.west+=dx;s.view.east+=dx;const allowed=Math.max(-90-s.view.south,Math.min(90-s.view.north,dy));s.view.south+=allowed;s.view.north+=allowed;}else if(s.mode==='detail'){s.detailCentre.x+=e.key==='ArrowLeft'?-.05:e.key==='ArrowRight'?.05:0;s.detailCentre.y+=e.key==='ArrowUp'?-.05:e.key==='ArrowDown'?.05:0;}schedulePreview(200);}});
  function fit(){if(!s.plan)return;if(s.mode==='area')fitArea(s.plan.bounds);else if(s.mode==='print'){s.previewZoom=1;s.printPan={x:0,y:0};}else{s.detailCentre={x:.5,y:.5};s.detailZoom=1;}if(s.mode==='print')draw();else schedulePreview(20);}
  function preset(key){if(!REGIONS[key]||s.busy)return;$('studio-map-title').value=REGIONS[key].name+' field map';setBounds(REGIONS[key]);changeMode('area');}
  for(const b of dialog.querySelectorAll('[data-region]'))b.addEventListener('click',()=>preset(b.dataset.region));
  $('studio-region').addEventListener('change',e=>{preset(e.target.value);e.target.value='';});
  for(const b of dialog.querySelectorAll('[data-preview]'))b.addEventListener('click',()=>changeMode(b.dataset.preview));
  $('studio-select').addEventListener('click',()=>{if(s.busy)return;if(s.mode!=='area')changeMode('area');s.selecting=!s.selecting;canvas.dataset.select=String(s.selecting);$('studio-select').setAttribute('aria-pressed',String(s.selecting));draw();canvas.focus();});
  $('studio-use-view').addEventListener('click',()=>{if(s.busy)return;setBounds(canonical(s.view),false);replan(false);});
  $('studio-gps').addEventListener('click',()=>{if(s.busy)return;if(!navigator.geolocation){toast('GPS is unavailable in this browser.');return;}navigator.geolocation.getCurrentPosition(p=>{setBounds(smallArea(p.coords.latitude,p.coords.longitude));changeMode('area');},e=>toast(`Could not get your location. ${e.message}`),{enableHighAccuracy:true,timeout:15000,maximumAge:30000});});
  $('studio-minus').addEventListener('click',()=>zoom(.7));$('studio-plus').addEventListener('click',()=>zoom(1.4));$('studio-fit').addEventListener('click',fit);$('studio-retry').addEventListener('click',()=>schedulePreview(0,true));
  $('studio-date-end').addEventListener('change',()=>{clearTimeout(planTimer);replan(false);});
  $('studio-date-end').addEventListener('input',()=>{clearTimeout(planTimer);planTimer=setTimeout(()=>replan(false),120);});
  $('studio-recent').addEventListener('click',()=>{if(s.busy)return;$('studio-source').value='recent';replan(false);changeMode('print');});
  $('studio-sheet').addEventListener('change',e=>selectSheet(e.target.value));$('studio-prev-sheet').addEventListener('click',()=>selectSheet(s.sheet-1));$('studio-next-sheet').addEventListener('click',()=>selectSheet(s.sheet+1));
  for(const id of ids){const update=()=>{clearTimeout(planTimer);if(s.busy)return;if(['map-title','layers'].includes(id)){invalidateResult();save();draw();}else replan(false);};$('studio-'+id).addEventListener(id==='map-title'?'input':'change',update);if(['north','west','south','east','mpp'].includes(id))$('studio-'+id).addEventListener('input',()=>{clearTimeout(planTimer);planTimer=setTimeout(update,120);});}
  $('studio-search-form').addEventListener('submit',async e=>{
    e.preventDefault();if(s.busy)return;const query=$('studio-search').value.trim(),results=$('studio-search-results'),coords=query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if(coords){const lat=Number(coords[1]),lon=Number(coords[2]);if(lat< -90||lat>90||lon< -180||lon>180){results.textContent='Use latitude -90 to 90 and longitude -180 to 180.';results.hidden=false;return;}setBounds(smallArea(lat,lon));changeMode('area');results.hidden=true;return;}
    s.searchController?.abort();const controller=new AbortController();s.searchController=controller;$('studio-find').disabled=true;results.textContent='Finding places…';results.hidden=false;
    try{const places=await searchPlaces(query,{signal:controller.signal,focus:$('studio-anz').checked?'anz':'world'});results.replaceChildren();if(!places.length)results.textContent='No places found. Use coordinates or draw an area on the map.';
      for(const place of places){const button=document.createElement('button');button.type='button';button.textContent=place.name;const small=document.createElement('small');small.textContent=[place.admin1,place.country].filter(Boolean).join(' · ');button.append(small);button.addEventListener('click',()=>{if(s.busy)return;$('studio-map-title').value=place.name+' field map';const region=place.feature_code==='PCLI'?(place.country_code==='AU'?REGIONS.australia:place.country_code==='NZ'?REGIONS.nz:null):null;setBounds(region||smallArea(place.latitude,place.longitude));changeMode('area');results.hidden=true;});results.append(button);}
      const attribution=document.createElement('a');attribution.href='https://open-meteo.com/en/docs/geocoding-api';attribution.target='_blank';attribution.rel='noopener';attribution.textContent='Place search: Open-Meteo / GeoNames';attribution.className='hint';results.append(attribution);
    }catch(error){if(error.name!=='AbortError')results.textContent=`Place search unavailable. ${error.message} You can still use coordinates or draw an area.`;}
    finally{if(s.searchController===controller)$('studio-find').disabled=false;}
  });
  for(const id of ['from','to'])$('studio-'+id).addEventListener('change',rangeMessage);
  const directAvailable=typeof window.showSaveFilePicker==='function';$('studio-direct-field').hidden=!directAvailable;
  $('studio-direct').addEventListener('change',()=>resetRange());
  $('studio-next-volume').addEventListener('click',()=>{if(lastRange&&s.plan){const next=lastRange.to+1;resetRange(next);selectSheet(next);lastRange=null;$('studio-next-volume').hidden=true;}});
  function setBusy(busy){s.busy=busy;if(busy){s.selecting=false;canvas.dataset.select='false';$('studio-select').setAttribute('aria-pressed','false');}$('studio-settings').inert=busy;for(const b of dialog.querySelectorAll('.studio-export-range input,.studio-export-range button'))b.disabled=busy;$('studio-select').disabled=busy;$('studio-export').hidden=busy;$('studio-cancel').hidden=!busy;$('studio-progress').hidden=!busy;if(!busy){$('studio-prev-sheet').disabled=s.sheet===1;$('studio-next-sheet').disabled=s.sheet===s.plan?.sheets.length;rangeMessage();}}
  async function jpegBrand(signal){
    const images=currentImages(),result={};for(const [key,image] of Object.entries(images)){abortCheck(signal);const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d',{alpha:false});ctx.fillStyle=s.plan.layout.margin==='paper'?'#e8f0e5':'#142e25';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0);result[key]={bytes:await rasterJPEG(c,.98),width:c.width,height:c.height};c.width=c.height=1;}return result;
  }
  $('studio-export').addEventListener('click',async()=>{
    if(s.busy)return;if(s.planSettingsKey!==JSON.stringify({options:settings(),date:dateOptions()}))replan(false);if(!s.exportPlan)return;const from=Number($('studio-from').value),to=Number($('studio-to').value),plan=s.exportPlan,name=title(),filename=mapFilename(name,from,to),controller=new AbortController();
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>plan.sheets.length){rangeMessage();return;}
    if(s.download)URL.revokeObjectURL(s.download);s.download=null;resultBlob=null;resultHandle=null;$('studio-download').hidden=true;$('studio-open-map').hidden=true;s.exportController=controller;setBusy(true);$('studio-progress').value=0;$('studio-progress-text').textContent='Preparing map resources…';let sink,handle;
    try{
      // Open the native file picker during the click's user activation.
      if(directAvailable&&$('studio-direct').checked){handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Georeferenced PDF map',accept:{'application/pdf':['.pdf']}}]});sink=await handle.createWritable();}
      else sink=blobSink();
      await assets();abortCheck(controller.signal);const brand=await jpegBrand(controller.signal),features=$('studio-layers').checked?structuredClone(getFeatures()):[];
      let session=null,sessionSheet=null;
      const sessionFor=async number=>{if(sessionSheet===number)return session;if(session)session.readers.clear();session=await recent(plan,controller.signal,message=>{$('studio-progress-text').textContent=message;},plan.sheets[number-1].bounds,dateOptions(),true);session.pages.clear();sessionSheet=number;return session;};
      let sourceInfo=imageryInfo;
      const exportedInfo=async page=>{if(session)return session.informationForSheet(page.number);if(plan.source!=='imagery')return sourceInfo;try{return await inspectMosaic(page.bounds,page.resolution,controller.signal);}catch{return {label:'Capture date unavailable; mosaic dates vary'};}};
      const result=await exportMapAtlas({plan,title:name,from,to,fontBytes,brand,features,signal:controller.signal,sink,getImageryInfo:exportedInfo,loadTile:async patch=>{const pageSession=plan.source==='recent'?await sessionFor(patch.sheetNumber):null;const raster=pageSession?await pageSession.render({...patch,progress:message=>{$('studio-progress-text').textContent=message;}}):await loadMapRaster(patch);try{return await rasterJPEG(raster,.95);}finally{raster.width=raster.height=1;}},progress:progress=>{$('studio-progress').value=progress.fraction;$('studio-progress-text').textContent=`${progress.stage==='page'?'Completed':'Building'} sheet ${progress.sheet} of ${plan.sheets.length} · ${Math.round(progress.fraction*100)}% · ${fileSize(progress.bytes)} written`;}});
      abortCheck(controller.signal);if(s.download)URL.revokeObjectURL(s.download);resultBlob=result.blob;resultHandle=handle;resultFilename=filename;lastResultKey=resultKey();
      if(resultBlob){s.download=URL.createObjectURL(resultBlob);$('studio-download').href=s.download;$('studio-download').download=filename;$('studio-download').hidden=false;$('studio-download').click();}else{$('studio-download').hidden=true;s.download=null;}
      $('studio-open-map').hidden=result.size>100*1024*1024;lastRange={from,to};$('studio-next-volume').hidden=to>=plan.sheets.length;
      const message=`${result.pages} GeoPDF sheet${result.pages===1?'':'s'} ready · ${fileSize(result.size)}${handle?' · saved to your file':''}.`;
      setBusy(false);$('studio-progress-text').textContent=message;toast(message);s.exportController=null;
    }catch(error){await sink?.abort?.().catch(()=>{});setBusy(false);$('studio-progress-text').textContent=error.name==='AbortError'?'Map creation cancelled.':`Could not finish this map. ${error.message}`;s.exportController=null;}
  });
  $('studio-cancel').addEventListener('click',()=>s.exportController?.abort());
  $('studio-open-map').addEventListener('click',async()=>{
    if(s.busy)return;try{const blob=resultBlob||await resultHandle?.getFile();if(!blob)return;const bytes=new Uint8Array(await blob.arrayBuffer());dialog.close();await onOpenMap?.(bytes,resultFilename||'TerraWarden map.geopdf.pdf');}catch(error){toast(`Could not open this map. ${error.message}`);}
  });
  function close(){if(s.busy){s.exportController?.abort();return;}dialog.close();}
  $('studio-close').addEventListener('click',close);dialog.addEventListener('cancel',e=>{if(s.busy){e.preventDefault();s.exportController?.abort();}});
  dialog.addEventListener('close',()=>{previews.cancel();clearTimeout(planTimer);s.searchController?.abort();metadataController?.abort();clearTimeout(metadataTimer);metadataKey=null;});
  s.resize=new ResizeObserver(()=>{if(dialog.open){draw();schedulePreview(180);}});s.resize.observe(canvas);
  $('studio-date-end').value=new Date().toISOString().slice(0,10);$('studio-date-end').max=$('studio-date-end').value;restore();
  return {open(){if(!dialog.open)dialog.showModal();const count=getFeatures().length;$('studio-layer-note').textContent=count?`${count} visible shared features available. The current layer filters are respected.`:'No shared features selected. Connect a group in the portal to include its layers.';replan(!s.plan);void assets().catch(error=>{$('studio-plan-note').textContent=error.message;});},refresh(){if(dialog.open){draw();$('studio-layer-note').textContent=`${getFeatures().length} visible shared features available.`;}}};
}
