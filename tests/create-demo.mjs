import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from '../docs/portal/vendor/pdf-lib.mjs';
import { writeFile, readFile } from 'node:fs/promises';
const pdf=await PDFDocument.create();
pdf.setTitle('TerraWarden - Redridge fictional survey demo');pdf.setAuthor('TerraWarden');pdf.setSubject('Fictional demo data; no real survey positions');
const page=pdf.addPage([1000,680]),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
const color=h=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
const text=(str,x,y,size=9,ink='#778365',strong=false)=>page.drawText(str,{x,y,size,font:strong?bold:font,color:color(ink)});
const line=(x1,y1,x2,y2,ink='#d5d9c1',thickness=.7)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color:color(ink),thickness});
page.drawRectangle({x:0,y:0,width:1000,height:680,color:color('#fdfef9')});
const brandMark=await pdf.embedPng(await readFile(new URL('../docs/portal/assets/terrawarden-mark.png',import.meta.url)));page.drawRectangle({x:60,y:620,width:28,height:28,color:color('#174d3a')});page.drawImage(brandMark,{x:63,y:623,width:22,height:21});text('TerraWarden',97,630,12,'#174d3a',true);text('REDRIDGE / SURVEY AREA 04',60,602,22,'#364b2e',true);text('FICTIONAL DEMO DATA',774,630,9,'#8e9a7c');text('WGS84 | EPSG:4326',802,608,9,'#849172');
const box=[60,70,930,570];
page.drawRectangle({x:60,y:70,width:870,height:500,color:color('#e8e9cf'),borderWidth:1,borderColor:color('#b8c19e')});
// Synthetic topography, deliberately unrelated to an actual mine or survey.
for(let contour=0;contour<34;contour++){
  let previous;
  for(let x=60;x<=930;x+=5){const y=83+contour*15+38*Math.sin((x-60)/140+contour*.09)+14*Math.sin(x/53+contour*.12);if(y>=72&&y<=568){if(previous)line(previous[0],previous[1],x,y,contour%5===0?'#a9b18b':'#c3c7a6',contour%5===0?.9:.4);previous=[x,y];}else previous=null;}
}
// A creek, access track, and exploration zone.
for(let x=65;x<920;x+=5){const f=n=>330+54*Math.sin(n/130)+20*Math.cos(n/58);line(x,f(x),x+5,f(x+5),'#a9bdb3',2.3);}
const track=[[66,130],[250,210],[440,254],[570,398],[740,444],[924,515]];
for(let i=1;i<track.length;i++){line(...track[i-1],...track[i],'#faf9ed',9);line(...track[i-1],...track[i],'#c8b798',3);}
page.drawSvgPath('M 0 0 L 137 26 L 160 118 L 38 150 L -36 73 Z',{x:528,y:365,color:color('#bec9a5'),opacity:.45,borderColor:color('#91a271'),borderWidth:1});
for(let i=0;i<=6;i++){const x=60+870*i/6;line(x,70,x,570,'#bcc5a4',.5);text((119.64+i*.01).toFixed(2)+' E',x-12,55,7,'#93a07c');}
for(let i=0;i<=5;i++){const y=70+500*i/5;line(60,y,930,y,'#bcc5a4',.5);text((23.365-i*.006).toFixed(3)+' S',8,y-3,7,'#93a07c');}
text('NORTH RIDGE',140,491,12,'#95a078',true);text('EXPLORATION ZONE',551,309,9,'#7e9062',true);text('DRY CREEK',747,352,8,'#8aaca0');text('ACCESS TRACK',270,189,8,'#9f9677');
line(887,484,887,540,'#6c8057',1.5);page.drawSvgPath('M 0 0 L -4 12 L 4 12 Z',{x:887,y:545,color:color('#6c8057')});text('N',884,551,10,'#60764e',true);
text('0',65,33,7);text('1 km (approx.)',205,33,7);line(65,44,209,44,'#64794f',3);line(65,40,65,48,'#64794f',1);line(209,40,209,48,'#64794f',1);
text('Synthetic terrain | For portal demonstration only',587,31,8,'#97a385');
const c=pdf.context;
const measure=c.obj({Type:PDFName.of('Measure'),Subtype:PDFName.of('GEO'),Bounds:[0,0,0,1,1,1,1,0],LPTS:[0,0,0,1,1,1,1,0],GPTS:[-23.365,119.64,-23.335,119.64,-23.335,119.70,-23.365,119.70],GCS:c.obj({Type:PDFName.of('GEOGCS'),EPSG:4326})});
const vp=c.obj({Type:PDFName.of('Viewport'),Name:PDFString.of('Redridge survey area'),BBox:box,Measure:c.register(measure)});page.node.set(PDFName.of('VP'),c.obj([c.register(vp)]));
await writeFile(new URL('../docs/portal/demo.pdf',import.meta.url),await pdf.save());
const layers=['1EE4F471-9F1D-4B9F-843E-123456789001','1EE4F471-9F1D-4B9F-843E-123456789002','1EE4F471-9F1D-4B9F-843E-123456789003'];
const items={};
for(const[id,i]of layers.map((id,i)=>[id,i]))items[`layer-${id}`]={kind:'layer',layerID:id,name:['Drill collars','Field observations','Routes & boundaries'][i],isDeleted:false,modifiedAt:790000000,modifiedBy:'demo',privacyVersion:2};
const spots=[[.26,.29],[.34,.40],[.44,.50],[.51,.63],[.59,.69],[.68,.75],[.78,.81],[.37,.76],[.69,.33]];
spots.forEach(([u,v],i)=>{const id=`DEMO-PIN-${i}`,layerID=layers[i<6?0:1],name=i<6?`RR-${String(241+i).padStart(4,'0')}`:['Outcrop A','Sample station','Creek crossing'][i-6];items[`pin-${layerID}-${id}`]={kind:'pin',name,layerID,isDeleted:false,pin:{id,name,latitude:-23.365+v*.03,longitude:119.64+u*.06,easting:0,northing:0,timestamp:790000000+i*600,unitID:i<6?'TW-04':'FIELD',mineSite:'Redridge (demo)',note:i<6?'Fictional drill collar. Ready for logging.':'Fictional observation recorded during the field survey.'}};});
const manifests={},geometry={};
for(const[id,name,type,points]of [['DEMO-ROUTE-1','Morning traverse','recordedRoute',[[.08,.12],[.16,.19],[.26,.29],[.37,.36],[.44,.50],[.51,.63],[.59,.69],[.68,.75],[.82,.85]]],['DEMO-LINE-1','Survey boundary','drawnLine',[[.46,.41],[.54,.33],[.69,.41],[.72,.63],[.57,.73],[.46,.41]]]]){
  const samples=Object.fromEntries(points.map(([u,v],i)=>[`p${String(i).padStart(4,'0')}`,{segmentID:'segment-1',point:{latitude:-23.365+v*.03,longitude:119.64+u*.06,timestamp:790000000+i*60}}]));
  manifests[id]={schemaVersion:1,routeID:id,layerID:layers[2],revision:'demo-revision-1',chunkCount:1,pointCount:points.length,lastChunk:'c000000',isDeleted:false,metadata:{name,note:'Fictional geometry for the portal demonstration.',geometryKind:type,distanceMeters:type==='drawnLine'?4621:5420,unitID:'TW-04',mineSite:'Redridge (demo)',creatorName:'TerraWarden demo',startedAt:790000000,drawingAppearance:type==='drawnLine'?{lineStyle:'dashed',lineWidth:'thin'}:undefined}};
  geometry[id]={c000000:{schemaVersion:1,routeID:id,layerID:layers[2],revision:'demo-revision-1',index:0,count:points.length,points:samples}};
}
await writeFile(new URL('../docs/portal/demo.json',import.meta.url),JSON.stringify({group:{name:'Redridge field survey',isDeleted:false,items},manifests,geometry},null,2)+'\n');
