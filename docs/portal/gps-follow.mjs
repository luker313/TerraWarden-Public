import {inPolygon,validCoordinate} from './core.mjs';

// A fresh GPS fix can centre the camera only inside the aligned map. Keeping
// the last useful view outside its coverage avoids navigating into blank space.
export function gpsCameraTarget({fix,model,viewport,pageBox,width,height,scale,now=Date.now()}) {
  if(!validCoordinate(fix)||!model||!viewport||!pageBox||!Number.isFinite(fix.timestamp)||now-fix.timestamp>30000||fix.timestamp>now+5000)return null;
  const p=model.toPDF(fix.latitude,fix.longitude);
  if(!p||!p.every(Number.isFinite)||p[0]<pageBox[0]||p[0]>pageBox[2]||p[1]<pageBox[1]||p[1]>pageBox[3]||!inPolygon(p,model.footprint))return null;
  const [x,y]=viewport.convertToViewportPoint(...p);
  return {x:width/2-x*scale,y:height/2-y*scale};
}
