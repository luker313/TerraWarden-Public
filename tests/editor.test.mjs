import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DemoClient} from '../docs/portal/demo-client.mjs';
import {SharedEditor,newID} from '../docs/portal/editor.mjs';
import {decodeGroup,decodeRoute} from '../docs/portal/core.mjs';
import {pinLabelPlacement} from '../docs/portal/label-placement.mjs';
import {readTheme,saveTheme,readLabelAngle,saveLabelAngle} from '../docs/portal/settings.mjs';
const data=JSON.parse(await readFile(new URL('../docs/portal/demo.json',import.meta.url),'utf8'));
test('editor creates and moves pins; stale versions and viewers cannot overwrite',async()=>{
 const client=new DemoClient(data),editor=new SharedEditor(client,client.groupID),layerID=decodeGroup(client.group)[0].id;
 const pin=await editor.savePin({layerID,point:{latitude:-31,longitude:115},fields:{name:'Test'}});
 const moved=await editor.savePin({id:pin.record.pin.id,layerID,point:{latitude:-31.1,longitude:115},fields:{name:'Moved'},baseline:pin.record});assert.equal(moved.record.pin.latitude,-31.1);
 await assert.rejects(editor.savePin({id:pin.record.pin.id,layerID,point:pin.record.pin,fields:{name:'Stale'},baseline:pin.record}),e=>e.code==='conflict');
 client.group.members[client.uid].role='viewer';await assert.rejects(editor.saveLayer({name:'Denied'}),e=>e.code==='permission');
});
test('drawn lines round-trip native chunks and metadata edits preserve immutable geometry',async()=>{
 const client=new DemoClient(data),editor=new SharedEditor(client,client.groupID),layerID=decodeGroup(client.group)[0].id;
 const line=await editor.createLine({layerID,points:[{latitude:-31,longitude:115},{latitude:-31.001,longitude:115}],fields:{name:'Line'}});
 assert.equal(decodeRoute(line.chunks,line.manifest,line.id).segments[0].points.length,2);
 const edited=await editor.saveRoute({baseline:line.manifest,fields:{name:'Renamed'}});assert.equal(edited.manifest.revision,line.manifest.revision);assert.equal(edited.manifest.metadata.distanceMeters,line.manifest.metadata.distanceMeters);
});
test('pin label rotates about its pin and keeps the same screen offset at every zoom',()=>{
 for(const scale of [.1,1,8])for(const angle of [-180,-90,0,45,180]){const p=pinLabelPlacement(120,300,scale,angle);assert.equal(p.transform,`rotate(${angle} 120 300)`);assert.ok(Math.abs(Math.hypot(p.x-120,p.y-300)*scale-Math.sqrt(109))<1e-10);}
});
test('theme and angle preferences persist independently of Firebase settings',()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 assert.equal(readTheme(),null);assert.equal(readLabelAngle(),0);saveTheme('dark');saveLabelAngle(45);assert.equal(readTheme(),'dark');assert.equal(readLabelAngle(),45);assert.equal(storage.has('tw.portal.apiKey'),false);
});
