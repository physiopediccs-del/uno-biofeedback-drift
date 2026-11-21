function makeHUD(){
  const map=document.getElementById('map'),dash=document.getElementById('dash'),watch=document.getElementById('chrono');
  watch.width=282;watch.height=60;
  const m=map.getContext('2d'),d=dash.getContext('2d'),w=watch.getContext('2d');
  const bg=document.createElement('canvas');bg.width=540;bg.height=324;
  const b=bg.getContext('2d'),digits=Array.from({length:256},(_,i)=>String(i)),two=digits.map(s=>s.padStart(2,'0'));
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<roadCount;i++){const x=road[6*i],z=road[6*i+2];minX=Math.min(x,minX);maxX=Math.max(x,maxX);minZ=Math.min(z,minZ);maxZ=Math.max(z,maxZ)}
  const sc=Math.min(476/(maxX-minX),266/(maxZ-minZ)),ox=270-(minX+maxX)*.5*sc,oz=162-(minZ+maxZ)*.5*sc;
  const path=new Path2D();for(let i=0;i<roadCount;i++) {const x=ox+road[i*6]*sc,y=oz+road[i*6+2]*sc;if(!i)path.moveTo(x,y);else path.lineTo(x,y)}path.closePath();
  b.lineJoin='round';b.strokeStyle='#101b1dcc';b.lineWidth=14;b.stroke(path);b.strokeStyle='#e5e9e8dd';b.lineWidth=6;b.stroke(path);
  const pt=new Float64Array(6);atRoad(50,pt);
  b.save();b.translate(ox+pt[0]*sc,oz+pt[2]*sc);b.rotate(Math.atan2(pt[5],pt[3]));b.fillStyle='#152022';b.fillRect(-5,-12,10,24);
  b.fillStyle='#fbfcf7';for(let j=0;j<4;j++)b.fillRect(-5+(j%2)*5,-10+j*5,5,5);b.restore();
  const gauge=document.createElement('canvas');gauge.width=540;gauge.height=250;
  const g=gauge.getContext('2d');
  g.fillStyle='#fff';g.textAlign='right';g.font='600 20px "Helvetica Neue",Arial';g.fillText('KM/H',532,172);
  g.font='600 14px "Helvetica Neue",Arial';g.fillStyle='#e1e2db';g.fillText('RPM  ×  1000',536,233);g.textAlign='left';g.fillText('0',36,233);
  g.fillStyle='#1c2527a6';g.fillRect(370,77,66,78);g.strokeStyle='#ffffff7a';g.lineWidth=2;g.strokeRect(371,78,64,76);
  for(let i=0;i<40;i++){g.fillStyle=i>34?'#e59e6659':'#ffffff45';g.fillRect(35+i*12.6,188,9,9+i*.13)}
  // The moving overlay samples baked glyphs and symbols. Text shaping and path building finish at startup.
  function sprites(chars,font,color,width,height,baseline){
    const atlas=document.createElement('canvas');atlas.width=chars.length*width;atlas.height=height;
    const ctx=atlas.getContext('2d');ctx.font=font;ctx.textAlign='center';ctx.fillStyle=color;
    for(let i=0;i<chars.length;i++)ctx.fillText(chars[i],width*(i+.50),baseline);
    return atlas;
  }
  const digits10='0123456789',speedDigits=sprites(digits10,'italic 670 131px "Helvetica Neue",Arial','#fff',96,155,128);
  const gears=sprites('R12345','italic 650 54px "Helvetica Neue",Arial','#ffda78',76,74,59);
  const timer=sprites(digits10,'600 55px "Helvetica Neue",Arial','#fff',38,60,48);
  const timerBase=document.createElement('canvas');timerBase.width=282;timerBase.height=60;
  const baseCtx=timerBase.getContext('2d');baseCtx.font='600 55px "Helvetica Neue",Arial';baseCtx.fillStyle='#fff';baseCtx.fillText(':',62,47);baseCtx.fillText('.',139,47);
  const bars=document.createElement('canvas');bars.width=540;bars.height=22;const led=bars.getContext('2d');
  for(let i=0;i<40;i++){led.fillStyle=i>34?'#ff8d5a':i>28?'#ffd576':'#fff9e4';led.fillRect(35+i*12.6,0,9,9+i*.13)}
  const pointer=document.createElement('canvas');pointer.width=pointer.height=40;const pen=pointer.getContext('2d');
  pen.translate(20,20);pen.fillStyle='#ffd16a';pen.strokeStyle='#172126';pen.lineJoin='round';pen.lineWidth=4;
  pen.beginPath();pen.moveTo(0,-13);pen.lineTo(9,9);pen.lineTo(0,5);pen.lineTo(-9,9);pen.closePath();pen.stroke();pen.fill();
  const lapEl=document.getElementById('lap'),hint=document.getElementById('hint');
  const widths=new Array(42).fill(null);
  for(let i=0;i<widths.length;i++)widths[i]=Math.min(540,35+i*12.6);
  let lastLap=-1,started=false;
  function tickDigit(n,x){w.drawImage(timer,n*38,0,38,60,x,0,38,60)}
  return function drawHUD(state,lap,clock){
    m.clearRect(0,0,540,324);m.drawImage(bg,0,0);
    const co=Math.cos(state.head),si=Math.sin(state.head);
    m.setTransform(co,si,-si,co,ox+state.x*sc,oz+state.z*sc);m.drawImage(pointer,-20,-20);m.resetTransform();
    d.clearRect(0,0,540,250);d.drawImage(gauge,0,0);
    let value=Math.min(255,Math.round(Math.abs(state.speed)*3.6)),x=267;
    do{d.drawImage(speedDigits,(value%10)*96,0,96,155,x,31,96,155);x-=73;value=Math.floor(value/10)}while(value);
    d.drawImage(gears,Math.max(0,state.gear)*76,0,76,74,365,78,76,74);
    const len=widths[Math.min(41,Math.round(state.rpm/6600*40))];
    d.drawImage(bars,0,0,len,22,0,188,len,22);
    const ms=Math.floor(clock.lapTime*1000),min=Math.floor(ms/60000)%100,sec=Math.floor(ms/1000)%60;
    w.clearRect(0,0,282,60);w.drawImage(timerBase,0,0);
    tickDigit(Math.floor(min/10),-4);tickDigit(min%10,27);tickDigit(Math.floor(sec/10),74);tickDigit(sec%10,105);
    tickDigit(Math.floor(ms/100)%10,151);tickDigit(Math.floor(ms/10)%10,182);tickDigit(ms%10,213);
    if(lap!==lastLap){lapEl.textContent=two[lap%100];lastLap=lap}
    if(!started&&Math.abs(state.speed)>.6){hint.hidden=true;started=true}
  };
}
