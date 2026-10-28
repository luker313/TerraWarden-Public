import { validCoordinate, normalizeLongitude } from './core.mjs';
import { gridCoordinate } from './coordinates.mjs';

const uuidPattern=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const newID=()=>{if(crypto.randomUUID)return crypto.randomUUID().toUpperCase();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
export const nowSwift=()=>Date.now()/1000-978307200;
export const canEdit=role=>role==='editor'||role==='owner';
const fail=(message,code)=>Object.assign(new Error(message),{code});
const requireID=id=>{if(!uuidPattern.test(id))throw new Error('This feature has an invalid identifier.');return id;};
const text=(value,label,limit,required=false)=>{const v=String(value??'');if((required&&!v.trim())||v.length>limit||new TextEncoder().encode(v).length>limit)throw new Error(`${label} must ${required?'not be empty and ':''}fit within ${limit} characters/bytes.`);return required?v.trim():v;};
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const same=(a,b)=>canonical(a)===canonical(b);
function desired(record){if(!record)return record;const next={...record};delete next.modifiedAt;return next;}
export function distanceMetres(a,b){const phi=a.latitude*Math.PI/180,p=b.latitude*Math.PI/180,dLat=p-phi,dLon=normalizeLongitude(b.longitude-a.longitude)*Math.PI/180;const h=Math.sin(dLat/2)**2+Math.cos(phi)*Math.cos(p)*Math.sin(dLon/2)**2;return 6371008.8*2*Math.atan2(Math.sqrt(Math.max(0,Math.min(1,h))),Math.sqrt(Math.max(0,1-h)));}

export function drawingPayload({id=newID(),revision=newID(),segmentID=newID(),layerID,points,fields,uid,createdAt=nowSwift()}){
  [id,revision,segmentID,layerID].forEach(requireID);
  if(!Array.isArray(points)||points.length<2||points.length>5000||!points.every(validCoordinate))throw new Error('A line needs 2–5000 valid geographic points.');
  const distance=points.slice(1).reduce((sum,p,i)=>sum+distanceMetres(points[i],p),0);
  if(distance<.001)throw new Error('Choose at least two different map positions.');
  const chunkCount=Math.ceil(points.length/512),chunks={};
  for(let i=0;i<chunkCount;i++){
    const part=points.slice(i*512,(i+1)*512),key=`c${String(i).padStart(6,'0')}`;
    chunks[key]={schemaVersion:1,layerID,routeID:id,revision,index:i,count:part.length,points:Object.fromEntries(part.map((p,j)=>[`p${String(j).padStart(4,'0')}`,{segmentID,point:{latitude:p.latitude,longitude:p.longitude}}]))};
  }
  const metadata={schemaVersion:1,id,layerID,name:text(fields.name,'Name',512,true),note:text(fields.note,'Note',50000),geometryRevision:revision,distanceMeters:distance,unitID:text(fields.unitID,'Unit ID',200),mineSite:text(fields.mineSite,'Site',200),creatorID:`web-${uid}`,creatorName:text(fields.creatorName||'Web portal','Creator name',200),geographicReference:'EPSG:4326',source:'TerraWarden web portal; WGS84 navigation coordinates; epoch unspecified',reducedAccuracy:false,rejectedFixes:0,geometryKind:'drawnLine',createdAt,drawingAppearance:{color:fields.color||'green',lineStyle:fields.lineStyle||'solid',lineWidth:'medium',contrastOutline:true,opacity:1}};
  if(!['red','blue','green','yellow','purple','orange','white','black'].includes(metadata.drawingAppearance.color)||!['solid','dashed','dotted'].includes(metadata.drawingAppearance.lineStyle))throw new Error('Invalid line appearance.');
  const manifest={privacyVersion:2,schemaVersion:1,routeID:id,layerID,revision,chunkCount,pointCount:points.length,lastChunk:`c${String(chunkCount-1).padStart(6,'0')}`,metadata,modifiedAt:nowSwift(),modifiedBy:`web-${uid}`,writerUID:uid,isDeleted:false};
  return {id,manifest,chunks};
}

export class SharedEditor {
  constructor(client,groupID,{signal}={}){this.client=client;this.groupID=groupID;this.signal=signal;}
  async request(path,options={}){if(this.signal?.aborted)throw new DOMException("Edit cancelled","AbortError");return this.client.request(path,{...options,signal:this.signal});}
  async access(layerID){
    const group=await this.request(`pinGroups/${this.groupID}`);
    if(group?.isDeleted!==false||!canEdit(group.members?.[this.client.uid]?.role))throw fail('This browser does not have edit access. Reconnect with an edit invitation or ask the owner.','permission');
    if(layerID&&(!group.items?.[`layer-${layerID}`]||group.items[`layer-${layerID}`].isDeleted!==false||group.privacyRemovals?.layers?.[layerID]))throw fail('This layer is no longer available. Choose another layer.','permission');
    return group;
  }
  async contribution(kind,id){await this.request(`cloudContributions/${kind}/${this.groupID}/${id}/${this.client.uid}`,{method:'PUT',body:true});}
  async write(path,payload,baseline){
    const snapshot=await this.request(path,{withETag:true});
    if(snapshot.value?.isDeleted===true&&payload.isDeleted!==true)throw fail('This feature was deleted on another device. It cannot be restored here.','conflict');
    // Recover a lost successful response without creating a duplicate or writing
    // over a later user's change. The operation ID stays stable in the draft.
    if(snapshot.value?.writerUID===this.client.uid&&same(desired(snapshot.value),desired(payload)))return snapshot.value;
    if(!same(snapshot.value,baseline??null))throw fail('This feature changed on another device. Close this editor and reopen it to use the latest version.','conflict');
    if(!snapshot.etag)throw new Error('The service did not provide an edit version. No changes were sent.');
    try{return await this.request(path,{method:'PUT',body:payload,etag:snapshot.etag});}
    catch(error){
      if(!['permission','conflict'].includes(error.code)){
        try{const value=await this.request(path);if(same(value,payload))return value;}catch{}
      }
      throw error;
    }
  }
  async saveLayer({id=newID(),name,baseline=null,isDeleted=false}){
    requireID(id);await this.access();
    const record={privacyVersion:2,kind:'layer',layerID:id,name:text(name,'Layer name',120,true),modifiedAt:nowSwift(),modifiedBy:`web-${this.client.uid}`,writerUID:this.client.uid,isDeleted};
    const key=`layer-${id}`;await this.contribution('pins',key);
    await this.write(`pinGroups/${this.groupID}/items/${key}`,record,baseline);return {id,record};
  }
  async savePin({id=newID(),layerID,point,fields,crs,baseline=null,isDeleted=false,createdAt=nowSwift()}){
    [id,layerID].forEach(requireID);if(!validCoordinate(point))throw new Error('Choose a valid pin position.');
    await this.access(layerID);
    const grid=gridCoordinate(point,crs),name=text(fields.name,'Name',512,true);
    const pin={id,name,latitude:point.latitude,longitude:point.longitude,easting:grid?.easting??baseline?.pin?.easting??0,northing:grid?.northing??baseline?.pin?.northing??0,timestamp:baseline?.pin?.timestamp??createdAt,unitID:text(fields.unitID,'Unit ID',200),mineSite:text(fields.mineSite,'Site',200),note:text(fields.note,'Note',500000)};
    const record={privacyVersion:2,kind:'pin',layerID,name,pin,modifiedAt:nowSwift(),modifiedBy:`web-${this.client.uid}`,writerUID:this.client.uid,isDeleted};
    const key=`pin-${layerID}-${id}`;await this.contribution('pins',key);await this.write(`pinGroups/${this.groupID}/items/${key}`,record,baseline);return {id:key,record};
  }
  async createLine(options){
    await this.access(options.layerID);
    const payload=drawingPayload({...options,uid:this.client.uid});
    await this.request(`routeUploadOwners/${this.client.uid}/${this.groupID}/${payload.id}/${payload.manifest.revision}`,{method:'PUT',body:true});
    // Immutable geometry is registered and uploaded first; only the manifest
    // makes a complete line visible to other members, matching the iOS codec.
    for(const [key,chunk]of Object.entries(payload.chunks)){
      const path=`routeGeometry/${this.groupID}/${payload.id}/${payload.manifest.revision}/${key}`,old=await this.request(path);
      if(old){if(!same(old,chunk))throw fail('This draft’s geometry changed. Start a new line.','conflict');}
      else await this.request(path,{method:'PUT',body:chunk,etag:'null_etag'});
    }
    await this.contribution('routes',payload.id);
    await this.write(`routeManifests/${this.groupID}/${payload.id}`,payload.manifest,null);
    return payload;
  }
  async saveRoute({baseline,fields,isDeleted=false}){
    if(!baseline)throw new Error('The route has not finished loading.');requireID(baseline.routeID);await this.access(baseline.layerID);
    const metadata={...baseline.metadata,name:text(fields.name,'Name',512,true),note:text(fields.note,'Note',50000),unitID:text(fields.unitID,'Unit ID',200),mineSite:text(fields.mineSite,'Site',200)};
    if(metadata.geometryKind==='drawnLine')metadata.drawingAppearance={...metadata.drawingAppearance,...(fields.color?{color:fields.color}:{}),...(fields.lineStyle?{lineStyle:fields.lineStyle}:{})};
    const record={...baseline,privacyVersion:2,metadata,modifiedAt:nowSwift(),modifiedBy:`web-${this.client.uid}`,writerUID:this.client.uid,isDeleted};
    await this.contribution('routes',baseline.routeID);await this.write(`routeManifests/${this.groupID}/${baseline.routeID}`,record,baseline);return {id:baseline.routeID,manifest:record};
  }
  async replaceLine(options,baseline){
    if(baseline?.metadata?.geometryKind!=='drawnLine')throw new Error('Only drawn lines can be redrawn.');
    // Revisions of published route geometry are immutable in the existing
    // rules, so redrawing publishes a new line and tombstones the old one.
    const old=await this.request(`routeManifests/${this.groupID}/${baseline.routeID}`);
    if(!same(old,baseline))throw fail('This line changed on another device. Reopen it before redrawing.','conflict');
    const result=await this.createLine(options);
    try{await this.saveRoute({baseline,fields:baseline.metadata,isDeleted:true});}
    catch(error){
      try{await this.saveRoute({baseline:result.manifest,fields:result.manifest.metadata,isDeleted:true});}
      catch{throw fail('The replacement line was saved, but the original could not be removed. Reconnect and review both lines before retrying.','partial');}
      throw error;
    }
    return {...result,replacedID:baseline.routeID};
  }
}
