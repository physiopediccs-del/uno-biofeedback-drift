const gameCanvas=document.getElementById('view');
const keys={KeyW:0,KeyA:0,KeyS:0,KeyD:0,Space:0,ArrowUp:0,Enter:0};
const mode=new URLSearchParams(location.search), testMode=mode.has('verify');
let renderer,driver,hudDraw,manual=testMode,camMode=0,pose=-1,camCut=true,lapNo=1,driving=false,clockStarted=false,nextGate=32,tapeIndex=0;
let cameraStation=-1,skidIndex=0,smokeIndex=0,wakeIndex=0,hasEffects=false,worstOffset=0,tireMargin=Infinity,firstCrossing=-1;
const gameTime={elapsed:0,lapTime:0,lastHUD:-1,lastRAF:0,simRemainder:0,trailDelay:0};
const chaseView={lookHeading:0,sideBias:-1.64};
const sprayClock=new Float32Array(4),spraySlot=new Uint8Array(4);
function resetSpray(){resetTireWater();spraySlot.fill(0);for(let i=0;i<4;i++)sprayClock[i]=i*.0071}
const targetCam=new Float32Array(3),lookAt=new Float32Array(3),station=new Float64Array(6);
const frame={vp:new Float32Array(16),prevVP:new Float32Array(16),invVP:new Float32Array(16),cam:new Float32Array(3),car:new Float32Array(3),transforms:new Float32Array(96),effects:new Float32Array(8*roadEffectsCount),wakes:new Float32Array(24*4),time:0,dt:0,s:0,speed:0,brake:0,cut:true,sample:-1,focus:1,apertureRadius:0};
const matrices=Array.from({length:6},(_,i)=>frame.transforms.subarray(i*16,i*16+16));
const fixedViews=[[11,3.05,1.28,-4.2,.52,0],[36,-2.75,1.43,4.5,.54,-.03],[162,4.35,1.04,.65,.58,.03],[360,3.3,2.89,4.15,.61,0],[580,-2.85,1.17,-4.86,.53,.02],[696,-7,2.75,6.3,.55,.05]];
function setupCamera(i){camMode=(i+3)%3;camCut=true;pose=-1;cameraStation=-1}
function respawn(){if(!driver)return;place(driver,driver.s);snapshot();setupCamera(camMode);frame.effects.fill(0);frame.wakes.fill(0);skidIndex=smokeIndex=wakeIndex=0;gameTime.trailDelay=0;resetSpray();hasEffects=false}
function controls(){const menu=document.getElementById('help');menu.hidden=!menu.hidden;document.getElementById('helpBtn').setAttribute('aria-expanded',menu.hidden?'false':'true')}
document.getElementById('helpBtn').onclick=controls;document.getElementById('closeHelp').onclick=controls;
document.getElementById('cameraBtn').onclick=()=>setupCamera(camMode+1);document.getElementById('resetBtn').onclick=respawn;

const qualityLevels=['low','medium','high'];
const qualityLabels={low:'Baixa',medium:'Média',high:'Alta'};
let currentQuality=localStorage.getItem('race_quality')||'medium';
function updateQualityUI(){const lbl=document.getElementById('qualLabel');if(lbl)lbl.textContent=qualityLabels[currentQuality]||'Média';}
function cycleQuality(){
  const nextIdx=(qualityLevels.indexOf(currentQuality)+1)%qualityLevels.length;
  currentQuality=qualityLevels[nextIdx];
  localStorage.setItem('race_quality',currentQuality);
  updateQualityUI();
  location.reload();
}
const qualBtn=document.getElementById('qualBtn');
if(qualBtn)qualBtn.onclick=cycleQuality;

const bio={active:true,state:'RELAX',turnDirection:0,turnDiff:0,curveStrength:0,userContracting:false,contractionLevel:0,drifting:false};
let pointerDown=false;
window.addEventListener('pointerdown',e=>{
  if(e.target.closest('button')||e.target.closest('section'))return;
  pointerDown=true;
});
window.addEventListener('pointerup',()=>{pointerDown=false;});
window.addEventListener('pointercancel',()=>{pointerDown=false;});
function checkContractionInput(){return !!(keys.Space||keys.KeyW||keys.ArrowUp||keys.Enter||pointerDown);}

function key(e,on){
  if(e.code in keys){e.preventDefault();keys[e.code]=on?1:0;return}
  if(e.code==='ArrowUp'||e.code==='Enter'){e.preventDefault();keys[e.code]=on?1:0;return}
  if(!on||e.repeat)return;
  if(e.code==='KeyC')setupCamera(camMode+1);
  else if(e.code==='KeyR')respawn();
  else if(e.code==='KeyH')controls();
  else if(e.code==='KeyQ')cycleQuality();
}
window.addEventListener('keydown',e=>key(e,true));window.addEventListener('keyup',e=>key(e,false));window.addEventListener('blur',()=>{keys.KeyW=keys.KeyS=keys.KeyD=keys.KeyA=keys.Space=keys.ArrowUp=keys.Enter=0;pointerDown=false;});
// The four wheels share spin and steering. Store the trigonometric pairs
// once and keep the rotations in float32 at each matrix write.
const poseAngles=new Float64Array(7),poseTurns=new Float64Array(14);
const headingPair=0,gradePair=2,bankPair=4,steeringPair=6,spinPair=8,rollPair=10,pitchPair=12;
const bodyPivot=new Float64Array([0,.39,0]);
function preparePose(d){
  poseAngles[0]=-d.head;poseAngles[1]=Math.atan(d.grade);poseAngles[2]=Math.atan(d.bank);
  poseAngles[3]=-d.steering;poseAngles[4]=d.wheel;poseAngles[5]=d.roll;poseAngles[6]=d.pitch;
  for(let i=0;i<poseAngles.length;i++){
    poseTurns[i*2]=Math.sin(poseAngles[i]);poseTurns[i*2+1]=Math.cos(poseAngles[i]);
  }
}
function chassisPose(d,m){
  ident(m);
  m[12]=d.x;m[13]=d.y+.004;m[14]=d.z;
  rotateY(m,poseTurns,headingPair);rotateX(m,poseTurns,gradePair);rotateZ(m,poseTurns,bankPair);
}
function wheelPose(b,i){
  const m=matrices[i+2],p=WHEEL_CENTERS[i];
  m.set(b);
  translatePivot(m,p,1);
  if(i<2)rotateY(m,poseTurns,steeringPair);
  rotateX(m,poseTurns,spinPair);
  translatePivot(m,p,-1);
}
function visualCar(d){
  const b=matrices[1];
  preparePose(d);chassisPose(d,b);
  for(let i=0;i<4;i++)wheelPose(b,i);
  translatePivot(b,bodyPivot,1);
  rotateZ(b,poseTurns,rollPair);rotateX(b,poseTurns,pitchPair);
  translatePivot(b,bodyPivot,-1);
  frame.car[0]=d.x;frame.car[1]=d.y;frame.car[2]=d.z;
}
const projectionScale=new Float64Array(2);
function chooseCamera(dt,d){
  const cam=frame.cam;
  let h=d.head,fov=.78,eyeSide,eyeUp,eyeBack,aimSide=0,aimUp=.76,aimBack=0;
  if(pose>=0){
    const p=fixedViews[pose];eyeSide=p[1];eyeUp=p[2];eyeBack=p[3];fov=p[4];aimUp=.80;aimBack=p[5];
  }else if(camMode===0){
    const diff=Math.atan2(Math.sin(d.head-chaseView.lookHeading),Math.cos(d.head-chaseView.lookHeading));
    chaseView.lookHeading=camCut?d.head:chaseView.lookHeading+diff*(1-Math.exp(-dt*5.7));h=chaseView.lookHeading;
    const factor=limit(Math.abs(d.speed)/19,0,1);
    const bend=limit(d.roll/.075,-1,1),surge=limit(d.pitch/.06,-1,1)*factor,desired=-1.64+factor*(.19+.48*bend);
    chaseView.sideBias=camCut?desired:chaseView.sideBias+(desired-chaseView.sideBias)*(1-Math.exp(-dt*1.5));
    eyeSide=chaseView.sideBias;eyeUp=1.61+factor*(.20+.063*Math.abs(bend))-.083*surge;
    eyeBack=4.04+.74*factor+.27*surge;aimBack=-.94-factor*1.21;
    aimSide=-.23*bend;aimUp=.81+factor*.24;fov=.785+factor*.136+.016*surge;
  }else if(camMode===1){
    eyeSide=-.28;eyeUp=1.154;eyeBack=-.63;aimUp=1.13;aimBack=-10;aimSide=-.28;fov=1.12;
  }else{
    const st=Math.floor(d.s/36),s=(st+.72)*36;atRoad(s,station);const sg=st%3===1?-1:1;
    const x=station[0]-station[5]*8.5*sg,z=station[2]+station[3]*8.5*sg;
    targetCam[0]=x;targetCam[1]=groundAt(x,z)+2.05;targetCam[2]=z;
    if(cameraStation!==st){camCut=true;cameraStation=st}
    cam.set(targetCam);lookAt[0]=d.x;lookAt[1]=d.y+.71;lookAt[2]=d.z;
    const dx=x-d.x,dz=z-d.z;
    fov=limit(5.35/Math.sqrt(dx*dx+dz*dz),.258,.77);
  }
  if(pose>=0||camMode!==2){
    const co=Math.cos(h),si=Math.sin(h);
    targetCam[0]=d.x+co*eyeSide-si*eyeBack;targetCam[2]=d.z+si*eyeSide+co*eyeBack;
    targetCam[1]=d.y+eyeUp+eyeSide*d.bank-eyeBack*d.grade;
    cam.set(targetCam);lookAt[0]=d.x+co*aimSide-si*aimBack;lookAt[2]=d.z+si*aimSide+co*aimBack;
    lookAt[1]=d.y+aimUp+aimSide*d.bank-aimBack*d.grade;
  }
  // 24 mm sensor height, f/4.8. The circle of confusion varies with the
  // selected lens and the distance to the point the camera is tracking.
  const dx=lookAt[0]-cam[0],dy=lookAt[1]-cam[1],dz=lookAt[2]-cam[2];
  const focus=Math.sqrt(dx*dx+dy*dy+dz*dz);
  const halfAngle=Math.tan(fov*.5),aspect=gameCanvas.width/gameCanvas.height;
  const focal=.012/halfAngle;
  projectionScale[1]=1/halfAngle;projectionScale[0]=projectionScale[1]/aspect;
  frame.focus=focus;
  frame.apertureRadius=gameCanvas.height*focal*focal/(.048*4.8*Math.max(.12,focus-focal));
  cameraMatrix(frame.vp,cam,lookAt,projectionScale);
  if(pose<0 && camMode===0){
    const angle=d.roll*.155,co=Math.cos(angle),si=Math.sin(angle);
    const m=frame.vp;
    for(let i=0;i<16;i+=4){
      const x=m[i],y=m[i+1];
      m[i]=co*x-si*y/aspect;m[i+1]=si*x*aspect+co*y;
    }
  }
}
function effects(dt){
  const d=driver,fx=frame.effects,wakes=frame.wakes;
  if(Math.abs(d.speed)>2.4){
    const co=Math.cos(d.head),si=Math.sin(d.head),roadK=d.seg*6;
    const tangent=Math.atan2(road[roadK+3],-road[roadK+5]),rel=d.head-tangent;
    const cr=Math.cos(rel),sr=Math.sin(rel);
    wetContact.dt=dt;
    wetContact.time=gameTime.elapsed;
    for(let tire=0;tire<4;tire++){
      const side=(tire%2)*2-1,wheel=WHEEL_CENTERS[tire],wx=wheel[0],wz=wheel[2];
      const lateral=d.offset+wx*cr-wz*sr,along=d.s-wz*cr-wx*sr;
      wetContact.lateral=lateral;
      wetContact.along=along;
      rollWater(tire,wetContact);
      const depth=wetContact.water;
      sprayClock[tire]-=dt;
      if(sprayClock[tire]>0)continue;
      const x=d.x+wx*co-wz*si,z=d.z+wx*si+wz*co;
      const angle=d.head+(tire<2?d.steering:0),ax=Math.cos(angle)*side,az=Math.sin(angle)*side;
      const fxwd=Math.sin(angle)*Math.sign(d.speed),fzwd=-Math.cos(angle)*Math.sign(d.speed);
      poolProbe[0]=x;poolProbe[1]=z;poolProbe[2]=ax;poolProbe[3]=az;
      poolProbe[4]=fxwd;poolProbe[5]=fzwd;poolProbe[6]=side;poolProbe[7]=Math.sign(d.speed);
      sampleWheelPool();
      const outward=wheelPool[0],inward=wheelPool[1],nose=wheelPool[2],heel=wheelPool[3];
      displacedProbe[0]=lateral;displacedProbe[1]=along+Math.sign(d.speed)*.38;displacedProbe[2]=wetContact.time;
      readDisplacedWater();const cleared=displacedProbe[3];
      const mobile=(.41*outward+.19*inward+.24*nose+.16*heel)*(1.-.76*cleared);
      // Water held in the tread continues to leave small droplets after the axle
      // has crossed the bank of the puddle.
      const carried=.38*wheelWater[tire]*wheelWater[tire];
      const strength=Math.max(carried,limit((mobile-.31)*1.73,0,1))*Math.min(1,Math.abs(d.speed)/14);
      // The lateral shoulder opens first as it catches a lobe of a puddle. A
      // front-to-back increase also feeds ligaments carried through the tread.
      const lip=limit(.31+2.14*(outward-inward)+1.81*(nose-heel),0,1);
      const irregular=Math.sin(along*53.73+tire*731.91)*43758.545;
      sprayClock[tire]+=.015+(irregular-Math.floor(irregular))*.010+.019*(1.-strength)-.005*lip;
      if(strength<.038 || (depth<.17 && carried<.16))continue;
      hasEffects=true;const k=(wakeIndex++%24)*4;wakes[k]=x;wakes[k+1]=z;wakes[k+2]=0;wakes[k+3]=strength;
      const o=8*(160+tire*waterPulseCount+spraySlot[tire]);spraySlot[tire]=(spraySlot[tire]+1)%waterPulseCount;
      fx[o]=x+side*co*.056;fx[o+1]=d.y+wx*d.bank-wz*d.grade+.022;
      fx[o+2]=z+side*si*.056;fx[o+3]=0;fx[o+4]=d.head+(tire<2?d.steering:0);fx[o+5]=d.speed;fx[o+6]=strength;fx[o+7]=3+lip*.999;
    }
  }
  if(!hasEffects&&!d.slip)return;
  gameTime.trailDelay+=dt;
  for(let i=0;i<24;i++){const k=i*4;if(wakes[k+3]>0){wakes[k+2]+=dt;if(wakes[k+2]>1.03)wakes[k+3]=0;}}
  for(let i=0;i<roadEffectsCount;i++){const o=i*8,kind=fx[o+7];if(!kind)continue;const age=fx[o+3]+dt;fx[o+3]=age;
    if(kind===2){if(age>2.5)fx[o+7]=0;else{fx[o]+=(.31+.16*Math.sin(fx[o+4]+age*3))*dt;fx[o+1]+=(.29+.11*age)*dt;fx[o+2]-=.12*dt;fx[o+6]+=.41*dt;}}
    else if(kind>=3&&age>.84)fx[o+7]=0;
  }
  if(d.slip&&gameTime.trailDelay>=.029){
    hasEffects=true;const co=Math.cos(d.head),si=Math.sin(d.head);
    for(let side=-1;side<=1;side+=2){
      let o=8*(skidIndex++%160);const x=d.x+side*.665*co-1.218*si,z=d.z+side*.665*si+1.218*co;
      const dy=d.y+.025+side*.665*d.bank-1.218*d.grade;
      fx[o]=x;fx[o+1]=dy;fx[o+2]=z;fx[o+3]=0;fx[o+4]=-d.head;fx[o+5]=Math.min(1.7,Math.abs(d.speed)*gameTime.trailDelay*1.22);fx[o+6]=.135;fx[o+7]=1;
      o=8*(smokeFirst+smokeIndex++%44);fx[o]=x;fx[o+1]=dy+.15;fx[o+2]=z;fx[o+3]=0;fx[o+4]=smokeIndex*2.4;fx[o+5]=.64;fx[o+6]=.55;fx[o+7]=2;
    }
    gameTime.trailDelay=0;
  }
}
const bioPt0=new Float64Array(6),bioPt1=new Float64Array(6),bioAim=new Float64Array(6);
function computeBioStep(dt){
  bio.userContracting=checkContractionInput();
  const targetContract=bio.userContracting?1.0:0.0;
  bio.contractionLevel+=(targetContract-bio.contractionLevel)*Math.min(1,dt*14);
  atRoad(driver.s,bioPt0);atRoad(driver.s+10,bioPt1);
  const a0=Math.atan2(bioPt0[3],-bioPt0[5]),a1=Math.atan2(bioPt1[3],-bioPt1[5]);
  const diffNow=Math.atan2(Math.sin(a1-a0),Math.cos(a1-a0)),curveNow=Math.abs(diffNow)/10;
  const lookDist=15+Math.min(12,Math.abs(driver.speed)*.42);
  atRoad(driver.s+lookDist,bioPt0);atRoad(driver.s+lookDist+12,bioPt1);
  const b0=Math.atan2(bioPt0[3],-bioPt0[5]),b1=Math.atan2(bioPt1[3],-bioPt1[5]);
  const diffAhead=Math.atan2(Math.sin(b1-b0),Math.cos(b1-b0)),curveAhead=Math.abs(diffAhead)/12;
  const CURVE_THRESHOLD=.0062;
  const inCurve=curveNow>CURVE_THRESHOLD,approaching=curveAhead>CURVE_THRESHOLD;
  if(inCurve||approaching){
    bio.state='CONTRACT';
    const sign=inCurve?Math.sign(diffNow):Math.sign(diffAhead);
    bio.turnDirection=sign||1;bio.curveStrength=Math.max(curveNow,curveAhead);bio.turnDiff=inCurve?diffNow:diffAhead;
  }else{
    bio.state='RELAX';bio.turnDirection=0;bio.curveStrength=0;bio.turnDiff=0;
  }
  let targetSpeed=26.0;
  if(bio.state==='CONTRACT'){
    if(bio.contractionLevel>=.35)targetSpeed=20.0;
    else targetSpeed=12.0;
  }
  const speedDiff=targetSpeed-driver.speed;
  let autoGas=0,autoBrake=0;
  if(speedDiff>.4)autoGas=Math.min(1.0,.36+speedDiff*.38);
  else if(speedDiff<-1.8)autoBrake=Math.min(.85,-speedDiff*.32);
  else autoGas=.22;
  const aimDist=4.2+Math.abs(driver.speed)*.42;
  atRoad(driver.s+aimDist,bioAim);
  let targetOffset=0,handbrake=0,steerMult=1.0;
  if(bio.state==='CONTRACT'){
    if(bio.contractionLevel>=.35){
      bio.drifting=true;
      targetOffset=-bio.turnDirection*1.6;
      if(Math.abs(driver.speed)>13&&inCurve){handbrake=.28;driver.slip=1;}
      steerMult=1.06;
    }else{
      bio.drifting=false;targetOffset=bio.turnDirection*3.8;steerMult=.32;
    }
  }else{
    bio.drifting=false;targetOffset=0;handbrake=0;steerMult=1.0;
    if(bio.contractionLevel>.5)targetOffset=Math.sin(gameTime.elapsed*5.5)*.65;
  }
  const targetX=bioAim[0]-bioAim[5]*targetOffset,targetZ=bioAim[2]+bioAim[3]*targetOffset;
  const dx=targetX-driver.x,dz=targetZ-driver.z,ld=Math.hypot(dx,dz);
  const alpha=Math.atan2(dx,-dz)-driver.head;
  const maxSteer=.565/(1+Math.abs(driver.speed)*.051);
  const baseSteer=limit(Math.atan(2*2.36*Math.sin(alpha)/Math.max(1,ld))/maxSteer,-1,1);
  const manualNudge=(keys.KeyD-keys.KeyA)*.3;
  const autoSteer=limit(baseSteer*steerMult+manualNudge,-1,1);
  return {gas:autoGas,brk:autoBrake,steer:autoSteer,hand:handbrake};
}

function advance(gas,brk,steer,hand,dt){
  if(!testMode){
    const ctrl=computeBioStep(dt);
    gas=ctrl.gas;brk=ctrl.brk;steer=ctrl.steer;hand=ctrl.hand;
  }
  step(driver,gas,brk,steer,hand,dt);effects(dt);gameTime.elapsed+=dt;
  if(gas||Math.abs(driver.speed)>.2)driving=true;
  if(driving)gameTime.lapTime+=dt;
  if(driver.distance>=nextGate){
    if(clockStarted)lapNo++;clockStarted=true;nextGate+=TRACK_LENGTH;gameTime.lapTime=0;
  }
}

const bioBanner=document.getElementById('bioBanner'),bioText=document.getElementById('bioText'),bioBar=document.getElementById('bioBar'),bioSub=document.getElementById('bioSub');
function updateBioHUD(){
  if(!bioBanner||!bioText||!bioBar)return;
  if(bio.state==='CONTRACT'){
    const arrow=bio.turnDirection<0?'⮠ ':'';
    const arrowRight=bio.turnDirection>0?' ➔':'';
    bioText.textContent=arrow+'CONTRACT'+arrowRight;
    bioText.className='bio-text contract';
    bioBanner.className='bio-banner contract';
    if(bioSub)bioSub.textContent=bio.contractionLevel>=.35?'Curva em drift · Contração ideal!':'Curva à frente · Contraia para derrapar!';
  }else{
    bioText.textContent='RELAX';
    bioText.className='bio-text relax';
    bioBanner.className='bio-banner relax';
    if(bioSub)bioSub.textContent=bio.contractionLevel>.4?'Reta livre · Relaxe seus músculos':'Piloto automático ativo · Relaxe na reta';
  }
  bioBar.style.width=(Math.max(0,Math.min(1,bio.contractionLevel))*100).toFixed(1)+'%';
}

function paint(dt,sample=-1,d=driver){
  frame.prevVP.set(frame.vp);visualCar(d);chooseCamera(dt,d);if(camCut)frame.prevVP.set(frame.vp);invert(frame.invVP,frame.vp);
  frame.time=gameTime.elapsed;frame.dt=dt;frame.s=d.s;frame.speed=d.speed;frame.brake=d.brake;frame.cut=camCut;frame.sample=sample;
  renderer.draw(frame);camCut=false;
  if(gameTime.elapsed-gameTime.lastHUD>=1/30-.0001||gameTime.lastHUD<0){
    hudDraw(driver,lapNo,gameTime);
    updateBioHUD();
    gameTime.lastHUD=gameTime.elapsed;
  }
}
const previousPose=spawnDriver(),smoothPose=spawnDriver();
function snapshot(){
  previousPose.x=driver.x;
  previousPose.y=driver.y;
  previousPose.z=driver.z;
  previousPose.head=driver.head;
  previousPose.speed=driver.speed;
  previousPose.steering=driver.steering;
  previousPose.bank=driver.bank;
  previousPose.grade=driver.grade;
  previousPose.roll=driver.roll;
  previousPose.pitch=driver.pitch;
  previousPose.wheel=driver.wheel;
}
function interpolate(t){
  smoothPose.x=previousPose.x+t*(driver.x-previousPose.x);
  smoothPose.y=previousPose.y+t*(driver.y-previousPose.y);
  smoothPose.z=previousPose.z+t*(driver.z-previousPose.z);
  smoothPose.head=previousPose.head+t*(driver.head-previousPose.head);
  smoothPose.speed=previousPose.speed+t*(driver.speed-previousPose.speed);
  smoothPose.steering=previousPose.steering+t*(driver.steering-previousPose.steering);
  smoothPose.bank=previousPose.bank+t*(driver.bank-previousPose.bank);
  smoothPose.grade=previousPose.grade+t*(driver.grade-previousPose.grade);
  smoothPose.roll=previousPose.roll+t*(driver.roll-previousPose.roll);
  smoothPose.pitch=previousPose.pitch+t*(driver.pitch-previousPose.pitch);
  let spin=driver.wheel-previousPose.wheel;
  if(spin>Math.PI)spin-=TAU;else if(spin< -Math.PI)spin+=TAU;
  smoothPose.wheel=previousPose.wheel+spin*t;smoothPose.s=driver.s;smoothPose.brake=driver.brake;
}
function tick(now){
  if(manual){gameTime.lastRAF=0;return}
  const dt=gameTime.lastRAF?Math.min(.0667,(now-gameTime.lastRAF)*.001):1/120;gameTime.lastRAF=now;
  gameTime.simRemainder+=dt;
  while(gameTime.simRemainder>=1/120){snapshot();advance(keys.KeyW,keys.KeyS,keys.KeyD-keys.KeyA,keys.Space,1/120);gameTime.simRemainder-=1/120}
  interpolate(gameTime.simRemainder*120);paint(dt,-1,smoothPose);requestAnimationFrame(tick);
}
// Cache the ordinary Number arguments that cross the simulation call boundary.
let decodedCommands=null;
function replayReset(){
  if(!recording)recording=makeRecording();
  if(!decodedCommands || decodedCommands.length!==recording.length){
    decodedCommands=new Array(recording.length).fill(null);
  }
  for(let i=0;i<recording.length;i++)decodedCommands[i]=recording[i]/32767;
  setupCamera(0);place(driver,50);driver.distance=0;
  gameTime.elapsed=gameTime.lapTime=0;driving=false;clockStarted=true;nextGate=TRACK_LENGTH;lapNo=1;tapeIndex=0;
  firstCrossing=-1;worstOffset=0;tireMargin=Infinity;gameTime.lastHUD=-1;gameTime.trailDelay=0;skidIndex=smokeIndex=wakeIndex=0;resetSpray();hasEffects=false;frame.effects.fill(0);frame.wakes.fill(0);
}
const tireProbe=spawnDriver();
function measureTires(){
  const d=driver,cs=Math.cos(d.head),sn=Math.sin(d.head);
  for(let i=0;i<4;i++){
    const wheel=WHEEL_CENTERS[i];
    tireProbe.x=d.x+cs*wheel[0]-sn*wheel[2];tireProbe.z=d.z+sn*wheel[0]+cs*wheel[2];tireProbe.seg=d.seg;
    nearest(tireProbe,false);
    const roadK=tireProbe.seg*6,diff=d.head+(i<2?d.steering:0)-Math.atan2(road[roadK+3],-road[roadK+5]);
    const footprint=.089*Math.abs(Math.cos(diff))+.116*Math.abs(Math.sin(diff));
    tireMargin=Math.min(tireMargin,TRACK_WIDTH*.5-Math.abs(tireProbe.offset)-footprint);
  }
}
function replayStep(sample=-1){
  const j=tapeIndex*3;if(j>=recording.length)return;
  for(let k=0;k<2;k++){advance(decodedCommands[j],decodedCommands[j+1],decodedCommands[j+2],0,1/120);measureTires()}
  worstOffset=Math.max(worstOffset,Math.abs(driver.offset));
  if(firstCrossing<0&&driver.distance>=TRACK_LENGTH)firstCrossing=tapeIndex;
  tapeIndex++;paint(1/60,sample);
}
function debugState(){return {x:driver.x,y:driver.y,z:driver.z,speed:driver.speed,steer:driver.steering,hand:keys.Space,slip:driver.slip,brake:driver.brake,offset:driver.offset,lap:lapNo,distance:driver.distance,firstCrossing,worstOffset,tireMargin,trackLength:TRACK_LENGTH,trackWidth:TRACK_WIDTH,camera:camMode,tapeIndex}}
async function start(){
  if(!navigator.gpu)throw Error('Este circuito requer WebGPU. Abra este arquivo no Chrome ou Edge com aceleração de gráficos.');
  updateQualityUI();
  const q=currentQuality;
  const qualityDims={low:{w:960,h:540},medium:{w:1280,h:720},high:{w:1920,h:1080}};
  const dims=qualityDims[q]||qualityDims.medium;
  gameCanvas.width=testMode&&Number(mode.get('w'))||dims.w;
  gameCanvas.height=testMode&&Number(mode.get('h'))||dims.h;
  prepareRoad();buildWorld();buildCar();const scene=G.finish();bakeCarOcclusion(scene);renderer=await initRenderer(gameCanvas,scene);
  driver=spawnDriver();place(driver,18);driver.distance=0;snapshot();ident(matrices[0]);hudDraw=makeHUD();
  for(let i=0;i<12;i++)paint(1/60);
  await renderer.device.queue.onSubmittedWorkDone();document.body.classList.add('ready');
  if(testMode)window.lab={
    reset:replayReset,step:replayStep,state:debugState,device:renderer.device,
    sampleStart:n=>renderer.startTiming(n),sampleEnd:async()=>Array.from(await renderer.finishTiming()),
    tape:()=>Array.from(recording),
    fixed(i){pose=i;place(driver,fixedViews[i][0]);camCut=true;for(let j=0;j<16;j++)paint(1/60);return renderer.device.queue.onSubmittedWorkDone()},
    settle(){for(let i=0;i<10;i++)paint(1/60);return renderer.device.queue.onSubmittedWorkDone()},
    input(n){for(let i=0;i<n;i++)advance(keys.KeyW,keys.KeyS,keys.KeyD-keys.KeyA,keys.Space,1/120);paint(1/60);return debugState()},
    displace(){driver.x+=6;nearest(driver,true);return debugState()},
    initial(){setupCamera(0);place(driver,0);camCut=true;paint(1/60)}
  };
  if(!manual)requestAnimationFrame(tick);
}
start().catch(e=>{console.error(e);document.getElementById('status').textContent=e.message;document.querySelector('.loader').hidden=true;window.gameError=e.message});
