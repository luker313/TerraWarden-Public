import { normalizeLongitude, validCoordinate } from './core.mjs';

// Coordinate mathematics matches TerraWarden's native CoordinateSystems.swift.
// GDA94 <-> GDA2020: ICSM / EPSG:8048, coordinate-frame convention.
// Unspecified WGS84 <-> GDA2020: EPSG:8450 approximation (3 m), no epoch.
const radians = Math.PI / 180, grs80 = 298.257222101;
const datumLabels = { wgs84:'WGS84', gda94:'GDA94', gda2020:'GDA2020', nzgd2000:'NZGD2000' };
export function datumNote(datum) {
  if (datum === 'gda94') return 'WGS84 ↔ GDA94 via EPSG:8048 / 8450; approximate 3 m, no epoch or local distortion model.';
  if (datum === 'gda2020') return 'WGS84 ↔ GDA2020 uses the EPSG:8450 3 m approximation; no coordinate epoch.';
  if (datum === 'nzgd2000') return 'WGS84 ↔ NZGD2000 is a navigation approximation; no epoch or deformation model.';
  return '';
}
export function gdaHelmert(point, inverse = false) {
  if (!validCoordinate(point)) throw new Error('Invalid geographic coordinate.');
  const f=1/grs80,e2=f*(2-f),a=6378137,phi=point.latitude*radians,lam=point.longitude*radians;
  const h=Number.isFinite(point.height)?point.height:0,n=a/Math.sqrt(1-e2*Math.sin(phi)**2);
  const v=[(n+h)*Math.cos(phi)*Math.cos(lam),(n+h)*Math.cos(phi)*Math.sin(lam),(n*(1-e2)+h)*Math.sin(phi)];
  const rx=-.0394924*radians/3600,ry=-.0327221*radians/3600,rz=-.0328979*radians/3600,s=1-.009994e-6;
  const m=[[s,s*rz,-s*ry],[-s*rz,s,s*rx],[s*ry,-s*rx,s]],t=[.06155,-.01087,-.04019];
  let out;
  if(inverse){
    const rows=m.map((row,i)=>[...row,v[i]-t[i]]);
    for(let i=0;i<3;i++){
      const pivot=rows[i][i];for(let j=i;j<4;j++)rows[i][j]/=pivot;
      for(let k=0;k<3;k++)if(k!==i){const factor=rows[k][i];for(let j=i;j<4;j++)rows[k][j]-=factor*rows[i][j];}
    }
    out=rows.map(row=>row[3]);
  }else out=m.map((row,i)=>t[i]+row.reduce((sum,value,j)=>sum+value*v[j],0));
  const radial=Math.hypot(out[0],out[1]);let lat=Math.atan2(out[2],radial*(1-e2));
  for(let i=0;i<10;i++){const radius=a/Math.sqrt(1-e2*Math.sin(lat)**2),next=Math.atan2(out[2]+e2*radius*Math.sin(lat),radial);if(Math.abs(next-lat)<1e-15){lat=next;break;}lat=next;}
  const radius=a/Math.sqrt(1-e2*Math.sin(lat)**2);
  return {latitude:lat/radians,longitude:Math.atan2(out[1],out[0])/radians,height:radial/Math.cos(lat)-radius};
}
export const fromWGS84=(point,datum)=>datum==='gda94'?gdaHelmert(point,true):{...point};
export const toWGS84=(point,datum)=>datum==='gda94'?gdaHelmert(point,false):{...point};

export function automaticZone(latitude,longitude) {
  const lon=longitude===180?180:normalizeLongitude(longitude);
  let zone=Math.max(1,Math.min(60,Math.floor((lon+180)/6)+1));
  if(latitude>=56&&latitude<64&&lon>=3&&lon<12)zone=32;
  if(latitude>=72&&latitude<=84){if(lon>=0&&lon<9)zone=31;else if(lon>=9&&lon<21)zone=33;else if(lon>=21&&lon<33)zone=35;else if(lon>=33&&lon<42)zone=37;}
  return zone;
}
export function gridCRS(datum,zone,north=false) {
  if(datum==='nzgd2000')return {datum,projection:'nztm',epsg:2193,label:'NZGD2000 / NZTM2000',meridian:173,falseEasting:1600000,falseNorthing:10000000};
  if(!Object.hasOwn(datumLabels,datum)||!Number.isInteger(zone)||zone<1||zone>60)throw new Error('Unsupported coordinate grid.');
  if(datum!=='wgs84'&&(north||zone<46||zone>59))throw new Error('Unsupported MGA zone.');
  const epsg=datum==='gda94'?28300+zone:datum==='gda2020'?7800+zone:(north?32600:32700)+zone;
  return {datum,projection:'utm',zone,north,epsg,label:datum==='wgs84'?`WGS84 / UTM ${zone}${north?'N':'S'}`:`${datumLabels[datum]} / MGA Zone ${zone}`,meridian:zone*6-183,falseEasting:500000,falseNorthing:north?0:10000000};
}
export function defaultGrid(point) {return gridCRS('wgs84',automaticZone(point.latitude,point.longitude),point.latitude>=0);}

// Sixth-order Krüger n-series; ICSM GDA2020 Technical Manual section 4.1.1.
export function projectGeographic(point,crs) {
  if(!validCoordinate(point)||point.latitude < -80||point.latitude>84)return null;
  const delta=normalizeLongitude(point.longitude-crs.meridian);if(Math.abs(delta)>30)return null;
  const f=1/(crs.datum==='wgs84'?298.257223563:grs80),n=f/(2-f),e=Math.sqrt(f*(2-f));
  const n2=n*n,n3=n2*n,n4=n2*n2,n5=n4*n,n6=n3*n3;
  const a=6378137/(1+n)*(1+n2/4+n4/64+n6/256);
  const alpha=[n/2-2*n2/3+5*n3/16+41*n4/180-127*n5/288+7891*n6/37800,13*n2/48-3*n3/5+557*n4/1440+281*n5/630-1983433*n6/1935360,61*n3/240-103*n4/140+15061*n5/26880+167603*n6/181440,49561*n4/161280-179*n5/168+6601661*n6/7257600,34729*n5/80640-3418889*n6/1995840,212378941*n6/319334400];
  const phi=point.latitude*radians,lam=delta*radians,tau=Math.tan(phi),tau1=Math.hypot(1,tau),sigma=Math.sinh(e*Math.atanh(e*tau/tau1));
  const tp=tau*Math.hypot(1,sigma)-sigma*tau1,xiP=Math.atan2(tp,Math.cos(lam)),etaP=Math.asinh(Math.sin(lam)/Math.hypot(tp,Math.cos(lam)));
  let xi=xiP,eta=etaP;
  for(let i=0;i<6;i++){const j=2*(i+1);xi+=alpha[i]*Math.sin(j*xiP)*Math.cosh(j*etaP);eta+=alpha[i]*Math.cos(j*xiP)*Math.sinh(j*etaP);}
  const easting=crs.falseEasting+.9996*a*eta,northing=crs.falseNorthing+.9996*a*xi;
  return Number.isFinite(easting)&&Number.isFinite(northing)?{easting,northing}:null;
}
export function gridCoordinate(point,preferred) {
  if(!validCoordinate(point))return null;
  const crs=preferred||defaultGrid(point),projected=projectGeographic(fromWGS84(point,crs.datum),crs);
  return projected?{...projected,crs}:null;
}
export function formattedGrid(point,preferred) {
  const grid=gridCoordinate(point,preferred);if(!grid)return null;
  const format=n=>n.toLocaleString('en-AU',{minimumFractionDigits:1,maximumFractionDigits:1});
  return {...grid,eastingText:format(grid.easting),northingText:format(grid.northing),label:`${grid.crs.label} · EPSG:${grid.crs.epsg}`};
}
export function inverseGrid(easting,northing,crs){
  if(!crs||![easting,northing].every(Number.isFinite)||Math.abs(easting)>5e7||Math.abs(northing)>5e7)return null;
  let latitude=Math.max(-79.9,Math.min(83.9,(northing-crs.falseNorthing)/111100)),longitude=crs.meridian+(easting-crs.falseEasting)/(111320*Math.cos(latitude*Math.PI/180));
  for(let i=0;i<15;i++){
    const p=projectGeographic({latitude,longitude},crs);if(!p)return null;
    const e=p.easting-easting,n=p.northing-northing;if(Math.hypot(e,n)<.0001)return toWGS84({latitude,longitude},crs.datum);
    const step=1e-5,a=projectGeographic({latitude:latitude+step,longitude},crs),b=projectGeographic({latitude,longitude:longitude+step},crs);if(!a||!b)return null;
    const dx=(a.easting-p.easting)/step,dy=(b.easting-p.easting)/step,nx=(a.northing-p.northing)/step,ny=(b.northing-p.northing)/step,det=dx*ny-dy*nx;
    if(Math.abs(det)<1e-8)return null;latitude-=(ny*e-dy*n)/det;longitude-=(dx*n-nx*e)/det;
  }
  return null;
}

export function identifyMapCRS(epsg,wkt='') {
  let datum=null,crs=null;
  if([4326,4979,3857].includes(epsg)||(epsg>=32601&&epsg<=32660)||(epsg>=32701&&epsg<=32760))datum='wgs84';
  if([4283,4939,4347].includes(epsg)||(epsg>=28346&&epsg<=28359))datum='gda94';
  if([7843,7844].includes(epsg)||(epsg>=7846&&epsg<=7859))datum='gda2020';
  if([4167,4959,2193].includes(epsg))datum='nzgd2000';
  const raw=wkt.match(/(?:DATUM|ENSEMBLE)\s*\[\s*"([^"]+)"/i)?.[1];
  const datumName=raw?.toUpperCase().replace(/^D_/, '').replace(/[^A-Z0-9]/g,'');
  const wktDatum=['WGS1984','WGS84','WORLDGEODETICSYSTEM1984','WORLDGEODETICSYSTEM1984ENSEMBLE'].includes(datumName)?'wgs84':['GDA1994','GDA94','GEOCENTRICDATUMOFAUSTRALIA1994'].includes(datumName)?'gda94':['GDA2020','GEOCENTRICDATUMOFAUSTRALIA2020'].includes(datumName)?'gda2020':['NZGD2000','NEWZEALANDGEODETICDATUM2000'].includes(datumName)?'nzgd2000':null;
  if(raw&&!wktDatum)return null;
  if(datum&&wktDatum&&datum!==wktDatum)return null;
  datum=datum||wktDatum;if(!datum)return null;
  if(epsg>=32601&&epsg<=32660)crs=gridCRS(datum,epsg-32600,true);
  else if(epsg>=32701&&epsg<=32760)crs=gridCRS(datum,epsg-32700,false);
  else if(epsg>=28346&&epsg<=28359)crs=gridCRS(datum,epsg-28300);
  else if(epsg>=7846&&epsg<=7859)crs=gridCRS(datum,epsg-7800);
  else if(epsg===2193)crs=gridCRS('nzgd2000');
  else if(wkt){
    const parameter=name=>{const match=wkt.match(new RegExp(`PARAMETER\\s*\\[\\s*"${name}"\\s*,\\s*([-+0-9.eE]+)`,'i'));return match?Number(match[1]):NaN;};
    const central=parameter('central_?meridian'),scale=parameter('scale_?factor'),east=parameter('false_?easting'),north=parameter('false_?northing'),origin=parameter('latitude_?of_?origin');
    if(/PROJECTION\s*\[\s*"Transverse_?Mercator"/i.test(wkt)&&Math.abs(scale-.9996)<1e-10&&Math.abs(origin)<1e-10){
      if(datum==='nzgd2000'&&Math.abs(central-173)<1e-9&&east===1600000&&north===10000000)crs=gridCRS(datum);
      else {const zone=(central+183)/6;if(Number.isInteger(zone)&&east===500000&&[0,10000000].includes(north))try{crs=gridCRS(datum,zone,north===0);}catch{}}
    }
  }
  return {datum,datumLabel:datumLabels[datum],crs,note:datumNote(datum)};
}
