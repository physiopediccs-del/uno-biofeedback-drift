// The canopy atlas is baked from sixteen independently seeded, three-dimensional sprays.
// Its channels store two normal components, ambient attenuation / leaf variation, and coverage.
function worldCanopyAtlas(device){
  const w=256,dim=w*4,canvas=document.createElement('canvas');
  canvas.width=canvas.height=dim*2;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  let seed=0x6dc55e31;
  const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  const range=(a,b)=>a+(b-a)*rand();
  const unit=a=>{const s=1/(Math.hypot(...a)||1);return a.map(x=>x*s);};
  const add=(a,b,s)=>a.map((x,i)=>x+b[i]*s);
  const twodir=()=>{const a=rand()*Math.PI*2,z=range(-1,1),h=Math.sqrt(1-z*z);return [h*Math.cos(a),h*Math.sin(a),z];};
  const leafColor=(nx,ny,shade)=>'rgb('+Math.round(128+nx*122)+','+Math.round(128+ny*122)+','+Math.round(Math.min(1,shade)*255)+')';
  function tile(id){
    const items=[],flower=id>=13,compound=id<4,slender=id>=8&&id<11,pine=id===11||id===12;
    const base=[range(-.15,.15),-.36,range(-.09,.06)],tilt=range(-.53,.53),turn=range(-.36,.36);
    const tw=(a,b,radius)=>items.push({a,b,radius,z:(a[2]+b[2])/2-.018});
    const leaf=(p,dir,r,w,shade,petal=false)=>{
      const angle=Math.atan2(-dir[1],dir[0]);
      const n=unit([dir[0]*.65+range(-.35,.35),dir[1]*.45+range(-.36,.51),range(.44,.99)]);
      items.push({p,angle,r:r*(.72+.28*Math.hypot(dir[0],dir[1])),w,shade,petal,n,z:p[2]});
    };
    // Each silhouette follows curving wood with leaves in opposite or alternate pairs.
    // Bare proximal internodes keep light visible between the sprays.
    const arms=pine?6:compound?4:slender?5:5+id%3;
    const axis=(a,z)=>unit([Math.sin(a),Math.cos(a),z]);
    const point=(a,b,t)=>a.map((v,i)=>v+t*(b[i]-v));
    for(let k=0;k<arms;k++){
      const u=(k+.31)/(arms+.13),sg=k%2?-1:1,
        takeoff=.19+.76*u,bear=tilt+turn*(2.*u-.36),
        spread=sg*range(.57,1.62)*(1.-.39*u),bearing=bear+spread,
        len=range(.33,.70)*(1.-.46*u),
        spine=axis(bear,.09+.12*u),root=add(base,spine,takeoff*.82),stem=axis(bearing,range(-.47,.65)),
        joint=add(root,axis(bearing+turn*.46,stem[2]),len*range(.30,.48)),
        tip=add(joint,axis(bearing+turn+range(-.31,.33),stem[2]+range(-.21,.21)),len*.61);
      tw(add(base,axis(tilt+turn*(u-.36),.09),takeoff*.31),root,.0064);tw(root,joint,.0075);tw(joint,tip,.0062);
      const branches=pine?9:compound?7:slender?7:7+id%2;
      for(let j=0;j<branches;j++){
        const side=(j%2?1:-1),t=.13+.79*(j+range(.06,.88))/branches,
          at=t<.4?point(root,joint,t/.4):point(joint,tip,(t-.4)/.6),
          az=bearing+side*range(.53,1.32)+(slender?.25:0),reach=range(.132,.326)*(1.10-t*.41),
          dir=axis(az,range(-.49,.68)),elbow=add(at,dir,reach*.54),
          tipDir=axis(az+range(-.34,.34)+(slender?side*.37:0),dir[2]+range(-.22,.22)),
          end=add(elbow,tipDir,reach*.47),pairs=pine?11:compound?7:slender?4:4+(rand()*3|0),
          pigment=range(.66,1.07),highlight=range(-.13,.15);
        tw(at,elbow,.0044);tw(elbow,end,.0031);
        for(let h=0;h<pairs;h++)for(const sideLeaf of [-1,1]){
          const u=Math.min(.99,(h+.16+(compound?0:sideLeaf*.16)+range(.11,.54))/pairs),
            knot=u<.54?point(at,elbow,u/.54):point(elbow,end,(u-.54)/.46),
            ld=axis(az+sideLeaf*range(.52,1.34)+(slender?sideLeaf*.37:0),range(-.48,.65)),
            size=(pine?range(.036,.059):compound?range(.028,.052):slender?range(.048,.090):range(.039,.074))
                *(.69+.31*Math.sin(u*Math.PI))*(1.-.14*u),
            width=size*(pine?range(.068,.11):compound?range(.26,.39):slender?range(.15,.26):range(.36,.61)),
            center=add(knot,ld,size*1.32),shade=(.66+center[2]*.61+highlight+range(-.22,.26))*pigment;
          tw(knot,center,.0018);leaf(center,ld,size*.89,width*.83,shade);
        }
        if(flower && (j+k+id)%3!==0){
          // Five overlapping petals form a corolla on the end of the reproductive shoot.
          const flowers=6+(rand()*8|0);
          for(let f=0;f<flowers;f++){
            const ray=twodir(),pos=add(end,ray,range(.009,.089));
            const radius=range(.019,.037),spin=range(0,6.28),lum=range(.66,1.03)+pos[2]*.13;
            tw(end,pos,.0019);
            for(let q=0;q<5;q++){
              const ld=axis(spin+q*1.2566,ray[2]*.47),c=add(pos,ld,radius*.52);
              leaf(c,ld,radius*.71,radius*.43,lum*range(.83,1.08),true);
            }
          }
        }
      }
    }
    // Use measured bounds, including the tapered leaf tips, to leave a transparent border on all sides.
    let x0=10,x1=-10,y0=10,y1=-10;
    for(const it of items){const p=it.p||it.a,q=it.p||it.b,r=it.r||it.radius;
      x0=Math.min(x0,p[0]-r,q[0]-r);x1=Math.max(x1,p[0]+r,q[0]+r);
      y0=Math.min(y0,p[1]-r,q[1]-r);y1=Math.max(y1,p[1]+r,q[1]+r);}
    const sx=(w-10)/(x1-x0),sy=(w-10)/(y1-y0),tx=(id%4)*w+5,ty=(id>>2)*w+5;
    const px=x=>tx+(x-x0)*sx,py=y=>ty+(y1-y)*sy;
    items.sort((a,b)=>a.z-b.z);ctx.lineCap='round';
    for(const it of items){
      const pigment=(nx,ny,light)=>leafColor(nx,ny,flower?(it.petal?.64+.35*Math.min(1,light):.06+.34*Math.min(1,light)):light);
      if(it.p){
        const nx=it.n[0],ny=it.n[1],x=px(it.p[0]),y=py(it.p[1]),rx=it.r*sx,ry=it.w*sy,
          dx=Math.cos(it.angle),dy=Math.sin(it.angle),ux=dx*rx,uy=dy*rx,vx=-dy*ry,vy=dx*ry;
        ctx.fillStyle=pigment(nx,ny,it.shade);
        ctx.beginPath();ctx.moveTo(x-ux,y-uy);ctx.bezierCurveTo(x-.30*ux+vx,y-.30*uy+vy,x+.38*ux+vx,y+.38*uy+vy,x+ux,y+uy);
        ctx.bezierCurveTo(x+.40*ux-vx,y+.40*uy-vy,x-.35*ux-vx,y-.35*uy-vy,x-ux,y-uy);ctx.fill();
        if(rx>2.6){
          // A folded blade has two planes. Resolve their tonal split before building the mip chain.
          ctx.fillStyle=pigment(nx*.87-.045,ny*.88-.057,it.shade*(.855+.091*Math.abs(dy)));
          ctx.beginPath();ctx.moveTo(x-ux,y-uy);ctx.lineTo(x+.12*ux+.085*vx,y+.12*uy+.085*vy);
          ctx.lineTo(x+ux,y+uy);ctx.bezierCurveTo(x+.40*ux-vx,y+.40*uy-vy,x-.35*ux-vx,y-.35*uy-vy,x-ux,y-uy);ctx.fill();
        }
        if(rx>3.8){
          ctx.strokeStyle=pigment(nx*.88,Math.min(.96,ny+.07),it.shade*1.12);
          ctx.lineWidth=.34;ctx.beginPath();ctx.moveTo(x-.79*ux,y-.79*uy);ctx.lineTo(x+.59*ux,y+.59*uy);ctx.stroke();
        }
      }else{
        ctx.strokeStyle=pigment(-.22,.07,.29+Math.max(0,it.z)*.19);ctx.lineWidth=Math.max(.32,it.radius*sx);
        ctx.beginPath();ctx.moveTo(px(it.a[0]),py(it.a[1]));ctx.lineTo(px(it.b[0]),py(it.b[1]));ctx.stroke();
      }
    }
  }
  // Each tuft contains an intertwined foreground and rear layer of short blades,
  // peppered with broader dicot leaves and a few dry seed stalks.
  function grassTile(id){
    const tx=(id%4)*w,ty=(4+(id>>2))*w,stamp=.75+rand()*.25;
    const blades=[],clumps=19+(rand()*13|0),lean=range(-.24,.24);
    for(let h=0;h<clumps;h++){
      const z=range(0,1),x=range(18,238),y=range(179,247),
        height=(.62+.38*Math.sqrt(Math.max(0,1-((x-128)/115)**2)))*range(.65,1.05);
      for(let j=0;j<12;j++){
        const angle=range(-1,1),sx=x+range(-9,9),sy=y+range(-6,5),len=height*range(37,147),
          endX=sx+angle*range(14,63)+lean*len,endY=sy-len*(1-.38*Math.abs(angle)),
          dry=(id%5===0?.31:.07)+rand()*.1,
          alk=range(.45,.85)*(1-.21*(1-z)),rx=range(.51,1.58)*(dry>.29?.72:1);
        blades.push({sx,sy,ex:Math.max(4,Math.min(252,endX)),ey:Math.max(7,endY),rx,angle,s:alk,z:z+.12*rand(),dry});
      }
    }
    blades.sort((a,b)=>a.z-b.z);
    ctx.save();ctx.translate(tx,ty);ctx.rect(1,1,254,254);ctx.clip();
    for(const q of blades){
      const {sx,sy,ex,ey,rx,angle,s,dry,z}=q,bend=angle*9+lean*17,mx=(sx+ex)*.5-bend,my=sy+(ey-sy)*.69;
      const gr=ctx.createLinearGradient(sx,sy,ex,ey);
      gr.addColorStop(0,leafColor(angle*.7,z*.48-.34,s*.42));gr.addColorStop(.51,leafColor(angle*.64,.27,s*.94));
      gr.addColorStop(1,leafColor(angle*.47,.48,Math.min(1,s*(1.19+dry*.4))));
      ctx.fillStyle=gr;ctx.beginPath();ctx.moveTo(sx-rx,sy);ctx.quadraticCurveTo(mx-rx*.79,my,ex,ey);ctx.quadraticCurveTo(mx+rx*.83,my+1,sx+rx,sy);ctx.fill();
      if(dry>.29&&rx<1.18){
        ctx.strokeStyle=leafColor(angle*.21,.67,.77);ctx.lineWidth=.7;
        for(let k=0;k<6;k++){
          const u=k/6,px=ex+(mx-ex)*u*.24,py=ey+(my-ey)*u*.24;
          ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+(k%2?1:-1)*range(1.2,3.4),py-range(2.1,4.7));ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  for(let id=0;id<16;id++){tile(id);grassTile(id);}
  // Two periodic micro-heightfields describe the crowns of a forest seen from above
  // and the fissures of the granite beneath it. The normal channels retain the direction
  // of the low sun on distant slopes even as the geometric terrain becomes subpixel.
  function highlandFields(){
    const res=dim,mask=res-1,n=res*res,h=new Float32Array(n),pigment=new Float32Array(n),
      heights=new Float32Array(n),rocks=new Float32Array(n),out=new Uint8ClampedArray(n*4);
    function dome(x,z,rx,rz,base,amp,pig,a,bend){
      const bound=Math.ceil(Math.max(rx,rz)),c=Math.cos(a),s=Math.sin(a);
      for(let j=Math.floor(z)-bound;j<=z+bound;j++)for(let i=Math.floor(x)-bound;i<=x+bound;i++){
        const dx=i+.5-x,dz=j+.5-z,u=(dx*c+dz*s)/rx,v=(-dx*s+dz*c)/rz;
        const rad=u*u+v*v+.25*bend*u*v*v;if(rad>=1)continue;
        const top=base+amp*Math.sqrt(1-rad),k=(i&mask)+(j&mask)*res;
        if(top>h[k]){h[k]=top;pigment[k]=pig+rad*.04;}
      }
    }
    for(let k=0;k<2350;k++){
      const x=rand()*res,z=rand()*res,spread=range(8,24),ht=range(11,36),pig=range(.51,.92),
        dr=range(.76,1.3),az=rand()*6.283;
      dome(x,z,spread*.75,spread*dr*.7,ht*.31,ht*.72,pig*.90,az,.17);
      for(let j=0;j<8;j++){
        const a=j*2.39996+az,rad=spread*range(.22,.84),w=spread*range(.34,.69),b=ht*range(.26,.56);
        dome(x+Math.cos(a)*rad,z+Math.sin(a)*rad,w,w*range(.71,1.22),b,ht*range(.25,.56),pig*range(.82,1.14),a,range(-.9,.9));
      }
    }
    let grids=[];
    for(const period of [8,16,32,64,128]){
      const values=new Float32Array(period*period);for(let i=0;i<values.length;i++)values[i]=rand();
      grids.push([period,values]);
    }
    function noise(u,v,band){
      const m=grids[band][0],samples=grids[band][1],tx=u*m,ty=v*m,x=Math.floor(tx),y=Math.floor(ty);
      let dx=tx-x,dy=ty-y;dx=dx*dx*(3-2*dx);dy=dy*dy*(3-2*dy);const q=m-1;
      const a=samples[(x&q)+(y&q)*m]*(1-dx)+samples[((x+1)&q)+(y&q)*m]*dx;
      const b=samples[(x&q)+((y+1)&q)*m]*(1-dx)+samples[((x+1)&q)+((y+1)&q)*m]*dx;
      return a*(1-dy)+b*dy;
    }
    for(let z=0;z<res;z++)for(let x=0;x<res;x++){
      const k=x+z*res,j=k*4,nx=(h[((x-1)&mask)+z*res]-h[((x+1)&mask)+z*res])*.60,
        nz=(h[x+((z-1)&mask)*res]-h[x+((z+1)&mask)*res])*.60,inv=1/Math.hypot(nx,1,nz);
      let shade=1;
      for(const step of [3,7,13,23,37]){
        const ahead=h[((x+Math.round(.195*step))&mask)+((z-Math.round(.981*step))&mask)*res];
        shade=Math.min(shade,Math.max(.26,Math.min(1,1-(ahead-h[k]-.34*step)*.10)));
      }
      out[j]=128+124*nx*inv;out[j+1]=128+124*nz*inv;
      out[j+2]=Math.min(255,(.21+.76*shade)*(.22+.80*pigment[k])*255);out[j+3]=255;
      const u=x/res,v=z/res,warp=noise(u,v,0),low=noise(u+warp*.10,v,1),steps=noise(u,v,2),fine=noise(u,v,4);
      const strata=(v*.81+u*.19+warp*.038+low*.024)*121,breaks=1-Math.min(1,Math.abs(strata-Math.round(strata))*13);
      heights[k]=warp*33+low*14+steps*8+noise(u+steps*.017,v,3)*4.8+fine*1.7-breaks*4.9;
      rocks[k]=.48+warp*.22+low*.20+fine*.13-breaks*.23;
    }
    ctx.putImageData(new ImageData(out,res,res),dim,0);
    const bed=new Uint8ClampedArray(n*4);
    for(let z=0;z<res;z++)for(let x=0;x<res;x++){
      const k=x+z*res,nx=(heights[((x-1)&mask)+z*res]-heights[((x+1)&mask)+z*res])*.69,
        nz=(heights[x+((z-1)&mask)*res]-heights[x+((z+1)&mask)*res])*.69,inv=1/Math.hypot(nx,nz,1),j=k*4;
      bed[j]=128+124*nx*inv;bed[j+1]=128+124*nz*inv;bed[j+2]=Math.min(255,rocks[k]*255);bed[j+3]=255;
    }
    ctx.putImageData(new ImageData(bed,res,res),dim,dim);
  }
  highlandFields();
  let data=new Uint8Array(ctx.getImageData(0,0,dim*2,dim*2).data);
  const texture=device.createTexture({size:[dim*2,dim*2],mipLevelCount:12,format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  let width=dim*2,height=dim*2;
  for(let level=0;level<12;level++){
    device.queue.writeTexture({texture,mipLevel:level},data,{bytesPerRow:4*width},[width,height]);
    if(height===1)break;
    const nextW=Math.max(1,width>>1),nextH=height>>1,out=new Uint8Array(nextW*nextH*4);
    for(let y=0;y<nextH;y++)for(let x=0;x<nextW;x++){
      const j=4*(2*x+2*y*width),right=width>1?4:0,below=4*width;
      const a=data[j+3],b=data[j+right+3],c=data[j+below+3],d=data[j+below+right+3],sum=a+b+c+d,k=4*(x+y*nextW);
      if(sum)for(let ch=0;ch<3;ch++)out[k+ch]=(a*data[j+ch]+b*data[j+right+ch]+c*data[j+below+ch]+d*data[j+below+right+ch])/sum;
      out[k+3]=Math.min(255,sum*.255);
    }data=out;width=nextW;height=nextH;
  }
  return texture.createView();
}

// Tree sprays and blades occupy the same positions in every view. Only distant hillside impostors face the camera.
// Static positions store its centre. The normal attribute stores half extents and orientation.
function withCanopy(code){
  const vertex=/* wgsl */`
fn canopyOffset(m:mat4x4f,uv:vec2f,shape:vec3f)->vec3f{
 let right=normalize(vec3f(m[0][0],m[1][0],m[2][0]));let up=normalize(vec3f(m[0][1],m[1][1],m[2][1]));
 let co=cos(shape.z);let si=sin(shape.z);let a=(uv*2.-1.)*shape.xy;
 return right*(a.x*co-a.y*si)+up*(a.x*si+a.y*co);
}
fn canopyV(v:Vertex,id:vec2u,p0:vec3f,passId:i32)->Vary{
 var m=g.vp;if(passId==1){m=g.wide;}else if(passId==2){m=g.nearSun;}
 let turf=v.n.x<0.;let distant=v.n.z>8.;let traced=v.n.z< -8.;
 let code=u32(max(0.,-32.-v.n.z));let variation=f32(code&255u)/79.-1.6;
 let species=code>>16u;let azimuth=f32((code>>8u)&255u)*.02463994-v.posYaw.w;
 let seed=fract(sin(dot(v.p.xyz,vec3f(9.13,21.76,5.89)))*1628.16);
 let tintSeed=fract(sin(dot(v.posYaw.xz+v.p.xz,vec2f(1.38,3.76)))*1124.);
 let az=select(6.283*seed-v.posYaw.w,azimuth+2.17*(seed-.5)+variation,traced);
 let uvCode=floor(v.uv*.5);let uv=v.uv-2.*uvCode;
 let a=uv*2.-1.;let radius=vec2f(abs(v.n.x)*(v.size.x+v.size.z)*.5,v.n.y*v.size.y);
 let axis=vec3f(cos(az),0.,sin(az));let lateral=vec3f(-axis.z,0.,axis.x);
 let drooping=species==2u || species==5u;
 let inclination=select(.28+.66*tintSeed+.13*variation,-.50+.96*tintSeed+.2*variation,drooping);
 let incline=clamp(select(inclination,mix(.90,.998,seed),turf),-.88,.999);
 let advance=axis*sqrt(max(.001,1.-incline*incline))+vec3f(0.,incline,0.);
 let localFace=cross(lateral,advance);
 let twist=select((seed-.5)*2.51+.51*variation,.04*sin(az),turf);
 let across=cos(twist)*lateral+sin(twist)*localFace;
 let face=cross(across,advance);
 let folded=traced && max(abs(v.n.x),v.n.y)>.77;
 let fold=select(0.,.10+.32*tintSeed,folded);
 let sideStep=across*(a.x*cos(fold))+face*(abs(a.x)*sin(fold));
 let curl=(.11+.15*seed)*min(radius.x,radius.y)*a.x*a.y;
 let offset=radius.x*sideStep*(1.-.07*a.y)+advance*radius.y*a.y+face*curl;
 var normal=normalize(face+across*(-a.x*tan(fold)+a.y*.14)+advance*(a.y*.23-a.x*.15));
 let sway=vec3f(.048,0.,.027)*min(1.,v.p.y*.18+.24)*(.65+.35*uv.y);
 var rest=p0+offset;var priorRest=rest;
 if(distant){
   let shape=vec3f(radius,v.n.z-16.+sin(v.posYaw.w)*.34);
   rest=p0+canopyOffset(m,uv,shape);priorRest=p0+canopyOffset(g.prevVP,uv,shape);
   normal=normalize(vec3f(.48*sin(tintSeed*6.283),.86+.19*cos(p0.x*1.8),.48*cos(tintSeed*6.283)));
 }
 let phase=.33*p0.x+.21*p0.z+v.p.y*.21;
 let wp=rest+sway*sin(g.cam.w*1.21+phase);var pos=m*vec4f(wp,1.);
 if(passId==0){pos=vec4f(pos.xy+g.jitter.xy*pos.w,pos.zw);}
 let old=g.prevVP*vec4f(priorRest+sway*sin((g.cam.w-g.game.x)*1.21+phase),1.);
 let pack=u32(uvCode.x);let pack2=u32(uvCode.y);
 let open=vec4f(f32(pack&15u),f32((pack>>4u)&15u),f32((pack>>8u)&15u),f32((pack>>12u)&15u))/15.;
 let skyAccess=select(1.,f32(pack2&15u)/15.,traced);
 let localSun=yaw(sun,-sin(v.posYaw.w),cos(v.posYaw.w));
 let sunWeight=vec4f(max(0.,localSun.x),max(0.,-localSun.x),max(0.,localSun.z),max(0.,-localSun.z));
 let sunAccess=select(1.,dot(open,sunWeight)/max(.01,dot(sunWeight,vec4f(1.))),traced);
 if(turf){normal=normalize(normal*vec3f(.46,.12,.46)+vec3f(0.,1.,0.));}
 let localTint=.91+.17*fract(sin(dot(v.posYaw.xz,vec2f(.347,1.39)))*745.18);
 let clr=v.c*vec3f(localTint,1.,2.-localTint)*(.76+.24*skyAccess);
 return Vary(pos,wp,normal,clr,uv,vec2u(id.x+select(0u,32u,turf)+select(0u,64u,distant),id.y),vec4f(old.xy+g.jitter.zw*old.w,sunAccess,old.w));
}
`;
  const material=/* wgsl */`
@group(0) @binding(11) var canopyMap:texture_2d<f32>;
fn canopySample(uv:vec2f,id:u32)->vec4f{
 let distant=id>=191u;let turf=id>=159u && !distant;let variant=id-select(select(127u,159u,turf),191u,distant);let cell=vec2f(f32(variant%4u),f32(variant/4u)+select(0.,4.,turf));
 let dx=dpdx(uv)*vec2f(.125,-.125);let dy=dpdy(uv)*vec2f(.125,-.125);
 let major=max(length(dx),length(dy));let scale=min(.81,.010/max(.000001,major));
 let sample=textureSampleGrad(canopyMap,linearS,(cell+vec2f(uv.x,1.-uv.y))*.125,dx*scale,dy*scale);
 // At grazing incidence a spray occupies less than one sample in its
 // narrow direction. Integrate that coverage without fetching the neighbours of its atlas cell.
 let coverage=1.-smoothstep(.044,.171,major);
 return vec4f(sample.rgb,sample.a*coverage);
}
`;
  const shade=/* wgsl */`
 }else if((id>=127u && id<=142u) || (id>=159u && id<=174u) || (id>=191u && id<=206u)){
  let variant=i.ids.x;let l=canopySample(i.uv,variant);let turf=variant>=159u && variant<=174u;
  if(alphaCut && l.a<select(.395,.32,turf)){discard;}
  var clusterNormal=normalize(i.n);
  if(dot(clusterNormal,v)<0.){clusterNormal=-clusterNormal;}
  // The stored tangent-space normals follow the physical spray in the world, including its bend.
  let tx=dpdx(i.wp);let ty=dpdy(i.wp);let ux=dpdx(i.uv);let uy=dpdy(i.uv);
  let det=ux.x*uy.y-ux.y*uy.x;
  let tangent=tx*uy.y-ty*ux.y;
  let T=tangent*inverseSqrt(max(1.e-16,dot(tangent,tangent)))*sign(det);
  let B=cross(clusterNormal,T);
  let ns=(l.rg-vec2f(.5))*2.;
  n=normalize(clusterNormal*mix(.79,1.,abs(ns.x))+T*ns.x*.92+B*ns.y*.84);
  let flowering=variant>=140u && variant<=142u;
  var bladeLight=l.b;
  if(flowering){
    let petal=smoothstep(.33,.706,l.b);
    let foliageColor=linear(vec3f(.286,.382,.222))*(.90+.17*i.c.b);
    col=mix(foliageColor,col,petal);
    bladeLight=mix(clamp((l.b-.06)/.34,.32,.99),clamp((l.b-.64)/.35,.58,1.),petal);
  }
  let mottled=select(.21+1.49*bladeLight*bladeLight+.32*bladeLight,.47+1.04*bladeLight*bladeLight+.36*bladeLight,turf);
  let warm=smoothstep(.46,.83,bladeLight);
  col*=mottled*mix(vec3f(.96,1.00,.97),vec3f(1.064,1.025,.92),warm);
  if(variant>=191u){col*=.70;}occ=.47+.53*bladeLight;foliage=select(select(.97,.63,turf),.28,variant>=191u);rough=.90;

`;
  return code.replace('fn vert(v:Vertex',vertex+'\nfn vert(v:Vertex')
    .replace(' if(id.x==14u || id.x==16u)', ' if(id.x>=127u && id.x<=142u){return canopyV(v,id,p,passId);}\n if(id.x==14u || id.x==16u)')
    .replace('fn leafValue(uv:',material+'\nfn leafValue(uv:')
    .replace('fn shadowFs(i:Vary){','fn shadowFs(i:Vary){if(((i.ids.x>=127u && i.ids.x<=142u) || (i.ids.x>=159u && i.ids.x<=174u) || (i.ids.x>=191u && i.ids.x<=206u)) && canopySample(i.uv,i.ids.x).a<.37){discard;}')
    .replace('var directSpec=sunlight','if(!opaquePass && !glassPass && i.ids.x>=127u && i.ids.x<=142u){let through=max(0.,dot(-n,sun));color+=col*vec3f(1.13,1.10,.72)*sunlight*light*.42*through;}var directSpec=sunlight')
    .replace('let light=visibility(p,n,dist,group==0u);','var light=visibility(p,n,dist,group==0u); if(!opaquePass && !glassPass && i.ids.x>=127u && i.ids.x<=142u){light*=.53+.47*i.old.z;}')
    .replace('select(1.,.53,id==19u)','select(1.,.53,id==19u || (!opaquePass && !glassPass && i.ids.x>=191u && i.ids.x<=206u))')
    .replace(' }else if(id==14u){',shade+' }else if(id==14u){');
}
