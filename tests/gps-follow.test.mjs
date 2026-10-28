import test from 'node:test';
import assert from 'node:assert/strict';
import {gpsCameraTarget} from '../docs/portal/gps-follow.mjs';
import {makeModel} from '../docs/portal/core.mjs';
const model=makeModel([{x:0,y:0,latitude:-32,longitude:115},{x:100,y:0,latitude:-32,longitude:116},{x:0,y:100,latitude:-31,longitude:115}],[0,0,100,100]);
const viewport={convertToViewportPoint:(x,y)=>[y,100-x]};
const settings={model,viewport,pageBox:[0,0,100,100],width:393,height:720,scale:3,now:100000};
test('successive moving GPS fixes keep the puck centred while preserving zoom and page rotation',()=>{
  const positions=[];
  for(const point of [[25,40],[28,42],[31,47]]) {
    const fix={...model.toGeo(...point),timestamp:99000},camera=gpsCameraTarget({...settings,fix});positions.push(camera);
    const screen=viewport.convertToViewportPoint(...point);
    assert.ok(Math.abs(camera.x+screen[0]*settings.scale-settings.width/2)<1e-8);
    assert.ok(Math.abs(camera.y+screen[1]*settings.scale-settings.height/2)<1e-8);
  }
  assert.notDeepEqual(positions[0],positions[1]);assert.notDeepEqual(positions[1],positions[2]);
});
test('stale, future or off-map fixes cannot move the camera into blank space',()=>{
  const fix={...model.toGeo(25,40),timestamp:99000};
  assert.equal(gpsCameraTarget({...settings,fix:{...fix,timestamp:1000}}),null);
  assert.equal(gpsCameraTarget({...settings,fix:{...fix,timestamp:200000}}),null);
  assert.equal(gpsCameraTarget({...settings,fix:{...model.toGeo(150,40),timestamp:99000}}),null);
  assert.equal(gpsCameraTarget({...settings,fix,model:null}),null);
});
