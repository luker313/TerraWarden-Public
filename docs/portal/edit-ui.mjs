import { SharedEditor, canEdit, newID, nowSwift } from './editor.mjs';
import { formattedGrid, defaultGrid, inverseGrid } from './coordinates.mjs';
import { validCoordinate } from './core.mjs';
const $=id=>document.getElementById(id),copy=v=>structuredClone(v);

export function createEditorUI(ctx){
  let draft=null,mapEdit=null,busy=false,mutation=null;
  const state=()=>ctx.getState();
  const writable=()=>canEdit(state().role)&&(state().mode==='demo'||state().mode==='live');
  const currentFeature=()=>ctx.features().find(f=>f.id===state().selected);
  function fields(){return {name:$('edit-name').value,unitID:$('edit-unit').value,mineSite:$('edit-site').value,note:$('edit-note').value,color:$('edit-colour').value,lineStyle:$('edit-line-type').value,creatorName:ctx.displayName()};}
  function position(){
    if($('edit-x').value.trim()===''||$('edit-y').value.trim()==='')throw new Error('Enter a position or pick one on the map.');
    const x=Number($('edit-x').value),y=Number($('edit-y').value);
    const point=draft.coordMode==='grid'?inverseGrid(x,y,draft.crs):{latitude:x,longitude:y};
    if(!validCoordinate(point))throw new Error('This position is outside the supported coordinate range. Check its datum and zone.');
    return point;
  }
  function setPosition(point,mode){
    draft.coordMode=mode;$('edit-coordinate-mode').value=mode;
    $('edit-x-label').textContent=mode==='grid'?'Easting (m)':'Latitude';$('edit-y-label').textContent=mode==='grid'?'Northing (m)':'Longitude';
    const grid=point?formattedGrid(point,draft.crs):null;
    $('edit-x').value=point?(mode==='grid'?(grid?.easting??''):point.latitude):'';
    $('edit-y').value=point?(mode==='grid'?(grid?.northing??''):point.longitude):'';
    $('edit-grid-label').textContent=mode==='grid'?`${draft.crs.label} · EPSG:${draft.crs.epsg}`:'WGS84 decimal degrees; southern latitudes are negative.';
  }
  function showForm(value){
    if(!writable()){ctx.toast('Connect with an edit code to change shared features.');return;}
    draft=value;const pin=draft.kind==='pin',layer=draft.kind==='layer';
    draft.crs=state().crs||(draft.point?defaultGrid(draft.point):null);
    $('edit-kind').textContent=state().mode==='demo'?'DEMO · LOCAL CHANGES':`SHARED ${draft.kind.toUpperCase()}`;
    $('edit-title').textContent=draft.replaceBaseline?'Redraw line':`${draft.baseline?'Edit':'Add'} ${draft.kind}`;
    $('edit-context').textContent=state().mode==='demo'?'These demo changes stay in this tab.':`Changes will be shared with ${state().group?.name||'this group'}.`;
    $('edit-layer').replaceChildren(...state().layers.map(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=l.name;return o;}));
    $('edit-layer').value=draft.layerID||state().layers[0]?.id||'';
    $('edit-layer-field').hidden=layer;$('edit-layer').required=!layer;$('edit-layer').disabled=layer||!!draft.baseline;
    $('edit-name').value=draft.fields.name||'';$('edit-name').maxLength=layer?120:512;
    $('edit-unit').value=draft.fields.unitID||'';$('edit-site').value=draft.fields.mineSite||'';$('edit-note').value=draft.fields.note||'';
    $('edit-attributes').hidden=layer;$('edit-position').hidden=!pin;$('edit-x').required=pin;$('edit-y').required=pin;
    $('edit-line-style').hidden=draft.kind!=='line';$('edit-colour').value=draft.fields.color||'green';$('edit-line-type').value=draft.fields.lineStyle||'solid';
    $('edit-coordinate-mode').querySelector('option[value=grid]').disabled=!draft.crs;
    if(pin)setPosition(draft.point,draft.crs?'grid':'geo');
    $('edit-delete-layer').hidden=!(layer&&draft.baseline);$('edit-error').textContent='';$('edit-save').textContent=state().mode==='demo'?'Save demo change':'Save to group';
    if(!$('edit-dialog').open)$('edit-dialog').showModal();
  }
  function fresh(kind){return {kind,id:newID(),revision:newID(),segmentID:newID(),createdAt:nowSwift(),layerID:state().layers[0]?.id,fields:{name:'',unitID:'',mineSite:'',note:''},baseline:null};}
  function updateDraw(){
    $('draw-controls').hidden=!mapEdit;$('map-area').classList.toggle('editing-map',!!mapEdit);
    if(mapEdit){$('draw-instruction').textContent=mapEdit.kind==='pin'?'Click the pin position':`${mapEdit.points.length} points · click to add vertices`;$('draw-undo').hidden=mapEdit.kind==='pin';$('draw-finish').hidden=mapEdit.kind==='pin';$('draw-finish').disabled=mapEdit.points?.length<2;}
    ctx.draw();
  }
  function cancelMap(restore=false){const old=mapEdit;mapEdit=null;updateDraw();if(restore&&old?.restore)showForm(old.draft);}
  function beginMap(value){
    if(!writable())return;
    if(!state().model){ctx.toast('Open an aligned PDF map first. Pins can also be positioned by entering coordinates.');return;}
    ctx.cancelCalibration();ctx.closeDetail();mapEdit=value;document.body.classList.remove('sidebar-open');$('sidebar-toggle').setAttribute('aria-expanded','false');updateDraw();
  }
  function editFeature(feature){
    const raw=feature.type==='pin'?state().group?.items?.[feature.id]:state().manifests[feature.id];if(!raw)return;
    showForm({kind:feature.type,id:feature.type==='pin'?raw.pin.id:feature.id,layerID:raw.layerID,fields:copy(feature.type==='pin'?raw.pin:{...raw.metadata,color:raw.metadata.drawingAppearance?.color,lineStyle:raw.metadata.drawingAppearance?.lineStyle}),point:feature.type==='pin'?copy(raw.pin):null,baseline:copy(raw)});
  }
  function editLayer(layer){const raw=state().group?.items?.[`layer-${layer.id}`];if(raw)showForm({kind:'layer',id:layer.id,fields:{name:raw.name},baseline:copy(raw)});}
  function refresh(){
    const allowed=writable();$('editor-tools').hidden=!allowed;$('new-layer').hidden=!allowed;$('feature-edit-actions').hidden=!allowed||!currentFeature();
    $('redraw-feature').hidden=currentFeature()?.type!=='line';
    $('mode-tag').textContent=state().mode==='demo'?'DEMO':allowed?'EDITOR':'VIEWER';
    if(!allowed&&(draft||mapEdit)){mutation?.abort();draft=null;cancelMap();$('edit-dialog').close();ctx.toast('Edit access ended. No further changes will be sent.');}
  }
  function reset(){mutation?.abort();draft=null;mapEdit=null;$('edit-dialog').close();updateDraw();}
  async function perform(task){
    if(busy)return;busy=true;mutation=new AbortController();const generation=state().generation;
    for(const id of ['edit-save','edit-close','edit-delete-layer','edit-feature','delete-feature'])$(id).disabled=true;
    try{
      const client=ctx.client(),groupID=state().activeGroup?.id;if(!client||!groupID||!writable())throw new Error('Connect with an edit code first.');
      const editor=new SharedEditor(client,groupID,{signal:mutation.signal}),result=await task(editor);
      if(state().generation===generation){ctx.saved(result);$('edit-dialog').close();draft=null;ctx.toast(state().mode==='demo'?'Demo change saved in this tab.':'Saved to the shared group.');}
    }catch(error){if(error.name!=='AbortError'){if($('edit-dialog').open)$('edit-error').textContent=error.message;else ctx.toast(error.message);}}
    finally{busy=false;mutation=null;for(const id of ['edit-save','edit-close','edit-delete-layer','edit-feature','delete-feature'])$(id).disabled=false;refresh();}
  }
  $('new-layer').addEventListener('click',()=>showForm(fresh('layer')));
  $('add-pin').addEventListener('click',()=>{const value=fresh('pin');if(!state().layers.length){ctx.toast('Create a shared layer first.');return;}if(state().model)beginMap({kind:'pin',draft:value});else{value.point=state().gpsFix||state().readout?.point||null;showForm(value);}});
  $('draw-line').addEventListener('click',()=>{if(!state().layers.length){ctx.toast('Create a shared layer first.');return;}beginMap({kind:'line',points:[],draft:fresh('line')});});
  $('draw-undo').addEventListener('click',()=>{mapEdit?.points.pop();updateDraw();});$('draw-cancel').addEventListener('click',()=>cancelMap(true));
  $('draw-finish').addEventListener('click',()=>{if(!mapEdit||mapEdit.points.length<2)return;const value=mapEdit.draft;value.points=copy(mapEdit.points);cancelMap();showForm(value);});
  $('edit-feature').addEventListener('click',()=>{const f=currentFeature();if(f)editFeature(f);});
  $('redraw-feature').addEventListener('click',()=>{const f=currentFeature(),raw=f&&state().manifests[f.id];if(!raw||f.type!=='line')return;const value=fresh('line');value.layerID=raw.layerID;value.fields={...raw.metadata,color:raw.metadata.drawingAppearance?.color,lineStyle:raw.metadata.drawingAppearance?.lineStyle};value.replaceBaseline=copy(raw);beginMap({kind:'line',points:[],draft:value});});
  $('delete-feature').addEventListener('click',()=>{
    const f=currentFeature();if(!f||!writable()||!confirm(`Delete “${f.name}” from the shared group? This also removes it for other members.`))return;
    const raw=copy(f.type==='pin'?state().group.items[f.id]:state().manifests[f.id]);
    perform(editor=>f.type==='pin'?editor.savePin({id:raw.pin.id,layerID:raw.layerID,point:raw.pin,fields:raw.pin,baseline:raw,crs:state().crs,isDeleted:true}):editor.saveRoute({baseline:raw,fields:raw.metadata,isDeleted:true}));
  });
  $('edit-delete-layer').addEventListener('click',()=>{if(!draft?.baseline||!confirm(`Delete layer “${draft.fields.name}” and hide all its shared pins and lines for the group?`))return;const value=copy(draft);perform(editor=>editor.saveLayer({id:value.id,name:value.fields.name,baseline:value.baseline,isDeleted:true}));});
  $('edit-close').addEventListener('click',()=>{if(!busy){$('edit-dialog').close();draft=null;}});
  $('edit-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else draft=null;});
  $('edit-coordinate-mode').addEventListener('change',event=>{try{const oldPoint=position();setPosition(oldPoint,event.target.value);}catch(error){$('edit-coordinate-mode').value=draft.coordMode;$('edit-error').textContent=error.message;}});
  $('pick-edit-position').addEventListener('click',()=>{if(!state().model){ctx.toast('Open an aligned PDF first.');return;}draft.fields=fields();draft.layerID=$('edit-layer').value;try{draft.point=position();}catch{}$('edit-dialog').close();beginMap({kind:'pin',draft,restore:true});});
  $('edit-form').addEventListener('submit',event=>{
    event.preventDefault();if(!draft)return;
    try{
      draft.fields=fields();draft.layerID=$('edit-layer').value||draft.layerID;
      if(draft.kind==='pin')draft.point=position();const value=copy(draft);
      perform(editor=>value.kind==='layer'?editor.saveLayer({id:value.id,name:value.fields.name,baseline:value.baseline}):value.kind==='pin'?editor.savePin({...value,crs:value.crs}):value.baseline?editor.saveRoute({baseline:value.baseline,fields:value.fields}):value.replaceBaseline?editor.replaceLine(value,value.replaceBaseline):editor.createLine(value));
    }catch(error){$('edit-error').textContent=error.message;}
  });
  return {
    writable,refresh,reset,editLayer,active:()=>!!mapEdit,cancelMap,
    mapClick(point){if(!mapEdit||!validCoordinate(point))return false;if(mapEdit.kind==='pin'){const value=mapEdit.draft;value.point=point;cancelMap();showForm(value);}else{mapEdit.points.push(point);updateDraw();}return true;},
    draw(overlay,k,svg,position){
      if(!mapEdit?.points?.length)return;const points=mapEdit.points.map(p=>position(p)?.screen).filter(Boolean);if(!points.length)return;
      const g=svg('g',{'aria-label':'Draft line',class:'draft-line'}),d=points.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join(' ');
      g.append(svg('path',{d,fill:'none',stroke:'#fff','stroke-width':6/k}),svg('path',{d,fill:'none',stroke:'#21865b','stroke-width':3/k,'stroke-dasharray':`${7/k} ${5/k}`}));
      points.forEach(([x,y],i)=>{g.append(svg('circle',{cx:x,cy:y,r:5/k,fill:'#21865b',stroke:'#fff','stroke-width':2/k}));const label=svg('text',{x:x+8/k,y:y-7/k,'font-size':10/k,fill:'#174d3a',stroke:'#fff','stroke-width':2/k,'paint-order':'stroke'});label.textContent=i+1;g.append(label);});overlay.append(g);
    }
  };
}
