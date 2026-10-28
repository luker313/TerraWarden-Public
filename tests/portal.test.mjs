import test from 'node:test';
import assert from 'node:assert/strict';
import {makeModel,reduceEvent,SSEParser,decodeGroup,decodeRoute,inviteCode,swiftDate,inPolygon} from '../docs/portal/core.mjs';
import {ViewerClient} from '../docs/portal/firebase.mjs';
test('map transform preserves rotated, offset, sheared reference points',()=>{
  const geo=(x,y)=>({x,y,latitude:-31+y*.0002+x*.00003,longitude:115+x*.0001-y*.00004});
  const anchors=[geo(20,35),geo(920,35),geo(20,635)],model=makeModel(anchors,[20,35,920,635]);
  const p=geo(470,335),roundtrip=model.toPDF(p.latitude,p.longitude);
  assert.ok(Math.abs(roundtrip[0]-470)<1e-7);assert.ok(Math.abs(roundtrip[1]-335)<1e-7);
  assert.throws(()=>makeModel([geo(1,1),geo(2,2),geo(3,3)],[0,0,100,100]));
});
test('bilinear GeoPDF model handles a warped viewport and dateline',()=>{
  const corners=[{x:0,y:0,latitude:10,longitude:179.9},{x:0,y:1,latitude:11,longitude:179.91},{x:1,y:1,latitude:11.1,longitude:-179.8},{x:1,y:0,latitude:10,longitude:-179.9}];
  const model=makeModel(corners,[0,0,1,1],true),geo=model.toGeo(.3,.7),point=model.toPDF(geo.latitude,geo.longitude);
  assert.ok(Math.abs(point[0]-.3)<1e-7);assert.ok(Math.abs(point[1]-.7)<1e-7);assert.ok(Math.abs(geo.longitude)>179);
  assert.equal(inPolygon([0,0],[[0,0],[0,1],[1,1],[1,0]]),true);assert.equal(inPolygon([2,1],[[0,0],[0,1],[1,1],[1,0]]),false);
});
test('Firebase streams parse split CRLF and multibyte payloads and apply multipath deletions',()=>{
  const parser=new SSEParser();assert.deepEqual(parser.push('event: put\r'),[]);
  const frames=parser.push('\ndata: {"path":"/","data":{"a":{"name":"Māori"}}}\r\n\r\n');
  assert.equal(frames.length,1);let tree=reduceEvent(null,frames[0].event,JSON.parse(frames[0].data));
  tree=reduceEvent(tree,'patch',{path:'/',data:{'a/name':null,'b/value':2}});assert.deepEqual(tree,{b:{value:2}});
  assert.throws(()=>reduceEvent(null,'put',{path:'/__proto__/bad',data:true}));assert.equal({}.bad,undefined);
});
test('layer and pin tombstones and privacy removals win over old records',()=>{
  const layerID='L',pin={id:'P',name:'test',latitude:-31,longitude:115},group={isDeleted:false,items:{'layer-L':{kind:'layer',layerID,name:'L',isDeleted:false},'pin-L-P':{kind:'pin',layerID,isDeleted:false,pin}}};
  assert.equal(decodeGroup(group)[0].pins.length,1);group.privacyRemovals={items:{'pin-L-P':true}};assert.equal(decodeGroup(group)[0].pins.length,0);group.privacyRemovals={layers:{L:true}};assert.equal(decodeGroup(group).length,0);group.privacyRemovals={};group.items['layer-L'].isDeleted=true;assert.equal(decodeGroup(group).length,0);
});
test('routes validate immutable revision, sequence, sample counts and gaps',()=>{
  const manifest={schemaVersion:1,routeID:'R',layerID:'L',revision:'V',chunkCount:1,pointCount:3,lastChunk:'c000000',isDeleted:false,metadata:{name:'Route'}};
  const p=(segmentID,lat)=>({segmentID,point:{latitude:lat,longitude:115}}),chunks={c000000:{schemaVersion:1,routeID:'R',layerID:'L',revision:'V',index:0,count:3,points:{p0000:p('A',-31),p0001:p('A',-31.1),p0002:p('B',-31.2)}}};
  assert.equal(decodeRoute(chunks,manifest,'R').segments.length,2);
  assert.throws(()=>decodeRoute(chunks,{...manifest,revision:'NEW'},'R'));
  assert.throws(()=>decodeRoute(chunks,{...manifest,pointCount:4},'R'));
  chunks.c000000.points.p0001.point.latitude=91;assert.throws(()=>decodeRoute(chunks,manifest,'R'));
});
test('invite normalization and Swift reference epoch match native formats',()=>{
  assert.equal(inviteCode('ABCD EFGH JKLM'),'ABCDEFGHJKLM');assert.equal(inviteCode('terrawarden://join?code=ABCDEFGHJKLM'),'ABCDEFGHJKLM');assert.throws(()=>inviteCode('abcdefghijk0'));assert.equal(swiftDate(0).toISOString(),'2001-01-01T00:00:00.000Z');
});
test('viewer invitation joins only the browser membership and never writes shared features',async()=>{
  const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
  const original=globalThis.fetch,writes=[];
  const group={name:'Test',isDeleted:false,ownerID:'OWNER',members:{BROWSER:{role:'viewer'}}};
  globalThis.fetch=async(url,options={})=>{
    if(url.includes('accounts:signUp'))return Response.json({localId:'BROWSER',refreshToken:'refresh',idToken:'id',expiresIn:'3600'});
    if(url.includes('pinGroupInvites'))return Response.json({enabled:true,groupID:'G',ownerID:'OWNER',role:'viewer'});
    if(url.includes('/members/')){if(options.method==='PUT'){writes.push({url,options});return Response.json(JSON.parse(options.body));}return Response.json(null);}
    return Response.json(group);
  };
  try{const client=new ViewerClient({apiKey:'test-key',databaseURL:'https://test.firebaseio.com'});assert.deepEqual(await client.join('ABCDEFGHJKLM','Browser'),{id:'G',name:'Test'});assert.equal(writes.length,1);assert.match(writes[0].url,/pinGroups\/G\/members\/BROWSER\.json/);assert.equal(JSON.parse(writes[0].options.body).role,'viewer');assert.equal(writes[0].options.headers['if-match'],'null_etag');}finally{globalThis.fetch=original;}
});
test('editor invitations are rejected before a membership write',async()=>{
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};const original=globalThis.fetch;let writes=0;
  globalThis.fetch=async(url,options={})=>{if(url.includes('accounts:signUp'))return Response.json({localId:'B',refreshToken:'r',idToken:'t',expiresIn:'3600'});if(options.method==='PUT')writes++;return Response.json({enabled:true,groupID:'G',ownerID:'O',role:'editor'});};
  try{const client=new ViewerClient({apiKey:'test',databaseURL:'https://test.firebaseio.com'});await assert.rejects(client.join('ABCDEFGHJKLM','Browser'),/allows editing/);assert.equal(writes,0);}finally{globalThis.fetch=original;}
});
test('live sync applies changes and stops after authoritative access cancellation',async()=>{
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};const original=globalThis.fetch;
  const payload='event: put\ndata: {"path":"/","data":{"items":{"P":1}}}\n\nevent: patch\ndata: {"path":"/items","data":{"P":null,"Q":2}}\n\nevent: cancel\ndata: "Permission denied"\n\n';
  globalThis.fetch=async(url)=>url.includes('accounts:signUp')?Response.json({localId:'B',refreshToken:'r',idToken:'t',expiresIn:'3600'}):new Response(payload,{headers:{'Content-Type':'text/event-stream'}});
  try{const client=new ViewerClient({apiKey:'test',databaseURL:'https://test.firebaseio.com'}),values=[],statuses=[];await client.watch('pinGroups/G',v=>values.push(v),s=>statuses.push(s),new AbortController().signal);assert.deepEqual(values.at(-1),{items:{Q:2}});assert.equal(statuses.at(-1),'denied');}finally{globalThis.fetch=original;}
});
