export function pinLabelPlacement(x,y,scale,angle){
  const degrees=Number.isFinite(angle)?Math.max(-180,Math.min(180,angle)):0;
  return {x:x+10/scale,y:y+3/scale,transform:`rotate(${degrees} ${x} ${y})`};
}
