// A cyclic detail tile stores overlapping blades and the albedo, relief and tilt of loose aggregate.
function worldVergeTile(device){
  const N=512,mask=N-1,texels=N*N;
  let seed=0x568ca290;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const grass=new Uint8Array(texels),pebbles=new Uint8Array(texels),slopes=new Uint8Array(texels),height=new Float32Array(texels);
  for(let i=0;i<texels;i++){grass[i]=39+rnd()*40;pebbles[i]=56+rnd()*49;slopes[i]=128;}
  // Small overlapping grass leaves are tapered and curved, and each blade casts a trace on the thatch underneath.
  for(let cl=0;cl<8200;cl++){
    const ox=rnd()*N,oy=rnd()*N,wind=.3*Math.sin(oy*.016)+.23*Math.cos(ox*.032),tone=.45+.55*rnd();
    const count=3+(rnd()*5|0);
    for(let k=0;k<count;k++){
      const a=wind+(rnd()-.5)*5.1,dx=Math.cos(a),dy=Math.sin(a),len=4.4+11*rnd(),bend=(rnd()-.5)*4.5,bright=51+tone*(59+105*rnd()),w=.45+.61*rnd();
      const xx=ox+(rnd()-.5)*2,yy=oy+(rnd()-.5)*2;
      for(let m=0;m<=len;m+=.66){
        const t=m/len,x=xx+dx*m-dy*bend*t*t,y=yy+dy*m+dx*bend*t*t,ix=Math.floor(x),iy=Math.floor(y);
        const lum=bright*(.62+.38*t),width=w*(1-t*.79);
        for(let by=-1;by<=1;by++)for(let bx=-1;bx<=1;bx++){
          const sx=ix+bx,sy=iy+by,d=Math.hypot(sx+.5-x,sy+.5-y),j=(sx&mask)+(sy&mask)*N,coverage=Math.max(0,Math.min(1,width+.58-d));
          if(coverage>0)grass[j]+=(lum-grass[j])*coverage*.87;
        }
      }
    }
  }
  // Elliptical stones overlap at randomized depths. Their facets and contact creases are baked before mip filtering.
  for(let k=0;k<14900;k++){
    const x=rnd()*N,y=rnd()*N,rx=1.35+rnd()**1.65*6.2,ry=rx*(.4+rnd()*.51),a=rnd()*6.283,c=Math.cos(a),s=Math.sin(a),
      albedo=68+rnd()**.72*131,base=rnd()*1.55,facet=(rnd()-.5)*.21,rad=Math.ceil(rx);
    for(let iy=Math.floor(y)-rad;iy<=y+rad;iy++)for(let ix=Math.floor(x)-rad;ix<=x+rad;ix++){
      const xx=ix+.5-x,yy=iy+.5-y,u=(c*xx+s*yy)/rx,v=(-s*xx+c*yy)/ry;
      const q=u*u+v*v+facet*Math.abs(u*v);if(q>=1)continue;
      const j=(ix&mask)+(iy&mask)*N,z=Math.sqrt(1-q)*ry*.9+base;
      if(z<height[j])continue;
      height[j]=z;const lit=.71+.27*Math.sqrt(1-q)-.235*(u*c-v*s)-.24*(u*s+v*c);
      pebbles[j]=Math.max(14,Math.min(245,albedo*lit*(.78+.22*Math.min(1,(1-q)*9))));slopes[j]=128+Math.min(112,Math.max(-112,(-u*c+v*s)*103));
    }
  }
  let data=new Uint8Array(texels*4);
  for(let i=0;i<texels;i++){data[i*4]=grass[i];data[i*4+1]=pebbles[i];data[i*4+2]=slopes[i];data[i*4+3]=Math.min(255,height[i]*35);}
  const tex=device.createTexture({size:[N,N],mipLevelCount:10,format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
  for(let level=0,size=N;size>0;level++,size>>=1){
    device.queue.writeTexture({texture:tex,mipLevel:level},data,{bytesPerRow:4*size},[size,size]);
    if(size===1)break;
    const next=size>>1,sm=new Uint8Array(next*next*4);
    for(let y=0;y<next;y++)for(let x=0;x<next;x++)for(let c=0;c<4;c++){
      const j=(x*2+y*2*size)*4+c;
      sm[(x+y*next)*4+c]=(data[j]+data[j+4]+data[j+size*4]+data[j+size*4+4]+2)>>2;
    }
    data=sm;
  }
  return tex.createView();
}

// Trackside material layers. Distances are in metres; derivatives gently integrate subpixel grains.
// Four periodic maps share one texture. The two materials carry diffuse pigment and
// tangent-space relief from their own height fields so their illumination follows the sun.
function createWoodlandMaps(device){
  const size=512,mask=size-1,n=size*size;
  let seed=0x14bc7219;
  const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  const range=(a,b)=>a+(b-a)*random();
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const grids=[4,8,16,32,64,128].map(side=>({side,v:Float32Array.from({length:side*side},random)}));
  function noise(x,y,band,vertical=1){
    const {side,v}=grids[band],m=side-1,my=side*vertical-1,px=x*side/size,py=y*side*vertical/size,ix=Math.floor(px),iy=Math.floor(py);
    let u=px-ix,t=py-iy;u=u*u*(3-2*u);t=t*t*(3-2*t);
    return (v[(ix&m)+(iy&my)*side]*(1-u)+v[((ix+1)&m)+(iy&my)*side]*u)*(1-t)+
      (v[(ix&m)+((iy+1)&my)*side]*(1-u)+v[((ix+1)&m)+((iy+1)&my)*side]*u)*t;
  }
  const height=new Float32Array(n),base=new Float32Array(n*3);
  function polygonLeaf(cx,cy,a,length,width,lift,rgb){
    const c=Math.cos(a),s=Math.sin(a),r=Math.ceil(length+width*.5+1),curl=range(-.34,.34),tip=range(.01,.43);
    const floor=height[(Math.floor(cx)&mask)+(Math.floor(cy)&mask)*size];
    for(let y=Math.floor(cy)-r;y<=cy+r;y++)for(let x=Math.floor(cx)-r;x<=cx+r;x++){
      const dx=x+.5-cx,dy=y+.5-cy,u=(dx*c+dy*s)/length;
      if(Math.abs(u)>=1)continue;
      const v=((dy*c-dx*s)/width-curl*u*u),edge=Math.max(.01,(1-u*u)*(.93+.12*u));
      if(Math.abs(v)>edge)continue;
      const k=(x&mask)+(y&mask)*size,vein=(1-clamp(Math.abs(v)*7,0,1))*(1-u*u),e=Math.abs(v)/edge;
      const z=floor+lift*(.31+.41*(1-e)+tip*u+curl*v+.13*vein+.12*(1-u*u));
      if(z<=height[k])continue;
      height[k]=z;
      const tooth=.5+.5*Math.cos((Math.abs(v)*.55-u)*26.1);
      const lit=.84+.18*(1-e)+.13*vein+.055*tooth+.09*v;
      for(let ch=0;ch<3;ch++)base[k*3+ch]=rgb[ch]*lit;
    }
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const k=x+y*size,lo=noise(x,y,1),crumb=noise(x,y,5),grain=random();
    const moss=clamp((.49*lo+.33*noise(x,y,2)+.18*crumb-.46)*3.5,0,1);
    height[k]=1.7*lo+.80*crumb+.43*grain+1.15*moss;
    const v=.49+.37*crumb+.31*grain+.21*lo;
    base[3*k]=(107-17*moss)*v;base[3*k+1]=(85+19*moss)*v;base[3*k+2]=(57+7*moss)*v;
  }
  for(let j=0;j<3350;j++){
    const x=random()*size,y=random()*size,wet=noise(x,y,1);
    const age=random(),length=range(3.2,13.0),color=age>.78?[168,136,77]:age>.53?[137,102,61]:age>.31?[91,74,46]:[73,66,45];
    const dye=range(.70,1.28)*(.91+.16*wet);
    polygonLeaf(x,y,random()*6.283,length,length*range(.23,.55),range(.7,2.0),color.map(c=>c*dye));
  }
  for(let b=0;b<263;b++){
    const x=random()*size,y=random()*size,length=range(4.1,34),angle=random()*6.28,curve=range(-.75,.75),wide=range(.38,1.38),pig=range(65,116);
    const z=height[(x|0)+size*(y|0)]+range(1.1,2.2);
    for(let d=0;d<length;d+=.41){
      const t=d/length,a=angle+curve*t,px=x+Math.cos(a)*d,py=y+Math.sin(a)*d,rad=wide*(1.01-.6*t);
      for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const ux=(px|0)+ox,uy=(py|0)+oy,delta=Math.hypot(ux+.5-px,uy+.5-py);
        if(delta>rad)continue;
        const k=(ux&mask)+(uy&mask)*size,ht=z+rad-delta;
        if(height[k]>=ht)continue;
        height[k]=ht;const l=pig*(1.05-.23*delta);
        base[k*3]=l;base[k*3+1]=l*.83;base[k*3+2]=l*.66;
      }
    }
  }
  function layers(boost){
    const albedo=new Uint8Array(n*4),normal=new Uint8Array(n*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const k=x+y*size,j=k*4,c=height[k];
      const hx=(height[((x-1)&mask)+size*y]-height[((x+1)&mask)+size*y])*boost;
      const hy=(height[x+size*((y-1)&mask)]-height[x+size*((y+1)&mask)])*boost;
      const inv=1/Math.hypot(hx,hy,1),cover=Math.max(0,(height[((x+1)&mask)+size*((y-3)&mask)]-c)*.8,(height[((x-3)&mask)+size*((y+1)&mask)]-c)*.67);
      const ao=1-.21*Math.min(1,cover*.62);
      for(let ch=0;ch<3;ch++)albedo[j+ch]=clamp(base[k*3+ch]*ao,0,255);
      albedo[j+3]=255;
      normal[j]=127.5+127*hx*inv;normal[j+1]=127.5+127*hy*inv;normal[j+2]=127.5+127*inv;normal[j+3]=255;
    }
    return [albedo,normal];
  }
  const maps=layers(.56);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const k=x+y*size,low=noise(x,y,0),wave=noise(x,y,1),chips=noise(x,y,5);
    const warp=(low-.5)*41+(wave-.5)*11+(noise(x,y,2)-.5)*5;
    const xx=x+warp,groove=noise(xx,y,4,.25),coarse=noise(xx,y,2,.5);
    const stitch=.56+.44*Math.sin(2*Math.PI*(17*xx/size+.36*wave+.19*noise(x,y,2)));
    const broken=clamp((coarse-.28)*3,0,1),crack=Math.max(0,Math.min(1,(stitch-.67)*4))*broken;
    const split=clamp((groove-.56)*4,0,1);
    const fleck=noise(x+17,y,3),lichen=clamp((.37*low+.38*fleck+.25*chips-.56)*6.4,0,1);
    height[k]=1.9*low+1.41*groove+1.5*chips-4.4*crack-1.81*split;
    const light=(.55+.40*groove+.25*chips+.22*coarse)*(1-.48*crack-.17*split);
    base[k*3]=119*light+lichen*12;base[k*3+1]=104*light+lichen*24;base[k*3+2]=85*light+lichen*18;
  }
  maps.push(...layers(.91));
    // Build an orthographic view of an interlocking sward in metres. The same
  // height field supplies the normals where the camera looks between stems.
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const k=x+y*size,lo=noise(x,y,1),grain=random();
    const z=2.7*noise(x,y,3)+1.2*grain;
    height[k]=z;
    const m=.56+.43*lo+.27*grain;
    base[k*3]=89*m;base[k*3+1]=84*m;base[k*3+2]=56*m;
  }
  for(let shoot=0;shoot<7750;shoot++){
    const x=random()*size,y=random()*size,drift=noise(x,y,1),coarse=noise(x,y,2),
      yaw=drift*5.5+coarse*1.3,colour=range(.78,1.23);
    const count=3+(random()*5|0);
    for(let j=0;j<count;j++){
      const a=yaw+range(-2.65,2.65),dx=Math.cos(a),dy=Math.sin(a),
        len=range(4.8,16.9),w0=range(.48,1.69),bend=range(-.27,.32)*len,
        z0=range(.2,1.5)+2.1*coarse,lift=range(2.3,9.0),dry=random()<.14+.22*drift,
        shade=colour*range(.74,1.19),rr=(dry?148:87)*shade,gg=(dry?128:110)*shade,bb=(dry?73:54)*shade;
      for(let d=0;d<len;d+=.72){
        const t=d/len,grow=t*(1.-.60*t),px=x+dx*d-dy*bend*t*t,py=y+dy*d+dx*bend*t*t,
          radius=w0*(.39+.80*Math.sin((.1+.84*t)*Math.PI))*(1.-.44*t);
        const xmin=Math.floor(px-radius),xmax=Math.ceil(px+radius),ymin=Math.floor(py-radius),ymax=Math.ceil(py+radius);
        for(let iy=ymin;iy<=ymax;iy++)for(let ix=xmin;ix<=xmax;ix++){
          const u=ix+.5-px,v=iy+.5-py,across=(-dy*u+dx*v)/radius,dd=u*u+v*v;
          if(dd>=radius*radius)continue;
          const k=(ix&mask)+(iy&mask)*size,z=z0+grow*lift+(1.-Math.abs(across))*.81;
          if(height[k]>z)continue;
          height[k]=z;const light=(.59+.65*t+.15*(1.-Math.abs(across)))*(1.+.145*across);
          base[k*3]=rr*light;base[k*3+1]=gg*light;base[k*3+2]=bb*light;
        }
      }
    }
  }
  maps.push(...layers(.80));
  const tex=device.createTexture({size:[size,size,6],mipLevelCount:10,format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  for(let layer=0;layer<6;layer++){
    let src=maps[layer],side=size;
    for(let level=0;level<10;level++){
      device.queue.writeTexture({texture:tex,mipLevel:level,origin:[0,0,layer]},src,{bytesPerRow:side*4},[side,side]);
      if(side===1)break;
      const m=side>>1,dst=new Uint8Array(m*m*4);
      for(let y=0;y<m;y++)for(let x=0;x<m;x++){
        const o=4*(x+y*m),p=4*(x*2+y*2*side);
        for(let c=0;c<4;c++)dst[o+c]=Math.round((src[p+c]+src[p+4+c]+src[p+4*side+c]+src[p+4*side+4+c])*.25);
      }
      src=dst;side=m;
    }
  }
  return tex.createView({dimension:'2d-array'});
}

const brakingBoardMaterial=114;
const worldMaterialsWGSL = /* wgsl */`
 if(id==${brakingBoardMaterial}u){
   let three=i.uv.x>1.5;let plate=vec2f(fract(i.uv.x),i.uv.y);
   let q=(plate-.5)*vec2f(1.33,.63)/.414;
   var digit=0;var center=select(.335,.665,three);
   if(three && q.x<-.32){digit=1;center=-.665;}
   else if(three && q.x<.33){center=0.;}
   else if(!three && q.x<0.){digit=5;center=-.335;}
   let uv=q-vec2f(center,0.);var dst=2.;
   if(digit==0){
     let edge=abs(uv)-vec2f(.021,.206);
     dst=abs(length(max(edge,vec2f(0.)))+min(max(edge.x,edge.y),0.)-.211)-.067;
   }else{
     // Smooth optical outlines for the DIN-style '5' and the flag of the '1'.
     // Explicit constants avoid Naga folding these arrays during override resolution.
     const five=array<vec2f,15>(vec2f(.218,.427),vec2f(-.171,.427),vec2f(-.197,.027),vec2f(-.094,.093),
       vec2f(.008,.114),vec2f(.106,.102),vec2f(.183,.053),vec2f(.225,-.026),vec2f(.236,-.143),
       vec2f(.223,-.273),vec2f(.181,-.363),vec2f(.107,-.421),vec2f(.008,-.441),vec2f(-.108,-.420),vec2f(-.210,-.343));
     const one=array<vec2f,3>(vec2f(-.177,.262),vec2f(.035,.428),vec2f(.035,-.445));
     var prev=select(five[0],one[0],digit==1);
     let steps=select(15,3,digit==1);
     for(var k=1;k<steps;k++){
       let pt=select(five[k],one[min(2,k)],digit==1);let d=pt-prev;
       let t=clamp(dot(uv-prev,d)/dot(d,d),0.,1.);dst=min(dst,length(uv-prev-d*t)-.065);prev=pt;
     }
   }
   let aa=max(.0012,fwidth(dst)*.60);let ink=1.-smoothstep(-aa,aa,dst);
   let patina=groundNoise(p.xy+p.zy*.8,.37).r;
   col=mix(linear(vec3f(.858,.845,.747))*(.94+.11*patina),linear(vec3f(.098,.122,.110)),ink);
   rough=.71;
 }
 if(id==11u || id==48u){
   let axes=abs(n);
   let face=select(select(p.zy,p.xy,axes.z>axes.x),p.xz,axes.y>max(axes.x,axes.z));
   let casting=groundNoise(face,.118);let grains=groundNoise(face,.96);
   let pores=smoothstep(.57,.80,grains.a*.6+grains.g*.4);
   col=linear(i.c)*(.85+.27*casting.r+.145*(grains.b-.5)-pores*.14);
   if(id==48u){
     let uv=i.uv;
     let dirty=smoothstep(.39,.66,casting.r*.64+grains.r*.36);
     let foot=exp(-max(0.,uv.y)*3.5);
     let runoff=groundNoise(vec2f(face.x*.295,face.y*.048),1.).r;
     col*=1.-.20*foot-.185*foot*dirty-.115*smoothstep(.5,.66,runoff)*dirty;
     let plug=length(vec2f(abs(uv.x-1.5)-.82,uv.y-.58));
     col*=.64+.36*smoothstep(.011,.028+fwidth(plug)*.58,plug);
     let scuffY=.34+.045*sin(face.x*.59)+casting.g*.048;
     let scuff=exp(-pow((uv.y-scuffY)/.027,2.))*smoothstep(.48,.65,casting.r*.77+grains.b*.23);
     col*=1.-.43*scuff;
   }
   rough=.91;
 }
 if(id==61u || id==62u || id==63u){
   let axis=abs(n);let face=select(select(p.zy,p.xy,axis.z>axis.x),p.xz,axis.y>max(axis.x,axis.z));
   let field=groundNoise(face,.11);let grit=groundNoise(face,1.29);
   let stains=groundNoise(face*vec2f(1.,.072)+field.r*.061,.56);
   let h=p.y-(3.1*sin(p.z*.016)+1.5*sin((p.x+p.z)*.020)+2.7*sin(p.x*.015)-1.5);
   let rising=exp(-max(0.,h-.2)*1.2);
   let percolation=smoothstep(.42,.73,stains.r*.65+field.g*.35);
   if(id==61u){
     let salt=smoothstep(.48,.73,field.r+grit.b*.093)*rising;
     col=linear(i.c)*(.69+.35*field.g+.21*grit.r-.26*percolation)*(.98-.32*rising);
     col=mix(col,vec3f(.177,.149,.108),salt*.48);
     let leak=groundNoise(vec2f(face.x*.64,face.y*.022),.84).r;
     col*=1.-.14*smoothstep(.57,.70,leak)*smoothstep(.22,.80,field.g);rough=.90;
   }else if(id==62u){
     let joint=face*vec2f(4.16,11.6);
     let course=floor(joint.y);let uv=vec2f(joint.x+fract(course*.5),joint.y);
     let edge=abs(fract(uv)-.5);
     let grout=smoothstep(.431,.489,max(edge.x,edge.y)+.025*(grit.g-.5));
     let brick=hash(floor(uv));
     let clay=mix(linear(vec3f(.462,.285,.202)),linear(vec3f(.652,.430,.294)),brick);
     col=mix(clay*(.68+.47*grit.r+.22*field.g),linear(vec3f(.562,.519,.431))*(.80+.26*field.r),grout);
     col*=1.-.21*percolation-.14*rising;rough=.90;
   }else{
     let slat=.5+.5*cos(h*70.35);let abrasion=smoothstep(.49,.69,field.g*.57+grit.a*.43);
     let dust=smoothstep(.48,.68,stains.g)*rising;
     col=linear(i.c)*(.69+.23*slat+.20*field.r+.16*grit.a);
     col=mix(col,linear(vec3f(.472,.388,.301)),dust*.29+abrasion*rising*.17);
     rough=.44+.21*dust;
   }
 }
 if(id==47u){
   let vertical=smoothstep(.03,.22,i.uv.y)*(1.-smoothstep(.85,.99,i.uv.y));
   let interior=groundNoise(p.zy*.10+v.zy*.27,1.).r;
   let skyView=reflect(-v,n);
   var glazing=skyColor(skyView);
   if(!probeMode){glazing=environment(skyView,.105);}
   let fresnel=.10+.64*pow(1.-max(0.,dot(n,v)),3.);
   col=linear(vec3f(.15,.185,.165))*(.69+interior*.68)*vertical;
   emit=glazing*fresnel*vec3f(.77,.90,.89);rough=.24;
 }
 if(id==119u){
   let sheet=groundNoise(i.uv*vec2f(.18,1.1),1.);
   let crystals=groundNoise(i.uv*vec2f(2.31,2.65),1.);
   let drip=groundNoise(vec2f(i.uv.x*.51+.028*sheet.r,i.uv.y*.13),1.);
   let oxidation=smoothstep(.47,.73,sheet.r*.56+drip.g*.44);
   col*=.73+.38*sheet.r+.14*crystals.a;
   col=mix(col,col*vec3f(.76,.73,.63),oxidation*.42);
   rough=.39+.14*oxidation+.09*crystals.g;metal=.73;
 }
 if(id==51u){
   let rockN=normalize(n);let powers=pow(abs(rockN),vec3f(3.));
   let sides=powers/dot(powers,vec3f(1.));
   let uvX=vec2f(p.z+.31*p.y,p.y-.20*p.z)*.076;
   let uvY=vec2f(p.x-.29*p.z,p.z+.19*p.x)*.082;
   let uvZ=vec2f(p.x+.21*p.y,p.y-.31*p.x)*.073;
   let rx=groundNoise(uvX,1.);
   let ry=groundNoise(uvY,1.);
   let rz=groundNoise(uvZ,1.);
   let relief=rx*sides.x+ry*sides.y+rz*sides.z;
   let dir=vec2f(.682,-.731);let uv=vec2f(dot(p.xz,dir)+.28*p.y, p.y*.94+dot(p.xz,dir.yx)*.331);
   let coarse=groundNoise(uv*.130,1.);let chipped=groundNoise(uv*.427+coarse.r*.032,1.);
   let crystal=groundNoise(uv*2.36+chipped.r*.061,1.);
   let stain=groundNoise(vec2f(uv.x*.155,p.y*.026)+vec2f(coarse.r*.083,.15),1.).r;
   let sheetCoord=dot(p,vec3f(.215,.564,-.183))+.26*coarse.r+.114*chipped.r;
   let joint=abs(fract(sheetCoord)-.5);
   let jointEdge=(1.-smoothstep(.004,.040+fwidth(sheetCoord)*.5,joint))*smoothstep(.38,.59,relief.r);
   let run=textureSample(vergeAtlas,linearS,vec2f(uv.x*.103 + p.y*.021,uv.y*.101)+vec2f(coarse.r*.021)).g;
   let feldspar=textureSample(vergeAtlas,linearS,vec2f(uv.x*.544+.138*uv.y,uv.y*.493)+vec2f(coarse.r*.04)).g;
   let inclusion=smoothstep(.44,.64,relief.r*.37+run*.38+chipped.r*.25);
   let mineral=clamp((feldspar-.24)*1.74,0.,1.);
   let sheetFace=clamp((chipped.r-.5)*2.58+.58,0.,1.);
   let weather=smoothstep(.37,.62,stain*.58+coarse.r*.26+relief.r*.16);
   let mica=smoothstep(.53,.72,crystal.a*.49+feldspar*.51);
   let quartz=1.-smoothstep(.006,.017+fwidth(sheetCoord)*.38,
       abs(fract(dot(p,vec3f(.283,-.371,.337))+.081*chipped.r+.164*coarse.r)-.5));
   let grey=linear(i.c)*mix(vec3f(1.24,1.07,.91),vec3f(.69,.70,.71),weather);
   var lithic=grey*(.33+.49*sheetFace+.41*mineral+.48*inclusion);
   lithic=mix(lithic,linear(vec3f(.58,.557,.491))*(.56+.71*mineral),quartz*.33*smoothstep(.43,.70,relief.r));
   let moisture=smoothstep(.44,.69,stain*.47+chipped.r*.32+run*.21)*(.47+.53*(1.-max(0.,rockN.y)));
   let lichen=smoothstep(.43,.68,relief.r*.44+run*.33+chipped.r*.23)*smoothstep(-.47,.68,rockN.y);
   col=mix(lithic,linear(vec3f(.341,.365,.259))*(.31+.93*mineral+.50*run),lichen*.86);
   col*=1.-jointEdge*.65-.28*moisture-.25*mica;
   let footing=(1.-smoothstep(.56,.94,i.uv.x))*smoothstep(.32,.62,run*.47+stain*.53);
   col=mix(col,linear(vec3f(.182,.214,.133))*(.49+mineral),footing*.62);
   // Convert millimetric relief slopes to a surface gradient in world space.
   let height=.061*sheetFace+.031*inclusion+.013*mineral+.0047*feldspar-.009*jointEdge;
   let dx=dpdx(p);let dy=dpdy(p);let tx=cross(dy,rockN);let ty=cross(rockN,dx);
   let det=dot(dx,tx);
   n=normalize(rockN*max(.00000001,abs(det))-sign(det)*(dpdx(height)*tx+dpdy(height)*ty));
   occ=mix(.40,1.,i.uv.x)*(.78+.22*inclusion);rough=.90+.08*moisture;
 }
 if(isRoad && abs(i.uv.x)>5.60 && abs(i.uv.x)<5.91){
   let bitumen=groundNoise(p.xz,.17);let sharp=groundNoise(p.xz,1.12);
   let tornLip=5.842+(bitumen.r-.5)*.209+(sharp.r-.5)*.071;
   let approach=smoothstep(tornLip-.050,tornLip+.052,abs(i.uv.x));
   let exposed=smoothstep(.35,.70,sharp.g*.68+sharp.a*.32);
   let filler=linear(vec3f(.415,.384,.318))*(.67+.75*sharp.g);
   col=mix(col,filler,approach*(.14+.65*exposed));
 }
 if(id==12u){
   let u=i.uv;
   let swell=groundNoise(p.xz,.024); let drift=groundNoise(p.xz+vec2f(swell.r*1.9),.103);
   let ochre=clamp((drift.r*.62+swell.r*.38-.40)*4.,0.,1.);
   let grey=linear(vec3f(.435,.429,.382)); let sand=linear(vec3f(.71,.63,.48));
   let bas=mix(grey,sand,ochre); let fine=groundNoise(p.xz,.27);
   let coarse=groundNoise(p.xz,.116);
   let ridges=cos((u.x+.085*drift.r+.031*sin(u.y*.12))*25.5)*.5+.5;
   let gran=.46+fine.a*.53+fine.g*.63; let grit=coarse.a*.68+coarse.g*.32;
   let scraped=smoothstep(.44,.70,swell.r*.57+drift.g*.43);
   col=mix(bas,linear(vec3f(.413,.365,.284)),scraped*.41)
       *(.54+grit*.67+drift.r*.28)*mix(.86,gran,.77)*(.94+.085*ridges);
   let gravelTex=textureSample(vergeAtlas,linearS,p.xz*.62+vec2f(drift.r*.043,0.));
   col*=.43+1.23*gravelTex.g;
   n=normalize(n+vec3f((gravelTex.b-.5)*.81,0.,(gravelTex.a-.46)*.41)+vec3f(fine.g-.5,0.,fine.a-.5)*.68+
     vec3f(coarse.r-.5,.03,coarse.a-.5)*.39);rough=.94;
   if(i.c.b>.95){
     let torn=(coarse.r-.5)*.13+(fine.a-.46)*.065;
     let ballast=smoothstep(.015,.19,i.uv.x-5.9+torn);
     col=mix(linear(vec3f(.236,.240,.232))*(.67+.44*gravelTex.g+.25*drift.r),col,ballast);
   }
 }
 let ecotone=id==12u && i.c.b>.95 && i.uv.y> -2.2;
 if(id==13u || ecotone){
   let mineral=col;let mineralN=n;
   let u=p.xz;
   let area=groundNoise(u,.0104);
   let meadow=groundNoise(u+vec2f(area.r*8.7,area.g*6.1),.046);
   let clump=groundNoise(u+vec2f(meadow.r*.73),.271);
   let blade=groundNoise(vec2f(u.x*1.9+u.y*.79,u.y*.51-u.x*.16)+clump.r*.06,1.);
   let dryness=smoothstep(.29,.73,area.r*.53+meadow.r*.31+clump.r*.16);
   let field=(u-vec2f(68.,-155.))/vec2f(107.,59.);
   let meadowCover=smoothstep(.04,.94,1.-dot(field,field));
   let lawn=mix(mix(linear(vec3f(.275,.335,.219)),linear(vec3f(.425,.435,.303)),dryness),
       mix(linear(vec3f(.398,.408,.254)),linear(vec3f(.550,.491,.296)),clump.r),meadowCover*.94);
   let turfCover=clump.r*.52+meadow.r*.31+area.r*.17;
   let wear=smoothstep(.51,.69,turfCover);
   let sprigs=.77+clump.r*.36+blade.g*.27;
   let grainUV=vec2f(dot(u,vec2f(.220,.156)),dot(u,vec2f(-.156,.220)));
   let lawnUV=grainUV+vec2f(meadow.r*.23,area.r*.14);
   let fibre=textureSample(vergeAtlas,linearS,lawnUV).r;
   let strawFibre=textureSample(vergeAtlas,linearS,vec2f(u.y*.477-u.x*.112,u.x*.406+u.y*.134)+.318*clump.r).r;
   let turfUV=vec2f(dot(u,vec2f(.282,.137)),dot(u,vec2f(-.137,.282)))+vec2f(clump.r*.055,area.r*.029);
   let lawnDetail=textureSample(woodlandMaps,linearS,turfUV,4).rgb;
   let turfNormal=textureSample(woodlandMaps,linearS,turfUV,5).xy*2.-1.;
   let thatch=max(fibre*.87,strawFibre*.75);
   col=mix(lawn,linear(vec3f(.413,.382,.282)),wear*.51)*sprigs*(.57+.96*fibre+.36*strawFibre);
   let grassLuma=dot(lawnDetail,vec3f(.31,.57,.12));
   let grassTint=clamp(lawnDetail/(grassLuma+.001),vec3f(.58),vec3f(1.47));
   col*=mix(vec3f(1.),grassTint,.37)*(.19+grassLuma*2.92);
   col=mix(col,col*vec3f(1.20,1.10,.79),smoothstep(.43,.65,thatch)*dryness);
   let border=smoothstep(7.,24.,i.uv.x+(meadow.r-.5)*7.);
   let detritus=smoothstep(.35,.66,meadow.r*.30+area.r*.41+clump.r*.29);
   let moss=linear(vec3f(.257,.329,.183))*(.61+.66*clump.r+.48*fibre);
   let forestUV=(p.xz+vec2f(156.,249.))/490.;
   let shadeField=textureSampleLevel(forestIrradiance,isotropic,forestUV,0.).r;
   let underTrees=smoothstep(.21,.72,shadeField)*smoothstep(9.,16.,i.uv.x+.82*(meadow.r-.5));
   let litterUV=vec2f(u.x*.221+u.y*.079,u.y*.221-u.x*.079)+vec2f(meadow.r*.094,area.r*.063);
   let leafBed=textureSample(woodlandMaps,linearS,litterUV,0).rgb;
   let leafNormal=textureSample(woodlandMaps,linearS,litterUV,1).rg*2.-1.;
   let cover=smoothstep(.31,.63,.55*detritus+.31*clump.r+.25*area.r)*underTrees;
   let loam=clamp((leafBed-vec3f(.34,.28,.19))*1.57+vec3f(.35,.283,.19),vec3f(.063),vec3f(.91));
   let leaves=linear(loam)*(.62+.51*meadow.r+.51*clump.r);
   col=mix(col,moss*mix(.97,.70,underTrees),border*.64*(1.-.87*meadowCover));
   col=mix(col,leaves,clamp(border*(.12+.48*underTrees) + cover*.89,0.,1.));
   let up=select(n,normalize(i.n),ecotone);
   let turfSlope=vec3f(.900*turfNormal.x-.437*turfNormal.y,0.,.437*turfNormal.x+.900*turfNormal.y);
   n=normalize(up+vec3f(clump.r-.5,0.,blade.g-.5)*.31+turfSlope*(.68-cover*.41)+vec3f(leafNormal.x,0.,leafNormal.y)*cover*.74);
   rough=.94;
   if(ecotone){
     let drift=groundNoise(p.xz*.12+vec2f(meadow.r*.12),1.);
     let grain=textureSample(vergeAtlas,linearS,p.xz*.62).g;
     let creep=(meadow.r-.50)*2.2+(drift.g-.50)*1.24+(fibre-.38)*1.48+(grain-.52)*.53;
     let mixSoil=smoothstep(-.85,.98,i.uv.y+creep);
     let mixPlants=smoothstep(-.27,.58,i.uv.y+creep);
     let rooted=mix(mineral,col*.77,mixSoil);
     col=mix(rooted,col,mixPlants);n=normalize(mix(mineralN,n,mixPlants));
   }
 }
 if(id==19u){
   let slopeN=normalize(select(i.n,-i.n,i.n.y<0.));
   let warp=groundNoise(p.xz*.00091,1.).r;
   let groveDensity=groundNoise(p.xz*.00175+vec2f(.217,.156)*warp+vec2f(.082,-.035)*p.y*.003,1.).r;
   let catchment=groundNoise(vec2f(dot(p.xz,vec2f(.63,-.86))*.0016,p.y*.0029)+vec2f(.053,-.164)*groveDensity,1.).r;
   let gUV=vec2f(dot(p.xz,vec2f(.86,.51))*.0037,p.y*.0045+dot(p.xz,vec2f(-.51,.86))*.0048);
   let secondUV=vec2f(dot(p.xz,vec2f(.287,-.958))*.0073,p.y*.005+dot(p.xz,vec2f(.958,.287))*.0068);
   let u1=gUV+vec2f(warp*.344,groveDensity*.267);let u2=secondUV+vec2f(groveDensity*.187,warp*.308);
   let crownA=textureSampleGrad(canopyMap,isotropic,vec2f(.5,0.)+fract(u1)*.5,dpdx(u1)*.5,dpdy(u1)*.5);
   let crownB=textureSampleGrad(canopyMap,isotropic,vec2f(.5,0.)+fract(u2)*.5,dpdx(u2)*.5,dpdy(u2)*.5);
   let veil=smoothstep(.32,.71,groveDensity*.61+catchment*.39);
   let canopy=mix(crownA,crownB,.16+.70*veil);
   let weatherUV=vec2f(dot(p.xz,vec2f(.27,.96))*.014,(p.y+.18*p.z)*.0103);
   let rockTex=textureSampleGrad(canopyMap,isotropic,vec2f(.5,.5)+fract(weatherUV+groveDensity*.138)*.5,dpdx(weatherUV)*.5,dpdy(weatherUV)*.5);
   let drained=clamp(i.uv.y,0.,1.);let steep=clamp((1.-slopeN.y)*3.,0.,1.);
   let ledge=smoothstep(.18,.77,i.uv.x*.87+.14*steep);
   let open=smoothstep(.28,.88,ledge*(.70+.44*catchment)+.16*steep*veil);
   let crownDepth=smoothstep(.25,.73,canopy.b*.67+crownB.b*.14+groveDensity*.19);
   let mottled=groundNoise(vec2f(dot(p.xz,vec2f(.43,.91))*.012,p.y*.0091+dot(p.xz,vec2f(.91,-.43))*.0097),1.).r;
   let forest=mix(linear(vec3f(.136,.221,.166)),linear(vec3f(.372,.407,.274)),veil)*
     (.44+.46*crownDepth+.30*groveDensity+.21*mottled);
   let dry=mix(linear(vec3f(.426,.423,.397)),linear(vec3f(.572,.537,.470)),rockTex.b);
   let seep=mix(linear(vec3f(.189,.224,.207)),linear(vec3f(.313,.307,.275)),catchment);
   let rock=mix(dry,seep,clamp(drained*.74+.21*groveDensity,0.,1.))*(.76+.38*rockTex.b);
   let cn=(canopy.rg-.5)*2.;let rn=(rockTex.rg-.5)*2.;
   let crownN=normalize(slopeN+vec3f(cn.x,.22*cn.y,cn.y)*(.20+.15*veil));
   let roughRock=groundNoise(vec2f(dot(p.xz,vec2f(.383,.923))*.027,p.y*.029+dot(p.xz,vec2f(.923,-.383))*.0061),1.);
   let bedN=normalize(slopeN+vec3f(rn.x,.16*rn.y,rn.y)*.42+vec3f(roughRock.g-.5,.23*(roughRock.r-.5),roughRock.a-.5)*.81);
   n=normalize(mix(crownN,bedN,open));col=mix(forest,rock*(.54+.66*rockTex.b+.27*roughRock.r),open);
   occ=mix(.72+.17*canopy.b+.09*groveDensity,.94,open);foliage=(1.-open)*.28;rough=.95;
 }
 if(id==22u || id==24u){
   let grain=groundNoise(p.xz,.47);let mac=groundNoise(p.xz,.099);
   let edge=groundNoise(p.xz,.21).r;
   let margin=.09+.28*edge+.22*grain.r;
   if(i.uv.x<margin || (i.uv.x<.66 && grain.g<.18*mac.r)){discard;}
   let microUV=p.xz*.31+vec2f(mac.r*.068,edge*.041);
   let herbs=textureSample(woodlandMaps,linearS,microUV,4).rgb;
   let litter=textureSample(woodlandMaps,linearS,microUV,0).rgb;
   let growth=smoothstep(.31,.58,mac.g*.54+grain.r*.32+edge*.14);
   col=mix(linear(litter)*.82,linear(herbs)*.79,growth);
   col*=.51+.73*mac.r+.46*grain.g+.20*grain.a;
   n=normalize(n+vec3f(grain.a-.5,0.,grain.g-.5)*.42);rough=.92;
 }
 if(id==23u || id==17u){
   let u=i.uv;let fleck=groundNoise(p.xz,.78);
   let binder=groundNoise(p.xz,.225);let scuff=groundNoise(vec2f(u.x*.47,u.y*.021),1.);
   let patches=groundNoise(p.xz,.034);
   let chip=smoothstep(.52,.69,binder.r*.58+fleck.g*.29+patches.r*.13);
   let dust=mix(linear(vec3f(.315,.292,.252)),linear(vec3f(.568,.527,.443)),binder.g);
   if(id==23u){
     let seam=abs(fract(u.y/1.62)-.5)*1.62;
     let nib=abs(fract((u.y+sin(u.x*12.)*.021)/.328)-.5)*.328;
     let lip=1.-smoothstep(.007,.027+fwidth(u.y)*.62,nib);
     let scuffed=smoothstep(.49,.68,scuff.r*.76+binder.r*.24);
     let rim=exp(-pow((abs(u.x)-6.07)*3.21,2.));
     col=mix(col,dust,clamp(chip*.83+patches.r*.13+.07,0.,1.));
     col*=1.-.55*scuffed*rim;
     col*=.71+.28*smoothstep(.012,.041+fwidth(u.y)*.65,seam);
     col*=1.-.16*lip;
     n=normalize(n+vec3f(fleck.a-.5,.0,fleck.g-.5)*.32);
   }else{
     col=mix(col,dust,chip*.42+.026);
     let lateral=abs(u.x);
     if(lateral>5.61 && lateral<5.78){
       let edgeD=min(lateral-5.62,5.77-lateral);
       let nick=(fleck.g-.47)*.041+(binder.r-.45)*.070;
       let aa=clamp(fwidth(lateral)*.59,.002,.025);
       let fray=1.-smoothstep(nick-aa,nick+aa,edgeD);
       let grain=smoothstep(.63,.79,binder.g*.54+fleck.a*.46);
       col=mix(col,linear(vec3f(.257,.255,.234))*(.82+.51*fleck.g),max(fray,grain*.73));
     }
   }
   rough=.88;
 }
`;

// Serra do Lume, an original 860 m club circuit in wooded hill country.
const TRACK_WIDTH = 11.8;
const courseKnots = [
  [0,52], [0,8], [0,-57], [5,-99], [31,-131], [67,-139], [89,-124],
  [112,-120], [139,-139], [162,-127], [176,-92], [169,-64], [143,-48],
  [111,-34], [99,-3], [109,25], [147,47], [164,76], [151,111],
  [116,126], [75,122], [41,104], [12,102], [1,84]
];
function groundAt(x,z) {
  return 3.1*Math.sin(z*.016)+1.5*Math.sin((x+z)*.020)+2.7*Math.sin(x*.015)-1.5;
}
// Low grasses occupy the north-facing shoulder. The eastern drainage is shaded;
 // the south ridge carries scattered araucarias above the mixed broadleaf wood.
function regionFalloff(x,z,cx,cz,rx,rz){
  const dx=(x-cx)/rx,dz=(z-cz)/rz;
  const f=Math.max(0,1-dx*dx-dz*dz);
  return f*f*(3-2*f);
}
function northMeadow(x,z){return regionFalloff(x,z,68,-155,107,59);}
function southRidge(x,z){return regionFalloff(x,z,130,107,97,58);}
function vergeElevation(x,z,offset){
  if(x>-36&&x<26&&z>-73&&z<83)return 0;
  const t=Math.min(1,Math.max(0,(offset-TRACK_WIDTH*.5-1.8)/16));
  const tor=regionFalloff(x,z,171,-170,73,35)*6.9;
  const ravine=regionFalloff(x,z,190,-64,31,57)*7.4+regionFalloff(x,z,140,-72,24,32)*4.3;
  const hillside=regionFalloff(x,z,139,150,111,39)*5.4;
  const openness=northMeadow(x,z),drop=openness*(3.4+2.1*Math.sin(x*.028+z*.033));
  const far=Math.max(0,Math.min(1,(offset-21)/21));
  return t*t*(3-2*t)*(.89+.65*Math.sin(x*.13+z*.014)+.54*Math.cos(z*.17-x*.075)+.23*Math.sin(z*.33+x*.26))+
    far*far*(3-2*far)*(tor+ravine+hillside-drop);
}
const courseArc = (() => {
  const pt=[], dist=[]; let len=0;
  const n=courseKnots.length;
  function c(a,b,c,d,t) {
    return b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
  }
  for(let i=0;i<=n*36;i++){
    const k=Math.floor(i/36)%n,t=(i%36)/36;
    const a=courseKnots[(k+n-1)%n],b=courseKnots[k],cc=courseKnots[(k+1)%n],d=courseKnots[(k+2)%n];
    const x=c(a[0],b[0],cc[0],d[0],t),z=c(a[1],b[1],cc[1],d[1],t),y=groundAt(x,z);
    const p=[x,y,z]; if(i) {const q=pt[i-1];len+=Math.hypot(x-q[0],y-q[1],z-q[2]);}
    pt.push(p);dist.push(len);
  }
  return {pt,dist,len};
})();
const TRACK_LENGTH=courseArc.len;
function trackSample(s,out) {
  const d=courseArc.dist,p=courseArc.pt;
  s=((s%TRACK_LENGTH)+TRACK_LENGTH)%TRACK_LENGTH;
  let lo=0,hi=d.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(d[mid]<=s)lo=mid;else hi=mid;}
  const a=p[lo],b=p[hi],u=(s-d[lo])/(d[hi]-d[lo]);
  out[0]=a[0]+(b[0]-a[0])*u;out[1]=a[1]+(b[1]-a[1])*u;out[2]=a[2]+(b[2]-a[2])*u;
  const pre=p[lo>0?lo-1:p.length-2],post=p[hi<p.length-1?hi+1:1];
  const tx=(b[0]-pre[0])*(1-u)+(post[0]-a[0])*u;
  const ty=(b[1]-pre[1])*(1-u)+(post[1]-a[1])*u;
  const tz=(b[2]-pre[2])*(1-u)+(post[2]-a[2])*u;
  const il=1/Math.hypot(tx,ty,tz);out[3]=tx*il;out[4]=ty*il;out[5]=tz*il;
  return out;
}
function buildWorld(){
  let state=0x7ea9ca2;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const r=(lo,hi)=>lo+(hi-lo)*rand(),pick=a=>a[Math.floor(rand()*a.length)];
  const tint=(c,m)=>[Math.min(1,c[0]*m),Math.min(1,c[1]*m),Math.min(1,c[2]*m)];
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
  const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=a=>{const m=Math.hypot(...a);return a.map(v=>v/m);};
  const mul=(a,m)=>a.map(v=>v*m);
  const W=TRACK_WIDTH*.5, ivory=[.86,.85,.74], oxide=[.62,.173,.095], concrete=[.64,.62,.55],
    rail=[.62,.65,.63],steel=[.225,.254,.244],asphalt=[.25,.255,.25],deep=[.13,.155,.151],wood=[.40,.34,.245];
  const template=fn=>{G.beginTemplate();fn();return G.endTemplate();};
  const length=TRACK_LENGTH;
  const grid=[];
  for(let s=0;s<length;s+=3.7){const a=trackSample(s,[]);grid.push([a[0],a[2],s]);}
  function nearest(x,z){let d=1e20,q=null;for(const p of grid){const l=(p[0]-x)**2+(p[1]-z)**2;if(l<d){d=l;q=p;}}return [Math.sqrt(d),q[2]];}
  const restricted=(x,z)=>(x>-36&&x<26&&z>-73&&z<83);
  const gravelAreas=[[124,229],[268,365],[353,455],[468,544],[601,700],[730,796]];
  const runoffAreas=[[125,225,-1,9],[277,355,1,7],[349,439,-1,8],[471,535,1,7],[602,685,-1,9],[730,786,-1,8]];
  function runoffWidth(s,side){
    const angle=s*6.2831853/length,phase=side*.79;
    let breadth=.57+.27*Math.sin(19*angle+phase)+.18*Math.sin(57*angle-phase)+.11*Math.cos(121*angle+phase);
    for(const [a,b,d,w] of runoffAreas)if(side===d && s>=a && s<=b){
      const envelope=Math.sin((s-a)/(b-a)*Math.PI)**.71;
      breadth+=envelope*(w+.87*Math.sin(s*.22)+.39*Math.cos(s*.63)+.28*Math.sin(s*1.12));
    }
    return Math.max(.16,breadth);
  }
  function profile(s,side){
    const w=runoffWidth(s,side),fade=.31+.16*w;
    const outer=w+2.7*fade;
    return [0,w*.5,w,w+fade,outer];
  }
  function edgeHeight(s,side,d){
    const p=pAt(s,side*(W+d));
    const breadth=runoffWidth(s,side),fade=.31+.16*breadth;
    const blend=Math.min(1,Math.max(0,d/(breadth+2.7*fade)));
    const soil=earthHeight(p[0],p[2]);
    p[1]=soil+(p[1]-soil)*(1-blend)**1.75-.002-.016*blend;
    return p;
  }
  const bank=vergeElevation;
  function soilAt(x,z){return groundAt(x,z)+bank(x,z,nearest(x,z)[0]);}
  function pAt(s,l,h=0){
    const a=trackSample(s,[]),ih=1/Math.hypot(a[3],a[5]),x=a[0]-a[5]*ih*l,z=a[2]+a[3]*ih*l;
    let elevation=groundAt(x,z)+bank(x,z,Math.abs(l));
    if(Math.abs(l)<W){
      const rx=-a[5]*ih,rz=a[3]*ih;
      const left=groundAt(a[0]-rx*W,a[2]-rz*W),right=groundAt(a[0]+rx*W,a[2]+rz*W);
      elevation=left+(right-left)*(.5+.5*l/W);
    }
    return [x,elevation+h,z];
  }
  function frame(s,l=0){
    const a=trackSample(s,[]),ih=1/Math.hypot(a[3],a[5]);
    const X=[-a[5]*ih,0,a[3]*ih],Z=[a[3]*ih,0,a[5]*ih],o=pAt(s,l);
    return (x,y,z)=>[o[0]+x*X[0]+z*Z[0],o[1]+y,o[2]+x*X[2]+z*Z[2]];
  }
  function uvQuad(a,b,c,d,col,mat,ua,ub,uc,ud,n=null){
    G.tri(a,b,c,col,mat,0,n,n,n,ua,ub,uc);G.tri(a,c,d,col,mat,0,n,n,n,ua,uc,ud);
  }
  function prism(f,x,y,z,sx,sy,sz,col,mat=0){
    const x0=x-sx*.5,x1=x+sx*.5,y0=y-sy*.5,y1=y+sy*.5,z0=z-sz*.5,z1=z+sz*.5,
      a=f(x0,y0,z0),b=f(x1,y0,z0),c=f(x1,y0,z1),d=f(x0,y0,z1),
      e=f(x0,y1,z0),g=f(x1,y1,z0),h=f(x1,y1,z1),i=f(x0,y1,z1);
    G.quad(e,g,h,i,col,mat);G.quad(d,c,b,a,col,mat);
    G.quad(a,b,g,e,col,mat);G.quad(b,c,h,g,col,mat);G.quad(c,d,i,h,col,mat);G.quad(d,a,e,i,col,mat);
  }
  function ribbon(a,b,l0,l1,h0,h1,col,mat,step=2.2){
    const n=Math.ceil((b-a)/step);
    for(let i=0;i<n;i++){
      const s=a+(b-a)*i/n,t=a+(b-a)*(i+1)/n;
      uvQuad(pAt(s,l0,h0),pAt(s,l1,h1),pAt(t,l1,h1),pAt(t,l0,h0),col,mat,[l0,s],[l1,s],[l1,t],[l0,t],[0,1,0]);
    }
  }

  // Road cross section follows the hillside. Faded edge stripes are real geometry.
  ribbon(0,length,-W,W,0,0,asphalt,10,1.45);
  for(const side of [-1,1]){
    const steps=Math.ceil(length/.82),tag=[.41,.38,1];
    function groundRow(s){
      const w=runoffWidth(s,side),fade=.31+.16*w;
      return profile(s,side).map(d=>{
        const p=edgeHeight(s,side,d);
        const normal=norm([groundAt(p[0]-.5,p[2])-groundAt(p[0]+.5,p[2]),1,groundAt(p[0],p[2]-.5)-groundAt(p[0],p[2]+.5)]);
        return [p,normal,[W+d,(d-w)/fade]];
      });
    }
    let last=groundRow(0);
    for(let j=1;j<=steps;j++){
      const next=groundRow(j*length/steps);
      for(let k=0;k<last.length-1;k++){
        const [a,b,c,d]=[last[k],last[k+1],next[k+1],next[k]];
        G.tri(a[0],b[0],c[0],tag,12,0,a[1],b[1],c[1],a[2],b[2],c[2]);
        G.tri(a[0],c[0],d[0],tag,12,0,a[1],c[1],d[1],a[2],c[2],d[2]);
      }
      last=next;
    }
    ribbon(0,length,side*(W-.28),side*(W-.13),.012,.012,ivory,17,1.6);
  }
  function kerb(s0,s1,side){
    const n=Math.ceil((s1-s0)/1.55);
    for(let i=0;i<n;i++){
      const a=s0+(s1-s0)*i/n,b=s0+(s1-s0)*(i+1)/n;
      const c=tint(i%4<2?ivory:oxide,r(.92,1.02));
      ribbon(a,b,side*(W-.04),side*(W+.30),.008,.095,c,23,2);
      ribbon(a,b,side*(W+.30),side*(W+.96),.095,.039,c,23,2);
    }
    ribbon(s0,s1,side*(W+.96),side*(W+1.65),.04,.005,[.27,.39,.32],23);
  }
  const corners=[[135,207,1],[220,256,1],[266,316,-1],[324,371,1],[383,444,1],[465,527,-1],[554,611,-1],[636,707,1],[718,774,1],[795,850,-1],[864,length-4,1]];
  for(const [lo,hi,side] of corners)if(lo<length-6)kerb(lo,Math.min(hi,length),side);
  // Individual aggregates sit proud of the apron at the transition from the binder to gravel.
  const gravelPile=template(()=>{
    for(let j=0;j<25;j++){
      const x=r(-.66,.66),z=r(-.58,.58),size=r(.009,.035),an=r(0,6.28),
        col=tint(pick([[.62,.54,.43],[.42,.397,.321],[.69,.62,.49],[.49,.46,.39]]),r(.87,1.1)),
        a=[x-size,.01,z-size*.66],b=[x+size*.72,.01,z-size],c=[x+size*.97,.011,z+size*.62],d=[x-size*.58,.008,z+size*.87],
        top=[x+Math.cos(an)*size*.3,.009+size*r(.4,.89),z];
      G.tri(a,b,top,col,12);G.tri(b,c,top,col,12);G.tri(c,d,top,col,12);G.tri(d,a,top,col,12);
    }
  });
  for(const [a,b,side,w] of [[125,225,-1,9],[277,355,1,7],[349,439,-1,8],[471,535,1,7],[602,685,-1,9],[730,786,-1,8]]){
    for(let k=0;k<(b-a)*1.7;k++){
      const t=r(0,1),s=a+t*(b-a),inner=k%3===0,l=side*(W+(inner?r(-.14,1.17):r(1.2,1.4+w*Math.sin(t*Math.PI)**.6))),
        p=inner&&Math.abs(l)<W?pAt(s,l,.01):edgeHeight(s,side,Math.abs(l)-W);
      G.instance(gravelPile,...p,r(0,6.28),1,1,1);
    }
  }
  const gridS=50;
  // Painted flying-start line and staggered grid brackets.
  const cell=.47,ncell=Math.ceil(TRACK_WIDTH/cell);
  for(let i=0;i<ncell;i++)for(let j=0;j<2;j++){
    const l=-W+TRACK_WIDTH*i/ncell, rr=-W+TRACK_WIDTH*(i+1)/ncell;
    ribbon(gridS+j*cell,gridS+(j+1)*cell,l,rr,.02,.02,(i+j)%2?ivory:deep,17);
  }
  for(let i=0;i<22;i++){
    const s=44-i*5.1,l=i%2?2.1:-2.1;
    ribbon(s,s+.122,l-1.16,l+1.16,.016,.016,ivory,17);
    ribbon(s-.83,s,l-1.16,l-1.045,.016,.016,ivory,17);
    ribbon(s-.83,s,l+1.045,l+1.16,.016,.016,ivory,17);
  }
  // Local pit access apron and its concrete pit wall.
  if(typeof registerBarrier==="function")registerBarrier(-29,108,-1,W+1.52);
  ribbon(-35,111,-W-7.6,-W-.97,.001,.003,[.34,.34,.32],10);
  ribbon(-35,111,-W-6.82,-W-6.68,.015,.015,[.78,.67,.36],17);
  for(let s=-29;s<106;s+=3.08){
    const cast=tint(concrete,r(.90,1.02));
    const profile=[[1.52,-.06],[1.52,.13],[1.66,.38],[1.70,.83],[1.735,.865],[2.022,.865],[2.06,.825],[2.06,-.06]];
    const left=[],right=[];
    for(const [base,h] of profile){
      left.push(pAt(s,-W-base,h));right.push(pAt(s+3.055,-W-base,h));
    }
    for(let k=0;k<profile.length-1;k++){
      const j=k+1;
      uvQuad(left[k],right[k],right[j],left[j],cast,48,[0,profile[k][1]],[3.055,profile[k][1]],[3.055,profile[j][1]],[0,profile[j][1]]);
    }
    for(let j=1;j<profile.length-1;j++){
      G.tri(left[0],left[j],left[j+1],cast,11);G.tri(right[0],right[j+1],right[j],cast,11);
    }
  }
  // Phototype on physical gantry and paddock fasciae, generated as merged pixel runs.
  const glyph={
    A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','10001','11110','10001','10001','11110'],
    C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],
    E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],
    G:['01111','10000','10000','10111','10001','10001','01110'],I:['111','010','010','010','010','010','111'],
    L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],
    N:['10001','11001','11001','10101','10011','10011','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],
    P:['11110','10001','10001','11110','10000','10000','10000'],R:['11110','10001','10001','11110','10100','10010','10001'],
    S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],
    U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],
    X:['10001','10001','01010','00100','01010','10001','10001'],0:['01110','10001','10011','10101','11001','10001','01110'],
    1:['010','110','010','010','010','010','111'],2:['01110','10001','00001','00110','01000','10000','11111'],
    3:['11110','00001','00001','01110','00001','00001','11110'],4:['10010','10010','10010','11111','00010','00010','00010'],
    5:['11111','10000','10000','11110','00001','00001','11110'],6:['01110','10000','10000','11110','10001','10001','01110'],
    7:['11111','00001','00010','00100','00100','01000','01000'],8:['01110','10001','10001','01110','10001','10001','01110'],
    9:['01110','10001','10001','01111','00001','00001','01110']
  };
  function lettering(f,str,x,y,z,h,col){
    const p=h/7;
    for(const ch of str){
      if(ch===' '){x+=p*3;continue;} const rows=glyph[ch];if(!rows)continue;
      for(let row=0;row<7;row++){
        let start=-1;
        for(let j=0;j<=rows[row].length;j++){
          if(rows[row][j]==='1'){if(start<0)start=j;} else if(start>=0){
            let x0=x+start*p,x1=x+j*p,y0=y-row*p,y1=y0-p;
            G.quad(f(x0,y1,z),f(x1,y1,z),f(x1,y0,z),f(x0,y0,z),col,0);start=-1;
          }
        }
      }
      x+=(rows[0].length+1.4)*p;
    }
  }
  const arch=frame(gridS);
  for(const x of [-W-2.8,W+2.1]){
    prism(arch,x,.31,0,1.13,.7,1.6,concrete,11);
    for(const z of [-.48,.48])prism(arch,x,3.18,z,.26,5.7,.24,steel,4);
    for(let y=.7;y<5.83;y+=1.0)G.beam(arch(x,y,-.48),arch(x,y+1,.48),.092,.092,rail,4);
  }
  for(const y of [5.48,6.83])for(const z of [-.52,.52])prism(arch,-.33,y,z,16.75,.16,.16,steel,4);
  for(let x=-8.30;x<7.6;x+=1.1){
    G.beam(arch(x,5.52,.52),arch(x+1.1,6.78,.52),.10,.10,rail,4);
    G.beam(arch(x,6.78,-.52),arch(x+1.1,5.52,-.52),.10,.10,rail,4);
  }
  prism(arch,-.36,6.19,-.65,16.90,1.36,.18,[.124,.178,.169],4);
  prism(arch,-.36,5.56,-.77,16.90,.064,.08,[.90,.53,.21],0);
  lettering(arch,'SERRA DO LUME',-4.83,6.60,-.751,.70,[.90,.87,.74]);
  // Three ochre parallel chevrons on the track's identity board.
  for(let k=0;k<3;k++){
    let x=-7.4+k*.52;
    G.quad(arch(x,5.84,-.753),arch(x+.3,5.84,-.753),arch(x+.97,6.53,-.753),arch(x+.67,6.53,-.753),[.94,.52,.20],0);
  }
  prism(arch,0,5.22,-.59,3.35,.53,.3,deep,2);
  for(let i=0;i<5;i++)G.cyl(arch(-1.24+i*.62,5.22,-.72),arch(-1.24+i*.62,5.22,-.81),.146,.155,12,[.18,.28,.20],2);
  function pier(f,x,z,width,depth,top,col,mat){
    const a=width*.5,b=depth*.5,ch=Math.min(a,b,.048),yz=[
      [-a+ch,-b],[a-ch,-b],[a,-b+ch],[a,b-ch],[a-ch,b],[-a+ch,b],[-a,b-ch],[-a,-b+ch]];
    for(let j=0;j<8;j++){
      const A=yz[j],B=yz[(j+1)%8];
      G.quad(f(x+A[0],-.24,z+A[1]),f(x+B[0],-.24,z+B[1]),f(x+B[0],top,z+B[1]),f(x+A[0],top,z+A[1]),col,mat);
    }
  }
  function foldedRoof(f,x0,x1,y0,y1,z0,z1,col){
    G.quad(f(x0,y0,z0),f(x1,y1,z0),f(x1,y1,z1),f(x0,y0,z1),col,4);
    G.quad(f(x0,y0-.087,z0),f(x0,y0-.087,z1),f(x1,y1-.087,z1),f(x1,y1-.087,z0),tint(col,.67),2);
    for(const z of [z0,z1])G.beam(f(x0,y0-.041,z),f(x1,y1-.041,z),.083,.077,col,4);
    for(let z=z0+.32;z<z1;z+=.66)G.beam(f(x0,y0+.015,z),f(x1,y1+.015,z),.036,.040,tint(col,.78),4);
  }
  const shutterTints=[[.39,.431,.421],[.382,.395,.383],[.502,.473,.418],[.34,.406,.393],[.30,.348,.353]];
  for(let bay=0;bay<13;bay++){
    const s=-20+bay*8.2,f=frame(s,-W-11.8);
    const open=bay===1||bay===3||bay===5||bay===6||bay===9||bay===11;
    const wing=bay<3?0:bay<6?1:bay<10?2:3;
    const jamb=wing===0?[.64,.58,.46]:wing===3?[.60,.64,.61]:ivory;
    const mat=wing===0?62:61;
    if(open){
      prism(f,-3.61,1.67,0,4.88,4.54,8.15,deep,61);
      for(const z of [-3.81,3.81])prism(f,1.28,1.67,z,4.36,4.54,.57,jamb,mat);
      prism(f,1.19,3.56,0,4.56,.72,8.15,jamb,mat);
      prism(f,1.03,.015,0,4.56,.10,8.15,[.45,.44,.40],11);
      const z=1.48*Math.sin(bay*4.1);
      prism(f,-.28,.51,z,1.4,.93,1.68,bay%3===0?oxide:steel,4);
      for(let drawer=0;drawer<5;drawer++)prism(f,.438,.23+drawer*.146,z,.048,.038,1.39,rail,4);
      G.cyl(f(2.952,3.28,-2.26),f(2.952,3.28,.04),.04,.04,8,ivory,9);
    }else prism(f,-1.5,1.67,0,9.1,4.54,8.15,jamb,mat);
    prism(f,-1.0,4.17,0,10.8,.36,8.22,[.64,.67,.63],61);
    const shutter=open?1.53+1.07*Math.abs(Math.sin(bay*1.98)):.08;
    const paint=shutterTints[(bay*3+wing)%shutterTints.length];
    const y0=shutter,y1=3.13;
    prism(f,3.098,(y0+y1)/2,0,.12,y1-y0,6.74,paint,63);
    for(let h=y0+.062;h<y1;h+=.222)prism(f,3.171,h,0,.044,.031,6.71,tint(paint,.78),63);
    prism(f,3.173,y0+.034,0,.073,.069,6.73,steel,4);
    for(const z of [-3.74,3.74])pier(f,3.24,z,.53,.41,3.63,jamb,mat);
    if(bay===0||bay===8||bay===12){
      const z=1.83;
      prism(f,3.24,1.06,z,.072,2.12,1.03,tint(paint,.65),63);
      prism(f,3.281,1.55,z,.03,.61,.67,[.188,.26,.259],4);
      prism(f,3.303,1.04,z+.36,.05,.036,.13,rail,4);
    }
    prism(f,3.2,3.44,0,.11,.40,6.74,deep,4);
    prism(f,3.30,3.51,2.91,.055,.55,.77,wing===3?steel:oxide,4);
    const sideFace=(x,y,z)=>f(3.336-z,y,x+5.85);
    lettering(sideFace,String(bay+1).padStart(2,'0'),-3.20,3.71,0,.34,ivory);
    if(wing===0){
      const tile=[.49,.348,.265];foldedRoof(f,-6.88,-1.75,4.44,5.74,-4.11,4.11,tile);
      foldedRoof(f,-1.75,4.38,5.74,4.40,-4.11,4.11,tile);
      if(bay===2){prism(f,-3.28,5.42,1.9,.69,1.41,.71,[.54,.361,.260],62);prism(f,-3.28,6.17,1.9,.80,.09,.83,concrete,61);}
    }else if(wing===1){
      prism(f,-1.3,5.11,0,7.7,1.55,8.05,[.22,.29,.29],4);
      for(let j=0;j<5;j++){
        const z=-3.18+j*1.58;
        uvQuad(f(2.622,4.44,z-.749),f(2.622,4.44,z+.749),f(2.622,5.62,z+.749),f(2.622,5.62,z-.749),
            [.32,.44,.452],47,[0,0],[1,0],[1,1],[0,1]);
        prism(f,2.65,5.03,z+.773,.088,1.28,.049,steel,4);
      }
      foldedRoof(f,-5.67,4.73,6.13,6.01,-4.11,4.11,ivory);
      if(bay===4){
        foldedRoof(f,3.34,5.58,3.69,3.21,-3.15,3.24,[.59,.390,.20]);
        for(const z of [-2.88,2.98])G.beam(f(3.36,2.81,z),f(5.38,3.19,z),.058,.065,steel,4);
      }
    }else if(wing===2){
      // A roof terrace and its external stair occupy the gap between the glazed club and the inspection shed.
      for(const x of [-5.94,3.83])for(const z of [-3.84,-1.28,1.28,3.84])G.cyl(f(x,4.32,z),f(x,5.50,z),.037,.037,8,steel,4);
      for(const x of [-5.94,3.83])for(const h of [4.58,5.05,5.50])G.cyl(f(x,h,-4.06),f(x,h,4.06),.031,.031,7,steel,4);
      if(bay===7||bay===8){
        for(const x of [-5.11,.92])for(const z of [-3.72,3.72])G.cyl(f(x,4.32,z),f(x,6.38,z),.051,.047,8,steel,4);
        foldedRoof(f,-5.54,1.52,6.59,6.31,-4.09,4.09,[.598,.66,.57]);
      }
      if(bay===6){
        for(let j=0;j<19;j++){const h=4.34-j*.226,z=-3.31+j*.346;prism(f,4.15,h,z,1.02,.068,.34,rail,4);}
        for(const x of [3.62,4.68]){
          G.beam(f(x,4.21,-3.46),f(x,.10,3.21),.11,.145,steel,4);
          G.beam(f(x,5.34,-3.46),f(x,1.23,3.21),.042,.047,rail,4);
          for(let j=0;j<=18;j+=3){let z=-3.33+j*.346;G.cyl(f(x,4.30-j*.226,z),f(x,5.26-j*.226,z),.026,.026,7,rail,4);}
        }
      }
    }else{
      const sage=[.373,.447,.413];
      foldedRoof(f,-6.63,-1.03,4.47,5.95,-4.09,4.09,sage);foldedRoof(f,-1.03,4.37,5.17,4.45,-4.09,4.09,sage);
      prism(f,-1.045,5.55,0,.094,.75,8.11,[.35,.45,.42],4);
      for(const z of [-3.96,-2.,0.,2.,3.96])prism(f,-.977,5.56,z,.075,.72,.050,steel,4);
    }
  }
  // Paddock fittings break the repeating bay rhythm: carts, gas bottles, vents and service lamps.
  for(let j=0;j<13;j++){
    const f=frame(-20+j*8.2,-W-11.8);
    G.cyl(f(3.22,.04,-3.92),f(3.22,4.29,-3.92),.061,.061,8,rail,4);
    for(const z of [-2.72,2.72]){prism(f,3.40,3.77,z,.33,.085,.80,deep,4);prism(f,3.52,3.74,z,.18,.065,.68,[.81,.81,.71],0);}
    if(j%3===0){
      prism(f,3.95,.64,2.72,.62,.89,.99,[.44,.17,.112],2);
      for(let i=0;i<4;i++)prism(f,4.271,.41+i*.145,2.72,.025,.038,.82,rail,4);
      for(const z of [2.37,3.08])for(const x of [3.75,4.15])G.cyl(f(x-.03,.15,z),f(x+.03,.15,z),.105,.105,8,deep,2);
      for(const z of [-2.96,-2.70]){G.cyl(f(3.71,.03,z),f(3.71,1.23,z),.105,.092,8,[.20,.27,.245],4);G.cyl(f(3.71,1.23,z),f(3.71,1.35,z),.038,.025,6,rail,4);}
    }
    if(j===3||j===5){
      prism(f,-2.86,6.59,1.9,1.38,.86,2.11,[.62,.633,.61],4);
      for(let n=0;n<8;n++)prism(f,-2.146,6.59,1.08+n*.23,.055,.64,.065,steel,4);
    }
  }
  for(const s of [-13,11,37,65,91]){
    const f=frame(s,-W-2.45),h=4.31;
    G.cyl(f(0,-.02,0),f(0,h+.09,0),.036,.024,8,rail,4);
    for(let k=0;k<6;k++){
      const u=k/6,vv=(k+1)/6,bend=t=>.11*Math.sin(t*7+.8*s)+.38*t*t;
      const p=(t,y)=>f(-.94*t,y-.22*t,bend(t));
      G.quad(p(u,h),p(vv,h),p(vv,h-.78),p(u,h-.78),s===37?ivory:oxide,0);
      G.quad(p(u,h-.78),p(vv,h-.78),p(vv,h-.98),p(u,h-.98),deep,0);
    }
  }
  // Elevated race control with a glazed observation gallery.
  {
    const f=frame(100,-W-17.9);
    prism(f,0,4.3,0,5.8,9.3,6.8,[.67,.66,.57],11);
    prism(f,0,9.52,0,8.8,1.42,8.1,[.28,.39,.398],4);
    for(const x of [-4.4,0,4.4])for(const z of [-4.05,4.05])prism(f,x,9.53,z,.105,1.45,.12,steel,4);
    prism(f,0,10.38,0,9.55,.28,8.82,ivory,4);
    G.cyl(f(0,10.45,0),f(0,14.6,0),.065,.03,8,rail,4);
    for(let j=0;j<4;j++)prism(f,0,13.1+j*.33,0,1.9-j*.24,.035,.035,rail,4);
  }
  const crowd=makeSpectators();
  G.markSpectators(crowd.seated,crowd.standing,crowd.profiles);
  // Pressed polypropylene bucket seats are bolted to a galvanized bearer below the pan.
  const seatColors=[[.318,.390,.365],[.646,.622,.524],[.528,.292,.204],[.428,.445,.400]];
  function seatShell(pigment){
    const stations=[[-.117,.406,.177],[-.098,.423,.222],[-.047,.424,.235],[.045,.413,.243],[.154,.402,.244],[.235,.406,.236],[.289,.429,.226],[.311,.473,.221],[.327,.525,.218],[.348,.596,.212],[.351,.618,.190],[.348,.625,.154]];
    const sections=[-1,-.83,-.53,0,.53,.83,1];
    const surface=stations.map(([x,y,w],i)=>sections.map(u=>{
      const cup=Math.abs(u)**2.5,back=Math.max(0,(i-5)/6);
      return [x-.042*cup*back,y+.029*cup*(1-.63*back)-.018*cup*(i>9?1:0),w*u];
    }));
    const normals=surface.map((row,i)=>row.map((pt,j)=>norm(cross(
      sub(row[Math.min(j+1,6)],row[Math.max(0,j-1)]),
      sub(surface[Math.min(i+1,stations.length-1)][j],surface[Math.max(0,i-1)][j])))));
    const underside=surface.map((row,i)=>row.map((pt,j)=>sub(pt,mul(normals[i][j],.011))));
    const edge=tint(pigment,.80),bottom=tint(pigment,.61);
    for(let i=1;i<surface.length;i++){
      const prev=surface[i-1],curr=surface[i],lo=underside[i-1],hi=underside[i],pn=normals[i-1],cn=normals[i];
      for(let j=1;j<sections.length;j++){
        const k=j-1;
        G.tri(prev[k],prev[j],curr[j],pigment,2,0,pn[k],pn[j],cn[j]);
        G.tri(prev[k],curr[j],curr[k],pigment,2,0,pn[k],cn[j],cn[k]);
        G.quad(lo[k],hi[k],hi[j],lo[j],bottom,2);
        if(i===1)G.quad(lo[k],lo[j],prev[j],prev[k],edge,2);
        if(i===surface.length-1)G.quad(curr[k],curr[j],hi[j],hi[k],edge,2);
      }
      G.quad(prev[0],curr[0],hi[0],lo[0],edge,2);G.quad(prev[6],lo[6],hi[6],curr[6],edge,2);
    }
  }
  const seatMeshes=seatColors.map(col=>[.91,1.02].map(gain=>template(()=>seatShell(tint(col,gain)))));
  // Open spectator terrace with slender folded cantilever roofs.
  for(let b=0;b<7;b++){
    const s=-8+b*10.8,f=frame(s,W+8.1);
    const center=f(0,0,0),rear=f(1,0,0),seatYaw=Math.atan2(center[2]-rear[2],rear[0]-center[0]);
    const aisleRail=b===2||b===5;
    if(aisleRail){
      // A continuous handrail follows the stairs in the two open viewing bays.
      const railLine=x=>.61+x*.42/.82+.97;
      G.cyl(f(-.34,railLine(-.34),.264),f(5.19,railLine(5.19),.264),.024,.024,10,rail,4);
      for(const x of [-.11,1.45,3.12,4.78]){
        G.cyl(f(x,.61+x*.42/.82-.13,.264),f(x,railLine(x),.264),.023,.023,9,rail,4);
      }
    }
    for(let k=0;k<7;k++){
      const x=k*.82,h=.61+k*.42;
      const pairRow=k===0 || k===(b%2?3:4),pairStart=k===0?(b%3===2?3:9+b%2):(b%2?3:9);
      const pairType=(b+(k>0?2:0))%3;
      prism(f,x,h-1.02,0,.84,2.04,10.62,concrete,11);
      for(const ends of [[-5.20,aisleRail&&k===1?-1.01:-.34],[aisleRail&&k===4?1.52:.66,4.92]]){
        const a=ends[0],z=ends[1];
        prism(f,x+.170,h+.312,(a+z)*.5,.068,.076,z-a,[.430,.442,.418],4);
        for(let m=0;m<3;m++){
          const p=a+.20+(z-a-.40)*m*.5;
          prism(f,x+.171,h+.147,p,.057,.294,.073,[.460,.465,.438],4);
          prism(f,x+.155,h+.012,p,.173,.024,.116,rail,4);
        }
      }
      for(let j=0;j<14;j++){
        if(j===7)continue;
        const z=-4.99+j*.739+(k%2)*.17;
        const color=b%3===1&&k===4?2:(j===0||j===13)&&k>1?3:k<2||k===5?0:1;
        const landing=aisleRail&&((j===6&&k===1)||(j===8&&k===4));
        const shell=seatMeshes[color][rand()<.36?0:1];
        if(!landing)G.instance(shell,...f(x,h,z),seatYaw);
        // A transverse cradle is recessed under the curved bearing surface.
        if(landing){
          const edge=x-.326,z0=z-.34,z1=z+.34;
          G.cyl(f(edge,h+.973,z0),f(edge,h+.973,z1),.024,.024,12,rail,4);
          for(const zp of [z0,z1])G.cyl(f(edge,h-.015,zp),f(edge,h+.973,zp),.020,.020,9,rail,4);
        }else prism(f,x+.164,h+.376,z,.122,.067,.200,[.285,.307,.290],4);
        const together=Math.exp(-((j-3.8-b%4)**2*.080+(k-3.4)**2*.15));
        const pocket=.11+.46*together+.42*Math.max(0,Math.cos(b*2.13+j*.52+k*.78))+.13*Math.sin(k*1.23-j*.37+b);
        const paired=pairRow&&(j===pairStart||j===pairStart+1),left=j===pairStart;
        const railPlace=landing;
        if(rand()<pocket*.82 || paired || railPlace){
          const up=railPlace || (!paired && (k===6?rand()<.52:(j===0||j===13)?rand()<.24:rand()<.055));
          let role=-1,handedness=0,turn=up?r(-.57,.55):r(-.27,.27);
          if(paired){
            // A programme is opened onto both laps, a parent listens to a
            // child, or two friends are watching the same corner together.
            const shared=pairType===0?[2,11]:pairType===1?[5,8]:[11,2];
            role=shared[left?0:1];handedness=left?-1:1;
            turn=(left?-1:1)*(role===2?.37:role===11?.42:.59);
          }
          if(railPlace){role=12;handedness=j===6?-1:1;turn=0;}
          const child=!up&&(paired?(pairType===1&&!left):((j+5*k+11*b)%17===0));
          const size=railPlace?1:child?r(.72,.81):r(.88,1.104);
          const spectator=crowd.assign(k,14*b+j,up,role,handedness);
          const openSeat=((k+b)%2?-1:1)*(up?.131:.029);
          const seatZ=railPlace?z:z+openSeat+(paired?(left?.062:-.062):0)+r(-.040,.040);
          const xx=railPlace?-.117:up?-.223:.145;
          const a=f(x+xx+(railPlace?0:r(-.021,.021)),up?h:h+.421,seatZ);
          const height=railPlace?1:up?r(.93,1.09):child?size:r(.94,1.045);
          G.instance(spectator.figure,...a,seatYaw+turn,size,height,railPlace?1:size*r(.94,1.06),spectator.appearance);
        }
      }
    }
    const openTerrace=b===2 || b===5;
    const slope=b<2?.078:b<5?-.069:.042;
    const roofBase=b<2?6.49:b<5?7.04:6.71;
    const roofY=x=>roofBase+slope*(x-2.46);
    for(const z of [-5.08,5.08]){
      if(!openTerrace){
        G.beam(f(5.55,.1,z),f(5.55,roofY(5.55)-.06,z),.18,.20,steel,4);
        G.beam(f(5.55,4.70,z),f(-1.30,roofY(-1.30)-.14,z),.14,.145,rail,4);
        G.beam(f(-1.62,roofY(-1.62)-.12,z),f(6.48,roofY(6.48)-.12,z),.205,.176,steel,4);
        G.beam(f(1.10,5.95,z),f(2.17,roofY(2.17)-.15,z),.075,.083,rail,4);
      }
      for(let k=0;k<7;k++)G.beam(f(k*.82,.75+k*.42,z),f(k*.82,1.65+k*.42,z),.046,.046,rail,4);
      G.beam(f(0,1.64,z),f(5,4.17,z),.05,.05,rail,4);
    }
    if(!openTerrace){
      const patina=b<2?[.601,.625,.603]:b<5?[.691,.659,.522]:[.50,.556,.528];
      foldedRoof(f,-1.76,6.54,roofY(-1.76),roofY(6.54),-5.43,5.43,patina);
      for(const x of [-1.25,.94,3.02,5.47])prism(f,x,roofY(x)-.07,0,.088,.15,10.77,rail,4);
      prism(f,-1.73,roofY(-1.73)-.083,0,.14,.198,10.86,b<2?deep:oxide,4);
    }else{
      for(const z of [-4.91,-2.49,0,2.49,4.91])G.beam(f(5.33,3.01,z),f(5.33,4.63,z),.051,.053,steel,4);
      G.beam(f(5.33,4.63,-5.05),f(5.33,4.63,5.05),.057,.060,rail,4);
      if(b===5){
        // The camera platform projects from the upper landing and stays clear of the seats.
        prism(f,5.96,3.57,1.43,1.59,.22,3.55,steel,4);
        for(const z of [-.09,2.97])for(const x of [5.23,6.66])G.beam(f(x,.10,z),f(x,4.67,z),.073,.073,steel,4);
        const head=f(5.80,5.16,1.68);
        for(const [x,z] of [[5.28,1.31],[6.19,1.21],[5.81,2.29]])G.beam(f(x,3.69,z),head,.041,.045,rail,4);
        prism(f,5.70,5.33,1.68,.63,.25,.23,steel,4);G.cyl(f(5.41,5.33,1.68),f(5.12,5.33,1.68),.109,.124,10,deep,2);
      }
    }
  }
  // Keep scenery placement independent of the number of occupied grandstand seats.
  state=2373671633;
  // W-beam formed from galvanised sheet. Factory sections overlap at the blockouts.
  const guardProfile=[
    [.414,.132],[.420,.111],[.434,.105],[.467,.056],[.486,.031],[.505,.023],[.523,.027],
    [.559,.069],[.579,.090],[.598,.095],[.617,.087],[.648,.047],[.668,.029],[.689,.024],
    [.708,.032],[.746,.077],[.766,.105],[.782,.111],[.789,.129]
  ];
  const guardPost=template(()=>{
    const zinc=[.442,.460,.453],darkZinc=[.340,.359,.351];
    G.box([0,.391,0],[.140,.818,.009],zinc,4);
    G.box([-.067,.391,.038],[.009,.818,.082],zinc,4);
    G.box([.067,.391,.038],[.009,.818,.082],zinc,4);
    G.box([-.014,.612,.037],[.238,.116,.136],darkZinc,4);
    G.box([-.072,.645,.033],[.165,.221,.087],zinc,4);
  });
  const spliceFasteners=template(()=>{
    const cap=[.54,.55,.535];
    for(const z of [-.047,.067])for(const y of [.509,.688]){
      G.cyl([.002,y,z],[-.004,y,z],.020,.019,8,cap,4);
      G.cyl([-.004,y,z],[-.010,y,z],.018,.010,8,cap,4);
    }
  });
  function guard(a,b,side,off=2.75){
    if(typeof registerBarrier==="function")registerBarrier(a,b,side,W+off);
    const bays=Math.ceil((b-a)/3.81),l=side*(W+off),bayLength=(b-a)/bays;
    function ring(s,lap){
      const t=trackSample(s,[]),horizontal=1/Math.hypot(t[3],t[5]);
      const nx=-t[5]*horizontal*side,nz=t[3]*horizontal*side;
      const q=[],normals=[];
      for(let k=0;k<guardProfile.length;k++){
        const g=guardProfile[k],lower=guardProfile[Math.max(k-1,0)],upper=guardProfile[Math.min(k+1,guardProfile.length-1)];
        const h=upper[0]-lower[0],r=upper[1]-lower[1];
        normals.push(norm([-nx*h,r,-nz*h]));
        q.push(pAt(s,l+side*(g[1]+lap),g[0]));
      }
      return [q,normals];
    }
    for(let bay=0;bay<bays;bay++){
      const start=a+bay*bayLength,stop=start+bayLength;
      const t=trackSample(start,[]),end=trackSample(stop,[]);
      const delta=Math.abs(Math.atan2(t[3]*end[5]-t[5]*end[3],t[3]*end[3]+t[5]*end[5]));
      const slices=Math.max(1,Math.ceil(Math.sqrt(delta*bayLength/.064)));
      const finish=bay+1<bays?stop+.106:stop;
      let [left,nl]=ring(start,.0045);
      const pigment=tint(rail,.87+.073*(.5+.5*Math.sin(start*9.713)));
      for(let j=1;j<=slices;j++){
        const x0=start+(j-1)*(finish-start)/slices,x1=start+j*(finish-start)/slices;
        const [right,nr]=ring(x1,.0045*(1-j/slices));
        for(let k=0;k<guardProfile.length-1;k++){
          const y0=guardProfile[k][0],y1=guardProfile[k+1][0];
          G.tri(left[k],left[k+1],right[k+1],pigment,119,0,nl[k],nl[k+1],nr[k+1],[x0,y0],[x0,y1],[x1,y1]);
          G.tri(left[k],right[k+1],right[k],pigment,119,0,nl[k],nr[k+1],nr[k],[x0,y0],[x1,y1],[x1,y0]);
        }
        left=right;nl=nr;
      }
      const yaw=Math.atan2(-t[3]*side,-t[5]*side);
      const postPos=pAt(start,l+side*.188,-.022),boltPos=pAt(start+.009,l+side*.019);
      G.instance(guardPost,...postPos,yaw,1,1,1);
      G.instance(spliceFasteners,...boltPos,yaw,1,1,1);
    }
  }
  guard(-41,115,1,4.43);guard(115,231,-1,12.7);guard(139,200,1,3.9);
  guard(226,305,-1,4.2);guard(289,364,1,10.8);guard(354,448,-1,12.4);guard(365,405,1,3.3);
  guard(447,511,-1,4.0);guard(476,543,1,10.2);guard(553,605,1,4.9);
  guard(607,695,-1,12.0);guard(658,720,1,3.3);guard(740,791,-1,11.2);guard(797,817,1,3.8);
  // Catch fencing between grandstand and racing surface.
  function fence(a,b,side,off,h){
    const l=side*(W+off),n=Math.ceil((b-a)/4.3);
    for(let i=0;i<n;i++){
      const s=a+(b-a)*i/n,t=a+(b-a)*(i+1)/n,base=.76;
      const p=pAt(s,l,base),q=pAt(t,l,base),r0=pAt(s,l,h),rr=pAt(t,l,h);
      uvQuad(p,q,rr,r0,[.335,.36,.326],20,[s,base],[t,base],[t,h],[s,h]);
      G.beam(pAt(s,l,-.04),r0,.062,.075,steel,4);
      G.beam(r0,rr,.054,.048,rail,4);
      if((i%2)===0)G.beam(r0,pAt(s,l-side*.27,h+.33),.05,.05,steel,4);
    }
  }
  fence(-33,83,1,5.12,3.23);fence(122,221,-1,13.33,3.1);fence(368,447,-1,13.12,3.1);
  // Tire walls: individually moulded hollow sidewalls and stepped rounded shoulders.
  const tireWall=template(()=>{
    const seg=12,profile=[[.188,.016],[.311,.016],[.354,.047],[.362,.174],[.336,.21],[.201,.218],[.188,.193]];
    for(let j=0;j<profile.length;j++)for(let k=0;k<seg;k++){
      const j2=(j+1)%profile.length,t=k*Math.PI*2/seg,tt=(k+1)*Math.PI*2/seg;
      const pp=(v,u)=>[Math.sin(u)*v[0],v[1],Math.cos(u)*v[0]];
      G.quad(pp(profile[j],t),pp(profile[j],tt),pp(profile[j2],tt),pp(profile[j2],t),[.11,.115,.109],2);
    }
  });
  for(const [a,b,side,off] of [[184,202,-1,11.7],[342,356,1,9.6],[425,445,-1,11.3],[671,690,-1,11.1]]){
    if(typeof registerBarrier==="function")registerBarrier(a,b,side,W+off-.36);
    for(let s=a;s<b;s+=.72)for(let j=0;j<4;j++){
      const p=pAt(s,side*(W+off),-.035+j*.219); G.instance(tireWall,...p,j*.31,1,1,1);
    }
  }
  // Distance boards at the braking points. Front faces point back along the circuit.
  for(const start of [151,338,492,623,796])for(const [offset,txt] of [[0,'50'],[34,'100']]){
    const a=start-offset,f=frame(a,-W-2.47);
    for(const x of [-.46,.46])prism(f,x,.53,0,.067,.98,.065,steel,4);
    const u=txt==='100'?2:0,edge=[[-.665,.625],[.665,.625],[.665,1.255],[-.665,1.255]];
    const face=edge.map(v=>f(v[0],v[1],-.043)),back=edge.map(v=>f(v[0],v[1],.043));
    uvQuad(...face,ivory,brakingBoardMaterial,[u,0],[u+.9999,0],[u+.9999,1],[u,1]);
    G.quad(back[3],back[2],back[1],back[0],ivory,4);
    for(let k=0;k<4;k++){const j=(k+1)%4;G.quad(face[k],back[k],back[j],face[j],ivory,4);}
  }
  // A grass-covered basin flows into three ridges with individually sampled silhouettes.
  const earthP=(x,z)=>[x,soilAt(x,z)-.18,z];
  const terrainNormal=(x,z)=>norm([soilAt(x-.68,z)-soilAt(x+.68,z),1.36,soilAt(x,z-.68)-soilAt(x,z+.68)]);
  function earthHeight(x,z){
    const size=4.5,x0=-280+Math.floor((x+280)/size)*size,z0=-333+Math.floor((z+333)/size)*size,
      u=(x-x0)/size,v=(z-z0)/size,lo=soilAt(x0,z0),hi=soilAt(x0+size,z0+size);
    return -.18+(v>u?(1-v)*lo+(v-u)*soilAt(x0,z0+size)+u*hi:(1-u)*lo+(u-v)*soilAt(x0+size,z0)+v*hi);
  }
  for(let x=-280;x<440;x+=4.5)for(let z=-333;z<333;z+=4.5){
    const a=earthP(x,z),b=earthP(x,z+4.5),c=earthP(x+4.5,z+4.5),d=earthP(x+4.5,z);
    const grass=[.347,.389,.228];
    const A=terrainNormal(a[0],a[2]),B=terrainNormal(b[0],b[2]),C=terrainNormal(c[0],c[2]),D=terrainNormal(d[0],d[2]);
    const da=[nearest(a[0],a[2])[0],0],db=[nearest(b[0],b[2])[0],0],dc=[nearest(c[0],c[2])[0],0],dd=[nearest(d[0],d[2])[0],0];
    G.tri(a,b,c,grass,13,0,A,B,C,da,db,dc);G.tri(a,c,d,grass,13,0,A,C,D,da,dc,dd);
  }
  function ridge(layer,base,depth,height,c){
    const ct=layer===0?600:476,rings=layer===0?37:16,rows=[],normals=[];
    const wing=t=>Math.atan2(Math.sin(t),Math.cos(t));
    function soft(lo,hi,x){
      const f=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return f*f*(3-2*f);
    }
    function bell(x,w){return Math.exp(-(x*x)/(w*w));}
    function hash(ix,iy){
      let h=Math.imul(ix,0x2c1b3c6d)^Math.imul(iy,0x297a2d39)^0x7da9c761;
      h=Math.imul(h^(h>>>15),0x2c1b3c6d);return ((h^(h>>>15))>>>0)/4294967296;
    }
    function noise(x,z){
      const i=Math.floor(x),j=Math.floor(z),fx=soft(0,1,x-i),fz=soft(0,1,z-j);
      return (hash(i,j)*(1-fx)+hash(i+1,j)*fx)*(1-fz)+(hash(i,j+1)*(1-fx)+hash(i+1,j+1)*fx)*fz;
    }
    const massif=t=>soft(-.92,-.64,t)*(1-soft(-.14,.09,t));
    // Eroded granite ribs share the height field and the geology. Narrow wet gullies
    // split each exposure into different runs, descending to the wooded shoulders.
    function exposure(a,u){
      const t=a+.058*u,incised=bell(t+.445,.043)+bell(t+.206,.035);
      const edge=.51+.040*Math.sin(11*t)+.030*Math.cos(23*t);
      const wall=bell(u-edge,.060)*(.53+.47*noise(t*12.3,u*2.1))+
        .84*bell(u-edge-.178-.052*Math.sin(6.6*t),.055)*(.40+.60*noise(t*19,u*2.7));
      return Math.max(0,wall*(1.-.84*Math.min(1,incised)));
    }
    function shape(t,u){
      const a=wing(t),rock=massif(a),base=.95+.24*Math.sin(t*(2+layer)+layer)+.18*Math.sin(t*5+.81*layer)
        +.072*Math.cos(t*9+layer*4)+.031*Math.cos(t*16+layer)+.009*Math.sin(t*40+layer*1.3);
      const valley=.53*bell(a-.04,.33)+.35*bell(a-1.82,.49);
      const baseline=-14+height*(base-valley)*Math.pow(Math.max(0,Math.sin(u*Math.PI*.685)),1.83);
      const ravines=Math.cos(t*13+1.74*Math.sin(t*7)+u*3.6+layer)*.057+Math.cos(t*28+Math.sin(t*11)-u*5)*.028+Math.sin(t*54+u*8)*.009;
      const low=Math.pow(Math.max(0,Math.sin(u*Math.PI*.90)),1.61);
      const notch=bell(a+.467+.066*(u-.69),.045)+.78*bell(a+.213-.123*(u-.68),.039);
      const shelves=.30*soft(.29+.060*Math.cos(8*a),.428+.060*Math.cos(8*a),u)
        +.37*soft(.468+.061*Math.sin(12*a),.544+.061*Math.sin(12*a),u)
        +.28*soft(.623+.078*Math.sin(6.4*a),.666+.078*Math.sin(6.4*a),u);
      const southDip=.80+.27*Math.cos(7.5*(a+.384))+.085*Math.sin(24*a+.3)+.055*Math.cos(38*a+1.37);
      const top=rock*(layer===0?30:layer===1?15:10)*(shelves*southDip)
        -rock*notch*low*(layer===0?16:7);
      const minor=rock*(5.6*noise(a*24+u*2.1,u*13.3)+2.6*noise(a*57,u*27)-4.2)*low;
      const wrinkle=3.2*(noise(a*49+u*.9,u*29)-.5)+1.8*(noise(a*84-u*1.3,u*52)-.5);
      const tors=layer===0?rock*exposure(a,u)*(4.7+7.6*noise(a*29+u*2.7,u*9.2)):0;
      return baseline+height*ravines*low+top+minor+low*(tors+wrinkle*(.22+.78*rock));
    }
    function at(t,u){
      const a=wing(t),contain=layer===0?massif(a):0;
      const ridgeToe=bell(a+.70+.10*u,.104)+.52*bell(a+.356-.091*u,.088);
      const radius=base+depth*(u+.151*Math.sin(t*3+layer)+.075*Math.sin(t*7+.7)+.029*Math.cos(t*16+u*3))
        -contain*ridgeToe*27*bell(u-.55,.25);
      return [78+radius*Math.cos(t),shape(t,u),radius*Math.sin(t)];
    }
    function cover(t,u){
      const a=wing(t),mass=layer===0?massif(a):0;
      const wall=exposure(a,u),fine=noise(a*37+u*3.3,u*14.1);
      const stone=mass*wall*(.64+.67*fine),seam=noise(a*43+u*2.6,u*6.1);
      return [stone,seam];
    }
    for(let j=0;j<rings;j++){
      let row=[],nr=[];for(let i=0;i<ct;i++){
        const t=i/ct*2*Math.PI,u=j/(rings-1);
        row.push(at(t,u));nr.push(norm(cross(sub(at(t+.0025,u),at(t-.0025,u)),sub(at(t,u+.006),at(t,u-.006)))));
      }rows.push(row);normals.push(nr);
    }
    for(let j=1;j<rings;j++)for(let i=0;i<ct;i++){
      const k=(i+1)%ct,a=rows[j-1][i],b=rows[j-1][k],d=rows[j][i],e=rows[j][k],
        A=normals[j-1][i],B=normals[j-1][k],D=normals[j][i],E=normals[j][k];
      const ta=i/ct*2*Math.PI,tb=k/ct*2*Math.PI,low=(j-1)/(rings-1),high=j/(rings-1);
      const ua=cover(ta,low),ub=cover(tb,low),ud=cover(ta,high),ue=cover(tb,high);
      G.tri(a,d,e,c,19,0,A,D,E,ua,ud,ue);G.tri(a,e,b,c,19,0,A,E,B,ua,ue,ub);
    }
    // These crowns intersect the actual triangulated land. The most distant slopes use the
    // baked canopy normal field for detail and sparse real crowns for a broken silhouette.
    {
      const saved=state;state=(0x7e05c8e0+layer*1339)>>>0;
      const locate=(t,u)=>{
        const x=t*ct,z=u*(rings-1),i=x|0,j=Math.min(rings-2,z|0),k=(i+1)%ct,
          f=x-i,v=z-j,a=rows[j][i],d=rows[j+1][i],b=rows[j][k],e=rows[j+1][k];
        return v>f?add(add(mul(a,1-v),mul(d,v-f)),mul(e,f)):add(add(mul(a,1-f),mul(b,f-v)),mul(e,v));
      };
      if(layer===0){
        const position=(az,u)=>locate((1+az/(2*Math.PI))%1,u);
        // Forest advances along the drainage cuts and the gentler shoulders. The connected
        // groves feather out into isolated young growth on the sparsely covered ledges.
        for(let j=0;j<258;j++){
          const az=r(-.99,.079),u=r(.26,.907),stone=cover(az,u)[0],canal=Math.max(bell(az+.456+.06*(u-.55),.076),
              bell(az+.206-.13*(u-.55),.056),bell(u-.58-.031*Math.cos(7.2*az),.037)),
            grow=.39+.48*canal+.20*noise(az*15,u*7.3)-.48*stone;
          if(rand()>grow)continue;
          const arms=4+(rand()*13|0),col=tint([.227,.300,.213],r(.72,1.00)),radius=r(.014,.050),height=r(1.9,4.2);
          for(let k=0;k<arms;k++){
            const a=r(0,6.284),reach=Math.sqrt(rand()),t=az+radius*reach*Math.cos(a),v=u+.65*radius*reach*Math.sin(a),
              p=position(t,v),w=height*r(.48,1.19),h=w*r(.58,1.11);
            p[1]+=h*.34;crown(p,w,h,16+r(-.38,.32),tint(col,r(.86,1.15)),rand()*12|0);
          }
        }
      }
      const groups=(layer===0?870:layer===1?590:370);
      for(let i=0;i<groups;i++){
        const t=rand(),u=i%3!==0?r(.68,.86):r(.38,.82),w=layer===0?r(1.3,2.8):r(.9,2.1);
        const cover=.67+.24*Math.sin(t*33+u*12)+.15*Math.cos(t*61-u*8);
        const copse=.47+.38*noise(Math.cos(t*6.283)*4+u*2,Math.sin(t*6.283)*4+u*3.7);
        if(rand()>cover*copse||layer===0&&u>.45&&u<.68&&massif(wing(t*6.283))>.69)continue;
        const count=3+(rand()*6|0),hue=tint(c,r(.60,.83));
        for(let j=0;j<count;j++){
          const du=r(-.004,.004),dt=r(-.0029,.0029),p=locate((1+t+dt)%1,Math.min(.96,u+du)),ht=w*r(.42,.87);
          p[1]+=ht*.15;
          crown(p,w*r(.62,1.22),ht,16+r(-.28,.28),tint(hue,r(.84,1.13)),rand()*16|0);
        }
      }
      state=saved;
    }
    // Continuous galleries of distant canopy follow the actual sampled ridge. A minute, irregular
    // fringe replaces individual silhouettes below the angular resolution of the forest floor.
    if(layer<2){
      for(const band of [Math.round((rings-1)*.73),Math.round((rings-1)*.80)]){
        let prev=null,base=null;
        const per=9,n=ct*per,f=.85+layer*.08;
        for(let i=0;i<=n;i++){
          const k=Math.floor(i/per)%ct,fract=(i%per)/per,p=mix(rows[band][k],rows[band][(k+1)%ct],fract);
          const grove=.27+.73*soft(.19,.77,noise(p[0]*.0141,p[2]*.013+layer*17.1));
          const bed=1.-(layer===0?.83*massif(wing(i/n*6.283)):0);
          const peak=(1.35+.48*Math.sin(i*.46)+.34*Math.sin(i*.93)+.24*Math.cos(i*2.2)+.44*Math.cos(i*.102))*grove*bed;
          const q=[p[0],p[1]+peak*f,p[2]],low=[p[0],p[1]-.16,p[2]],t=i/n*6.283;
          if(prev){
            const nor=[-Math.cos(t)*.65,.78,-Math.sin(t)*.65];
            G.tri(base,prev,q,tint(c,.88),19,0,nor,nor,nor);G.tri(base,q,low,tint(c,.88),19,0,nor,nor,nor);
          }
          prev=q;base=low;
        }
      }
    }
  }
  ridge(0,197,287,52,[.25,.328,.234]);ridge(1,378,380,98,[.301,.368,.317]);ridge(2,650,480,156,[.35,.414,.425]);
  // At each branch tip, pack individually oriented crowns into a three-dimensional cluster.
  // The GPU reconstructs their contours from many small, irregularly overlapping blades.
  let floraSpecies=-1,bloomSpray=false,sprayAzimuth=0,branchLeaves=null,fineShoots=null;
  function drawSpray(o,shape,col,id,packed=0,sky=15){
    const u=packed*2,v=sky*2,a=[u,v],b=[u+1,v],c=[u+1,v+1],d=[u,v+1];
    if(shape[2]<-8 && Math.max(shape[0],shape[1])>.77){
      const e=[u+.5,v],f=[u+.5,v+1];
      G.tri(o,o,o,col,127+id,0,shape,shape,shape,a,e,f);
      G.tri(o,o,o,col,127+id,0,shape,shape,shape,a,f,d);
      G.tri(o,o,o,col,127+id,0,shape,shape,shape,e,b,c);
      G.tri(o,o,o,col,127+id,0,shape,shape,shape,e,c,f);
    }else{
      G.tri(o,o,o,col,127+id,0,shape,shape,shape,a,b,c);
      G.tri(o,o,o,col,127+id,0,shape,shape,shape,a,c,d);
    }
  }
  function bakeSprayLight(sprays){
    // Accumulate leaf area around each shoot. Four oblique sun paths and one sky path
    // are stored per spray; an instance can then turn without taking its baked sun with it.
    const directions=[[.969,.247,0],[-.969,.247,0],[0,.247,.969],[0,.247,-.969],[0,1,0]];
    for(const spray of sprays){
      const thickness=[0,0,0,0,0],p=spray.o;
      for(const neighbor of sprays){
        if(neighbor===spray)continue;
        const q=neighbor.o,dx=q[0]-p[0],dy=q[1]-p[1],dz=q[2]-p[2],rr=neighbor.radius;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2>85)continue;
        for(let j=0;j<5;j++){
          const ray=directions[j],t=dx*ray[0]+dy*ray[1]+dz*ray[2];
          if(t<-.13*rr)continue;
          const disc=1.-Math.max(0,d2-t*t)/(rr*rr);
          if(disc>0)thickness[j]+=disc*.82/(1.+.027*t*t);
        }
      }
      const q=thickness.map(x=>Math.round(15*Math.exp(-x*.59)));
      const horizon=q[0]|q[1]<<4|q[2]<<8|q[3]<<12;
      // A terminal branch forks in three-dimensional space. Its tips occupy
      // smaller projected areas and expose sky between independently lit leaves.
      const shape=spray.shape,w=shape[0],h=shape[1];
      if(Math.max(w,h)>.69){
        const code=Math.round(-32-shape[2]),angle=((code>>8)&255)*(Math.PI*2/255),
          roll=code&255,seed=Math.sin(p[0]*4.71+p[1]*12.39+p[2]*3.26)*459.82,
          noise=seed-Math.floor(seed),side=[-Math.sin(angle),0,Math.cos(angle)],
          advance=[Math.cos(angle),0,Math.sin(angle)],sg=noise>.5?1:-1;
        for(let k=0;k<3;k++){
          const spread=k===0?-.37:k===1?.29:.048,reach=k===2?.29:k===0?-.11:.038,
            lateral=sg*(spread+.083*(noise-.5)),lift=k===0?-.18:k===1?.12:.35,
            offset=[p[0]+w*(side[0]*lateral+advance[0]*reach),p[1]+h*(lift-.045*noise),
                    p[2]+w*(side[2]*lateral+advance[2]*reach)],
            turn=(angle+sg*(k===0?-.68:k===1?.71:.12)+.34*(noise-.5))/(2*Math.PI),
            az=Math.round((turn-Math.floor(turn))*255),
            twist=Math.max(0,Math.min(255,roll+(k-1)*39));
          const sz=[w*(k===2?.47:.56),h*(k===2?.65:.57),-32-(code&0xff0000)-az*256-twist];
          // Companion sprays use the neighbouring variant in the species' own family.
          const species=(code>>16)-1,family=spray.id>=13?[13,14,15]:leafFamilies[species],
            variant=family[(Math.max(0,family.indexOf(spray.id))+k)%family.length];
          drawSpray(offset,sz,tint(spray.col,k===0?.89:k===1?1.07:1.015),variant,horizon,q[4]);
        }
      }else drawSpray(p,shape,spray.col,spray.id,horizon,q[4]);
    }
  }
  const leafFamilies=[[0,1,2,3,4],[8,9,10],[11,12],[4,5,6,7],[8,9,10,4],[0,1,2,3,7],[4,5,6,7],[0,1,2,3]];
  function crown(o,w,h,roll,col,id){
    if(w>0 && roll>=8)id%=13;
    if(w>0 && roll<8){
      if(bloomSpray)id=13+id%3;
      else if(floraSpecies>=0){const family=leafFamilies[floraSpecies];id=family[id%family.length];}
      else id%=13;
      if(floraSpecies>=0){
        const az=Math.round((sprayAzimuth/(2*Math.PI)%1+1)%1*255);
        roll=-32-(floraSpecies+1)*65536-az*256-Math.round(Math.max(0,Math.min(255,(roll+1.6)*79)));
      }
    }
    const shape=[w,h,roll];
    if(roll< -8 && branchLeaves){branchLeaves.push({o,shape,col,id,radius:.31+.98*Math.sqrt(w*h)});}
    else drawSpray(o,shape,col,id);
  }
  function lobe(o,rx,ry,rz,col,sprays){
    const phase=r(0,6.283),skew=r(-.28,.28),sub=sprays<7?7:10+(rand()*4|0),
      rootHue=r(.94,1.05),dominant=Math.floor(rand()*16),
      cx=rx*r(.91,1.15),cy=ry*r(.72,1.03),cr=r(-.34,.34);
    if(dominant%4!==0)crown(o,cx*.92,cy*.94,cr,tint(col,rootHue*.91),dominant);
    for(let k=0;k<sub;k++){
      const v=(k+.55+r(-.31,.31))/sub*2-1,hr=Math.sqrt(1-v*v),ang=k*2.39996+phase+r(-.31,.31),
        dir=[Math.cos(ang)*hr,v,Math.sin(ang)*hr],scale=r(.70,1.03),extent=r(.61,.96),
        p=[o[0]+rx*(dir[0]*scale+skew*v),o[1]+ry*dir[1]*scale,o[2]+rz*dir[2]*scale];
      const hue=tint(col,rootHue*r(.82,1.16)*(.96+.075*v));
      crown(p,rx*extent*r(.87,1.16),ry*extent*r(.69,1.17),r(-.56,.56),hue,rand()*16|0);
    }
  }
  // A transported frame follows the grain throughout the branch. A lateral's
  // first ring conforms to the parent surface and opens into a raised branch collar.
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  function branchTube(points,radii,color,segments,host=null){
    const phase=r(-.35,.35),circumference=2*Math.PI*Math.max(.049,radii[0]),rings=[],normals=[],rows=[];
    let previousAxis=null,length=0;
    for(let i=0;i<points.length;i++){
      const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=norm(sub(b,a)),
        ref=previousAxis||norm(cross(d,Math.abs(d[0])>.80?[0,0,1]:[1,0,0])),
        u=norm(sub(ref,mul(d,dot(ref,d)))),v=cross(d,u),rr=[],nn=[],uv=[];
      if(i)length+=Math.hypot(...sub(points[i],points[i-1]));
      const gradient=(radii[Math.max(0,i-1)]-radii[Math.min(points.length-1,i+1)])/Math.max(.01,Math.hypot(...sub(b,a)));
      let outward,side,upward;
      if(host&&i===0){
        outward=norm(sub(sub(points[1],points[0]),mul(host.axis,dot(sub(points[1],points[0]),host.axis))));
        side=norm(cross(host.axis,outward));upward=norm(cross(side,d));
        if(dot(upward,host.axis)<0)upward=mul(upward,-1);
      }
      for(let k=0;k<segments;k++){
        const angle=phase+k*6.283185/segments,p=add(mul(u,Math.cos(angle)),mul(v,Math.sin(angle))),
          groove=.062*Math.cos(angle*3+.64*phase+length*.14)+.036*Math.cos(angle*5-.5*length+phase*6),
          buttress=(i===0&&!host?.13:0)*Math.cos(angle*3+phase*.61),rad=radii[i]*(1+groove+buttress);
        let pos=add(points[i],mul(p,rad)),n=norm(add(p,mul(d,gradient)));
        if(i===0&&host){
          const az=dot(p,side)*Math.min(1.16,rad*1.32/host.r),vertical=dot(p,upward),
            skin=add(mul(outward,Math.cos(az)),mul(side,Math.sin(az)));
          pos=add(add(points[0],mul(skin,host.r*.97)),mul(host.axis,vertical*rad*(vertical<0?2.18:1.16)));
          n=norm(mix(skin,p,.16));
        }
        rr.push(pos);nn.push(n);uv.push([circumference*k/segments,length]);
      }
      rings.push(rr);normals.push(nn);rows.push(uv);previousAxis=u;
      if(i)for(let k=0;k<segments;k++){
        const kk=(k+1)%segments,l=rings[i-1],n=normals[i-1],old=rows[i-1],
          end=kk?uv[kk]:[circumference,uv[0][1]],oldEnd=kk?old[kk]:[circumference,old[0][1]];
        G.tri(l[k],rr[k],rr[kk],color,15,0,n[k],nn[k],nn[kk],old[k],uv[k],end);
        G.tri(l[k],rr[kk],l[kk],color,15,0,n[k],nn[kk],n[kk],old[k],end,oldEnd);
      }
    }
  }
  function feather(at,len,dir,leafHue,droop,lift=1){
    const side=[-dir[2],0,dir[0]],height=len*r(.28,.44)*lift;
    const p=t=>add(add(at,mul(dir,len*t)),[0,height*Math.sin(t*2.48)-droop*t*t,0]);
    const a=p(0),b=p(.51),c=p(1),ax=mul(side,len*.008);
    G.quad(sub(a,ax),add(a,ax),add(b,ax),sub(b,ax),tint(leafHue,.72),0);G.tri(sub(b,ax),add(b,ax),c,leafHue);
    const count=13+Math.floor(len*1.62);
    for(let j=0;j<count;j++)for(const sg of [-1,1]){
      const t=(j+1)/(count+1.5),o=p(t),wid=len*Math.sin(t*Math.PI*.89)**.6*(1-t*.57)*r(.107,.164),
        elbow=add(add(o,mul(side,sg*wid*.55)),mul(dir,len*.047)),
        end=add(add(o,mul(side,sg*wid)),mul(dir,len*.091)),e=p(t+.047);
      elbow[1]+=.012*len;end[1]-=len*.069;
      G.tri(o,elbow,e,tint(leafHue,r(.84,1.11)));G.tri(elbow,end,e,leafHue);
    }
  }
  // Four observed branching habits are combined with independent stem lean, fork height,
  // a dominant side, clear bole, subordinate twigs and differently shaped leaf masses.
  const profiles=[
    // height, crown spread, trunk radius, height of first lateral, thickness, number of crown tiers
    [10.5,4.0,.37,.22,.91,12],[14.1,2.7,.29,.40,1.36,10],[16.3,4.7,.35,.48,.39,10],
    [10.9,5.6,.46,.34,.48,10],[11.3,3.53,.33,.26,1.46,9],[9.0,3.95,.29,.16,.75,11],
    [14.8,4.34,.47,.28,.78,10],[9.8,3.0,.22,.41,.60,8]
  ];
  function tree(species,col,flower=null){
    const pr=profiles[species],H=pr[0]*r(.79,1.17),R=pr[1]*r(.82,1.23),dia=pr[2]*r(.77,1.21),phi=r(0,6.283),
      euc=species===1,pine=species===2,umbrella=species===3,pendant=species===4,twin=species===5,old=species===6,pion=species===7,
      woodCol=tint(euc||pion?[.54,.511,.431]:pine?[.27,.239,.182]:pendant?[.36,.322,.244]:[.34,.294,.228],r(.87,1.1)),
      crooked=r(.44,1.76)*(old||twin?1.8:1),lean=r(-.11,.19)*H/10,principal=[Math.cos(phi),0,Math.sin(phi)],
      stems=twin?3:umbrella||old||pendant?2:1;
    floraSpecies=species;branchLeaves=[];
    let mainCurve=null;
    const stemFactor=flower?.84:1;
    for(let stem=0;stem<stems;stem++){
      const th=phi+stem*(2.399+r(-.33,.31)),out=[Math.cos(th),0,Math.sin(th)],fraction=stem?r(.62,.92):1,
        fork=stem?(twin?r(.06,.18):r(.20,.38)):0,diverge=stem?r(1.6,3.57):r(.08,1.48);
      const organic=(t,z)=>(Math.sin((z?5.6:6.8)*t+(z?-phi:phi))-Math.sin(z?-phi:phi))*crooked*Math.sqrt(t)*(z?.63:.72);
      const base=stem?mainCurve(fork):[0,0,0],baseX=organic(fork,0),baseZ=organic(fork,1);
      const trunkP=t=>{
        const u=Math.max(0,(t-fork)/(1-fork)),sweep=u*(1+.22*Math.sin(2.9*u+phi)-.22*Math.sin(phi));
        return [base[0]+organic(t,0)-baseX+out[0]*sweep*diverge+(lean*H+crooked*.76)*u*.48,
          base[1]+H*(t-fork)*fraction,base[2]+organic(t,1)-baseZ+out[2]*sweep*diverge];
      };
      if(!stem)mainCurve=trunkP;
      const tt=stem?[fork,fork+.087*(1-fork),fork+.23*(1-fork),fork+.48*(1-fork),fork+.73*(1-fork),1]:
        [0,.025,.071,.17,.30,.44,.58,.73,.86,1];
      const pts=tt.map(trunkP);
      if(!stem)pts[0][1]-=.51;
      const trunkRadius=t=>dia*stemFactor*(stem?.52:1)*Math.max(.045,1-.958*(t-fork)/(1-fork));
      const rs=tt.map((t,j)=>trunkRadius(t)*(j===0&&!stem?1.75:j===1&&!stem?1.10:1));
      const tangent=(curve,t)=>norm(sub(curve(Math.min(1,t+.015)),curve(Math.max(0,t-.015))));
      const junction=stem?{axis:tangent(mainCurve,fork),r:dia*stemFactor*(1-.958*fork)}:null;
      branchTube(pts,rs,woodCol,stem?11:16,junction);
      if(!stem){
        // Ground roots rise against the base of the bole then disappear beneath the leaf litter.
        const restore=state,count=old||umbrella?7:5;
        for(let j=0;j<count;j++){
          const a=phi+6.283*(j+.29*Math.sin(2.9*j+phi))/count,axis=[Math.cos(a),0,Math.sin(a)],
            lateral=[-axis[2],0,axis[0]],reach=dia*r(2.24,4.65),bend=r(-.42,.42)*reach,
            flight=(t,y)=>add(add(mul(axis,dia*.63+reach*t),mul(lateral,bend*t*t)),[0,y,0]);
          const high=flight(0,dia*r(.95,1.68)),foot=flight(.22,dia*.15),middle=flight(.61,-.075),end=flight(1,-.24);
          branchTube([high,foot,middle,end],[dia*.23,dia*.41,dia*.23,.015],tint(woodCol,r(.74,.96)),7);
        }
        state=restore;
      }
      const n=pine?22:stem?6+(rand()*4|0):pr[5]+(rand()*3|0),y0=Math.max(pr[3]+r(-.085,.075),fork+.12);
      for(let k=0;k<n;k++){
        const u=pine?(Math.floor(k/4)+r(.18,.48))/5.9:(k+r(.12,.79))/n,t=y0+(1-y0-.017)*u,
          a=phi+stem*.93+(pine?(k%4)*1.571+Math.floor(k/4)*.57:k*2.39996)+r(-.36,.36),
          asym=.81+.26*Math.cos(a-phi)+(pine?.1:.28)*r(-1,1),rad=R*(1-u*(pine?.76:.55))*asym*(stem?.77:1),
          spread=[Math.cos(a)*rad,0,Math.sin(a)*rad],o=trunkP(t),up=(pine?.17:umbrella?.12:euc?.47:pendant?.32:old?.37-.26*u:.38)*H*r(.21,.64),
          tip=add(o,spread),mid=add(o,mul(spread,r(.39,.67)));tip[1]+=up;mid[1]+=up*.45-r(.06,.61);
        const bend=add(mid,mul([-Math.sin(a),0,Math.cos(a)],r(-.27,.29)*rad));bend[1]+=.17*up;
        const limbR=dia*stemFactor*(stem?.37:.47)*(.83-.44*u),bole=trunkRadius(t),
          direction=norm([spread[0],0,spread[2]]),ax=tangent(trunkP,t),host={axis:ax,r:bole};
        // Growth first lifts away from the trunk, then bends under the weight of its tip.
        const lateral=Math.min(rad*.33,bole+limbR*1.39),lift=limbR*(pine?1.87:3.24),
          neck=add(add(o,mul(direction,lateral)),mul(ax,lift)),
          radialKnee=mix(neck,bend,.53),curl=mul([-direction[2],0,direction[0]],rad*.081*Math.cos(k*.97+phi));
        radialKnee[1]+=limbR*(pine?.59:1.45);bend[1]+=limbR*(pine?.78:1.48);
        const lower=mix(bend,tip,.49);
        lower[0]-=curl[0]*.73;lower[2]-=curl[2]*.73;lower[1]-=rad*(.065+.041*Math.sin(a+phi));
        branchTube([o,neck,add(radialKnee,curl),bend,lower,tip],[limbR,limbR*.83,limbR*.66,limbR*.41,limbR*.25,limbR*.051],woodCol,limbR>.095?7:5,host);
        sprayAzimuth=a;
        if(!pine && k%3!==1 && rad>1.15){
          const saved=state;
          const tangent=norm(sub(tip,bend)),side=[-direction[2],0,direction[0]];
          for(let g=0;g<(k%4===0?2:1);g++){
            const sign=(k+g)%2===0?1:-1,origin=g?mix(neck,radialKnee,.61):mix(bend,lower,.33),
              length=rad*r(.24,.49),turn=add(mul(side,sign*length*.79),mul(direction,length*.39)),
              joint=add(origin,mul(turn,.45)),sprig=add(origin,turn);
            joint[1]+=r(.22,.49)*length;sprig[1]+=r(.53,1.05)*length;
            const host={axis:g?norm(sub(radialKnee,neck)):tangent,r:limbR*(g?.71:.37)},rr=limbR*(g?.25:.19);
            branchTube([origin,joint,sprig],[rr,rr*.61,.008],woodCol,5,host);
            const bud=add(sprig,[-side[0]*sign*length*.36,length*.28, -side[2]*sign*length*.36]);
            branchTube([mix(joint,sprig,.55),bud],[rr*.36,.007],woodCol,4);
            if((g+k)%4!==0){
              sprayAzimuth=a+sign*1.02;
              const sc=r(.35,.67),hue=tint(col,r(.83,.97));
              crown(sprig,sc*r(.66,1.06),sc*r(.59,.96),r(-.65,.52),hue,rand()*13|0);
              crown(bud,sc*.62,sc*.51,r(-.7,.67),hue,rand()*13|0);
            }
          }
          state=saved;
        }
        if(old&&u>.54){
          // Old upper branches carry new growth along the length of each strongly lit limb.
          const keep=state,side=[-direction[2],0,direction[0]];
          for(let q=0;q<4;q++){
            const along=r(.22,.80),start=q===0?mix(neck,radialKnee,along):q===1?mix(radialKnee,bend,along):
              q===2?mix(bend,lower,along):mix(lower,tip,along),sign=q%2?1:-1,length=r(.36,.76)*Math.min(1.9,rad),
              elbow=add(add(start,mul(side,sign*length*.38)),[0,length*.20,0]),
              end=add(add(start,mul(side,sign*length*.70)),mul(direction,length*.39)),size=r(.47,.88);
            end[1]+=r(.21,.62)*length;
            branchTube([start,elbow,end],[limbR*.34,limbR*.22,.015],woodCol,5);
            sprayAzimuth=a+sign*.76;
            crown(mix(elbow,end,.32),size*.75,size*.58,r(-.51,.44),tint(col,r(.82,.98)),q+k);
            crown(end,size*1.06,size*.76,r(-.50,.55),tint(col,r(.93,1.12)),q*3+k);
          }
          state=keep;
        }
        sprayAzimuth=a;
        if(pine){
          for(let q=0;q<6;q++){
            const frac=.23+.131*q,sgn=q%2?1:-1,pc=mix(bend,tip,frac),dr=mul([-Math.sin(a),0,Math.cos(a)],sgn*(.24+.33*frac)*rad),
              ee=add(pc,dr),hue=tint(col,r(.78,1.12));ee[1]+=rad*(.07+.085*frac);
            branchTube([pc,ee],[limbR*.19,.014],woodCol,4);
            const level=.65+1.08*Math.sin(frac*Math.PI*.92);
            crown(mix(pc,ee,.63),level*r(.74,1.04),level*r(.23,.49),r(-.21,.21),hue,rand()*16|0);
            crown(ee,level*r(.58,.85),level*r(.29,.51),r(-.28,.27),tint(hue,1.09),rand()*16|0);
          }
        }
        if(old&&k%6===2){
          const bare=add(tip,[r(-.6,.6),r(.55,1.48),r(-.73,.91)]);
          branchTube([mid,tip,bare],[limbR*.31,limbR*.19,.018],woodCol,4);continue;
        }
        const crownR=(pion?.65:pine?.95:umbrella?1.44:euc?1.14:1.31)*r(.79,1.40);
        let nSprigs=pendant?4:pion?3:pine?2:2+(rand()*3|0);
        for(let j=0;j<nSprigs;j++){
          const off=(j-(nSprigs-1)*.5)*r(.57,.92),angle=a+off,
            reach=r(.38,1.35)*(umbrella?1.36:1),start=mix(mid,tip,r(.46,.94)),
            end=add(tip,[Math.cos(angle)*reach,r(-.28,.78),Math.sin(angle)*reach]);
          if(pendant)end[1]-=r(.46,1.54);if(euc)end[1]-=r(.06,.95);
          branchTube([start,mix(start,end,.61),end],[limbR*.25,limbR*.15,.008],woodCol,4);
          const size=crownR*r(.69,1.19),height=size*pr[4]*r(.68,1.22),blossom=flower&&Math.sin(k*1.74+stem*2+j*.79)>.02,
            hue=tint(blossom?flower:col,r(.81,1.13));
          if(fineShoots&&(j+k+stem)%3===0){
            fineShoots.push({o:end,angle,size,hue:col,petal:blossom?flower:null});
          }
          bloomSpray=!!blossom;sprayAzimuth=angle;
          if((j+k+species)%3===0){
            const saved=state,angle2=angle+r(-.9,.91),dir=[Math.cos(angle2),0,Math.sin(angle2)],
              tip2=add(end,mul(dir,size*r(1.08,1.49))),axis=[-dir[2],0,dir[0]];
            tip2[1]+=height*r(.39,.97);
            const fork2=mix(end,tip2,r(.55,.76)),bark=tint(woodCol,r(1.08,1.23));
            fork2[1]-=size*.27;branchTube([end,fork2,tip2],[.037,.022,.008],bark,4);
            for(const sig of [-1,1]){
              const twigTip=add(mix(fork2,tip2,.76),mul(axis,sig*size*r(.20,.55)));twigTip[1]+=size*r(.07,.26);
              branchTube([fork2,twigTip],[.019,.005],bark,4);
              crown(twigTip,size*r(.18,.36),height*r(.19,.41),r(-.43,.44),tint(hue,1.08),[0,4,8,12][rand()*4|0]);
            }
            state=saved;
          }
          if(pion&&k%3===0){for(let f=0;f<6;f++){const ang=a+f*1.047;feather(end,size*r(.74,1.43),[Math.cos(ang),0,Math.sin(ang)],tint(hue,1.14),size*.26);}}
          else{
            crown(end,size*r(.87,1.26),height,r(-.46,.46),hue,rand()*16|0);
            for(let f=0;f<(pine?2:pendant?2:3);f++){
              const ang=angle+f*2.40,pc=add(end,[Math.cos(ang)*size*r(.35,.71),height*r(-.49,.47),Math.sin(ang)*size*r(.28,.69)]);
              if(pendant)pc[1]-=height*.37;
              sprayAzimuth=angle+Math.sin(f*1.98+angle)*.69;
              crown(pc,size*r(.46,.91),height*r(.50,.94),r(-.66,.66),tint(hue,r(.88,1.13)),rand()*16|0);
            }
          }
        }
      }
      bloomSpray=false;
      const cap=trunkP(1);lobe(cap,r(.78,1.55),r(.59,1.49)*pr[4],r(.77,1.42),col,7);
    }
    bakeSprayLight(branchLeaves);branchLeaves=null;floraSpecies=-1;
    if(old||umbrella){
      // In the shaded interior the thin hanging vines retain empty space between major forks.
      for(let k=0;k<3;k++){
        const a=phi+k*1.94,x=Math.cos(a)*R*.66,z=Math.sin(a)*R*.67,y=r(.56,.70)*H,len=r(1.7,3.8);
        branchTube([[x,y,z],[x+.11,y-len*.32,z-.16],[x-.18,y-len*.73,z+.14],[x-.02,y-len,z+.1]],[.022,.018,.015,.010],tint(woodCol,.74),4);
      }
    }
  }
  const palette=[
    [[.287,.384,.201],[.354,.397,.219],[.321,.378,.260]],[[.365,.440,.314],[.41,.45,.34],[.31,.409,.317]],
    [[.232,.319,.236],[.249,.335,.239]],[[.38,.403,.229],[.358,.390,.248],[.315,.370,.258]],
    [[.400,.433,.251],[.357,.399,.229]],[[.323,.378,.207],[.378,.384,.216],[.333,.401,.242]],
    [[.31,.351,.221],[.348,.368,.220]],[[.416,.459,.328],[.370,.439,.31]]
  ];
  const summerGrowth=new Map();
  function treeTemplate(species,col,flower=null){
    const shoots=[];
    fineShoots=shoots;
    const trunk=template(()=>tree(species,col,flower));
    fineShoots=null;
    const saved=state;
    const leafMesh=template(()=>{
      function blade(root,angle,len,breadth,raise,droop,pigment){
        const dv=[Math.cos(angle),0,Math.sin(angle)],side=[-dv[2],0,dv[0]];
        const mid=add(add(root,mul(dv,len*.41)),[0,raise*.51+.16*len,0]);
        const ridge=add(mid,[0,.34*breadth,0]),turn=r(-.18,.18)*len;
        const tip=add(add(add(root,mul(dv,len)),mul(side,turn)),[0,raise-droop,0]);
        const a=add(mid,mul(side,breadth)),b=sub(mid,mul(side,breadth));
        const up=norm([-dv[0]*raise/len,1.1,-dv[2]*raise/len]),
          nl=norm(add(up,mul(side,.42))),nr=norm(sub(up,mul(side,.47)));
        G.tri(root,a,ridge,pigment,16,0,up,nl,up,[2,0],[2.5,.44],[2,.44]);
        G.tri(a,tip,ridge,pigment,16,0,nl,up,up,[2.5,.44],[2,1],[2,.44]);
        G.tri(ridge,b,root,pigment,16,0,up,nr,up,[2,.44],[1.5,.44],[2,0]);
        G.tri(tip,b,ridge,pigment,16,0,up,nr,up,[2,1],[1.5,.44],[2,.44]);
      }
      for(const bud of shoots){
        const {o,angle,size,hue,petal}=bud,shoots=species===2?3:2+(rand()*2|0);
        for(let j=0;j<shoots;j++){
          const az=angle+(j-(shoots-1)*.5)*1.13+r(-.35,.35),axis=[Math.cos(az),0,Math.sin(az)],
            len=size*r(.64,1.49),up=size*(species===4?r(-.21,.31):r(.14,.94)),side=[-axis[2],0,axis[0]];
          const root=add(o,mul(axis,-.27*len));
          const crooked=r(-.31,.31)*len;
          const twig=t=>add(add(add(root,mul(axis,len*t)),mul(side,crooked*t*t)),[0,up*t-.38*len*t*t,0]);
          // Split the twig once so the outer leaves have genuine depth against the skyline.
          const crotch=twig(.45),top=twig(1),bark=tint([.345,.322,.214],r(.79,1.19));
          G.beam(root,crotch,.012,.011,bark);G.beam(crotch,top,.01,.009,bark);
          const pairs=species===2?7:4+(rand()*3|0);
          for(let k=0;k<pairs;k++)for(const sign of [-1,1]){
            const t=(k+.52+r(-.21,.21))/pairs,at=twig(t),br=az+sign*r(.66,1.28);
            const sz=(species===2?r(.105,.181):r(.093,.183))*(1.-.34*t),
              width=sz*(species===2?.099:species===1?.167:r(.23,.44));
            blade(at,br,sz,width,r(.015,.073)*size,r(.013,.085)*size,tint(hue,r(.82,1.26)));
          }
          if(petal && j%2===0){
            for(let f=0;f<6;f++){
              const a=r(0,6.28),at=add(top,[Math.cos(a)*r(.015,.063),r(-.019,.053),Math.sin(a)*r(.015,.063)]);
              const tintPetal=tint(petal,r(1.02,1.37)),radius=r(.024,.046);
              for(let q=0;q<5;q++)blade(at,a+q*1.2566,radius,radius*.52,radius*.68,radius*.61,tintPetal);
            }
          }
        }
      }
    });
    summerGrowth.set(trunk,leafMesh);state=saved;
    return trunk;
  }
  const trees=[];
  for(let species=0;species<profiles.length;species++)for(let j=0;j<(species===2||species===7?3:5);j++){
    const hue=tint(pick(palette[species]),r(.88,1.09));
    trees.push(treeTemplate(species,hue));
  }
  const bushes=[];
  for(let i=0;i<11;i++){
    const hue=pick([[.367,.419,.218],[.282,.367,.218],[.343,.392,.20],[.427,.436,.242],[.373,.391,.260],[.346,.371,.249]]);
    bushes.push(template(()=>{
      const nt=3+(rand()*6|0),phase=r(0,6.28),wide=r(.61,1.28),ht=r(.51,1.51);
      for(let j=0;j<nt;j++){
        const t=j*2.40+phase,rad=j===0?0:r(.33,1.48)*wide,yy=r(.36,1.09)*ht;
        const c=[Math.cos(t)*rad,yy,Math.sin(t)*rad],size=r(.62,1.22);
        if(i%5===1){for(let k=0;k<6;k++){const a=k*1.047+t;feather([c[0],.13,c[2]],size*r(.82,1.21),[Math.cos(a),0,Math.sin(a)],hue,.15);}}
        else lobe(c,size*wide,size*ht*r(.55,.85),size*wide,hue,5);
      }
    }));
  }
  // Arching canes, bare-branched shrubs and heliconias have different branching
  // patterns and leaf scales, including gaps through which the forest floor shows.
  {
    const forestState=state;state=0x372cbc43;
    function lance(base,axis,length,width,rise,droop,col){
      const across=[-axis[2]*width,0,axis[0]*width];
      const place=t=>[base[0]+axis[0]*length*t,base[1]+rise*t-droop*t*t,base[2]+axis[2]*length*t];
      const a=base,m=place(.45),t=place(1),vein=add(m,[0,width*.39,0]);
      const b=add(m,across),d=sub(m,across);
      G.tri(a,b,vein,tint(col,.92));G.tri(a,vein,d,col);
      G.tri(b,t,vein,tint(col,.91));G.tri(vein,t,d,col);
    }
    for(let v=0;v<12;v++)bushes.push(template(()=>{
      const form=v%4,phase=r(0,6.28);
      const hue=pick([[.31,.420,.235],[.397,.462,.246],[.287,.390,.283],[.400,.445,.235],[.260,.366,.202]]);
      const stems=form===0?7:form===1?4:form===2?6:3;
      for(let k=0;k<stems;k++){
        const a=k*2.39996+phase+r(-.37,.37),axis=[Math.cos(a),0,Math.sin(a)];
        const H=form===0?r(.68,1.51):form===1?r(1.22,2.07):form===2?r(1.14,2.00):r(.74,1.31);
        const foot=[axis[0]*r(.04,.32),-.02,axis[2]*r(.04,.32)];
        if(form===0){ // broad ribbed leaves grouped on individual petioles
          const tip=add(foot,[axis[0]*.29,H*.42,axis[2]*.29]);
          G.cyl(foot,tip,.022,.011,5,tint(hue,.77),15);
          lance(tip,axis,r(.60,1.21),r(.096,.169),H*.93,H*.69,tint(hue,r(.82,1.12)));
        }else{
          const reach=form===1?r(.31,.83):form===2?r(.55,.98):r(.69,1.26);
          const crownAt=t=>add(foot,[axis[0]*reach*t*t,H*t-.26*reach*t*t,axis[2]*reach*t*t]);
          const wood=form===1?[.391,.351,.245]:form===2?[.386,.441,.225]:[.349,.303,.214];
          branchTube([foot,crownAt(.34),crownAt(.73),crownAt(1)],form===1?[.045,.031,.019,.006]:[.025,.020,.012,.004],wood,5);
          const sprays=form===1?4:form===2?5:4;
          for(let j=0;j<sprays;j++){
            const u=(j+r(.16,.75))/sprays,root=crownAt(.24+.74*u),ang=a+(j%2?1:-1)*r(.37,1.89),out=[Math.cos(ang),0,Math.sin(ang)];
            const ext=(form===2?.25:.58)*(1.16-u*.53)*r(.68,1.33);
            const tip=add(root,[ext*out[0],ext*(form===3?.11:.65),ext*out[2]]);
            G.cyl(root,tip,form===1?.013:.009,.004,4,wood,15);
            if(form===1){
              if(j<1 && k%2===0)continue;
              crown(tip,r(.235,.44),r(.19,.36),r(-1.06,1.06),tint(hue,r(.78,1.13)),rand()*16|0);
            }else{
              const leaves=form===2?5:6;
              for(let z=0;z<leaves;z++){
                const l=(z+.64)/leaves,origin=add(root,mul(sub(tip,root),l));
                const t=ang+(z%2?1:-1)*r(.47,1.25),dir=[Math.cos(t),0,Math.sin(t)];
                lance(origin,dir,form===2?r(.19,.36):r(.12,.27),form===2?r(.025,.043):r(.032,.062),
                  r(.063,.143),r(.067,.149),tint(hue,r(.83,1.20)));
              }
            }
          }
        }
      }
    }));
    state=forestState;
  }
  function clearance(p,x,z){
    if(restricted(x,z))return 34;
    for(const [a,b] of gravelAreas)if(p[1]>=a&&p[1]<=b)return 19;
    return 13.2;
  }
  const graniteSites=[
      [304,-1,27,12.9,3.6,6.4,.31],[317,-1,24,17.1,5.8,7.1,.13],[333,-1,20.8,11.7,4.4,4.8,-.13],
      [347,-1,23,9.7,3.4,4.2,.51],[417,1,28,10.8,3.1,5.5,-.29],[431,1,23,8.9,3.7,7.2,.31]
    ];
  const outcrops=graniteSites.map(([s,side,off,length,height,depth,tilt])=>{
    const p=pAt(s,side*off),road=trackSample(s,[]),az=Math.atan2(road[3],road[5])+tilt;
    return [p[0],p[2],Math.cos(az),Math.sin(az),depth,length];
  });
  function bareGranite(x,z){
    for(const [px,pz,c,s,depth,length] of outcrops){
      const dx=x-px,dz=z-pz,u=(c*dx-s*dz)/depth,v=(s*dx+c*dz)/length;
      if(u*u+v*v<1.18)return true;
    }
    return false;
  }
  const floraSeed=state;state=0xd14a76d2;
  const paranaPines=Array.from({length:3},(_,variant)=>template(()=>{
    const H=14.8+2.7*variant,rad=4.0+.69*variant,lean=r(-.47,.42),turn=r(0,6.28);
    const bark=[.36,.326,.260],leaf=[.204,.326,.232];
    const stem=t=>[lean*t+.14*Math.sin(t*3.2),H*t,.21*t*t-.13*Math.sin(t*4.1)];
    const ts=[-.015,.018,.075,.27,.51,.68,.78,.88,.96,1];
    branchTube(ts.map(stem),ts.map((t,j)=>(j===0?.67:j===1?.52:.395)*Math.sqrt(Math.max(.009,1.-t))),bark,12);
    floraSpecies=2;branchLeaves=[];
    // Mature A. angustifolia retains a narrow umbrella of upturned, tufted limbs
    // above most of its long, clear bole. Old lower branch collars remain visible.
    for(let j=0;j<9;j++){
      const ang=j*2.399+turn,t=.28+.039*j,at=stem(t),reach=r(.16,.48);
      const d=[Math.cos(ang),0,Math.sin(ang)];
      branchTube([at,add(at,mul(d,.28)),add(add(at,mul(d,reach+.29)),[0,-.18,0])],[.104,.099,.038],bark,6);
    }
    for(let k=0;k<24;k++){
      const tier=k<9?0:k<17?1:2,idx=k-(tier===0?0:tier===1?9:17);
      const a=turn+idx*6.283/(tier===0?9:tier===1?8:7)+tier*.92+r(-.21,.21);
      const radial=[Math.cos(a),0,Math.sin(a)],side=[-radial[2],0,radial[0]];
      const t=.704+tier*.096+r(-.019,.022),at=stem(t),reach=rad*r(.76,1.15)*(1.-.17*tier),lift=H*(.134-.031*tier)*r(.87,1.21);
      const b=add(add(at,mul(radial,reach*.36)),[0,-.48,0]),c=add(add(at,mul(radial,reach*.77)),[0,lift*.25,0]),end=add(add(at,mul(radial,reach)),[0,lift,0]);
      branchTube([at,b,c,end],[.19-.032*tier,.142-.025*tier,.095,.023],bark,7);
      for(let j=0;j<5;j++){
        const f=.20+j*.16,sg=j%2?1:-1,mid=mix(b,end,f);
        const tip=add(add(mid,mul(side,sg*reach*(.27-.12*f))),[radial[0]*.36,lift*(.25+.09*f),radial[2]*.36]);
        branchTube([mid,mix(mid,tip,.49),tip],[.056,.040,.012],bark,5);
        sprayAzimuth=a+sg*.77;
        const w=.65+.33*(1.-f),h=.35+.20*f;
        crown(tip,w,h,r(-.45,.45),tint(leaf,r(.91,1.19)),j+variant);
        crown(mix(mid,tip,.66),w*.82,h*.88,r(-.47,.43),tint(leaf,r(.79,1.10)),j+2);
      }
      sprayAzimuth=a;crown(end,.97,.56,r(-.34,.29),tint(leaf,r(.97,1.25)),k);
    }
    bakeSprayLight(branchLeaves);branchLeaves=null;floraSpecies=-1;
  }));
  // Tall seed panicles and folded blades colonise the windy north shoulder.
  const silverGrass=Array.from({length:3},(_,variant)=>template(()=>{
    for(let j=0;j<24;j++){
      const a=j*2.39996+r(-.24,.24),dx=Math.cos(a),dz=Math.sin(a),side=[-dz,0,dx];
      const extent=r(.34,.81),h=r(.31,.73),base=r(.13,.34),root=[dx*base,-.025,dz*base];
      const mid=[root[0]+dx*extent*.47,h*.87,root[2]+dz*extent*.47],tip=[root[0]+dx*extent,h*r(.41,.75),root[2]+dz*extent+.067],w=r(.009,.017);
      const b=add(root,mul(side,w)),c=sub(root,mul(side,w)),l=add(mid,mul(side,w*.81)),n=sub(mid,mul(side,w*.81));
      const col=tint([.452,.444,.273],r(.76,1.12)),up=norm([dx,.36,dz]);
      G.tri(b,c,n,col,16,0,up,up,up,[0,0],[1,0],[1,.55]);G.tri(b,n,l,col,16,0,up,up,up,[0,0],[1,.55],[0,.55]);
      G.tri(l,n,tip,col,16,0,up,up,up,[0,.55],[1,.55],[.5,1]);
      if(j%7)continue;
      const plume=add(mid,[dx*.12,.26+variant*.056,dz*.12]),sway=[dx*.11,.17,dz*.11];
      G.beam(root,plume,.008,.008,[.480,.442,.271],0);
      for(let q=0;q<9;q++){
        const t=q/9,at=add(plume,mul(sway,t)),w=.018*(1-t*.70),top=add(at,[dx*.021,.045,dz*.021]);
        const seed=tint([.767,.698,.456],r(.82,1.11));
        G.tri(sub(at,mul(side,w)),top,add(at,mul(side,w)),seed,16,0,up,up,up);
        const across=[w*dx,0,w*dz];G.tri(sub(at,across),top,add(at,across),seed,16,0,up,up,up);
      }
    }
  }));
  state=floraSeed;
  function plant(ids,x,z,sz,sy=1){
    let id=pick(ids);const angle=r(0,6.283),szZ=sz*r(.91,1.09);
    if(bareGranite(x,z))return;
    const opening=northMeadow(x,z),highland=southRidge(x,z),v=angle/6.283;
    if(ids===trees){
      // Small groups track drainage and leave long, asymmetric views across the saddle.
      const knoll=.5+.5*Math.sin(x*.13-z*.067)*Math.cos(z*.113+x*.047);
      if(v<opening*(.87+.19*knoll))return;
      if(highland>.18){
        if(v<highland*(.50+.41*knoll)){
          id=paranaPines[(Math.abs(Math.floor(x*.23+z*.19)))%3];sz*=.91+.21*knoll;
        }else if(v<highland*.94)return;
      }
      if(regionFalloff(x,z,173,-75,46,56)>.22 && v>.28)id=trees[5+Math.floor(v*4.99)];
    }else if(ids===bushes){
      if(v<opening*.97){id=silverGrass[Math.abs(Math.floor(x*.3-z*.14))%3];sz*=.82;}
      else if(v<highland*.83)sz*=.54;
    }
    const y=soilAt(x,z)-.18;
    G.instance(id,x,y,z,angle,sz,sz*sy,szZ);
    if(summerGrowth.has(id)&&nearest(x,z)[0]<36)G.instance(summerGrowth.get(id),x,y,z,angle,sz,sz*sy,szZ);
  }
  // Naturally clustered woodland. Keep the pits in a clearing with a deep, broken skyline beyond.
  for(let iz=-245;iz<236;iz+=8.35)for(let ix=-118;ix<293;ix+=8.35){
    const x=ix+r(-3.9,3.9),z=iz+r(-3.9,3.9),p=nearest(x,z);
    if(p[0]<clearance(p,x,z)||restricted(x,z))continue;
    const groves=.5+.22*Math.sin(.052*x+.035*z)+.21*Math.cos(z*.061-x*.042)+.17*Math.cos(x*.10+z*.069);
    if(rand()>.28+.54*groves)continue;
    if(p[0]>64 && rand()>.40)continue;
    if(x>35&&x<78&&z>-74&&z<50&&rand()>.27)continue;
    plant(trees,x,z,r(.66,1.27),r(.94,1.14));
    if(p[0]<63){
      const n=2+(rand()*3|0);
      for(let j=0;j<n;j++){const bx=x+r(-4.0,4.0),bz=z+r(-4.0,4.0);plant(bushes,bx,bz,r(.61,1.75));}
    }
  }
  {
    const keep=state;state=0xba439217;
    const streamWood=trees.slice(13,18).concat(trees.slice(23,28));
    for(const [s,side,offset,sz] of [[417,-1,14.8,1.29],[431,1,14.1,1.42],[439,-1,13.7,1.24],
      [452,1,15.9,1.45],[463,-1,14.0,1.50],[478,1,13.9,1.20],[486,-1,13.6,1.25]]){
      const at=pAt(s,side*Math.max(offset,setback(s,side)+4.3));
      if(nearest(at[0],at[2])[0]<12.6||bareGranite(at[0],at[2]))continue;
      plant(streamWood,at[0],at[2],sz,.97);
    }
    state=keep;
  }
  // A few groups to frame the climb and backlight the start-line buildings.
  for(const [x,z,sc] of [[-31,28,1.20],[-33,46,1.18],[-31,-35,1.12],[-34,-42,1.31],[27,35,1.10],[27,41,1.15],[29,7,1.2],[30,-55,1.11],[-20,-84,1.32],[-26,-91,1.24],[-28,-101,1.13]]){
    plant(trees,x,z,sc);plant(bushes,x+2.8,z+1.4,1.2);
  }
  // The cut at the middle hairpin exposes a quartz-bearing granite shoulder. Its jointed
  // faces sit below the fern wood, followed by a flowering manacá grove on the return.
  {
    const previous=state;state=0x53c96ae9;
    const rockMeshes=[],talus=[];
    const bedrockState=state;
    // Intersect tilted fracture planes with a single weathered granite dome.
    // The neighbouring blocks share the same broad surface and meet below the joints.
    function granite(variant,detached){
      const rot=r(0,6.28),c=Math.cos(rot),sn=Math.sin(rot),cells=[],count=detached?1:17+variant*2;
      const boundary=[];
      for(let i=0;i<40;i++){
        const a=6.283185*i/40,rad=.96+.049*Math.cos(3*a+rot)+.044*Math.cos(5*a-variant)+.026*Math.sin(7*a+rot);
        boundary.push([rad*Math.cos(a),rad*Math.sin(a)]);
      }
      for(let i=0;i<count;i++){
        const a=i*2.39996+rot+r(-.25,.25),radius=i?Math.sqrt((i-.10)/count)*r(.87,1.025):0;
        cells.push([radius*Math.cos(a)+r(-.05,.05),radius*Math.sin(a)+r(-.05,.05)]);
      }
      function elevation(x,z){
        const radial=Math.sqrt((x*.99-.10)**2+(z*1.005+.04)**2);
        const t=Math.max(0,1-Math.pow(Math.min(1.06,radial)*.93,2.4));
        return .12+Math.pow(t,.57)*(.80+.14*x-.10*z+.11*Math.sin(2.18*z-2.51*x+rot)+.049*Math.cos(x*7.6+z*5.25+variant));
      }
      for(let j=0;j<count;j++){
        const a=cells[j];let poly=boundary;
        for(let k=0;k<count;k++)if(k!==j){
          const b=cells[k],nx=b[0]-a[0],nz=b[1]-a[1],mid=.5*(nx*(b[0]+a[0])+nz*(b[1]+a[1])),clip=[];
          for(let q=0;q<poly.length;q++){
            const u=poly[q],v=poly[(q+1)%poly.length],du=nx*u[0]+nz*u[1]-mid,dv=nx*v[0]+nz*v[1]-mid;
            if(du<=0)clip.push(u);
            if((du<0)!==(dv<0)){const t=du/(du-dv);clip.push([u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t]);}
          }
          poly=clip;
        }
        if(poly.length<3)continue;
        let x=0,z=0;
        for(const v of poly){x+=v[0]/poly.length;z+=v[1]/poly.length;}
        const ox=r(-.159,.133),tiltX=r(-.29,.28),tiltZ=r(-.33,.27),phase=r(0,6.28);
        const stone=tint([.500,.472,.429],r(.79,1.16)),outline=[];
        // Corners spall along a third set of fractures; broad faces retain their planes.
        for(let q=0;q<poly.length;q++){
          const prev=poly[(q+poly.length-1)%poly.length],pt=poly[q],next=poly[(q+1)%poly.length];
          function toward(dir,amount){return [pt[0]+(dir[0]-pt[0])*amount,pt[1]+(dir[1]-pt[1])*amount];}
          const sharp=(prev[0]-pt[0])*(next[0]-pt[0])+(prev[1]-pt[1])*(next[1]-pt[1]);
          if(sharp>-.08){outline.push(toward(prev,.089),toward(next,.101));}
          else outline.push(pt);
          if(Math.hypot(next[0]-pt[0],next[1]-pt[1])>.25)outline.push(toward(next,.48));
        }
        const rows=[],n=outline.length,capY=(px,pz)=>elevation(px,pz)+ox+(px-x)*tiltX+(pz-z)*tiltZ;
        for(let ring=0;ring<7;ring++){
          const row=[];
          for(const v of outline){
            const dx=v[0]-x,dz=v[1]-z;
            const ripple=Math.sin(v[0]*16.31+v[1]*11.82+phase)*.5+.5*Math.cos(v[1]*31.7-v[0]*17.43);
            const outer=ring===0?1.03:ring===1?1.018:ring===2?.983:ring===3?.960:ring===4?.915:ring===5?.79:.43;
            const sh=outer+(ring>1&&ring<6?ripple*.044:0);
            const px=x+dx*sh,pz=z+dz*sh;
            const h=capY(px,pz),bevel=.058+.033*ripple;
            const y=ring===0?-.46:ring===1?h-.42+.055*ripple:ring===2?h-.225+.048*ripple:ring===3?h-.11+.036*ripple:ring===4?h-bevel:ring===5?h+.005:h+.055+.021*ripple;
            // Slight lean along the common regional joint direction.
            row.push([px+.075*(1-h+Math.max(0,h-y))*c,y,pz+.055*(1-h+Math.max(0,h-y))*sn]);
          }
          rows.push(row);
        }
        const top=[x,capY(x,z)+.069,z];
        const norms=rows.map((row,k)=>row.map((p,q)=>{
          const along=sub(row[(q+1)%n],row[(q+n-1)%n]),up=sub(rows[Math.min(6,k+1)][q],rows[Math.max(0,k-1)][q]);
          return norm(cross(up,along));
        }));
        const lightAt=[.44,.55,.73,.84,.90,.99,1.];
        for(let k=1;k<7;k++)for(let q=0;q<n;q++){
          const w=(q+1)%n,a=rows[k-1][q],b=rows[k][q],c=rows[k][w],d=rows[k-1][w];
          const f=norm(cross(sub(b,a),sub(d,a))),normal=(ki,qi)=>norm(mix(norms[ki][qi],f,.30));
          const aUV=[lightAt[k-1],0],bUV=[lightAt[k],0];
          G.tri(a,b,c,stone,51,0,normal(k-1,q),normal(k,q),normal(k,w),aUV,bUV,bUV);
          G.tri(a,c,d,stone,51,0,normal(k-1,q),normal(k,w),normal(k-1,w),aUV,bUV,aUV);
        }
        for(let q=0;q<n;q++){
          const w=(q+1)%n;
          G.tri(rows[6][q],top,rows[6][w],stone,51,0,norms[6][q],[0,1,0],norms[6][w],[1,0],[1,0],[1,0]);
        }
      }
    }
    for(let i=0;i<5;i++){rockMeshes.push(template(()=>granite(i,false)));talus.push(template(()=>granite(i,true)));}
    state=bedrockState;
    // Keep the seeded placement of the independent flowering grove and tree ferns.
    for(let i=0;i<20;i++)rand();
    for(const [s,side,dist,length,height,depth,tilt] of graniteSites){
      const p=pAt(s,dist*side),road=trackSample(s,[]),az=Math.atan2(road[3],road[5])+tilt;
      p[1]=earthHeight(p[0],p[2])-.30;G.instance(pick(rockMeshes),...p,az,depth,height,length);
      for(let k=0;k<13;k++){
        const d=r(.5,2.6),at=pAt(s+r(-length*.94,length*.94),side*(dist-r(depth*.59,depth+1.6)));
        if(nearest(at[0],at[2])[0]<W+3.5)continue;
        at[1]=earthHeight(at[0],at[2])-.18;G.instance(pick(talus),...at,az+r(-.82,.82),d*r(.68,1.20),d*r(.37,.65),d*r(.74,1.56));
      }
    }
    const blossoms=[treeTemplate(0,[.302,.374,.239],[.685,.452,.642]),treeTemplate(3,[.365,.407,.256],[.774,.572,.687]),
      treeTemplate(5,[.329,.379,.234],[.592,.421,.598])];
    const fernSeed=state;
    const treeFerns=Array.from({length:3},(_,ix)=>template(()=>{
      const h=[2.64,3.61,4.26][ix],ox=[.27,-.57,.42][ix],oz=[.14,.19,-.49][ix],
        tip=[ox,h,oz],col=tint([.273,.266,.188],r(.84,1.15)),phi=r(0,6.28);
      branchTube([[0,-.2,0],[ox*.19,h*.32,-oz*.07],[ox*.64,h*.75,oz*.43],tip],[.18,.13,.128,.153],col,8);
      // Dark petiole bases and old, broken fronds persist under the living crown.
      for(let j=0;j<11;j++){
        const a=j*2.39996+phi,dir=[Math.sin(a),0,Math.cos(a)],age=(j%3)*.14,
          root=add(tip,mul(dir,.12)),join=add(root,[dir[0]*.24,-.15-age,dir[2]*.24]),
          end=add(join,[dir[0]*.14,-.30-r(.01,.32),dir[2]*.14]);
        branchTube([root,join,end],[.044,.032,.012],tint([.323,.284,.179],r(.81,1.07)),5);
      }
      const count=ix===0?13:ix===1?17:15;
      for(let j=0;j<count;j++){
        const a=j*2.39996+phi+r(-.23,.23),dir=[Math.sin(a),0,Math.cos(a)],old=j%6===0,young=j%4===1&&!old;
        const root=add(tip,mul(dir,r(.05,.12)));root[1]-=old?.16:young?-.05:.028;
        const len=(young?r(.95,1.42):r(1.43,2.31))*(.93+.13*Math.cos(a-phi)),
          droop=old?r(.92,1.43):young?r(.09,.25):r(.37,.81),lift=old?r(.46,.77):young?r(1.64,2.22):r(.91,1.47);
        const pigment=old?[.344,.356,.197]:young?[.365,.465,.249]:[.269,.389,.230];
        feather(root,len,dir,tint(pigment,r(.86,1.14)),droop,lift);
      }
    }));
    state=fernSeed;
    for(let j=0;j<39;j++){
      const s=484+(.5+.5*Math.sin(j*.89))*82+r(-4,4),side=j%5===0?-1:1,d=side*(W+r(8.5,15.6)),
        at=pAt(s,d),near=nearest(at[0],at[2]);if(near[0]<15)continue;
      at[1]=earthHeight(at[0],at[2])-.16;const sz=r(.69,1.06);
      const treeId=pick(blossoms),az=r(0,6.28),sy=sz*r(.84,1.04);
      G.instance(treeId,...at,az,sz,sy,sz);G.instance(summerGrowth.get(treeId),...at,az,sz,sy,sz);
    }
    for(let j=0;j<76;j++){
      const s=(j%3===0?310:383)+r(-31,30),side=j%3===0?-1:1,at=pAt(s,side*r(12.3,24)),near=nearest(at[0],at[2]);if(near[0]<11.5)continue;
      at[1]=earthHeight(at[0],at[2])-.15;const sz=r(.36,1.31);
      const id=pick(treeFerns),angle=r(0,6.28),sy=sz*r(.90,1.08);
      if(!bareGranite(at[0],at[2]))G.instance(id,...at,angle,sz,sy,sz);
    }
    // Ferns root in soil along the broken foot of the slabs. Their fronds break
    // the otherwise bare contact between the scree and the forest floor.
    for(const [cx,cz,co,si,depth,length] of outcrops){
      for(let j=0;j<19;j++){
        const a=r(0,6.283),edge=r(1.09,1.28),lx=Math.cos(a)*edge*depth,lz=Math.sin(a)*edge*length;
        const x=cx+co*lx+si*lz,z=cz-si*lx+co*lz;
        if(bareGranite(x,z)||nearest(x,z)[0]<W+4.1)continue;
        const sz=r(.25,.66),id=pick(j%5?bushes:treeFerns);
        G.instance(id,x,earthHeight(x,z)-.081,z,r(0,6.283),sz,sz*r(.79,1.09),sz);
      }
    }
    state=previous;
  }
  function setback(s,side){
    let off=runoffWidth(s,side);
    for(const [lo,hi,sideOfKerb] of corners)if(side===sideOfKerb&&s>=lo&&s<=hi)off=Math.max(off,1.68);
    return W+off;
  }
  function patch(s,side,off,ax,az,mat,col,h){
    const f=(x,z)=>pAt(s+z,(off+x)*side,h);
    const seg=11,center=f(0,0),pp=[];
    for(let i=0;i<seg;i++){
      let a=2*Math.PI*i/seg,j=r(.69,1.18);pp.push(f(Math.cos(a)*ax*j,Math.sin(a)*az*j));
    }
    for(let i=0;i<seg;i++)
      G.tri(center,pp[i],pp[(i+1)%seg],col,mat,0,[0,1,0],[0,1,0],[0,1,0],[1,0],[0,0],[0,1]);
  }
  // Weathered verges, low rosettes, ferns, seed heads, scattered dry litter and meadow flowers.
  const fern=Array.from({length:3},(_,j)=>template(()=>{
    for(let k=0;k<8;k++){
      const a=k*2.39996+r(-.22,.22),dx=Math.cos(a),dz=Math.sin(a),l=r(.21,.56),h=r(.21,.48),base=[dx*.025,.017,dz*.025];
      const at=t=>[dx*l*t,h*Math.sin(t*2.13)+.013,dz*l*t],c=tint([[.26,.39,.207],[.37,.436,.237],[.459,.452,.235]][j],r(.91,1.18));
      const left=[-dz*.010,0,dx*.010],mid=at(.56),tip=at(1);
      G.quad(sub(base,left),add(base,left),add(mid,left),sub(mid,left),c,0);G.tri(sub(mid,left),add(mid,left),tip,c,0);
      for(let q=1;q<7;q++)for(const side of [-1,1]){
        const t=q/7.5,u=at(t),w=(1-t*.84)*.117*side;
        const end=[u[0]-dz*w+dx*.038,u[1]+.015,u[2]+dx*w+dz*.038],v=at(t+.071);
        G.tri(u,end,v,c,0);
      }
    }
  }));
  const meadow=Array.from({length:3},(_,j)=>template(()=>{
    for(let k=0;k<9;k++){
      const x=r(-.49,.49),z=r(-.47,.47),h=r(.19,.52),dx=r(-.08,.08),dz=r(-.08,.08),
        bot=[x,0,z],top=[x+dx,h,z+dz],c=[.386,.409,.208];
      G.tri(bot,[x+.015,0,z+.009],top,c);
      for(let m=0;m<3;m++){
        const y=h*(.23+m*.15),sg=m%2?1:-1,p=[x+dx*y/h,y,z+dz*y/h];G.tri(p,add(p,[.055*sg,.06,.031]),add(p,[0,.037,0]),c);
      }
      const heads=j===1?3:5,seed=j===0?[.824,.762,.523]:j===1?[.773,.63,.216]:[.702,.664,.534];
      for(let m=0;m<heads;m++){
        const a=m*6.283/heads+.32,rx=(j===2?.018:.032)*Math.cos(a),rz=(j===2?.018:.032)*Math.sin(a);
        G.tri(top,add(top,[rx-rz*.39,.015,rz+rx*.39]),add(top,[rx+rz*.39,.012,rz-rx*.39]),seed);
      }
    }
  }));
  const stones=Array.from({length:4},(_,j)=>template(()=>{
    const seg=8,base=[],mid=[],cx=r(-.09,.09),cz=r(-.09,.09),col=pick([[.41,.39,.32],[.385,.379,.339],[.526,.49,.416],[.427,.422,.384]]);
    for(let k=0;k<seg;k++){
      const a=k*Math.PI/4,rad=r(.74,1.24);
      base.push([Math.cos(a)*rad*.78,-.15,Math.sin(a)*rad*.49]);
      mid.push([cx+Math.cos(a)*rad*r(.47,.74),r(.19,.43),cz+Math.sin(a)*rad*r(.30,.47)]);
    }
    const t=[cx+.12,r(.41,.59),cz-.071];for(let k=0;k<seg;k++){
      const q=(k+1)%seg;
      G.quad(base[k],mid[k],mid[q],base[q],tint(col,r(.87,1.04)),11);G.tri(mid[k],t,mid[q],tint(col,r(.95,1.09)),11);
    }
  }));
  const litter=Array.from({length:2},(_,j)=>template(()=>{
    for(let k=0;k<28;k++){
      const x=r(-.68,.68),z=r(-.65,.65),a=r(0,6.28),l=r(.036,.094),w=r(.013,.037),
        tang=[Math.cos(a)*l,0,Math.sin(a)*l],side=[-Math.sin(a)*w,.009,Math.cos(a)*w],
        o=[x,.009,z],v=add(o,tang),tip=add(v,mul(tang,.86)),c=tint(j?[.49,.377,.196]:[.329,.281,.175],r(.78,1.30));
      G.quad(o,add(v,side),tip,add(v,mul(side,-1)),c,0);
    }
  }));
  for(let i=0;i<540;i++){
    const s=r(2,length-1),side=rand()<.5?1:-1,off=setback(s,side),d=r(.3,4.1),p=pAt(s,side*(off+d));
    if(restricted(p[0],p[2]))continue;
    patch(s,side,off+d,r(.34,1.48),r(.36,3.7),i%4===0?24:22,
      tint(i%4===0?[.366,.325,.197]:[.432,.385,.255],r(.87,1.13)),-.132);
    if(i%2)continue;
    for(let k=0;k<r(2,5);k++){
      const at=pAt(s+r(-1.4,1.4),side*(off+d+r(-.19,.76)),-.135);
      G.instance(pick(litter),...at,r(0,6.28),r(.61,1.3),1,r(.61,1.3));
    }
  }
  for(let i=0;i<420;i++){
    const s=r(0,length),side=rand()<.5?-1:1,off=setback(s,side)+r(1.6,9.9),p=pAt(s,side*off,-.18);
    if(restricted(p[0],p[2]))continue;
    for(let j=0;j<r(5,13);j++){
      const d=r(-1.4,1.4),at=pAt(s+r(-2.1,2.1),side*(off+d),-.18),sz=r(.61,1.31);
      const windy=northMeadow(at[0],at[2]),open=windy>.39&&j%3===0;
      G.instance(pick(open?silverGrass:i%4===0?fern:meadow),...at,r(0,6.28),sz,sz*(open?.87+.52*windy:1),sz);
    }
    if(i%6===0 && off>W+6){
      for(let k=0;k<r(2,6);k++){const at=pAt(s+r(-2.3,2.3),side*(off+r(.4,1.9)),-.19),sz=r(.32,1.13);G.instance(pick(stones),...at,r(0,6.28),sz,sz,sz);}
    }
  }
  // Short, dense turf is underplanted from the edge of the gravel to the first shrubs.
  // Each small tuft has hundreds of tapered blades but costs only two triangles.
  const lawns=[];
  for(let i=0;i<8;i++)lawns.push(template(()=>{
    const n=4+(i%3),hue=pick([[.317,.379,.232],[.350,.392,.246],[.405,.414,.265],[.355,.395,.254]]);
    for(let j=0;j<n;j++){
      const theta=j*2.3999+r(-.3,.3),rad=j===0?0:r(.15,.58),height=r(.050,.116),
        o=[Math.cos(theta)*rad,height-.033,Math.sin(theta)*rad],half=r(.31,.57),v=Math.floor(rand()*16);
      crown(o,-half,height,r(-.039,.039),tint(hue,r(.85,1.12)),v);
    }
  }));
  for(let side=-1;side<=1;side+=2){
    for(let s=0;s<length;s+=.69){
      const edge=setback(s,side),pk=pAt(s,side*(edge+1));
      if(restricted(pk[0],pk[2])&&(s<110||s>length-38))continue;
      const cover=.86+.12*Math.sin(s*.081+side*.75)*Math.sin(s*.028+side);
      for(let j=0;j<8;j++){
        if(rand()>cover)continue;
        const atS=s+r(-.40,.40),dist=j<4?edge+(j+.37)*.66+r(-.32,.32):edge+2.54+(j-4)*1.58+r(-.71,.71),
          at=pAt(atS,side*dist,-.174),sz=r(.79,1.40),ht=r(.71,1.36)*(1+Math.min(.5,j*.21));
        if(j<4 && !corners.some(c=>side===c[2]&&atS>=c[0]&&atS<=c[1])){
          const width=runoffWidth(atS,side),transition=.31+.16*width,dis=width+transition*(j*.54-.78)+r(-.24,.24);
          const rooted=edgeHeight(atS,side,Math.max(.18,dis));
          at[0]=rooted[0];at[1]=rooted[1]-.027;at[2]=rooted[2];
        }else at[1]=earthHeight(at[0],at[2])-.022;
        G.instance(pick(lawns),...at,r(0,6.283),sz,ht,sz*r(.90,1.11));
      }
    }
  }
  // Tussocks composed of folding tapered blades, with seed heads in the dry grass.
  const tufts=Array.from({length:4},(_,n)=>template(()=>{
    for(let k=0;k<23;k++){
      const ox=r(-.59,.59),oz=r(-.55,.55),a=r(0,6.28),h=r(.18,.56),w=r(.010,.021),dx=Math.cos(a),dz=Math.sin(a),
        top=[ox+dx*h*.57,h,oz+dz*h*.57],mid=[ox+dx*h*.12,h*.57,oz+dz*h*.12],
        root=[ox,0,oz],side=[-dz*w,0,dx*w],col=tint(n%2?[.48,.486,.243]:[.38,.440,.224],r(.79,1.16));
      const l=sub(root,side),rr=add(root,side),ml=sub(mid,mul(side,.72)),mr=add(mid,mul(side,.72)),no=norm([dx,.54,dz]);
      G.tri(l,rr,mr,col,16,0,no,no,no,[0,0],[1,0],[1,.57]);G.tri(l,mr,ml,col,16,0,no,no,no,[0,0],[1,.57],[0,.57]);
      G.tri(ml,mr,top,col,16,0,no,no,no,[0,.57],[1,.57],[.5,1]);
    }
  }));
  for(let i=0;i<3970;i++){
    const s=r(0,length),side=rand()<.5?-1:1,edge=setback(s,side),near=i%3!==0,
      off=edge+(near?r(-.12,3.65):r(3.3,10.8)),p=pAt(s,off*side,-.19);
    if(restricted(p[0],p[2]) && (s<112||s>length-38))continue;
    const size=r(.61,1.36),height=(near?r(.38,.91):r(.61,1.23))*(.84+.30*Math.cos(.055*s+off*.28));
    p[1]=earthHeight(p[0],p[2])-.016;G.instance(pick(tufts),...p,r(0,6.28),size,height,size*r(.82,1.24));
  }
  for(let i=0;i<1750;i++){
    const s=r(0,length),side=rand()<.5?-1:1,off=setback(s,side)+r(5.1,19.5),p=pAt(s,side*off);
    if(restricted(p[0],p[2])||nearest(p[0],p[2])[0]<W+4.7)continue;
    const band=.56+.23*Math.sin(s*.088+off*.36)+.21*Math.cos(s*.17+side*off*.24);
    if(rand()>band)continue;
    p[1]=earthHeight(p[0],p[2])-.035;
    const st=r(.63,1.47);
    G.instance(pick(i%7===0?bushes:i%3===0?fern:lawns),...p,r(0,6.283),st,st*r(.59,1.02),st*r(.78,1.17));
  }
  // Colonies below the trees occupy gaps between the tall shrubs. Fronds and
  // small woody debris have distinct geometry and cast shadows into the litter.
  {
    const keep=state;state=0x65cbd1af;
    const debris=Array.from({length:4},(_,kind)=>template(()=>{
      const hue=pick([[.371,.31,.198],[.431,.361,.237],[.336,.294,.213]]);
      for(let j=0;j<3+kind;j++){
        const a=r(0,6.28),dir=[Math.cos(a),0,Math.sin(a)],l=r(.26,1.03),
          start=[r(-.47,.47),.052,r(-.53,.53)],mid=add(start,mul(dir,l*.48)),end=add(start,mul(dir,l));
        mid[1]+=r(.016,.063);end[1]=.019;
        const radius=r(.011,.029);
        branchTube([start,mid,end],[radius,radius*.77,radius*.29],hue,5);
        if(j%2===0){
          const twig=[end[0]-dir[2]*.17,end[1]+.041,end[2]+dir[0]*.17];
          branchTube([mid,twig],[radius*.54,.003],hue,4);
        }
      }
    }));
    for(let side=-1;side<=1;side+=2)for(let s=3;s<length;s+=2.13){
      const edge=setback(s,side),offset=edge+r(5.1,26.2),center=pAt(s,side*offset);
      if(restricted(center[0],center[2])||nearest(center[0],center[2])[0]<12.4)continue;
      const humidity=.51+.27*Math.sin(center[0]*.089-center[2]*.051)+.16*Math.cos(center[0]*.148+center[2]*.091);
      const count=3+Math.floor(humidity*10);
      for(let j=0;j<count;j++){
        const x=center[0]+r(-2.1,2.1),z=center[2]+r(-1.83,1.83),d=nearest(x,z);
        if(d[0]<12.1)continue;
        const pickSet=j%6===0?debris:j%4===0?bushes:j%3===0?lawns:fern;
        const sz=(pickSet===bushes?r(.29,.88):pickSet===fern?r(.69,1.82):r(.87,1.43));
        G.instance(pick(pickSet),x,earthHeight(x,z)-.022,z,r(0,6.283),sz,sz*r(.65,1.17),sz*r(.76,1.19));
      }
    }
    const groundHerbs=Array.from({length:7},(_,species)=>template(()=>{
      const feet=species%3===0?5:3,palette=[[.302,.393,.204],[.350,.427,.233],[.431,.455,.255],[.330,.379,.212],[.466,.425,.238],[.295,.401,.270],[.394,.415,.208]];
      for(let f=0;f<feet;f++){
        const theta=f*2.40+r(-.41,.41),spread=f?r(.15,.57):0,x=Math.cos(theta)*spread,z=Math.sin(theta)*spread;
        const root=[x,-.025,z],ht=r(.052,.161)*(species%3===0?1.15:1),phase=r(0,6.28);
        for(let j=0;j<6;j++){
          const a=j*2.4+phase+r(-.31,.34),dir=[Math.cos(a),0,Math.sin(a)],side=[-dir[2],0,dir[0]],
            len=r(.15,.32),w=len*r(.11,.23),mid=add(root,mul(dir,len*.49)),tip=add(root,mul(dir,len));
          mid[1]+=ht*r(.58,.95);tip[1]+=ht*r(.22,.69);
          const left=add(mid,mul(side,w)),right=sub(mid,mul(side,w)),rib=add(mid,[0,w*.42,0]);
          const col=tint(palette[species],r(.77,1.19)),up=norm([-dir[0]*.34,1,-dir[2]*.34]);
          const west=norm(add(up,mul(side,.48))),east=norm(sub(up,mul(side,.48)));
          G.tri(root,left,rib,col,16,0,up,west,up,[0,0],[0,.48],[.5,.48]);
          G.tri(left,tip,rib,col,16,0,west,up,up,[0,.48],[.5,1],[.5,.48]);
          G.tri(root,rib,right,col,16,0,up,up,east,[0,0],[.5,.48],[1,.48]);
          G.tri(rib,tip,right,col,16,0,up,up,east,[.5,.48],[.5,1],[1,.48]);
        }
      }
    }));
    for(let side=-1;side<=1;side+=2)for(let s=.3;s<length;s+=1.68){
      const edge=setback(s,side);
      for(let j=0;j<5;j++){
        const ds=s+r(-.78,.78),off=edge+3.5+(j+rand())*5.7,p=pAt(ds,off*side),x=p[0],z=p[2];
        if(restricted(x,z)||bareGranite(x,z)||nearest(x,z)[0]<W+2.6)continue;
        const drift=.51+.23*Math.sin(x*.17+z*.22)+.19*Math.sin(.4*x-.293*z);
        if(rand()>.44+.55*drift)continue;
        const size=r(.58,1.51),repeats=1+Math.floor(3*drift);
        for(let h=0;h<repeats;h++){
          const px=x+r(-.67,.67),pz=z+r(-.64,.64),sz=size*r(.83,1.11);
          G.instance(pick(groundHerbs),px,earthHeight(px,pz)-.027,pz,r(0,6.28),sz,sz*r(.78,1.33),sz*r(.83,1.18));
        }
      }
    }
    state=keep;
  }

}
