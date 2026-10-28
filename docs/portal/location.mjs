import { normalizeLongitude, validCoordinate } from './core.mjs';

// Started only by the explicit Locate me button; never during page load.
export class LocationTracker {
  constructor(geolocation,onFix,onStatus){this.geolocation=geolocation;this.onFix=onFix;this.onStatus=onStatus;this.watchID=null;this.generation=0;this.running=false;}
  start(){
    if(this.running)return;
    if(!this.geolocation){this.onStatus('unavailable','Location is unavailable in this browser.');return;}
    this.running=true;const generation=++this.generation;this.onStatus('waiting','Waiting for your location…');
    try{
      this.watchID=this.geolocation.watchPosition(position=>{
        if(!this.running||generation!==this.generation)return;
        const {latitude,longitude,accuracy}=position.coords;
        if(!validCoordinate({latitude,longitude})||!Number.isFinite(accuracy)||accuracy<0)return;
        this.onFix({latitude,longitude,accuracy,timestamp:Number.isFinite(position.timestamp)?position.timestamp:Date.now()});
        this.onStatus('live','Location connected');
      },error=>{
        if(!this.running||generation!==this.generation)return;
        if(error.code===1){this.stop();this.onStatus('denied','Location permission was denied. Allow location for this site, then try Locate me.');}
        else this.onStatus('unavailable',error.code===3?'Location timed out. Waiting for another fix…':'Location signal unavailable. Waiting for another fix…');
      },{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
    }catch{this.stop();this.onStatus('unavailable','Could not start location. Check browser permissions and HTTPS.');}
  }
  stop(){
    this.running=false;this.generation++;
    if(this.watchID!==null)this.geolocation?.clearWatch(this.watchID);
    this.watchID=null;this.onStatus('off','Location off');
  }
}

export function accuracyRing(fix,vertices=48){
  const phi=fix.latitude*Math.PI/180,lambda=fix.longitude*Math.PI/180,d=fix.accuracy/6371008.8,points=[];
  for(let i=0;i<=vertices;i++){
    const bearing=2*Math.PI*i/vertices;
    const lat=Math.asin(Math.sin(phi)*Math.cos(d)+Math.cos(phi)*Math.sin(d)*Math.cos(bearing));
    const lon=lambda+Math.atan2(Math.sin(bearing)*Math.sin(d)*Math.cos(phi),Math.cos(d)-Math.sin(phi)*Math.sin(lat));
    points.push({latitude:lat*180/Math.PI,longitude:normalizeLongitude(lon*180/Math.PI)});
  }
  return points;
}
