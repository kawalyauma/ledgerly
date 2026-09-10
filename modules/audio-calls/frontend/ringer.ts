let context:AudioContext|null=null;
let timer:number|undefined;
let active=false;

function tone(){
  if(!active)return;
  try{
    context??=new AudioContext();
    const osc=context.createOscillator(),gain=context.createGain();
    osc.frequency.value=720;gain.gain.value=.035;osc.connect(gain);gain.connect(context.destination);osc.start();osc.stop(context.currentTime+.22);
    window.setTimeout(()=>{if(!active)return;try{const o=context!.createOscillator(),g=context!.createGain();o.frequency.value=880;g.gain.value=.03;o.connect(g);g.connect(context!.destination);o.start();o.stop(context!.currentTime+.2)}catch{}},300);
  }catch{}
  try{navigator.vibrate?.([250,180,250])}catch{}
}

export const webCallRinger={
 start(){if(active)return;active=true;tone();timer=window.setInterval(tone,2500)},
 stop(){active=false;if(timer)window.clearInterval(timer);timer=undefined;try{navigator.vibrate?.(0)}catch{}},
};
