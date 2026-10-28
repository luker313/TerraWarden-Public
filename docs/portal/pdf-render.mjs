// Render only the visible part of a page at screen resolution. A full-page
// bitmap at high zoom would quickly exceed mobile canvas/memory limits.
export function planPDFRender({pageWidth,pageHeight,width,height,x,y,scale,dpr=1,padding=96}) {
  if(![pageWidth,pageHeight,width,height,scale].every(n=>Number.isFinite(n)&&n>0)||![x,y,dpr,padding].every(Number.isFinite))return null;
  const left=Math.max(0,(-x-padding)/scale),top=Math.max(0,(-y-padding)/scale);
  const right=Math.min(pageWidth,(width-x+padding)/scale),bottom=Math.min(pageHeight,(height-y+padding)/scale);
  if(right<=left||bottom<=top)return null;
  const w=right-left,h=bottom-top;
  // Bound both total pixels and dimensions for Safari and large desktop displays.
  const resolution=Math.min(scale*Math.max(1,dpr),4096/w,4096/h,Math.sqrt(6_000_000/(w*h)));
  const pixelWidth=Math.max(1,Math.floor(w*resolution)),pixelHeight=Math.max(1,Math.floor(h*resolution));
  return {left,top,width:w,height:h,pixelWidth,pixelHeight,resolution,
    transform:[resolution,0,0,resolution,-left*resolution,-top*resolution]};
}

export class PDFViewportRenderer {
  constructor(host,{createCanvas=()=>document.createElement('canvas'),delay=100,onError=()=>{}}={}) {
    this.host=host;this.createCanvas=createCanvas;this.delay=delay;this.onError=onError;this.generation=0;
  }
  clear() {
    this.generation++;clearTimeout(this.timer);this.timer=null;
    this.task?.cancel();this.task=null;this.page=null;
    this.replace();
  }
  setPage(page) {this.clear();this.page=page;}
  schedule(view) {
    const generation=++this.generation;
    clearTimeout(this.timer);this.task?.cancel();this.task=null;
    if(!this.page)return;
    const plan=planPDFRender(view);
    if(!plan){this.replace();return;}
    this.timer=setTimeout(()=>{this.timer=null;this.render(plan,generation);},this.delay);
  }
  async render(plan,generation) {
    const canvas=this.createCanvas();
    canvas.width=plan.pixelWidth;canvas.height=plan.pixelHeight;
    Object.assign(canvas.style,{left:plan.left+'px',top:plan.top+'px',width:plan.width+'px',height:plan.height+'px'});
    let task;
    try {
      task=this.page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:this.page.getViewport({scale:1}),transform:plan.transform,background:'#fff'});
      this.task=task;await task.promise;
      if(generation===this.generation)this.replace(canvas);
      else {canvas.width=0;canvas.height=0;}
    } catch(error) {
      canvas.width=0;canvas.height=0;
      if(generation===this.generation&&error.name!=='RenderingCancelledException')this.onError(error);
    } finally {if(this.task===task)this.task=null;}
  }
  replace(canvas) {
    const old=[...this.host.children];
    this.host.replaceChildren(...(canvas?[canvas]:[]));
    for(const previous of old){previous.width=0;previous.height=0;}
  }
}
