import { distanceMetres, canonical } from './editor.mjs';
const id=(prefix,index)=>`${prefix}0000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const copy=value=>structuredClone(value);
// All demo edits live only in this in-memory tree. This client has no URL,
// authentication, storage or network capability.
export class DemoClient {
  constructor(data){
    this.uid='DEMO-EDITOR';this.groupID='DEMO';this.tree={pinGroups:{DEMO:copy(data.group)},routeManifests:{DEMO:{}},routeGeometry:{DEMO:{}}};
    const group=this.tree.pinGroups.DEMO;group.members={[this.uid]:{role:'editor',displayName:'Demo editor'}};
    const items={};let index=1;
    for(const record of Object.values(group.items)){
      const value={privacyVersion:2,modifiedAt:790000000,modifiedBy:'demo',writerUID:this.uid,...record};
      if(value.kind==='pin'){value.pin.id=id('2',index++);items[`pin-${value.layerID}-${value.pin.id}`]=value;}else items[`layer-${value.layerID}`]=value;
    }
    group.items=items;index=1;
    for(const [oldID,old]of Object.entries(data.manifests)){
      const routeID=id('3',index),revision=id('4',index),segmentID=id('5',index++),chunks=copy(data.geometry[oldID]);
      const points=[];for(const chunk of Object.values(chunks)){chunk.routeID=routeID;chunk.revision=revision;for(const sample of Object.values(chunk.points)){sample.segmentID=segmentID;points.push(sample.point);}}
      const metadata={schemaVersion:1,id:routeID,layerID:old.layerID,note:'',unitID:'',mineSite:'',creatorName:'Demo editor',geographicReference:'EPSG:4326',source:'Fictional demo',reducedAccuracy:false,rejectedFixes:0,...old.metadata,geometryRevision:revision,distanceMeters:points.slice(1).reduce((sum,p,i)=>sum+distanceMetres(points[i],p),0)};
      if(metadata.geometryKind==='drawnLine'){delete metadata.startedAt;delete metadata.gaps;metadata.drawingAppearance={lineStyle:'solid',lineWidth:'medium',contrastOutline:true,...metadata.drawingAppearance};}
      this.tree.routeManifests.DEMO[routeID]={...old,privacyVersion:2,routeID,revision,metadata,modifiedAt:790000000,modifiedBy:'demo',writerUID:this.uid};
      this.tree.routeGeometry.DEMO[routeID]={[revision]:chunks};
    }
  }
  get group(){return this.tree.pinGroups.DEMO;}
  get manifests(){return this.tree.routeManifests.DEMO;}
  async request(path,{method='GET',body,etag,withETag=false}={}){
    const keys=path.split('/');if(keys.some(k=>['__proto__','constructor','prototype'].includes(k)))throw new Error('Invalid demo path.');
    let current=this.tree;for(const key of keys)current=current?.[key];current=current??null;
    if(method==='GET')return withETag?{value:copy(current),etag:canonical(current)}:copy(current);
    if(!['editor','owner'].includes(this.group.members?.[this.uid]?.role))throw Object.assign(new Error('Demo is read-only.'),{code:'permission'});
    if(etag&&etag!==(current===null?'null_etag':canonical(current))&&etag!==canonical(current))throw Object.assign(new Error('This demo feature changed.'),{code:'conflict'});
    let parent=this.tree;for(const key of keys.slice(0,-1))parent=parent[key]??=( {} );
    if(method==='DELETE')delete parent[keys.at(-1)];else parent[keys.at(-1)]=copy(body);
    this.onChange?.();return copy(body??null);
  }
}
