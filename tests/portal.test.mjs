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
  try{const client=new ViewerClient({apiKey:'test-key',databaseURL:'https://test.firebaseio.com'});assert.deepEqual(await client.join('ABCDEFGHJKLM','Browser'),{id:'G',name:'Test',role:'viewer'});assert.equal(writes.length,1);assert.match(writes[0].url,/pinGroups\/G\/members\/BROWSER\.json/);assert.equal(JSON.parse(writes[0].options.body).role,'viewer');assert.equal(writes[0].options.headers['if-match'],'null_etag');}finally{globalThis.fetch=original;}
});
test('editor invitations join with the server assigned edit role',async()=>{
 globalThis.localStorage={getItem:()=>null,setItem:()=>{}};const original=globalThis.fetch;const writes=[];
 globalThis.fetch=async(url,options={})=>{if(url.includes('accounts:signUp'))return Response.json({localId:'B',refreshToken:'r',idToken:'t',expiresIn:'3600'});if(url.includes('pinGroupInvites'))return Response.json({enabled:true,groupID:'G',ownerID:'O',role:'editor'});if(url.includes('/members/')){if(options.method==='PUT'){writes.push(JSON.parse(options.body));return Response.json(null);}return Response.json(null);}return Response.json({isDeleted:false,name:'Editable',ownerID:'O',members:{B:{role:'editor'}}});};
 try{const client=new ViewerClient({apiKey:'test',databaseURL:'https://test.firebaseio.com'});const group=await client.join('ABCDEFGHJKLM','Browser');assert.equal(group.role,'editor');assert.equal(writes[0].role,'editor');}finally{globalThis.fetch=original;}
});
test('live sync applies changes and stops after authoritative access cancellation',async()=>{
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};const original=globalThis.fetch;
  const payload='event: put\ndata: {"path":"/","data":{"items":{"P":1}}}\n\nevent: patch\ndata: {"path":"/items","data":{"P":null,"Q":2}}\n\nevent: cancel\ndata: "Permission denied"\n\n';
  globalThis.fetch=async(url)=>url.includes('accounts:signUp')?Response.json({localId:'B',refreshToken:'r',idToken:'t',expiresIn:'3600'}):new Response(payload,{headers:{'Content-Type':'text/event-stream'}});
  try{const client=new ViewerClient({apiKey:'test',databaseURL:'https://test.firebaseio.com'}),values=[],statuses=[];await client.watch('pinGroups/G',v=>values.push(v),s=>statuses.push(s),new AbortController().signal);assert.deepEqual(values.at(-1),{items:{Q:2}});assert.equal(statuses.at(-1),'denied');}finally{globalThis.fetch=original;}
});
test('a stream rejected with an expired token refreshes and reconnects without losing identity',async()=>{
 const memory=new Map(),original=globalThis.fetch;
 memory.set('tw.portal.identity.v1.test.firebaseio.com',JSON.stringify({uid:'B',refreshToken:'saved-refresh'}));
 globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
 let refreshes=0,streams=0;const controller=new AbortController(),values=[],statuses=[];
 globalThis.fetch=async url=>{
   if(url.includes('securetoken')){refreshes++;return Response.json({user_id:'B',refresh_token:'saved-refresh',id_token:`token-${refreshes}`,expires_in:'3600'});}
   if(++streams===1)return Response.json({error:'Auth token is expired'},{status:401});
   assert.match(url,/auth=token-2/);
   return new Response('event: put\ndata: {"path":"/","data":{"name":"Restored"}}\n\n');
 };
 try{const client=new ViewerClient({apiKey:'test',databaseURL:'https://test.firebaseio.com'});await client.watch('pinGroups/G',v=>{values.push(v);controller.abort();},s=>statuses.push(s),controller.signal);assert.equal(refreshes,2);assert.equal(streams,2);assert.equal(values[0].name,'Restored');assert.ok(!statuses.includes('denied'));assert.equal(JSON.parse(memory.values().next().value).uid,'B');}finally{globalThis.fetch=original;}
});
test('a temporary authentication service failure preserves identity and retries live sync',async()=>{
 const original=globalThis.fetch,controller=new AbortController();let refreshes=0;const statuses=[];
 globalThis.localStorage={getItem:()=>JSON.stringify({uid:'B',refreshToken:'saved-refresh'}),setItem:()=>{}};
 globalThis.fetch=async url=>{
   if(url.includes('securetoken')){if(++refreshes===1)return Response.json({error:'Temporary outage'},{status:503});return Response.json({user_id:'B',refresh_token:'saved-refresh',id_token:'ok',expires_in:'3600'});}
   return new Response('event: put\ndata: {"path":"/","data":{"name":"Restored"}}\n\n');
 };
 try{const client=new ViewerClient({apiKey:'test',databaseURL:'https://test.firebaseio.com'});await client.watch('pinGroups/G',()=>controller.abort(),s=>statuses.push(s),controller.signal);assert.equal(refreshes,2);assert.ok(statuses.includes('reconnecting'));assert.ok(!statuses.includes('denied'));assert.equal(client.uid,'B');}finally{globalThis.fetch=original;}
});
