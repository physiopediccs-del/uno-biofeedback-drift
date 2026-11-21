// Road coordinates keep the rainfall, surface drainage and contact patches in the same space.
const waterCols=512,waterRows=8192;
const waterPulseCount=26,smokeFirst=160+4*waterPulseCount,roadEffectsCount=smokeFirst+44;
let roadWaterField=null;
function makeWaterField(){
  if(roadWaterField)return roadWaterField;
  const width=TRACK_WIDTH,length=TRACK_LENGTH;
  const texels=new Uint8Array(waterCols*waterRows),point=new Float64Array(6);
  const lattice=new Float32Array(256*256);
  let seed=0x15803161;
  for(let i=0;i<lattice.length;i++)lattice[i]=(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  function noise(x,y){
    const ix=Math.floor(x),iy=Math.floor(y);
    let fx=x-ix,fy=y-iy;fx*=fx*(3-2*fx);fy*=fy*(3-2*fy);
    const a=(iy&255)*256,b=((iy+1)&255)*256,l=ix&255,r=(ix+1)&255;
    return (lattice[a+l]*(1-fx)+lattice[a+r]*fx)*(1-fy)+(lattice[b+l]*(1-fx)+lattice[b+r]*fx)*fy;
  }
  const clamp=(x)=>Math.min(1,Math.max(0,x));
  const smooth=(x)=>{const f=clamp(x);return f*f*(3-2*f)};
  // Remaining water varies over long shaded stretches and drains across their camber.
  // Lengths describe the extent of rainfall; the flooded contours come from the levels below.
  const rainfall=[[13,37,.96],[91,14,.48],[198,63,1.03],[313,24,.69],[446,56,1.10],[536,19,.52],[601,28,.74],[723,74,1.13],[810,23,.62]];
  for(let j=0;j<waterRows;j++){
    const s=(j+.5)*length/waterRows,theta=s*2*Math.PI/length;
    const swaleX=14*Math.cos(theta),swaleY=18.5*Math.sin(theta);
    let rain=0;
    for(let k=0;k<rainfall.length;k++){
      const cell=rainfall[k];let delta=s-cell[0];delta-=Math.round(delta/length)*length;
      const fraction=Math.abs(delta/cell[1]);
      rain=Math.max(rain,cell[2]*smooth(1-fraction*fraction));
    }
    trackSample(s,point);
    const x0=point[0],z0=point[2],nx=-point[5],nz=point[3];
    const crossfall=(groundAt(x0+nx*2,z0+nz*2)-groundAt(x0-nx*2,z0-nz*2))*.25;
    const drainDir=Math.tanh(crossfall*18);
    const bankFlow=.068*(x0*.59+z0*.84),bed=2.13*Math.sin(3*theta+.63)+.67*Math.sin(8*theta-.29);
    const silt=2.3*noise(x0*.025+4.4,z0*.025)-1.0;
    const descent=Math.min(.095,Math.abs(crossfall)*.72+Math.abs(point[4])*.49);
    for(let i=0;i<waterCols;i++){
      const x=(i+.5)*width/waterCols-width*.5;
      const wx=x0+nx*x,wz=z0+nz*x;
      const broad=noise(wx*.100+3.1,wz*.109+5.7);
      const relief=noise(wx*.367+broad*.74,wz*.361-.54*broad);
      const pores=noise(wx*1.18+relief,wz*1.13+.33*relief);
      // Runoff follows the gradient. The channels divide around local aggregate ridges.
      const channel=noise(x*.58+bankFlow*.44*drainDir+silt,bankFlow+2.4*broad);
      const eroded=smooth((channel-.37)*3.5);
      const kerb=clamp((Math.abs(x)-3.74)*.63);
      const gutter=kerb*(.4+.60*clamp(.5-x*drainDir*.10));
      const dist=Math.min(Math.abs(x-bed-.76),Math.abs(x-bed+.76));
      const rut=Math.exp(-dist*dist*4.7)*(.62+.38*relief);
      // The cambered crown drains between the wheel ruts. Water survives on the
      // low side of stone ridges and in shallow pockets fed by the crossing flow.
      const swale=noise(x*.59+2.61*broad-.09*silt+swaleX,swaleY+.069*wz+1.2*relief);
      const pocket=smooth((.63-.53*relief-.47*swale)*3.4);
      const crown=1.-(x*2./width)**2;
      const elevation=.260*broad+.182*relief+.080*pores+.043*crown+.130*(1.-pocket);
      const supply=rain*(.375+.091*eroded+.285*rut+.211*gutter+.107*pocket-.067*x*drainDir*.30);
      const wet=clamp((supply-elevation+.113)*1.49-descent);
      texels[j*waterCols+i]=Math.round(255*wet);
    }
  }
  roadWaterField=texels;return texels;
}
// The tyre footprint samples the same relief and free water as the pavement shader.
// Keep the four footprint points and five texture bands in double storage at startup.
let tyreBedTile=null;
const bedScale=new Float64Array([.037,.006,.45,1.64,1.64]);
const bedChannel=new Uint8Array([0,0,0,3,0]);
const bedBands=new Float64Array(5),wheelPool=new Float64Array(4),poolProbe=new Float64Array(8);
function sampleWheelPool(){
  const x=poolProbe[0],z=poolProbe[1],ax=poolProbe[2],az=poolProbe[3],fxwd=poolProbe[4],fzwd=poolProbe[5];
  const lateral=wetContact.lateral,along=wetContact.along,side=poolProbe[6],dir=poolProbe[7];
  for(let k=0;k<4;k++){
    let px=x,pz=z,lane=lateral,meter=along;
    if(k===0){px+=ax*.085;pz+=az*.085;lane+=side*.085;}
    if(k===1){px-=ax*.085;pz-=az*.085;lane-=side*.085;}
    if(k===2){px+=fxwd*.095;pz+=fzwd*.095;meter+=dir*.095;}
    if(k===3){px-=fxwd*.090;pz-=fzwd*.090;}
    let supply=wetContact.water;
    if(k<3){
      roadProbe[0]=lane;roadProbe[1]=meter;readRoadWater();supply=roadProbe[2];
    }
    for(let band=0;band<5;band++){
      const ch=bedChannel[band],scale=bedScale[band];
      let value=ch===3?.45:.5;
      if(tyreBedTile){
        const u=px*scale*256-.5,v=pz*scale*256-.5,ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
        const a=(iy&255)*1024,b=((iy+1)&255)*1024,l=(ix&255)*4+ch,r=((ix+1)&255)*4+ch;
        value=((tyreBedTile[a+l]*(1-fx)+tyreBedTile[a+r]*fx)*(1-fy)+(tyreBedTile[b+l]*(1-fx)+tyreBedTile[b+r]*fx)*fy)/255;
      }
      bedBands[band]=value;
    }
    const course=.57*(bedBands[0]-.5)+.43*(bedBands[1]-.5);
    const relief=.64*(bedBands[2]-.48)+.40*(bedBands[3]-.42)+.18*(bedBands[4]-.5)+1.17*course;
    wheelPool[k]=Math.max(0,Math.min(1,supply-relief));
  }
}
const roadProbe=new Float64Array(3);
function readRoadWater(){
  const x=roadProbe[0],s=roadProbe[1];
  if(!roadWaterField||Math.abs(x)>=TRACK_WIDTH*.5){roadProbe[2]=0;return;}
  const u=(x/TRACK_WIDTH+.5)*waterCols-.5,t=(s/TRACK_LENGTH-Math.floor(s/TRACK_LENGTH))*waterRows-.5;
  const ix=Math.max(0,Math.min(waterCols-2,Math.floor(u))),iy=(Math.floor(t)+waterRows)%waterRows;
  const a=iy*waterCols+ix,b=((iy+1)%waterRows)*waterCols+ix,fx=u-ix,fy=t-Math.floor(t),m=roadWaterField;
  roadProbe[2]=((m[a]+(m[a+1]-m[a])*fx)*(1-fy)+(m[b]+(m[b+1]-m[b])*fx)*fy)/255;
}
// Scalar sampling remains available for the offline hydrology diagnostics.
function contactWater(x,s){
  roadProbe[0]=x;roadProbe[1]=s;readRoadWater();return roadProbe[2];
}
// A wheel displaces deep water and carries it onto porous, drier asphalt.
// The footprint stores its own age so old film evaporates without a full-track rewrite.
const filmWidth=512,filmHeight=4096;
const tireFilm=new Uint8Array(filmWidth*filmHeight*4);
const previousContact=new Float64Array(8),wheelWater=new Float32Array(4);
const dirtyFirst=new Int32Array([filmHeight,filmHeight]),dirtyLast=new Int32Array([-1,-1]);
let filmActive=false,filmEra=0;
function resetTireWater(){
  previousContact.fill(NaN);wheelWater.fill(0);
  if(filmActive){tireFilm.fill(0);dirtyFirst[0]=0;dirtyLast[0]=filmHeight/2-1;dirtyFirst[1]=filmHeight/2;dirtyLast[1]=filmHeight-1;}
  filmActive=false;filmEra=0;
}
const wetContact={lateral:0,along:0,water:0,dt:0,time:0};
function rollWater(tire,contact){
  const x=contact.lateral,s=contact.along,dt=contact.dt,now=contact.time;
  roadProbe[0]=x;roadProbe[1]=s;readRoadWater();const water=roadProbe[2];
  contact.water=water;
  const era=Math.floor(now/2048);
  if(era!==filmEra){resetTireWater();filmEra=era;}
  const k=tire*2,px=previousContact[k],ps=previousContact[k+1];
  previousContact[k]=x;previousContact[k+1]=s;
  if(!Number.isFinite(ps))return;
  let ds=s-ps;ds-=Math.round(ds/TRACK_LENGTH)*TRACK_LENGTH;
  const travel=Math.abs(ds);
  if(travel>.8 || travel<.0005 || Math.abs(x)>TRACK_WIDTH*.5)return;
  const pickup=Math.max(0,Math.min(1,(water-.22)*1.53));
  const charge=Math.max(pickup,wheelWater[tire]*Math.exp(-travel*.30-dt*.12));
  wheelWater[tire]=charge;
  const outflow=Math.max(0,(water-.43)*1.82);
  if(Math.max(outflow,charge)<.033)return;
  const longScale=filmHeight/TRACK_LENGTH,latScale=filmWidth/TRACK_WIDTH;
  const s0=ps,s1=ps+ds,half=.096,extension=.105+.5/longScale;
  const start=Math.floor((Math.min(s0,s1)-extension)*longScale),end=Math.ceil((Math.max(s0,s1)+extension)*longScale);
  const stamp=Math.floor(now*32)&65535;
  const xfer=Math.min(1,charge*(1.-Math.min(.87,water))+.18*outflow);
  for(let row=start;row<=end;row++){
    const along=(row+.5)/longScale;
    const t=Math.max(0,Math.min(1,(along-s0)/ds));
    const longCoverage=Math.max(0,1-Math.abs(along-(s0+t*ds))/extension);
    const center=px+t*(x-px);
    // Water heaped along the shoulders shares the age of the evacuated tread print.
    const breakup=.5+.5*Math.sin(along*19.8+tire*1.91+1.2*Math.sin(along*7.23));
    const outward=(tire%2)*2-1,reach=half*(1.87+.48*outflow);
    const left=Math.max(0,Math.floor((center-reach+TRACK_WIDTH*.5)*latScale)),right=Math.min(filmWidth-1,Math.ceil((center+reach+TRACK_WIDTH*.5)*latScale));
    if(!longCoverage)continue;
    const iy=(row+filmHeight*2)%filmHeight;
    const bank=iy>>11;
    dirtyFirst[bank]=Math.min(dirtyFirst[bank],iy);dirtyLast[bank]=Math.max(dirtyLast[bank],iy);filmActive=true;
    for(let i=left;i<=right;i++){
      const side=((i+.5)/latScale-TRACK_WIDTH*.5-center)/half;
      const pressure=longCoverage*Math.max(0,Math.min(1,(1-Math.abs(side))*5.6));
      const flank=(Math.abs(side)-1.22-.26*breakup)/(.39+.34*outflow);
      const ridge=outflow*longCoverage*(side*outward>0?.94:.49)*(.48+.52*breakup)*Math.max(0,1-flank*flank);
      if(Math.max(pressure,ridge)<=.001)continue;
      const groove=.82+.18*Math.cos(12.6*side);
      const j=(iy*filmWidth+i)*4;
      const age=((stamp-(tireFilm[j+2]*256+tireFilm[j+3])+65536)&65535)/32;
      const film=tireFilm[j]*Math.max(0,1-age/20),prior=tireFilm[j+1];
      const relaxation=Math.max(0,1-age/1.55);
      let transfer=(prior<128?prior/127:(128-prior)/127)*relaxation;
      if(pressure*outflow>.015)transfer=Math.max(transfer,pressure*groove*outflow);
      else if(ridge>.008)transfer=Math.min(transfer,-ridge);
      tireFilm[j]=Math.max(film,Math.round(255*pressure*groove*xfer));
      tireFilm[j+1]=transfer>=0?Math.min(127,Math.round(127*transfer)):128+Math.min(127,Math.round(-127*transfer));
      tireFilm[j+2]=stamp>>8;tireFilm[j+3]=stamp&255;
    }
  }
}
// Fluid displaced by a leading wheel takes time to flow back into its tracks.
const displacedProbe=new Float64Array(4);
function readDisplacedWater(){
  const x=displacedProbe[0],s=displacedProbe[1],seconds=displacedProbe[2];
  if(!filmActive || Math.abs(x)>=TRACK_WIDTH*.5){displacedProbe[3]=0;return;}
  const u=(x/TRACK_WIDTH+.5)*filmWidth-.5, j=(s/TRACK_LENGTH-Math.floor(s/TRACK_LENGTH))*filmHeight-.5;
  const ix=Math.max(0,Math.min(filmWidth-2,Math.floor(u))),iy=Math.floor(j);
  const fx=limit(u-ix,0,1),fy=j-iy,stamp=Math.floor(seconds*32);
  let total=0;
  for(let y=0;y<2;y++)for(let a=0;a<2;a++){
    const k=4*(((iy+y+filmHeight)%filmHeight)*filmWidth+ix+a);
    const age=((stamp-(tireFilm[k+2]*256+tireFilm[k+3]))&65535)/32;
    const stored=tireFilm[k+1];
      total+=(stored<128?stored:128-stored)*Math.max(0,1-age/1.55)*(a?fx:1-fx)*(y?fy:1-fy);
  }
  displacedProbe[3]=total/127;
}
function displacedWater(x,s,seconds){
  displacedProbe[0]=x;displacedProbe[1]=s;displacedProbe[2]=seconds;readDisplacedWater();return displacedProbe[3];
}
function tireWaterTexture(device){
  const texture=device.createTexture({size:[filmWidth,filmHeight],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const origin={x:0,y:0,z:0},destination={texture,origin},layout={bytesPerRow:filmWidth*4,offset:0},size={width:filmWidth,height:0};
  function update(){
    for(let bank=0;bank<2;bank++){
      const first=dirtyFirst[bank],last=dirtyLast[bank];
      if(last<first)continue;
      origin.y=first;layout.offset=first*layout.bytesPerRow;size.height=last-first+1;
      device.queue.writeTexture(destination,tireFilm,layout,size);
      dirtyFirst[bank]=filmHeight;dirtyLast[bank]=-1;
    }
  }
  return {view:texture.createView(),update};
}
// A circuit-length map retains repairs, tire deposits and marbles at their track coordinates.
function createPavementMap(device){
  const W=512,H=8192,levels=14,w=TRACK_WIDTH,L=TRACK_LENGTH;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const c=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
  c.fillStyle='#000';c.fillRect(0,0,W,H);c.setTransform(W/w,0,0,H/L,W*.5,0);
  c.globalCompositeOperation='lighter';c.lineCap='round';c.lineJoin='round';
  let seed=6911423;
  function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const a=new Float64Array(6),b=new Float64Array(6),n=768,turn=new Float32Array(n+1);
  for(let i=0;i<n;i++){
    const s=L*i/n;trackSample(s-8,a);trackSample(s+8,b);
    turn[i]=Math.atan2(b[3]*(-a[5])+b[5]*a[3],a[3]*b[3]+a[5]*b[5])/16;
  }
  turn[n]=turn[0];
  function bend(s){let u=n*(s/L-Math.floor(s/L)),j=Math.floor(u);return turn[j]+(u-j)*(turn[j+1]-turn[j])}
  function racingLine(s){return 2.6*Math.tanh(bend(s)*24)-1.28*Math.tanh(bend(s+34)*30)}
  c.strokeStyle='rgb(255,0,0)';
  for(let lap=0;lap<63;lap++){
    const phase=rand()*6.28,offset=(rand()+rand()-1)*1.25,variation=rand()*.45+.17,sideWidth=.65+rand()*.18;
    c.lineWidth=.105+rand()*.13;c.globalAlpha=.013+rand()*.022;
    for(const side of [-1,1]){
      c.beginPath();for(let j=-2;j<=n+2;j++){
        const s=j*L/n,x=racingLine(s)+offset+side*sideWidth+variation*Math.sin(j*.042+phase)+.14*Math.sin(j*.122+phase*2);
        if(j===-2)c.moveTo(x,s);else c.lineTo(x,s);
      }c.stroke();
    }
  }
  // Braking scuffs have staggered ends and fine longitudinal tread grooves.
  for(let j=0;j<54;j++){
    const s=rand()*L;if(Math.abs(bend(s+10))<.008&&rand()<.8)continue;
    const offset=(rand()-.5)*3.5,len=3+rand()*22,veer=(rand()-.5)*1.6;
    for(const side of [-1,1])for(let ridge=0;ridge<4;ridge++){
      c.globalAlpha=.13+rand()*.18;c.lineWidth=.018+rand()*.019;c.beginPath();
      const offsetTrack=offset+.70*side+(ridge-1.5)*.036,lead=rand()*.9;
      for(let k=0;k<12;k++){
        const u=k/11,d=s+u*len+lead,x=racingLine(d)+offsetTrack+veer*u*u;
        if(k)c.lineTo(x,d);else c.moveTo(x,d);
      }c.stroke();
    }
  }
  // The discontinuous joint between adjacent courses of asphalt gathers dark bitumen.
  c.strokeStyle='rgb(0,255,0)';
  for(let slot=0;slot<2;slot++){
    let s=4+rand()*17;
    while(s<L){
      let len=8+rand()*70,base=(slot?1:-1)*(1.83+rand()*.23);
      c.lineWidth=.014+rand()*.018;c.globalAlpha=.40+rand()*.28;c.beginPath();
      for(let k=0;k<12;k++){let y=s+k*len/11,x=base+.035*Math.sin(.26*y)+rand()*.021;if(k)c.lineTo(x,y);else c.moveTo(x,y)}c.stroke();s+=len+5+rand()*28;
    }
  }
  for(let j=0;j<80;j++){
    const s=rand()*L,side=rand()<.5?-1:1,x=side*(w*.5-rand()*2.0);
    c.lineWidth=.014+rand()*.031;c.globalAlpha=.21+rand()*.43;
    c.beginPath();c.moveTo(x,s);let dx=x,dy=s;
    for(let k=0;k<4+rand()*4;k++){dx-=side*rand()*.44;dy+=(rand()-.48)*2;c.lineTo(dx,dy)}c.stroke();
    if(rand()<.3){c.beginPath();c.moveTo(dx,dy);c.lineTo(dx-side*.57,dy+.5);c.lineTo(dx-side*.81,dy+.39);c.stroke()}
  }
  c.fillStyle='rgb(0,0,255)';
  for(let i=0;i<31000;i++){
    const s=rand()*L,cur=bend(s),side=rand()<.5?-1:1,towardOutside=cur*side<0;
    if(!towardOutside&&rand()<.56)continue;
    const x=side*(2.85+Math.pow(rand(),.69)*(w*.5-2.84));
    const r=.003+Math.pow(rand(),4)*.019;c.globalAlpha=.21+rand()*.59;c.fillRect(x,s,r*2,r*(1.5+rand()*3.2));
  }
  c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='copy';
  const tex=device.createTexture({size:[W,H],format:'rgba8unorm',mipLevelCount:levels,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  let current=canvas,water=makeWaterField(),ww=waterCols,wh=waterRows;
  for(let level=0;level<levels;level++){
    const width=Math.max(1,W>>level),height=Math.max(1,H>>level);
    const pixels=current.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    for(let y=0;y<height;y++){const row=Math.min(wh-1,Math.floor(y*wh/height))*ww;for(let x=0;x<width;x++)pixels[(y*width+x)*4+3]=water[row+Math.min(ww-1,Math.floor(x*ww/width))];}
    if(ww>1||wh>1){const nw=Math.max(1,ww>>1),nh=Math.max(1,wh>>1),next=new Uint8Array(nw*nh);for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){const a=Math.min(y*2,wh-1)*ww+Math.min(x*2,ww-1),sx=ww>1?1:0,sy=wh>1?ww:0;next[y*nw+x]=(water[a]+water[a+sx]+water[a+sy]+water[a+sy+sx])*.25;}water=next;ww=nw;wh=nh;}
    device.queue.writeTexture({texture:tex,mipLevel:level},pixels,{bytesPerRow:width*4},[width,height]);
    if(level+1<levels){const next=document.createElement('canvas');next.width=Math.max(1,width>>1);next.height=Math.max(1,height>>1);next.getContext('2d',{willReadFrequently:true}).drawImage(current,0,0,next.width,next.height);current=next}
  }
  return tex.createView();
}
// Crushed stone in 0.8 m of pavement. Height and mineral reflectance share each
// texel with the two normal components of the exposed cleavage face.
function createAggregateMap(device){
  const size=1024,mask=size-1,levels=11;
  let seed=0xee33e107;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  let data=new Uint8Array(size*size*4);
  const texture=device.createTexture({size:[size,size],format:'rgba8unorm',mipLevelCount:levels,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  for(let j=0;j<data.length;j+=4){
    const grit=random();
    data[j]=118+18*random();data[j+1]=118+18*random();
    data[j+2]=21+26*grit;data[j+3]=7+26*grit;
  }
  const xs=new Float32Array(9),ys=new Float32Array(9),zs=new Float32Array(9);
  function fracture(count,small,large){
    for(let stone=0;stone<count;stone++){
      const cx=random()*size,cy=random()*size;
      const radius=small+(large-small)*random(),stretch=.53+.45*random();
      const sides=5+Math.floor(4*random()),turn=random()*Math.PI,c=Math.cos(turn),s=Math.sin(turn);
      const ridge=(.35+.63*random())*Math.min(1,.53+.08*radius);
      const apexX=cx+(random()-.5)*radius*.66,apexY=cy+(random()-.5)*radius*.56,apexZ=72+174*ridge;
      const mineral=random(),albedo=mineral<.54?55+random()*51:mineral<.91?97+random()*63:149+random()*75;
      for(let i=0;i<sides;i++){
        const angle=(i+(random()-.5)*.52)*6.2831853/sides;
        const extent=radius*(.79+.22*random());
        const x=Math.cos(angle)*extent,y=Math.sin(angle)*extent*stretch;
        xs[i]=cx+c*x-s*y;ys[i]=cy+s*x+c*y;zs[i]=24+(.05+.26*random())*apexZ;
      }
      for(let i=0;i<sides;i++){
        const other=(i+1)%sides,ux=xs[i]-apexX,uy=ys[i]-apexY,vx=xs[other]-apexX,vy=ys[other]-apexY;
        const det=ux*vy-uy*vx;
        if(det<.015)continue;
        const uz=zs[i]-apexZ,vz=zs[other]-apexZ;
        // The largest stone crowns stand about 2.7 mm above the binder.
        const slopeX=(vy*uz-uy*vz)/det*.0135,slopeY=(ux*vz-vx*uz)/det*.0135;
        const inv=1/Math.hypot(1,slopeX,slopeY),nx=127.5-127.5*slopeX*inv,ny=127.5-127.5*slopeY*inv;
        const facet=albedo*(.88+.23*random()),x0=Math.floor(Math.min(apexX,xs[i],xs[other])),x1=Math.ceil(Math.max(apexX,xs[i],xs[other]));
        const y0=Math.floor(Math.min(apexY,ys[i],ys[other])),y1=Math.ceil(Math.max(apexY,ys[i],ys[other]));
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
          const dx=x+.5-apexX,dy=y+.5-apexY;
          const u=(dx*vy-dy*vx)/det,v=(ux*dy-uy*dx)/det;
          if(u<0||v<0||u+v>1)continue;
          const z=apexZ+u*uz+v*vz,idx=((x&mask)+(y&mask)*size)*4;
          if(data[idx+3]>=z)continue;
          data[idx]=nx;data[idx+1]=ny;
          data[idx+2]=facet*(.94+.12*random());data[idx+3]=z;
        }
      }
    }
  }
  fracture(58000,1.7,3.6);fracture(24700,3.45,8.25);
  for(let level=0,width=size;level<levels;level++,width>>=1){
    device.queue.writeTexture({texture,mipLevel:level},data,{bytesPerRow:width*4},[width,width]);
    if(width===1)break;
    const half=width>>1,next=new Uint8Array(half*half*4);
    for(let y=0;y<half;y++)for(let x=0;x<half;x++){
      const j=(2*y*width+2*x)*4,k=(y*half+x)*4,row=width*4;
      for(let ch=0;ch<4;ch++)next[k+ch]=Math.round(.25*(data[j+ch]+data[j+4+ch]+data[j+row+ch]+data[j+row+4+ch]));
    }
    data=next;
  }
  return texture.createView();
}
