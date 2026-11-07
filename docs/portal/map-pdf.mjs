import fontkit from './vendor/fontkit.mjs';
import {dimensions,niceDistance,rasterPatches,resolutionText,wrapLongitude} from './map-plan.mjs?v=20261108.1';
import {abortCheck} from './map-source.mjs?v=20261108.1';
const encoder=new TextEncoder(),n=v=>String(Number(v.toFixed(5))),hex=c=>c.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255),pdfColour=c=>hex(c).map(n).join(' ');
const literal=text=>`(${String(text).replace(/[^\x20-\x7e\xa0-\xff]/g,'-').replace(/[\\()]/g,'\\$&')})`;
const unicode=text=>'<FEFF'+Array.from(String(text)).flatMap(char=>{const cp=char.codePointAt(0);return cp>65535?[0xd800+((cp-65536)>>10),0xdc00+((cp-65536)&1023)]:[cp];}).map(cp=>cp.toString(16).padStart(4,'0')).join('')+'>';
export function coordinateLabel(value,axis,span=10){const precision=Math.min(7,Math.max(2,Math.ceil(-Math.log10(span/4))+1));return `${Math.abs(value).toFixed(precision)}°${axis==='lat'?(value<0?'S':'N'):(value<0?'W':'E')}`;}
// One vector scene drives both print preview and PDF decoration.
export function marginScene({plan,sheet,title='Field map',date=new Date().toISOString().slice(0,10),imageryInfo}){
  const {width:w,height:h,unit:u,margin}=sheet.layout||plan.layout,f=sheet.frame,d=dimensions(sheet.bounds),dark=margin!=='paper';
  const forest='#142e25',green='#00cc12',ink='#254737',muted='#587164',paper='#f7f8f3',on=dark?'#ffffff':ink;
  const items=[],rect=(x,y,width,height,fill)=>items.push({type:'rect',x,y,width,height,fill}),line=(x1,y1,x2,y2,stroke,width=1)=>items.push({type:'line',x1,y1,x2,y2,stroke,width}),text=(value,x,y,size,fill=ink,extra={})=>items.push({type:'text',value,x,y,size,fill,...extra});
  rect(0,0,w,h,paper);rect(0,h-92*u,w,92*u,dark?forest:'#e8f0e5');rect(0,h-94*u,w,2*u,green);
  // Contour ribbons are true PDF vectors, so the border stays sharp at any zoom.
  for(let i=0;i<10;i++){
    const x=w-390*u+i*29*u,y=h-92*u;
    items.push({type:'path',stroke:dark?'#365747':'#c8dac8',width:.7*u,commands:[['M',x,y],['C',x-90*u,y+35*u,x+65*u,y+100*u,x+8*u,h+24*u]]});
  }
  items.push({type:'image',key:'logo',x:34*u,y:h-64*u,width:39*u,height:34*u});
  items.push({type:'image',key:'wordmark',x:85*u,y:h-57*u,width:160*u,height:31.68*u});
  text('FIELD ATLAS',86*u,h-73*u,7*u,dark?'#a8c3b0':muted,{spacing:2*u});
  text(title,282*u,h-48*u,23*u,on,{title:true,maxWidth:w-340*u});
  text(`${plan.sourceInfo.name.toUpperCase()}  /  ${resolutionText(sheet.resolution)}`,283*u,h-65*u,8*u,dark?'#b8d0bd':muted,{maxWidth:w-320*u});
  const capture=imageryInfo?.label||(plan.source==='recent'?'Capture dates shown after imagery loads':plan.source==='earth'?'Historic composite; not current imagery':plan.source==='topo'?'Cartographic basemap':'Capture date unavailable; mosaic dates vary');
  text(`${capture}  |  Exported ${date}${plan.source==='recent'?'  |  Hatching: no clear capture':''}`,283*u,h-82*u,6.5*u,dark?'#b8d0bd':muted,{maxWidth:w-320*u});
  // Registration ticks live outside the geographic viewport.
  for(let i=0;i<=4;i++){
    const x=f.x+f.width*i/4,y=f.y+f.height*i/4,b=sheet.bounds;
    line(x,f.y-5*u,x,f.y,muted,.65*u);line(x,f.y+f.height,x,f.y+f.height+5*u,muted,.65*u);
    text(coordinateLabel(b.west+(b.east-b.west)*i/4,'lon',b.east-b.west),x,f.y+f.height+10*u,6.7*u,muted,{align:'center'});
    if(i>0&&i<4)text(coordinateLabel(b.west+(b.east-b.west)*i/4,'lon',b.east-b.west),x,f.y-14*u,6.7*u,muted,{align:'center'});
    line(f.x-5*u,y,f.x,y,muted,.65*u);line(f.x+f.width,y,f.x+f.width+5*u,y,muted,.65*u);
    if(i>0&&i<4){text(coordinateLabel(b.south+(b.north-b.south)*i/4,'lat',b.north-b.south),f.x-11*u,y,6.7*u,muted,{align:'center',rotation:90});text(coordinateLabel(b.south+(b.north-b.south)*i/4,'lat',b.north-b.south),f.x+f.width+15*u,y,6.7*u,muted,{align:'center',rotation:90});}
  }
  line(f.x,f.y,f.x+f.width,f.y,ink,.7*u);line(f.x,f.y+f.height,f.x+f.width,f.y+f.height,ink,.7*u);line(f.x,f.y,f.x,f.y+f.height,ink,.7*u);line(f.x+f.width,f.y,f.x+f.width,f.y+f.height,ink,.7*u);
  const distance=niceDistance(d.width*.2),barWidth=distance/d.width*f.width,barX=34*u,barY=45*u;
  for(let i=0;i<4;i++)rect(barX+i*barWidth/4,barY,barWidth/4,4*u,i%2?'#c9d9c7':forest);
  text('0',barX,barY-10*u,7*u,muted);text(distance>=1000?`${Number((distance/1000).toFixed(2))} km`:`${Math.round(distance)} m`,barX+barWidth,barY-10*u,7*u,muted,{align:'right'});
  text('Scale at centre latitude',barX,barY+10*u,6.5*u,muted);
  text('WGS84  /  EPSG:4326',w*.38,51*u,8*u,ink);
  text(`${sheet.width.toLocaleString('en')} × ${sheet.height.toLocaleString('en')} px  |  NORTH UP`,w*.38,37*u,6.8*u,muted);
  // North arrow remains outside the map and its coordinate ticks.
  const ax=w-147*u,ay=42*u;items.push({type:'path',fill:forest,commands:[['M',ax,ay+18*u],['L',ax-5*u,ay],['L',ax,ay+4*u],['L',ax+5*u,ay],['Z']]});text('N',ax,ay+23*u,8*u,ink,{align:'center'});
  text(`SHEET ${String(sheet.number).padStart(2,'0')}`,w-34*u,51*u,9*u,ink,{align:'right',bold:true});text(`OF ${String(plan.sheets.length).padStart(2,'0')}`,w-34*u,37*u,7*u,muted,{align:'right'});
  line(34*u,24*u,w-34*u,24*u,'#cddccd',.6*u);
  text(`${plan.sourceInfo.credit}${plan.polar&&plan.source!=='earth'&&plan.source!=='recent'?'; polar coverage: NASA GIBS':''}`,34*u,12*u,6.3*u,muted,{maxWidth:w-230*u});
  text('TERRAWARDEN  /  EXPLORE WITH CONFIDENCE',w-34*u,12*u,6*u,muted,{align:'right'});
  return items;
}
export function paintMargin(context,scene,images={}){
  for(const item of scene){context.save();const i=item;
    if(i.fill)context.fillStyle=i.fill;if(i.stroke)context.strokeStyle=i.stroke;context.lineWidth=i.width||1;
    if(i.type==='rect')context.fillRect(i.x,i.y,i.width,i.height);
    else if(i.type==='line'){context.beginPath();context.moveTo(i.x1,i.y1);context.lineTo(i.x2,i.y2);context.stroke();}
    else if(i.type==='path'){context.beginPath();for(const [op,...a] of i.commands){if(op==='M')context.moveTo(...a);else if(op==='L')context.lineTo(...a);else if(op==='C')context.bezierCurveTo(...a);else context.closePath();}if(i.fill)context.fill();if(i.stroke)context.stroke();}
    else if(i.type==='image'&&images[i.key]){context.translate(i.x,i.y+i.height);context.scale(1,-1);context.drawImage(images[i.key],0,0,i.width,i.height);}
    else if(i.type==='text'){
      context.translate(i.x,i.y);if(i.rotation)context.rotate(i.rotation*Math.PI/180);context.scale(1,-1);context.font=`${i.bold?700:400} ${i.size}px MapPrint, Arial, sans-serif`;context.textAlign=i.align||'left';
      const width=context.measureText(i.value).width;if(i.maxWidth&&width>i.maxWidth)context.scale(i.maxWidth/width,1);context.fillText(i.value,0,0);
    }context.restore();
  }
}
export function featureScene(features,sheet){
  const b=sheet.bounds,f=sheet.frame,project=p=>{let lon=p.longitude;const centre=(b.west+b.east)/2;while(lon-centre>180)lon-=360;while(lon-centre< -180)lon+=360;return [f.x+(lon-b.west)/(b.east-b.west)*f.width,f.y+(p.latitude-b.south)/(b.north-b.south)*f.height];},items=[];
  for(const feature of features){
    if(feature.type==='pin'){
      const [x,y]=project(feature);if(x<f.x||x>f.x+f.width||y<f.y||y>f.y+f.height)continue;
      const colour=/^#[a-f\d]{6}$/i.test(feature.color||'')?feature.color:'#00aa33';
      items.push({type:'circle',x,y,radius:3.5,fill:colour,stroke:'#ffffff',width:1.2},{type:'text',value:feature.name||'',x:x+6,y:y+3,size:8,fill:'#18392b',halo:true});
    }else for(const segment of feature.segments||[]){
      let previous=null;const commands=[];
      for(const point of segment.points||[]){if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)){previous=null;continue;}const p=project(point);commands.push([previous&&Math.abs(point.longitude-previous.longitude)<180?'L':'M',...p]);previous=point;}
      if(commands.length){const stroke=/^#[a-f\d]{6}$/i.test(feature.color||'')?feature.color:'#00aa33',dash=feature.drawingAppearance?.lineStyle==='dashed'?[6,4]:feature.drawingAppearance?.lineStyle==='dotted'?[1,3]:[];items.push({type:'path',commands,stroke:'#ffffff',width:4},{type:'path',commands,stroke,width:2,dash});}
    }
  }return items;
}
export function paintFeatures(context,items,frame){
  context.save();context.beginPath();context.rect(frame.x,frame.y,frame.width,frame.height);context.clip();
  for(const item of items){if(item.type==='circle'){context.beginPath();context.arc(item.x,item.y,item.radius,0,Math.PI*2);context.fillStyle=item.fill;context.fill();context.strokeStyle=item.stroke;context.lineWidth=item.width;context.stroke();}
    else if(item.type==='text'){context.save();context.translate(item.x,item.y);context.scale(1,-1);context.font=`${item.size}px MapPrint, Arial, sans-serif`;context.lineJoin='round';context.lineWidth=2;context.strokeStyle='#ffffff';context.strokeText(item.value,0,0);context.fillStyle=item.fill;context.fillText(item.value,0,0);context.restore();}
    else{context.setLineDash(item.dash||[]);paintMargin(context,[item]);}
  }context.restore();
}
class PDFStream {
  constructor(sink,signal){this.sink=sink;this.signal=signal;this.offsets=[0];this.position=0;this.count=1;}
  reserve(){return this.count++;}
  async write(data){abortCheck(this.signal);const bytes=typeof data==='string'?encoder.encode(data):data;await this.sink.write(bytes);this.position+=bytes.byteLength;if(this.position>=9_000_000_000)throw new Error('This PDF exceeds the 9 GB file limit. Export a smaller sheet range.');}
  async object(id,body){this.offsets[id]=this.position;await this.write(`${id} 0 obj\n${body}\nendobj\n`);}
  async stream(id,dict,bytes){this.offsets[id]=this.position;await this.write(`${id} 0 obj\n<< ${dict} /Length ${bytes.byteLength} >>\nstream\n`);await this.write(bytes);await this.write('\nendstream\nendobj\n');}
  async finish(root,info){const offset=this.position;await this.write(`xref\n0 ${this.count}\n0000000000 65535 f \n`);for(let id=1;id<this.count;id++){if(this.offsets[id]===undefined)throw new Error('The PDF was not fully written.');await this.write(`${String(this.offsets[id]).padStart(10,'0')} 00000 n \n`);}await this.write(`trailer\n<< /Size ${this.count} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF`);await this.sink.close();return this.position;}
}
export function blobSink(maxBytes=192_000_000){
  let parts=[],size=0;return {async write(bytes){size+=bytes.byteLength;if(size>maxBytes)throw new Error('This download is too large for this browser. Export fewer sheets at a time, or use direct saving in a desktop browser.');parts.push(bytes);},async close(){},async abort(){parts=[];},blob(){return new Blob(parts,{type:'application/pdf'});},get size(){return size;}};
}
function textPDF(item,font){
  const i=item,layout=font.layout(String(i.value)),rawWidth=layout.positions.reduce((s,p)=>s+p.xAdvance,0),size=Math.min(i.size,i.maxWidth?i.maxWidth/rawWidth*font.unitsPerEm:Infinity),scale=size/font.unitsPerEm;
  let x=i.align==='center'?-rawWidth/2:i.align==='right'?-rawWidth:0,y=0;
  const angle=(i.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),lines=[`q ${n(c*scale)} ${n(s*scale)} ${n(-s*scale)} ${n(c*scale)} ${n(i.x)} ${n(i.y)} cm ${pdfColour(i.fill)} rg`];
  if(i.halo)lines.push(`1 1 1 RG ${n(2/scale)} w 1 j`);
  for(let k=0;k<layout.glyphs.length;k++){
    const p=layout.positions[k],glyph=layout.glyphs[k],gx=x+p.xOffset,gy=y+p.yOffset;
    for(const command of glyph.path.commands){const a=command.args,op=command.command;
      if(op==='moveTo')lines.push(`${n(a[0]+gx)} ${n(a[1]+gy)} m`);
      else if(op==='lineTo')lines.push(`${n(a[0]+gx)} ${n(a[1]+gy)} l`);
      else if(op==='bezierCurveTo')lines.push(`${a.map((v,j)=>n(v+(j%2?gy:gx))).join(' ')} c`);
      else if(op==='quadraticCurveTo'){
        // fontkit's glyph paths normally use cubic curves. Convert any quadratic
        // from its current point so TrueType glyphs retain their exact outline.
        const previous=glyph.path.commands[glyph.path.commands.indexOf(command)-1],pa=previous?.args||[0,0],px=pa.at(-2),py=pa.at(-1);
        lines.push(`${n(px+(a[0]-px)*2/3+gx)} ${n(py+(a[1]-py)*2/3+gy)} ${n(a[2]+(a[0]-a[2])*2/3+gx)} ${n(a[3]+(a[1]-a[3])*2/3+gy)} ${n(a[2]+gx)} ${n(a[3]+gy)} c`);
      }else if(op==='closePath')lines.push('h');
    }
    lines.push(i.halo?'B':'f');x+=p.xAdvance;y+=p.yAdvance;
  }lines.push('Q');return lines.join('\n');
}
function scenePDF(scene,font,images){
  return scene.map(i=>{
    const fill=i.fill?`${pdfColour(i.fill)} rg `:'',stroke=i.stroke?`${pdfColour(i.stroke)} RG ${n(i.width||1)} w `:'';
    if(i.type==='rect')return `q ${fill}${n(i.x)} ${n(i.y)} ${n(i.width)} ${n(i.height)} re f Q`;
    if(i.type==='line')return `q ${stroke}${n(i.x1)} ${n(i.y1)} m ${n(i.x2)} ${n(i.y2)} l S Q`;
    if(i.type==='path')return `q ${fill}${stroke}1 J 1 j [${(i.dash||[]).map(n).join(' ')}] 0 d ${i.commands.map(([op,...args])=>op==='Z'?'h':args.map(n).join(' ')+({M:' m',L:' l',C:' c'}[op])).join(' ')} ${i.fill&&i.stroke?'B':i.fill?'f':'S'} Q`;
    if(i.type==='circle'){const k=i.radius*.5522847498,x=i.x,y=i.y,r=i.radius;return `q ${fill}${stroke}${n(x+r)} ${n(y)} m ${n(x+r)} ${n(y+k)} ${n(x+k)} ${n(y+r)} ${n(x)} ${n(y+r)} c ${n(x-k)} ${n(y+r)} ${n(x-r)} ${n(y+k)} ${n(x-r)} ${n(y)} c ${n(x-r)} ${n(y-k)} ${n(x-k)} ${n(y-r)} ${n(x)} ${n(y-r)} c ${n(x+k)} ${n(y-r)} ${n(x+r)} ${n(y-k)} ${n(x+r)} ${n(y)} c B Q`;}
    if(i.type==='image')return images[i.key]?`q ${n(i.width)} 0 0 ${n(i.height)} ${n(i.x)} ${n(i.y)} cm /${i.key} Do Q`:'';
    if(i.type==='text')return textPDF(i,font);return '';
  }).join('\n');
}
const WKT='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';
export async function exportMapAtlas({plan,title,from=1,to=plan.sheets.length,signal,sink=blobSink(),loadTile,fontBytes,brand={},features=[],progress=()=>{},date,getImageryInfo=()=>null}){
  const first=Number(from),last=Number(to);if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>plan.sheets.length)throw new Error('Choose a valid sheet range.');
  if(!fontBytes||typeof loadTile!=='function')throw new Error('Map resources are unavailable.');
  abortCheck(signal);const font=fontkit.create(new Uint8Array(fontBytes)),writer=new PDFStream(sink,signal),root=writer.reserve(),pages=writer.reserve(),info=writer.reserve(),gcs=writer.reserve();
  const selected=plan.sheets.slice(first-1,last),pageIDs=selected.map(()=>writer.reserve()),images={},totalPixels=selected.reduce((s,p)=>s+p.pixels,0),captureDescriptions=new Set(),coverage=[];let done=0;
  try{
    await writer.write('%PDF-1.7\n%TerraWarden GeoPDF\n');
    await writer.object(gcs,`<< /Type /GEOGCS /EPSG 4326 /WKT ${literal(WKT)} >>`);
    for(const [key,image] of Object.entries(brand)){if(!['logo','wordmark'].includes(key))continue;const id=writer.reserve();images[key]=id;await writer.stream(id,`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,image.bytes);}
    for(let index=0;index<selected.length;index++){
      const sheet=selected[index],frame=sheet.frame,b=sheet.bounds,xobjects=Object.entries(images).map(([key,id])=>`/${key} ${id} 0 R`),ops=[];let patchNumber=0;
      for(const patch of rasterPatches(sheet)){
        abortCheck(signal);progress({sheet:sheet.number,stage:'imagery',fraction:done/totalPixels,bytes:writer.position});
        const bytes=await loadTile({...patch,source:plan.source,sheetNumber:sheet.number,signal});abortCheck(signal);
        const id=writer.reserve(),key=`I${++patchNumber}`;
        await writer.stream(id,`/Type /XObject /Subtype /Image /Width ${patch.width} /Height ${patch.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false /Filter /DCTDecode`,bytes);
        xobjects.push(`/${key} ${id} 0 R`);
        const x=frame.x+patch.x/sheet.width*frame.width,y=frame.y+(1-(patch.y+patch.height)/sheet.height)*frame.height,w=patch.width/sheet.width*frame.width,h=patch.height/sheet.height*frame.height;
        ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm /${key} Do Q`);done+=patch.width*patch.height;
      }
      const imageryInfo=await getImageryInfo(sheet);if(imageryInfo?.label)captureDescriptions.add(imageryInfo.label);if(imageryInfo?.recent)coverage.push(imageryInfo.missing);
      ops.unshift(scenePDF(marginScene({plan,sheet,title,date,imageryInfo}),font,images));
      if(features.length)ops.push(`q ${n(frame.x)} ${n(frame.y)} ${n(frame.width)} ${n(frame.height)} re W n`,scenePDF(featureScene(features,sheet),font,{}),'Q');
      const content=writer.reserve(),measure=writer.reserve(),viewport=writer.reserve();
      await writer.stream(content,'',encoder.encode(ops.join('\n')));
      const local='[0 0 0 1 1 1 1 0]',geo=[b.south,b.west,b.north,b.west,b.north,b.east,b.south,b.east].map(v=>String(Number(v.toFixed(10)))).join(' ');
      await writer.object(measure,`<< /Type /Measure /Subtype /GEO /Bounds ${local} /LPTS ${local} /GPTS [${geo}] /GCS ${gcs} 0 R >>`);
      await writer.object(viewport,`<< /Type /Viewport /Name ${unicode(`${title||'TerraWarden map'} - sheet ${sheet.number}`)} /BBox [${[frame.x,frame.y,frame.x+frame.width,frame.y+frame.height].map(n).join(' ')}] /Measure ${measure} 0 R >>`);
      const pageLayout=sheet.layout||plan.layout;
      await writer.object(pageIDs[index],`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${n(pageLayout.width)} ${n(pageLayout.height)}] /Resources << /XObject << ${xobjects.join(' ')} >> >> /Contents ${content} 0 R /VP [${viewport} 0 R] >>`);
      progress({sheet:sheet.number,stage:'page',fraction:done/totalPixels,bytes:writer.position});
    }
    await writer.object(pages,`<< /Type /Pages /Kids [${pageIDs.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIDs.length} >>`);
    await writer.object(root,`<< /Type /Catalog /Pages ${pages} 0 R /Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 3 >> >> >>`);
    if(plan.source==='recent'&&coverage.length&&coverage.every(value=>value===1))throw new Error('No clear imagery covers these sheets in the selected period. Increase the period or cloud limit, or choose the detailed mosaic.');
    await writer.object(info,`<< /Title ${unicode(title||'TerraWarden map')} /Author (TerraWarden) /Creator (TerraWarden Web Portal Map Creator) /Subject ${unicode(`${plan.sourceInfo.name}; WGS84 EPSG:4326; ${resolutionText(plan.resolution)}; ${plan.sourceInfo.credit}; ${[...captureDescriptions].join('; ').slice(0,4096)}`)} >>`);
    const size=await writer.finish(root,info);return {size,pages:pageIDs.length,blob:sink.blob?.()};
  }catch(error){await sink.abort?.().catch(()=>{});throw error;}
}
