import { config } from './config.js';
import { readAPIKey, saveAPIKey, removeAPIKey, readTheme, saveTheme, readLabelAngle, saveLabelAngle } from './settings.mjs';
import { makeModel, decodeGroup, decodeRoute, inPolygon, swiftDate } from './core.mjs';
import { openPDF, geoPDFRegions } from './pdf-map.mjs?v=20261028.3';
import { ViewerClient } from './firebase.mjs';
import { formattedGrid, datumNote } from './coordinates.mjs';
import { LocationTracker, accuracyRing } from './location.mjs';
import { pinLabelPlacement } from './label-placement.mjs';
import { createEditorUI } from './edit-ui.mjs';
import { DemoClient } from './demo-client.mjs';
import { PDFViewportRenderer } from './pdf-render.mjs';
import { filterFeatures } from './feature-visibility.mjs';
import { gpsCameraTarget } from './gps-follow.mjs';
const $=(id)=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
const state={layers:[],hidden:new Set(),routes:new Map(),manifests:{},group:null,mode:'empty',pdf:null,metadata:null,page:1,viewport:null,model:null,regions:[],anchors:[],capture:false,scale:1,x:0,y:0,selected:null,session:null,generation:0,pdfGeneration:0,pageGeneration:0,routePending:new Set(),routeErrors:new Set(),role:null,opacity:1,labelAngle:readLabelAngle(),crs:null,readout:null,gpsFix:null,gpsStatus:'off',gpsFollowing:false,pageLoading:false,exporting:false};
let toastTimer,dragDepth=0,drawRequest=0,client=null,demoClient=null,exportURL=null;
const pdfRenderer=new PDFViewportRenderer($('pdf-detail'));
const saved=(key)=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{toast('Browser storage is unavailable. Changes will last for this visit.');}};
const remove=(key)=>{try{localStorage.removeItem(key);}catch{}};
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function svg(tag,attrs={}){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,8000);}
function status(message,type='neutral'){$('sync-status').textContent=message;$('sync-dot').className=`status-dot ${type}`;}
function notice(message){$('map-notice').textContent=message;$('map-notice').hidden=!message;}
const calibrationKey=()=>`tw.portal.alignment.v1.${state.pdf?.fingerprints?.[0]}.${state.page}`;
const drawingColours={green:'#36a447',red:'#d25252',blue:'#3a85c6',yellow:'#d4be42',purple:'#946ca8',orange:'#d68c46',white:'#ffffff',black:'#202b25'};
function allFeatures(){return state.layers.flatMap(l=>[...l.pins,...l.routes].map(f=>({...f,layerName:l.name,color:drawingColours[f.drawingAppearance?.color]||l.color})));}
function visibleFeatures(){return filterFeatures(allFeatures(),{hidden:state.hidden,search:$('search').value});}
function reconcile(){
  if(state.group){
    state.layers=decodeGroup(state.group);
    const removed=state.group.privacyRemovals||{};
    for(const l of state.layers) l.routes=[...state.routes.values()].filter(r=>r.layerID===l.id&&!removed.routes?.[r.id]&&state.manifests[r.id]?.isDeleted===false&&state.manifests[r.id]?.revision===r.revision);
  }
  state.role=state.group?.members?.[(state.mode==='demo'?demoClient:client)?.uid]?.role||null;
  renderLists();editorUI.refresh();scheduleDraw();
  if(state.selected){const current=allFeatures().find(f=>f.id===state.selected);if(current&&!state.hidden.has(current.layerID))showDetail(current,false);else closeDetail();}
}
function renderLists(){
  $('layer-count').textContent=state.layers.length;
  const layers=$('layers');layers.replaceChildren();
  if(!state.layers.length)layers.append(node('p','empty-small',state.mode==='live'?'No shared layers in this group yet.':'Shared layers will appear here.'));
  for(const l of state.layers){
    const row=node('div','layer-row'),swatch=node('span','layer-swatch','⌖');swatch.style.color=l.color;swatch.style.background=l.color+'15';
    const label=node('label'),name=node('span','layer-name',l.name),meta=node('span','layer-meta',`${l.pins.length} pins · ${l.routes.length} routes / lines`),check=node('input');check.type='checkbox';check.checked=!state.hidden.has(l.id);check.setAttribute('aria-label',`Show ${l.name}`);
    const inputID=`layer-${state.layers.indexOf(l)}`;check.id=inputID;label.htmlFor=inputID;label.append(name,meta);row.append(swatch,label);if(editorUI.writable()){const edit=node('button','layer-edit','✎');edit.setAttribute('aria-label',`Edit layer ${l.name}`);edit.addEventListener('click',()=>editorUI.editLayer(l));row.append(edit);}row.append(check);layers.append(row);
    check.addEventListener('change',()=>{check.checked?state.hidden.delete(l.id):state.hidden.add(l.id);if(state.selected&&allFeatures().some(f=>f.id===state.selected&&f.layerID===l.id)&&!check.checked)closeDetail();renderLists();scheduleDraw();});
  }
  const all=allFeatures(),features=visibleFeatures(),list=$('features');$('feature-count').textContent=all.length;list.replaceChildren();
  if(!features.length)list.append(node('p','empty-small',all.length?'No features match the current filters.':state.mode==='empty'?'Connect a group or explore the demo.':'No shared features to display.'));
  for(const f of features.slice(0,150)){
    const b=node('button','feature-row'),symbol=node('span','feature-symbol',f.type==='pin'?'◉':'⌁');symbol.style.color=f.color;const text=node('span','feature-text');text.append(node('strong','',f.name),node('small','',[f.unitID,f.mineSite||f.layerName].filter(Boolean).join(' · ')));b.append(symbol,text,node('span','arrow','›'));b.addEventListener('click',()=>{showDetail(f,true);document.body.classList.remove('sidebar-open');$('sidebar-toggle').setAttribute('aria-expanded','false');});list.append(b);
  }
  if(features.length>150)list.append(node('p','hint',`Showing the first 150 of ${features.length}. Use search to narrow the list.`));
  $('map-summary').textContent=state.mode==='demo'?'DEMO · fictional field data':`${state.layers.length} layers · ${all.length} features`;
}
function updateAlignment(){
  state.model=null;
  const region=state.regions[Number($('region-select').value)||0];state.crs=region?.crs||null;
  let error='';
  if(state.anchors.length>=3){try{state.model=makeModel(state.anchors,state.pageBox,false);}catch(e){error=e.message;}}
  else if(!state.anchors.length)state.model=state.regions[Number($('region-select').value)||0]?.model||null;
  $('alignment-status').textContent=state.model?(state.anchors.length?'Reference points applied':`${region?.source||'GeoPDF'} aligned`):state.anchors.length?`${state.anchors.length} of 3 reference points`:'Map alignment needed';
  $('alignment-icon').textContent=state.model?'●':'○';
  $('calibration-note').textContent=error||(state.model&&state.anchors.length?`${state.anchors.length} points · fit residual ${state.model.rmsMetres.toFixed(1)} m. This fit does not measure map accuracy. Three-point alignment is a local affine approximation; add extra points to check the fit.`:region?.note||state.alignmentMessage||'');
  const list=$('anchor-list');list.replaceChildren();
  state.anchors.forEach((p,i)=>{const li=node('li','',`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`),b=node('button','', '×');b.setAttribute('aria-label',`Remove reference point ${i+1}`);b.addEventListener('click',()=>{state.anchors.splice(i,1);save(calibrationKey(),state.anchors);updateAlignment();});li.append(b);list.append(li);});
  $('export-calibration').disabled=state.anchors.length<3;
  if(!state.model&&state.pdf)notice(state.anchors.length?'Add at least three well-spaced reference points to show geographic features.':state.alignmentMessage);
  else notice(state.model?.rmsMetres>10?'The reference points have a large fit residual. Check coordinates or add more points.':'');
  if(state.model){const b=state.pageBox;state.readout={point:state.model.toGeo((b[0]+b[2])/2,(b[1]+b[3])/2),source:'Map centre'};}else state.readout=null;
  refreshCoordinates();
  if(state.selected){const selected=allFeatures().find(f=>f.id===state.selected);if(selected)showDetail(selected,false);}
  updateExportButtons();scheduleDraw();
}
async function openBytes(bytes,name){
  const generation=++state.pdfGeneration;
  clearExportDownload();
  state.pageLoading=true;updateExportButtons();
  $('pdf-description').textContent='Opening PDF…';
  try{
    if(bytes.byteLength>100*1024*1024)throw new Error('Choose a PDF smaller than 100 MB for this browser viewer.');
    const opened=await openPDF(bytes);
    if(generation!==state.pdfGeneration){await opened.pdf.destroy();return;}
    pdfRenderer.clear();
    if(state.renderTask){state.renderTask.cancel();await state.renderTask.promise.catch(()=>{});}
    if(state.pdf)await state.pdf.destroy();
    state.pdf=opened.pdf;state.metadata=opened.metadata;state.page=1;state.pdfName=name;
    $('pdf-name').textContent=name;$('map-title').textContent=name;$('pdf-description').textContent='Stored only in this browser session';
    $('page-select').replaceChildren(...Array.from({length:state.pdf.numPages},(_,i)=>{const o=node('option','',`Page ${i+1} of ${state.pdf.numPages}`);o.value=i+1;return o;}));
    $('map-controls').hidden=false;cancelCapture();await displayPage(1);
  }catch(e){if(generation===state.pdfGeneration){$('pdf-description').textContent=state.pdf?'Stored only in this browser session':'Choose a PDF or drop it on the map';toast(e.name==='PasswordException'?'This PDF needs a password. Open an unprotected copy to use it here.':`Could not open this PDF. ${e.message}`);}}
  finally{if(generation===state.pdfGeneration){state.pageLoading=false;updateExportButtons();}}
}
async function displayPage(number){
  const generation=++state.pageGeneration;
  state.pageLoading=true;updateExportButtons();
  closeDetail();cancelCapture();pdfRenderer.clear();
  try{
    if(state.renderTask){state.renderTask.cancel();await state.renderTask.promise.catch(()=>{});}
    const page=await state.pdf.getPage(number);if(generation!==state.pageGeneration)return;
    const viewport=page.getViewport({scale:1}),scale=Math.min(2,2048/Math.max(viewport.width,viewport.height),Math.sqrt(2_000_000/(viewport.width*viewport.height)));
    const canvas=node('canvas');canvas.id='pdf-canvas';canvas.width=Math.ceil(viewport.width*scale);canvas.height=Math.ceil(viewport.height*scale);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
    state.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale})});
    await state.renderTask.promise;if(generation!==state.pageGeneration)return;
    state.page=number;state.viewport=viewport;state.pageBox=page.view;state.width=viewport.width;state.height=viewport.height;
    $('pdf-canvas').replaceWith(canvas);pdfRenderer.setPage(page);$('stage').style.width=viewport.width+'px';$('stage').style.height=viewport.height+'px';$('overlay').setAttribute('width',viewport.width);$('overlay').setAttribute('height',viewport.height);$('overlay').setAttribute('viewBox',`0 0 ${viewport.width} ${viewport.height}`);
    const detected=geoPDFRegions(state.metadata,number-1);state.regions=detected.regions;state.alignmentMessage=detected.message;
    $('region-select').replaceChildren(...state.regions.map((r,i)=>{const o=node('option','',r.name);o.value=i;return o;}));$('region-field').hidden=state.regions.length<2;
    const stored=saved(calibrationKey());state.anchors=Array.isArray(stored)?stored:[];
    $('stage').hidden=false;$('map-empty').hidden=true;updateAlignment();fit();
  }catch(e){if(e.name!=='RenderingCancelledException')toast(`This page could not be rendered. ${e.message}`);}
  finally{if(generation===state.pageGeneration){state.pageLoading=false;updateExportButtons();}}
}
function fit(){if(!state.viewport)return;const rect=$('map-area').getBoundingClientRect();state.scale=Math.min((rect.width-80)/state.width,(rect.height-145)/state.height);state.scale=Math.max(.03,state.scale);state.x=(rect.width-state.width*state.scale)/2;state.y=70+(rect.height-145-state.height*state.scale)/2;transform();}
function transform(){if(!state.viewport)return;const rect=$('map-area').getBoundingClientRect();if(state.gpsFollowing){const target=gpsCameraTarget({fix:state.gpsFix,model:state.model,viewport:state.viewport,pageBox:state.pageBox,width:rect.width,height:rect.height,scale:state.scale});if(target){state.x=target.x;state.y=target.y;}}$('stage').style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;$('zoom-label').textContent=Math.round(state.scale*100)+'%';pdfRenderer.schedule({pageWidth:state.width,pageHeight:state.height,width:rect.width,height:rect.height,x:state.x,y:state.y,scale:state.scale,dpr:window.devicePixelRatio||1});scheduleDraw();}
function zoom(factor,point){if(!state.viewport)return;const rect=$('map-area').getBoundingClientRect(),p=point||[rect.width/2,rect.height/2];const next=Math.max(.03,Math.min(12,state.scale*factor));state.x=p[0]-(p[0]-state.x)*next/state.scale;state.y=p[1]-(p[1]-state.y)*next/state.scale;state.scale=next;transform();}
function scheduleDraw(){if(!drawRequest)drawRequest=requestAnimationFrame(()=>{drawRequest=0;drawOverlay();});}
function pdfPosition(feature){const p=state.model?.toPDF(feature.latitude,feature.longitude);return p?{pdf:p,screen:state.viewport.convertToViewportPoint(...p)}:null;}
function drawOverlay(){
  const overlay=$('overlay');overlay.replaceChildren();if(!state.viewport)return;
  const k=state.scale,r=5/k,showLabels=k>.3;
  let shown=0;
  if(state.model){
    const footprint=state.model.footprint||[[state.pageBox[0],state.pageBox[1]],[state.pageBox[2],state.pageBox[1]],[state.pageBox[2],state.pageBox[3]],[state.pageBox[0],state.pageBox[3]]];
    const defs=svg('defs'),clip=svg('clipPath',{id:'map-footprint'});clip.append(svg('polygon',{points:footprint.map(p=>state.viewport.convertToViewportPoint(...p).join(',')).join(' ')}));defs.append(clip);overlay.append(defs);
    const features=svg('g',{'clip-path':'url(#map-footprint)',opacity:state.opacity});overlay.append(features);
    for(const f of visibleFeatures()){
      if(f.type==='pin'){
        const pos=pdfPosition(f);if(!pos||!inPolygon(pos.pdf,footprint))continue;
        const [x,y]=pos.screen;if(x<0||y<0||x>state.width||y>state.height)continue;
        const g=svg('g',{class:'pin-marker',role:'button',tabindex:'0','aria-label':f.name});const title=svg('title');title.textContent=f.name;g.append(title,svg('circle',{cx:x,cy:y,r:r+3/k,fill:'#fff',opacity:'.7'}),svg('circle',{cx:x,cy:y,r,fill:f.color,stroke:'#fff','stroke-width':1.8/k}));
        if(showLabels){const text=svg('text',{...pinLabelPlacement(x,y,k,state.labelAngle),fill:'#344b2c','font-size':10/k,'font-weight':550,stroke:'#fff','stroke-width':2.5/k,'paint-order':'stroke','stroke-linejoin':'round'});text.textContent=f.name.length>35?f.name.slice(0,33)+'…':f.name;g.append(text);}
        g.addEventListener('click',()=>{if(!editorUI.active()&&!state.capture)showDetail(f,false);});g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showDetail(f,false);}});features.append(g);shown++;
      }else{
        const commands=[];let bounds=[Infinity,Infinity,-Infinity,-Infinity];
        for(const segment of f.segments){let pen=false;for(const point of segment.points){const pos=pdfPosition(point);if(!pos){pen=false;continue;}const[x,y]=pos.screen;bounds=[Math.min(bounds[0],x),Math.min(bounds[1],y),Math.max(bounds[2],x),Math.max(bounds[3],y)];commands.push(`${pen?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`);pen=true;}}
        if(!commands.length||bounds[2]<0||bounds[3]<0||bounds[0]>state.width||bounds[1]>state.height)continue;
        const dash=f.drawingAppearance?.lineStyle==='dashed'?`${8/k} ${6/k}`:f.drawingAppearance?.lineStyle==='dotted'?`${1/k} ${5/k}`:null;
        const color=f.color,width=(f.drawingAppearance?.lineWidth==='thin'?2:f.drawingAppearance?.lineWidth==='thick'?6:3)/k;
        const g=svg('g',{class:'route-line',role:'button',tabindex:'0','aria-label':f.name}),title=svg('title');title.textContent=f.name;g.append(title,svg('path',{d:commands.join(' '),fill:'none',stroke:color==='#ffffff'?'#29402f':'#fff','stroke-width':width+3/k,'stroke-linejoin':'round','stroke-linecap':'round'}));
        const path=svg('path',{d:commands.join(' '),fill:'none',stroke:color,'stroke-width':width,'stroke-linejoin':'round','stroke-linecap':'round'});if(dash)path.setAttribute('stroke-dasharray',dash);g.append(path,svg('path',{d:commands.join(' '),fill:'none',stroke:'transparent','stroke-width':Math.max(width,12/k)}));g.addEventListener('click',()=>{if(!editorUI.active()&&!state.capture)showDetail(f,false);});g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showDetail(f,false);}});features.prepend(g);shown++;
      }
    }
  }
  state.anchors.forEach((a,i)=>{const[x,y]=state.viewport.convertToViewportPoint(a.x,a.y),g=svg('g');g.append(svg('circle',{cx:x,cy:y,r:9/k,fill:'#234d3a',stroke:'#fff','stroke-width':2/k}));const text=svg('text',{x,y:y+3/k,'text-anchor':'middle',fill:'#fff','font-size':10/k});text.textContent=i+1;g.append(text);overlay.append(g);});
  drawGPS(overlay,k);editorUI.draw(overlay,k,svg,pdfPosition);
  $('visibility-status').textContent=state.model?`${shown} of ${visibleFeatures().length} features intersect this page`:allFeatures().length?'Align the map to place shared features':'Ready when you are';
}
function closeDetail(){state.selected=null;$('feature-detail').hidden=true;$('feature-edit-actions').hidden=true;}
function showDetail(f,center){
  state.selected=f.id;$('detail-kind').textContent=`${f.type} · ${f.layerName}`;$('detail-title').textContent=f.name;$('detail-fields').replaceChildren();
  const grid=f.type==='pin'?formattedGrid(f,state.crs):null;
  const date=swiftDate(f.timestamp??f.createdAt??f.startedAt),fields=[['Easting',grid?grid.eastingText+' m':null],['Northing',grid?grid.northingText+' m':null],['Coordinate system',grid?.label],['Unit ID',f.unitID],['Site',f.mineSite],['WGS84 latitude / longitude',f.type==='pin'?`${f.latitude.toFixed(7)}, ${f.longitude.toFixed(7)}`:null],['Distance',f.distanceMeters!=null?`${(f.distanceMeters/1000).toFixed(3)} km`:null],['Recorded',date&&!isNaN(date)?date.toLocaleString():null],['Created by',f.creatorName],['Note',f.note]];
  for(const[label,value]of fields)if(value){const cls=['Easting','Northing'].includes(label)?'grid-field':'';$('detail-fields').append(node('dt',cls,label),node('dd',cls,String(value)));}
  if(!$('detail-fields').children.length)$('detail-fields').append(node('dd','', 'No additional details.'));
  $('feature-detail').hidden=false;editorUI.refresh();
  if(f.type==='pin'){state.readout={point:f,source:'Selected pin'};refreshCoordinates();}
  if(center&&state.model){const point=f.type==='pin'?f:f.segments.flatMap(s=>s.points)[0],pos=point&&pdfPosition(point);if(pos){pauseGPSFollow();const rect=$('map-area').getBoundingClientRect();state.scale=Math.max(state.scale,1.1);state.x=rect.width*.4-pos.screen[0]*state.scale;state.y=rect.height*.5-pos.screen[1]*state.scale;transform();}}
}
function refreshCoordinates(){
  const gpsActive=locationTracker.running,fix=state.gpsFix,readout=gpsActive?(fix?{point:fix,source:'GPS'}:null):state.readout;
  $('coordinate-card').hidden=!state.viewport&&!gpsActive;
  const grid=readout?formattedGrid(readout.point,state.crs):null;
  $('coordinate-source').textContent=gpsActive?(fix?(Date.now()-fix.timestamp>30000?'GPS · last fix':state.gpsFollowing?'GPS · following':'GPS · view unlocked'):'GPS · waiting'):readout?.source||'Map coordinates';
  $('readout-easting').textContent=grid?.eastingText||'—';$('readout-northing').textContent=grid?.northingText||'—';
  $('readout-crs').textContent=grid?.label||state.crs?.label||'WGS84 / UTM · automatic zone';
  $('readout-crs').title=datumNote((grid?.crs||state.crs)?.datum);
  $('readout-secondary').textContent=readout?`WGS84 ${readout.point.latitude.toFixed(6)}, ${readout.point.longitude.toFixed(6)}`:'Move over the aligned map or use Locate me';
  $('gps-status').hidden=!gpsActive&&state.gpsStatus!=='denied';
  if(gpsActive&&fix){const age=Math.max(0,Math.round((Date.now()-fix.timestamp)/1000));const pos=state.model?.toPDF(fix.latitude,fix.longitude),inside=pos&&inPolygon(pos,state.model.footprint)&&pos[0]>=state.pageBox[0]&&pos[0]<=state.pageBox[2]&&pos[1]>=state.pageBox[1]&&pos[1]<=state.pageBox[3];$('gps-status').textContent=`±${Math.round(fix.accuracy)} m · ${age>30?`last fix ${age}s ago`:'GPS accuracy'}${state.model&&!inside?' · outside this page':''}${state.gpsStatus==='unavailable'?' · waiting for signal':''}${!state.gpsFollowing?' · tap GPS to follow':''}`;}
}
function updateGPSButton(){const active=locationTracker.running,following=active&&state.gpsFollowing,label=!active?'Follow my GPS location':following?'Stop GPS following':'Resume GPS following';$('locate').setAttribute('aria-pressed',String(following));$('locate').setAttribute('aria-label',label);$('locate').title=!active?'Follow my GPS location':following?'GPS following · click to turn GPS off':'GPS view unlocked · click to follow';}
function pauseGPSFollow(){if(state.gpsFollowing){state.gpsFollowing=false;updateGPSButton();refreshCoordinates();}}
const locationTracker=new LocationTracker(navigator.geolocation,fix=>{
  state.gpsFix=fix;refreshCoordinates();if(state.gpsFollowing)transform();else scheduleDraw();
},(phase,message)=>{
  state.gpsStatus=phase;
  if(phase==='off'){state.gpsFix=null;state.gpsFollowing=false;}
  updateGPSButton();
  $('gps-status').textContent=message;refreshCoordinates();scheduleDraw();
  if(phase==='denied'||(phase==='unavailable'&&!locationTracker.running))toast(message);
});
function drawGPS(overlay,k){
  if(!state.gpsFix||!locationTracker.running||!state.model)return;
  const pos=pdfPosition(state.gpsFix);if(!pos)return;
  const g=svg('g',{'clip-path':'url(#map-footprint)'}),[x,y]=pos.screen;
  const points=accuracyRing(state.gpsFix).map(p=>pdfPosition(p)?.screen).filter(Boolean);
  if(points.length>2)g.append(svg('polygon',{points:points.map(p=>p.join(',')).join(' '),fill:'#3389dc','fill-opacity':.12,stroke:'#3389dc','stroke-opacity':.4,'stroke-width':1/k}));
  const title=svg('title');title.textContent=`GPS location · accuracy ±${Math.round(state.gpsFix.accuracy)} m`;
  g.append(title,svg('circle',{cx:x,cy:y,r:7/k,fill:'#3389dc',stroke:'#fff','stroke-width':2.5/k}));overlay.append(g);
}
$('locate').addEventListener('click',()=>{if(!locationTracker.running){state.gpsFollowing=true;locationTracker.start();}else if(!state.gpsFollowing){state.gpsFollowing=true;updateGPSButton();refreshCoordinates();transform();}else locationTracker.stop();});
window.addEventListener('pagehide',()=>locationTracker.stop());
setInterval(()=>{if(locationTracker.running)refreshCoordinates();},10000);
function cancelCapture(){state.capture=false;$('capture-hint').hidden=true;$('map-area').classList.remove('capturing');}
function stopSession(){clearExportDownload();editorUI.reset();state.role=null;state.activeGroup=null;state.session?.abort();state.session=null;state.generation++;state.routes.clear();state.manifests={};state.routePending.clear();state.routeErrors.clear();state.group=null;state.layers=[];closeDetail();}
function connectionLost(message){stopSession();state.mode='empty';status(message,'error');$('connect-label').textContent='Reconnect group';$('group-name').textContent='Group access ended';$('group-description').textContent='Shared features have been cleared. Ask the owner for a current invitation.';$('disconnect').hidden=true;remove('tw.portal.group.v1');reconcile();toast(message);}
async function openGroup(group){
  stopSession();state.mode='live';state.session=new AbortController();const signal=state.session.signal,generation=state.generation;
  $('group-name').textContent=group.name||'Shared group';$('group-description').textContent='Live shared pins, recorded routes and drawn lines. Your PDF and map alignment stay on this device.';$('connect-label').textContent='Connected group';state.activeGroup=group;$('disconnect').hidden=false;status('Connecting to live layers…');
  const channel={pins:'connecting',routes:'connecting'};
  const updateStatus=()=>{if(generation!==state.generation)return;status(state.routeErrors.size?'Some routes could not be loaded':channel.pins==='live'&&channel.routes==='live'?`Live sync · ${state.role==='viewer'?'read-only':'can edit'}`:channel.pins==='live'?'Pins connected · routes connecting':'Reconnecting · last received data',channel.pins==='live'?'':'neutral');};
  const routesChanged=()=>{if(generation===state.generation){loadRoutes(generation,signal).catch(e=>toast(e.message));reconcile();}};
  client.watch(`pinGroups/${group.id}`,value=>{
    if(generation!==state.generation)return;
    if(value?.isDeleted!==false || !['viewer','editor','owner'].includes(value.members?.[client.uid]?.role)){connectionLost('This browser no longer has access to the group.');return;}
    state.group=value;$('group-name').textContent=value.name||'Shared group';reconcile();routesChanged();
  },(s,e)=>{if(generation!==state.generation)return;channel.pins=s;if(s==='denied')connectionLost(e.message);else updateStatus();},signal).catch(()=>{});
  client.watch(`routeManifests/${group.id}`,value=>{
    if(generation!==state.generation)return;state.manifests=value||{};
    for(const[id,r]of state.routes)if(state.manifests[id]?.revision!==r.revision||state.manifests[id]?.isDeleted!==false)state.routes.delete(id);
    routesChanged();
  },(s)=>{if(generation!==state.generation)return;channel.routes=s;if(s==='denied'){state.manifests={};state.routes.clear();reconcile();status('Pins connected · route access unavailable','error');}else updateStatus();},signal).catch(()=>{});
  state.activeGroup=group;reconcile();
}
async function loadRoutes(generation,signal){
  if(!state.group||!state.activeGroup)return;
  const groupID=state.activeGroup.id,removed=state.group.privacyRemovals||{},layerIDs=new Set(decodeGroup(state.group).map(l=>l.id));
  const candidates=Object.entries(state.manifests).filter(([id,m])=>m?.isDeleted===false&&layerIDs.has(m.layerID)&&!removed.routes?.[id]&&!removed.layers?.[m.layerID]&&state.routes.get(id)?.revision!==m.revision&&!state.routePending.has(id));
  let cursor=0;
  const worker=async()=>{while(cursor<candidates.length&&!signal.aborted){const[id,manifest]=candidates[cursor++];state.routePending.add(id);try{
    if(typeof manifest.revision!=='string'||/[.#$\[\]/]/.test(manifest.revision))throw new Error('Invalid route revision.');
    const chunks=await client.request(`routeGeometry/${groupID}/${id}/${manifest.revision}`,{signal});
    const route=decodeRoute(chunks,manifest,id);
    const head=await client.request(`routeManifests/${groupID}/${id}`,{signal});
    if(generation===state.generation&&head?.revision===manifest.revision&&head.isDeleted===false&&state.manifests[id]?.revision===manifest.revision){state.routes.set(id,route);state.routeErrors.delete(id);reconcile();}
  }catch(e){if(!signal.aborted&&generation===state.generation){state.routes.delete(id);state.routeErrors.add(id);status('Pins connected · some routes could not be loaded','error');reconcile();}}finally{if(generation===state.generation){state.routePending.delete(id);const current=state.manifests[id];if(current?.isDeleted===false&&current.revision!==manifest.revision)queueMicrotask(()=>loadRoutes(generation,signal).catch(()=>{}));}}}};
  await Promise.all([worker(),worker(),worker()]);
}
async function demo(){
  stopSession();state.mode='demo';state.hidden.clear();remove('tw.portal.group.v1');$('disconnect').hidden=false;$('group-name').textContent='Redridge field survey';$('group-description').textContent='A fictional workspace. Add pins, draw lines and try editing. Demo changes stay in this tab.';$('connect-label').textContent='Connect your group';status('Demo data · no cloud connection');
  try{const data=await(await fetch('./demo.json')).json();demoClient=new DemoClient(data);demoClient.onChange=rebuildDemo;state.activeGroup={id:demoClient.groupID,name:'Redridge field survey'};rebuildDemo();await openBytes(new Uint8Array(await(await fetch('./demo.pdf')).arrayBuffer()),'Redridge survey · demo.pdf');}catch(e){toast(`Demo could not be opened. ${e.message}`);}
}
$('demo').addEventListener('click',demo);$('demo-empty').addEventListener('click',demo);
$('pdf-upload').addEventListener('change',async(e)=>{const f=e.target.files[0];if(f)await openBytes(new Uint8Array(await f.arrayBuffer()),f.name);e.target.value='';});
$('page-select').addEventListener('change',e=>displayPage(Number(e.target.value)));
$('region-select').addEventListener('change',updateAlignment);
$('search').addEventListener('input',()=>{renderLists();scheduleDraw();});
function setTheme(theme){document.documentElement.dataset.theme=theme;const dark=theme==='dark';$('theme-toggle').setAttribute('aria-pressed',String(dark));$('theme-toggle').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');$('theme-toggle').title=dark?'Switch to light mode':'Switch to dark mode';document.querySelector('meta[name="theme-color"]').content=dark?'#101914':'#f7f8f3';}
setTheme(document.documentElement.dataset.theme||'light');
$('theme-toggle').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(theme);try{saveTheme(theme);}catch{toast('Theme changed for this visit. Browser storage is unavailable.');}});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',e=>{if(!readTheme())setTheme(e.matches?'dark':'light');});
function setLabelAngle(value,persist=false){state.labelAngle=Number(value);$('label-angle').value=state.labelAngle;$('label-angle-value').textContent=state.labelAngle+'°';$('label-angle').setAttribute('aria-valuetext',state.labelAngle+' degrees');if(persist)try{saveLabelAngle(state.labelAngle);}catch{toast('Label angle changed for this visit. Browser storage is unavailable.');}scheduleDraw();}
setLabelAngle(state.labelAngle);
$('label-angle').addEventListener('input',e=>setLabelAngle(e.target.value));$('label-angle').addEventListener('change',e=>setLabelAngle(e.target.value,true));$('reset-label-angle').addEventListener('click',()=>setLabelAngle(0,true));
$('opacity').addEventListener('input',e=>{state.opacity=Number(e.target.value)/100;$('opacity-label').textContent=e.target.value+'%';scheduleDraw();});
$('zoom-in').addEventListener('click',()=>zoom(1.25));$('zoom-out').addEventListener('click',()=>zoom(.8));$('fit').addEventListener('click',()=>{pauseGPSFollow();fit();});$('close-detail').addEventListener('click',closeDetail);
$('sidebar-toggle').addEventListener('click',()=>{const open=document.body.classList.toggle('sidebar-open');$('sidebar-toggle').setAttribute('aria-expanded',String(open));});
$('add-anchor').addEventListener('click',()=>{state.capture=true;$('capture-hint').hidden=false;$('map-area').classList.add('capturing');document.body.classList.remove('sidebar-open');$('sidebar-toggle').setAttribute('aria-expanded','false');});$('cancel-capture').addEventListener('click',cancelCapture);
$('anchor-form').addEventListener('submit',e=>{e.preventDefault();try{const next=[...state.anchors,{...state.pendingAnchor,latitude:Number($('anchor-lat').value),longitude:Number($('anchor-lon').value)}];if(next.length>=3)makeModel(next,state.pageBox,false);state.anchors=next;save(calibrationKey(),next);$('anchor-dialog').close();updateAlignment();if(next.length<3)toast(`${next.length} reference point${next.length===1?'':'s'} saved. Pick ${3-next.length} more.`);}catch(error){$('anchor-error').textContent=error.message;}});
$('reset-calibration').addEventListener('click',()=>{state.anchors=[];remove(calibrationKey());updateAlignment();});
$('export-calibration').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,fingerprint:state.pdf.fingerprints[0],page:state.page,coordinateSystem:'EPSG:4326',anchors:state.anchors},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='terrawarden-map-alignment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('alignment-upload').addEventListener('change',async(e)=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw new Error('Alignment file is too large.');const data=JSON.parse(await file.text());if(data.schemaVersion!==1||data.fingerprint!==state.pdf.fingerprints[0]||data.page!==state.page||data.coordinateSystem!=='EPSG:4326')throw new Error('This alignment belongs to a different PDF or page.');makeModel(data.anchors,state.pageBox,false);state.anchors=data.anchors;save(calibrationKey(),state.anchors);updateAlignment();}catch(error){toast(error.message);}e.target.value='';});
function updateExportButtons(){const reason=state.exporting?'Preparing GeoPDF…':state.pageLoading?'Wait for the PDF page to finish loading.':!state.pdf?'Open a PDF map first.':!state.model?'Align this map before exporting a GeoPDF.':!state.metadata?'This PDF cannot be exported by this browser.':'';for(const id of ['export-pdf','export-pdf-tool']){$(id).disabled=!!reason;$(id).title=reason||'Export this PDF page with the visible layers at original quality';}$('export-pdf').textContent=state.exporting?'Preparing GeoPDF…':'Export map as GeoPDF';$('export-hint').textContent=reason||'Full page · visible layers and search results · original PDF quality';}
function clearExportDownload(){state.exportAbort?.abort();if(exportURL)URL.revokeObjectURL(exportURL);exportURL=null;$('export-download').hidden=true;$('export-download').removeAttribute('href');}
async function exportCurrentMap(){
  if(state.exporting||state.pageLoading||!state.metadata||!state.model)return;
  // Snapshot before loading the exporter so live sync cannot change which
  // features, colours or filters belong to this requested file.
  const snapshot={source:state.metadata,pageIndex:state.page-1,model:state.model,pageBox:[...state.pageBox],viewport:state.viewport,features:structuredClone(allFeatures()),hidden:new Set(state.hidden),search:$('search').value,opacity:state.opacity,labelAngle:state.labelAngle,scale:state.scale,sourceRegion:Number($('region-select').value)||0,usePDFAlignment:state.anchors.length===0,title:state.pdfName};
  clearExportDownload();state.exportAbort=new AbortController();state.exporting=true;updateExportButtons();
  try{const {exportGeoPDF,geoPDFFilename,rasterizeExportLabel}=await import('./geopdf-export.mjs');const result=await exportGeoPDF({...snapshot,rasterizeLabel:rasterizeExportLabel,signal:state.exportAbort.signal}),blob=new Blob([result.bytes],{type:'application/pdf'}),a=$('export-download');exportURL=URL.createObjectURL(blob);a.href=exportURL;a.download=geoPDFFilename(snapshot.title,snapshot.pageIndex+1);a.hidden=false;a.click();toast(`GeoPDF ready · ${result.pinCount} pins · ${result.routeCount} routes / lines. `);const link=node('a','export-toast-link','Download GeoPDF');link.href=exportURL;link.download=a.download;$('toast').append(link);}catch(error){toast(error.name==='AbortError'?'GeoPDF export cancelled.':`GeoPDF export failed. ${error.message}`);}finally{state.exportAbort=null;state.exporting=false;updateExportButtons();}
}
$('export-pdf').addEventListener('click',exportCurrentMap);$('export-pdf-tool').addEventListener('click',exportCurrentMap);
window.addEventListener('pagehide',clearExportDownload);
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>$(b.dataset.close).close());
function keyState(message){const key=readAPIKey();$('key-badge').textContent=key?'Saved on this browser':'Not saved';$('key-remove').hidden=!key;$('key-state').textContent=message||(key?'Your key is saved on this browser. It will still be here after reloading.':'Save a key to remember it on this browser.');}
function connectionDialog(showKey=false){$('connect-error').textContent='';$('upgrade-submit').hidden=true;$('connect-form').dataset.upgrade='false';$('api-key').value=readAPIKey();$('api-key').type='password';$('key-show').textContent='Show key';$('viewer-name').value=saved('tw.portal.name')||'';$('service-setup').open=showKey||!$('api-key').value;keyState();$('connect-dialog').showModal();}
$('connect').addEventListener('click',()=>connectionDialog());$('key-settings').addEventListener('click',()=>connectionDialog(true));
$('key-save').addEventListener('click',()=>{try{saveAPIKey($('api-key').value);keyState('Key saved on this browser. Reloading will keep it.');}catch(e){$('key-state').textContent=e.message;}});
$('key-show').addEventListener('click',()=>{const show=$('api-key').type==='password';$('api-key').type=show?'text':'password';$('key-show').textContent=show?'Hide key':'Show key';});
$('key-remove').addEventListener('click',()=>{try{removeAPIKey();$('api-key').value='';keyState('Saved key removed from this browser.');}catch(e){$('key-state').textContent=e.message;}});
$('connect-form').addEventListener('submit',async(e)=>{e.preventDefault();$('join-submit').disabled=true;$('connect-error').textContent='';try{const apiKey=$('api-key').value.trim();if(!apiKey)throw new Error('The portal owner needs to add the Firebase Web API key under Connection setup.');saveAPIKey(apiKey);keyState();client=new ViewerClient({...config,apiKey});const group=await client.join($('invite').value,$('viewer-name').value,{upgrade:$('connect-form').dataset.upgrade==='true'});save('tw.portal.name',$('viewer-name').value.trim());save('tw.portal.group.v1',group);$('invite').value='';$('connect-dialog').close();await openGroup(group);}catch(error){$('connect-error').textContent=error.message;$('upgrade-submit').hidden=error.code!=='upgrade';}finally{$('join-submit').disabled=false;}});
$('upgrade-submit').addEventListener('click',()=>{$('connect-form').dataset.upgrade='true';$('upgrade-submit').hidden=true;$('connect-form').requestSubmit();});
$('disconnect').addEventListener('click',()=>{stopSession();state.mode='empty';remove('tw.portal.group.v1');$('group-name').textContent='Your field, in view.';$('group-description').textContent='Open a PDF map and connect a TerraWarden group to bring your shared layers into focus.';$('connect-label').textContent='Connect group';$('disconnect').hidden=true;status('No group connected');reconcile();});
const pointers=new Map();let gesture=null,clicked=null;
const point=(e)=>{const r=$('map-area').getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];};
function updateCursor(p){if(state.model&&state.viewport){const raw=state.viewport.convertToPdfPoint((p[0]-state.x)/state.scale,(p[1]-state.y)/state.scale),geo=state.model.toGeo(...raw);if(raw[0]>=state.pageBox[0]&&raw[0]<=state.pageBox[2]&&raw[1]>=state.pageBox[1]&&raw[1]<=state.pageBox[3]&&inPolygon(raw,state.model.footprint)&&Math.abs(geo.latitude)<=90){state.readout={point:geo,source:'Map cursor'};const grid=formattedGrid(geo,state.crs);$('coordinate-status').textContent=grid?`Cursor · E ${grid.eastingText} · N ${grid.northingText}`:'Cursor outside supported grid';refreshCoordinates();}}}
function beginGesture(){const values=[...pointers.values()];gesture=values.length>=2?{kind:'pinch',distance:Math.hypot(values[0][0]-values[1][0],values[0][1]-values[1][1]),center:[(values[0][0]+values[1][0])/2,(values[0][1]+values[1][1])/2],x:state.x,y:state.y,scale:state.scale}:{kind:'pan',point:values[0],x:state.x,y:state.y};}
$('map-area').addEventListener('pointerdown',e=>{if(!state.viewport||e.button!==0||e.target.closest('button,.map-tools,.feature-detail,.map-topbar,.capture-hint,.draw-controls'))return;if(!editorUI.active()&&!state.capture&&e.target.closest('.pin-marker,.route-line'))return;pointers.set(e.pointerId,point(e));$('map-area').setPointerCapture(e.pointerId);clicked={point:point(e),moved:false};beginGesture();});
$('map-area').addEventListener('pointermove',e=>{const p=point(e);updateCursor(p);if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,p);if(clicked&&Math.hypot(p[0]-clicked.point[0],p[1]-clicked.point[1])>4){clicked.moved=true;if(gesture.kind==='pan')pauseGPSFollow();}if(gesture.kind==='pinch'&&pointers.size>=2){const[a,b]=[...pointers.values()],center=[(a[0]+b[0])/2,(a[1]+b[1])/2],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);state.scale=Math.max(.03,Math.min(12,gesture.scale*distance/Math.max(1,gesture.distance)));state.x=center[0]-(gesture.center[0]-gesture.x)*state.scale/gesture.scale;state.y=center[1]-(gesture.center[1]-gesture.y)*state.scale/gesture.scale;if(clicked)clicked.moved=true;}else{state.x=gesture.x+p[0]-gesture.point[0];state.y=gesture.y+p[1]-gesture.point[1];}transform();});
function endPointer(e){
  if(!pointers.has(e.pointerId))return;const p=point(e),tap=clicked&&!clicked.moved&&pointers.size===1&&e.type!=='pointercancel';
  pointers.delete(e.pointerId);if(pointers.size)beginGesture();else gesture=null;
  if(tap){const[x,y]=state.viewport.convertToPdfPoint((p[0]-state.x)/state.scale,(p[1]-state.y)/state.scale);if(x>=state.pageBox[0]&&x<=state.pageBox[2]&&y>=state.pageBox[1]&&y<=state.pageBox[3]){
    if(state.capture){state.pendingAnchor={x,y};cancelCapture();$('anchor-form').reset();$('anchor-number').textContent=state.anchors.length+1;$('anchor-error').textContent='';$('anchor-dialog').showModal();}
    else if(editorUI.active()&&state.model&&inPolygon([x,y],state.model.footprint))editorUI.mapClick(state.model.toGeo(x,y));
    else updateCursor(p);
  }}clicked=null;
}
$('map-area').addEventListener('pointerup',endPointer);$('map-area').addEventListener('pointercancel',endPointer);
$('map-area').addEventListener('wheel',e=>{if(!state.viewport)return;e.preventDefault();zoom(Math.exp(-e.deltaY*.0015),point(e));},{passive:false});
$('map-area').addEventListener('keydown',e=>{if(e.target.closest('input,select,button,[role=button]'))return;if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}else if(e.key==='-'){e.preventDefault();zoom(.8);}else if(e.key==='0'){e.preventDefault();pauseGPSFollow();fit();}else if(e.key==='Escape'){cancelCapture();editorUI.cancelMap(true);closeDetail();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();pauseGPSFollow();state.x+=e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0;state.y+=e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0;transform();}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
$('map-area').addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth++;$('drop-hint').hidden=false;}});
$('map-area').addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('drop-hint').hidden=true;}});
$('map-area').addEventListener('drop',async e=>{e.preventDefault();dragDepth=0;$('drop-hint').hidden=true;const file=e.dataTransfer.files[0];if(file&&(/\.pdf$/i.test(file.name)||file.type==='application/pdf'))await openBytes(new Uint8Array(await file.arrayBuffer()),file.name);else toast('Drop a PDF map here.');});
new ResizeObserver(()=>{if(state.viewport)fit();}).observe($('map-area'));
function rebuildDemo(){
  if(state.mode!=='demo'||!demoClient)return;state.group=demoClient.group;state.manifests=demoClient.manifests;state.routes.clear();
  for(const [id,m]of Object.entries(state.manifests))if(m.isDeleted===false)try{state.routes.set(id,decodeRoute(demoClient.tree.routeGeometry.DEMO[id]?.[m.revision],m,id));}catch{}
  reconcile();
}
function applySaved(result){
  if(state.mode==='demo'){rebuildDemo();return;}
  if(result.record&&state.group){const r=result.record,key=r.kind==='layer'?`layer-${r.layerID}`:`pin-${r.layerID}-${r.pin.id}`;state.group.items??={};state.group.items[key]=r;}
  if(result.manifest){const m=result.manifest;state.manifests[result.id]=m;if(m.isDeleted)state.routes.delete(result.id);else if(result.chunks)state.routes.set(result.id,decodeRoute(result.chunks,m,result.id));else if(state.routes.has(result.id))state.routes.set(result.id,{...state.routes.get(result.id),...m.metadata});}
  if(result.replacedID){if(state.manifests[result.replacedID])state.manifests[result.replacedID].isDeleted=true;state.routes.delete(result.replacedID);}
  reconcile();
}
const editorUI=createEditorUI({getState:()=>state,client:()=>state.mode==='demo'?demoClient:client,features:allFeatures,displayName:()=>state.mode==='demo'?'Demo editor':saved('tw.portal.name')||'Web portal',toast,draw:scheduleDraw,cancelCalibration:cancelCapture,closeDetail,saved:applySaved});
renderLists();editorUI.refresh();updateExportButtons();
const previousGroup=saved('tw.portal.group.v1'),apiKey=readAPIKey();
if(previousGroup&&apiKey){try{client=new ViewerClient({...config,apiKey});if(client.identity?.refreshToken)openGroup(previousGroup).catch(e=>connectionLost(e.message));}catch(e){status(e.message,'error');}}
