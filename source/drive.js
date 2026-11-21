// Distances use metres, velocities use metres per second and the fixed simulation runs at 120 Hz.
let road, roadCount, roadStep, barrierEdges;
function prepareRoad(){
  roadCount=Math.ceil(TRACK_LENGTH/1.25);roadStep=TRACK_LENGTH/roadCount;
  road=new Float64Array((roadCount+1)*6);barrierEdges=new Float32Array(roadCount*2);barrierEdges.fill(1e4);
  for(let i=0;i<=roadCount;i++)trackSample(i%roadCount*roadStep,road.subarray(i*6,i*6+6));
}
function registerBarrier(start,end,side,distance){
  if(!barrierEdges)return;
  for(let j=Math.floor(start/roadStep);j<=Math.ceil(end/roadStep);j++){
    const slot=((j%roadCount+roadCount)%roadCount)*2+(side>0?1:0);
    barrierEdges[slot]=Math.min(barrierEdges[slot],distance);
  }
}
const limit=(v,a,b)=>Math.max(a,Math.min(b,v));
const TAU=2*Math.PI;
function atRoad(distance,out){
  let u=distance/roadStep;u-=Math.floor(u/roadCount)*roadCount;
  const i=Math.floor(u)*6, f=u-Math.floor(u);
  for(let k=0;k<6;k++)out[k]=road[i+k]+f*(road[i+6+k]-road[i+k]);
}
function nearest(d,all){
  let best=1e14,seg=d.seg,bestT=0;
  const start=all?0:seg-6,stop=all?roadCount-1:seg+6;
  for(let j=start;j<=stop;j++){
    const i=(j+roadCount)%roadCount, k=i*6;
    const ax=road[k],az=road[k+2],dx=road[k+6]-ax,dz=road[k+8]-az;
    const t=limit(((d.x-ax)*dx+(d.z-az)*dz)/(dx*dx+dz*dz),0,1);
    const ex=d.x-ax-dx*t,ez=d.z-az-dz*t,ds=ex*ex+ez*ez;
    if(ds<best){best=ds;seg=i;bestT=t}
  }
  const k=seg*6,tx=road[k+3],tz=road[k+5];
  const abs=(seg+bestT)*roadStep;
  let delta=abs-d.s;
  if(delta<-TRACK_LENGTH*.5)delta+=TRACK_LENGTH;
  if(delta>TRACK_LENGTH*.5)delta-=TRACK_LENGTH;
  d.distance+=delta;d.seg=seg;d.s=abs;d.y=road[k+1]+(road[k+7]-road[k+1])*bestT;
  d.offset=(d.x-road[k]-(road[k+6]-road[k])*bestT)*(-tz)+(d.z-road[k+2]-(road[k+8]-road[k+2])*bestT)*tx;
  d.grade=road[k+4];
  const w=TRACK_WIDTH*.5,cx=road[k]+(road[k+6]-road[k])*bestT,cz=road[k+2]+(road[k+8]-road[k+2])*bestT;
  const l=groundAt(cx+tz*w,cz-tx*w),r=groundAt(cx-tz*w,cz+tx*w);
  d.bank=(r-l)/TRACK_WIDTH;
  d.y=Math.abs(d.offset)<=w?(l+r)*.5+d.bank*d.offset:groundAt(d.x,d.z)+vergeElevation(d.x,d.z,Math.abs(d.offset))-Math.min(.16,(Math.abs(d.offset)-w)*.085);

}
const roadPoint=new Float64Array(6);
function spawnDriver(){
  return {x:0,y:0,z:0,head:0,steering:0,speed:0,travel:0,seg:0,s:0,distance:0,offset:0,bank:0,grade:0,roll:0,pitch:0,drift:0,wheel:0,brake:0,slip:0,yawRate:0,gear:1,rpm:950};
}
function place(d,s){
  atRoad(s,roadPoint);
  d.x=roadPoint[0];d.y=roadPoint[1];d.z=roadPoint[2];
  d.head=Math.atan2(roadPoint[3],-roadPoint[5]);d.travel=d.head;
  d.speed=d.steering=d.offset=d.drift=d.roll=d.pitch=d.yawRate=d.brake=d.slip=d.wheel=0;
  d.seg=Math.floor(s/roadStep)%roadCount;d.s=s;d.grade=roadPoint[4];d.rpm=950;d.gear=1;
  nearest(d,false);
}
function step(d,throttle,brake,steer,hand,dt){
  const v=d.speed,av=Math.abs(v),sgn=Math.sign(v);
  const grass=Math.abs(d.offset)>TRACK_WIDTH*.5;
  const maxSteer=.565/(1+av*.051);
  const target=steer*maxSteer;
  d.steering+=limit(target-d.steering,-dt*1.7,dt*1.7);
  let drive=throttle*(v<-.18?7.2:4.35/(1+av*.033));
  if(brake)drive-=brake*(v>.18?9.5:2.05/(1+av*.21));
  let acc=drive-sgn*(.12+.00112*v*v+(grass?.95+av*.10:0)+(hand?5.2:0))-d.grade*7.5;
  if(!throttle&&!brake&&av<.09)acc=-v/dt;
  let nv=limit(v+acc*dt,-7.8, 42);
  if(hand&&nv*v<0)nv=0;
  d.speed=nv;
  const grip=grass?5.1:9.6;
  const requested=nv*Math.tan(d.steering)/2.36;
  const capped=limit(requested,-grip/Math.max(2,av),grip/Math.max(2,av));
  const rate=hand?requested*.72+capped*.62:capped*.92+requested*.08;
  d.yawRate+=(rate-d.yawRate)*Math.min(1,dt*(hand?6.4:9.2));
  d.head+=d.yawRate*dt;
  const orient=Math.atan2(Math.sin(d.head-d.travel),Math.cos(d.head-d.travel));
  d.travel+=orient*Math.min(1,dt*(hand?2.0:grass?5.6:12));
  d.x+=Math.sin(d.travel)*nv*dt;d.z-=Math.cos(d.travel)*nv*dt;
  nearest(d,false);
  const barrier=barrierEdges[d.seg*2+(d.offset>0?1:0)];
  let fence=TRACK_WIDTH*.5+5.3;
  if(barrier<40&&Math.abs(d.offset)>TRACK_WIDTH*.5-.7){
    const k=d.seg*6,rel=d.head-Math.atan2(road[k+3],-road[k+5]);
    const halfSpan=.775*Math.abs(Math.cos(rel))+1.83*Math.abs(Math.sin(rel));
    fence=Math.min(fence,barrier-halfSpan-.035);
  }
  if(Math.abs(d.offset)>fence){
    const k=d.seg*6,e=(Math.abs(d.offset)-fence)*Math.sign(d.offset);
    d.x+=road[k+5]*e;d.z-=road[k+3]*e;d.speed*=Math.exp(-3*dt);
    nearest(d,false);
  }
  d.roll+=(limit(d.yawRate*nv*.008,-.075,.075)-d.roll)*Math.min(1,dt*6.2);
  d.pitch+=(limit(acc*.007,-.068,.034)-d.pitch)*Math.min(1,dt*6.4);
  d.wheel=(d.wheel-nv*dt/WHEEL_RADIUS)%TAU;
  d.brake=brake>.038&&v>=-.1||hand?1:0;
  d.slip=av>4&&(hand||Math.abs(requested*nv)>grip*1.12)?1:0;
  let gear=av<10.2?1:av<18?2:av<25.2?3:av<33.2?4:5;
  d.gear=v<-.15?-1:gear;
  const ratio=gear===1?485:gear===2?299:gear===3?215:gear===4?165:132;
  d.rpm=limit(900+av*ratio+throttle*180,890,6350);
}

const replayLength=3600;
let recording;
function makeRecording(){
  const commands=new Int16Array(replayLength*3),look=new Float64Array(6);
  const d=spawnDriver();
  // Closed-loop rehearsal writes the control tape. Playback only reads the recorded axes.
  function rehearse(pace){
    place(d,50);d.distance=0;
    for(let i=0;i<replayLength;i++){
      const aim=4.1+Math.abs(d.speed)*.44;
      atRoad(d.s+aim,look);
      const dx=look[0]-d.x,dz=look[2]-d.z,ld=Math.hypot(dx,dz);
      const alpha=Math.atan2(dx,-dz)-d.head;
      const steer=limit(Math.atan(2*2.36*Math.sin(alpha)/Math.max(1,ld))*(1+Math.abs(d.speed)*.051)/.565,-1,1);
      let target=pace;
      for(let j=0;j<5;j++){
        const ahead=5+j*8;
        atRoad(d.s+ahead,look);
        const aa=Math.atan2(look[3],-look[5]);
        atRoad(d.s+ahead+5,look);
        const ab=Math.atan2(look[3],-look[5]);
        const curve=Math.abs(Math.atan2(Math.sin(ab-aa),Math.cos(ab-aa)))/5;
        const cv=Math.sqrt(6.75/Math.max(.0005,curve));
        target=Math.min(target,Math.sqrt(cv*cv+2*5.0*Math.max(0,ahead-6)));
      }
      const demand=(target-d.speed)*1.65+.12+d.speed*d.speed*.00112+d.grade*7.5;
      const gas=limit(demand*(1+d.speed*.033)/4.35,0,1),brake=demand<-.29?limit(-demand/9.5,0,1):0,o=i*3;
      commands[o]=Math.round(32767*gas);commands[o+1]=Math.round(32767*brake);commands[o+2]=Math.round(32767*steer);
      for(let k=0;k<2;k++)step(d,commands[o]/32767,commands[o+1]/32767,commands[o+2]/32767,0,1/120);
    }
    return d.distance;
  }
  let lo=3,hi=42;
  for(let j=0;j<22;j++){const mid=(lo+hi)/2;if(rehearse(mid)<TRACK_LENGTH+.08)lo=mid;else hi=mid}
  rehearse((lo+hi)/2);
  return commands;
}
