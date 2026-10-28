import test from 'node:test';
import assert from 'node:assert/strict';
import {LocationTracker,accuracyRing} from '../docs/portal/location.mjs';
test('GPS is opt-in, stop clears watch ID zero and late fixes are ignored',()=>{
  let success,error,starts=0,cleared;const fixes=[],statuses=[];
  const tracker=new LocationTracker({watchPosition:(s,e)=>{success=s;error=e;starts++;return 0;},clearWatch:id=>cleared=id},f=>fixes.push(f),s=>statuses.push(s));
  assert.equal(starts,0);tracker.start();tracker.start();assert.equal(starts,1);
  const fix={coords:{latitude:-31,longitude:115,accuracy:12},timestamp:1000};success(fix);assert.equal(fixes.length,1);tracker.stop();assert.equal(cleared,0);success(fix);error({code:1});assert.equal(fixes.length,1);assert.equal(statuses.at(-1),'off');
});
test('permission denial stops GPS and timeouts report unavailable without inventing coordinates',()=>{
  let error;const fixes=[],statuses=[];
  const tracker=new LocationTracker({watchPosition:(s,e)=>{error=e;return 7;},clearWatch:()=>{}},f=>fixes.push(f),s=>statuses.push(s));
  tracker.start();error({code:3});assert.equal(tracker.running,true);assert.equal(statuses.at(-1),'unavailable');assert.equal(fixes.length,0);error({code:1});assert.equal(tracker.running,false);assert.equal(statuses.at(-1),'denied');
});
test('accuracy ring is closed and a 100 m uncertainty is represented geographically',()=>{
  const points=accuracyRing({latitude:-31,longitude:115,accuracy:100});assert.equal(points.length,49);assert.ok(Math.abs(points[0].latitude-points.at(-1).latitude)<1e-10);assert.ok(Math.abs((points[0].latitude+31)*Math.PI/180*6371008.8-100)<1e-6);
});
