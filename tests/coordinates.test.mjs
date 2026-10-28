import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticZone, gridCRS, identifyMapCRS, projectGeographic, gdaHelmert, formattedGrid, fromWGS84 } from '../docs/portal/coordinates.mjs';

export const arcMapWKT='PROJCS["GDA_1994_MGA_Zone_50",GEOGCS["GCS_GDA_1994",DATUM["D_GDA_1994",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",117.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

test('ArcMap WKT identifies GDA94 / MGA50 without an EPSG number',()=>{
  const crs=identifyMapCRS(null,arcMapWKT);assert.equal(crs.datum,'gda94');assert.equal(crs.crs.epsg,28350);assert.equal(crs.crs.zone,50);
  assert.equal(identifyMapCRS(4326,arcMapWKT),null);
  assert.equal(identifyMapCRS(null,arcMapWKT.replace('D_GDA_1994','D_Unknown')),null);
  assert.equal(identifyMapCRS(null,arcMapWKT.replace('117.0','117.5')).crs,null);
});
test('projection outputs match independent PROJ reference values within 0.1 mm',()=>{
  // Generated with pyproj / PROJ, geographic input already in the target datum.
  const cases=[
    [-31.95,115.86,'gda94',50,false,392259.3618852099,6464539.163993055],
    [-37.81,144.96,'gda2020',55,false,320422.8202635015,5813305.222564748],
    [-36.85,174.76,'nzgd2000',null,false,1756911.9448501726,5920321.818190336],
    [78,18,'wgs84',33,true,569600.3798846477,8660152.344065603],
    [0,3,'wgs84',31,true,500000,0],
    [-23,123,'wgs84',51,false,500000,7456480.236401952],
    [-31.95,115.86,'wgs84',50,false,392259.3618857052,6464539.163893426],
  ];
  for(const [latitude,longitude,datum,zone,north,easting,northing]of cases){const got=projectGeographic({latitude,longitude},gridCRS(datum,zone,north));assert.ok(Math.abs(got.easting-easting)<.0001);assert.ok(Math.abs(got.northing-northing)<.0001);}
});
test('GDA conformal transform matches ICSM ALIC example evaluated by PROJ',()=>{
  // ICSM GDA2020 Technical Manual 3.1.1; EPSG:8048 parameters, full DMS input.
  const input={latitude:-23.670123894166668,longitude:133.88551329,height:603.3466};
  const result=gdaHelmert(input);
  assert.ok(Math.abs(result.latitude-(-23.670110138604244))<1e-10);
  assert.ok(Math.abs(result.longitude-133.88552160855534)<1e-10);
  assert.ok(Math.abs(result.height-603.2488721413538)<.0001);
  const inverse=gdaHelmert(result,true);assert.ok(Math.abs(inverse.latitude-input.latitude)<1e-10);assert.ok(Math.abs(inverse.longitude-input.longitude)<1e-10);assert.ok(Math.abs(inverse.height-input.height)<.0001);
});
test('GPS readout converts WGS84 to the fixed map grid instead of trusting stored grid numbers',()=>{
  const point={latitude:-31.95,longitude:115.86,easting:1,northing:2};const crs=gridCRS('gda94',50),grid=formattedGrid(point,crs),source=fromWGS84(point,'gda94'),expected=projectGeographic(source,crs);
  assert.equal(grid.crs.epsg,28350);assert.equal(grid.easting,expected.easting);assert.notEqual(grid.easting,1);assert.match(grid.northingText,/^6,464,/);
  assert.equal(formattedGrid({latitude:0,longitude:3}).crs.epsg,32631);
  assert.equal(formattedGrid({latitude:91,longitude:0}),null);
  assert.equal(formattedGrid({latitude:-30,longitude:-80},crs),null);
});
test('automatic UTM handles antimeridian, Norway and Svalbard',()=>{
  assert.equal(automaticZone(0,180),60);assert.equal(automaticZone(0,-180),1);assert.equal(automaticZone(60,4),32);assert.equal(automaticZone(78,18),33);assert.equal(automaticZone(-23,119.9),50);
});
