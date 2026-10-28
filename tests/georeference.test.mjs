import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFString,PDFHexString,degrees} from '../docs/portal/vendor/pdf-lib.mjs';
import {geoPDFRegions} from '../docs/portal/georeference.mjs';
import {toWGS84} from '../docs/portal/coordinates.mjs';

const wkt='PROJCS["GDA_1994_MGA_Zone_50",GEOGCS["GCS_GDA_1994",DATUM["D_GDA_1994",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000],PARAMETER["False_Northing",10000000],PARAMETER["Central_Meridian",117],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0],UNIT["Meter",1]]';
async function fixture({box=[25,750,1075,35],gcs,rotation=0,crop=false}={}){
  const document=await PDFDocument.create(),page=document.addPage([1100,800]),c=document.context;
  const defaultGCS=c.obj({Type:PDFName.of('PROJCS'),WKT:PDFHexString.fromText(wkt)});
  const measure=c.obj({Type:PDFName.of('Measure'),Subtype:PDFName.of('GEO'),Bounds:[0,1,0,0,1,0,1,1],LPTS:[0,1,0,0,1,0,1,1],GPTS:[-32.02,115.90,-32,115.90,-31.999,115.94,-32.019,115.94],GCS:c.register(gcs?c.obj(gcs):defaultGCS)});
  const viewport=c.obj({Type:PDFName.of('Viewport'),Name:PDFString.of('Synthetic map'),BBox:box,Measure:c.register(measure)});
  page.node.set(PDFName.of('VP'),c.obj([c.register(viewport)]));page.setRotation(degrees(rotation));if(crop)page.setCropBox(15,15,1080,770);
  // Exercise indirect objects, compressed object streams and re-parsing too.
  return PDFDocument.load(await document.save({useObjectStreams:true}));
}
test('ArcMap reversed BBox and WKT-only GDA94 auto-align without mirroring',async()=>{
  const {regions,message}=geoPDFRegions(await fixture(),0);assert.equal(message,'');assert.equal(regions.length,1);const r=regions[0];
  assert.equal(r.crs.epsg,28350);assert.equal(r.source,'GDA94 GeoPDF');assert.deepEqual(r.model.box,[25,35,1075,750]);
  const south=r.model.toSourceGeo(25,35),north=r.model.toSourceGeo(25,750);assert.ok(south.latitude<north.latitude);assert.ok(Math.abs(south.latitude-(-32.02))<1e-10);
  for(const a of r.model.anchors){const gps=toWGS84(a,'gda94'),roundtrip=r.model.toPDF(gps.latitude,gps.longitude);assert.ok(Math.hypot(roundtrip[0]-a.x,roundtrip[1]-a.y)<.0001);}
});
test('rotated and cropped pages preserve georeferencing in PDF coordinates',async()=>{
  const r=geoPDFRegions(await fixture({rotation:90,crop:true}),0).regions[0];assert.ok(r);const geo=r.model.toGeo(550,390),point=r.model.toPDF(geo.latitude,geo.longitude);assert.ok(Math.hypot(point[0]-550,point[1]-390)<.0001);
});
test('reversed X and Y and a normal BBox retain each declared LPTS direction',async()=>{
  for(const box of [[1075,750,25,35],[25,35,1075,750]]){const r=geoPDFRegions(await fixture({box}),0).regions[0];assert.ok(r);assert.deepEqual([r.model.anchors[0].x,r.model.anchors[0].y],[box[0],box[3]]);}
});
test('WGS84 demo behaviour is retained; unknown or contradictory datums do not auto-align',async()=>{
  const good=await fixture({gcs:{Type:PDFName.of('GEOGCS'),EPSG:4326}});assert.equal(geoPDFRegions(good,0).regions[0].source,'WGS84 GeoPDF');
  const unknown=await fixture({gcs:{Type:PDFName.of('GEOGCS'),EPSG:999999}});assert.equal(geoPDFRegions(unknown,0).regions.length,0);
  const conflict=await fixture({gcs:{Type:PDFName.of('PROJCS'),EPSG:4326,WKT:PDFString.of(wkt)}});assert.equal(geoPDFRegions(conflict,0).regions.length,0);
});
test('ordinary PDF and zero-size viewport require calibration',async()=>{
  assert.equal(geoPDFRegions(await fixture({box:[25,35,25,750]}),0).regions.length,0);
  const plain=await PDFDocument.create();plain.addPage();assert.equal(geoPDFRegions(plain,0).regions.length,0);
});
