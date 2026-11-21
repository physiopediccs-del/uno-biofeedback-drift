// Material and transform IDs are small integers exactly representable in binary16.
function packSceneVertices(source,count){
 const vertices=new Float32Array(count*12),ids=new Float16Array(vertices.buffer);
 for(let i=0;i<count;i++){
   const src=i*13,dst=i*12,packed=i*24+18;
   for(let j=0;j<9;j++)vertices[dst+j]=source[src+j];
   ids[packed]=source[src+9];ids[packed+1]=source[src+10];
   if(ids[packed]!==source[src+9] || ids[packed+1]!==source[src+10])throw Error('Vertex identifier out of range.');
   vertices[dst+10]=source[src+11];vertices[dst+11]=source[src+12];
 }
 return vertices;
}
const RENDER_SUN = new Float32Array([.1914,.2578,-.9471]);
const renderCommon = /* wgsl */`
const sun=vec3f(.1914,.2578,-.9471);
const pi=3.141592654;
fn hash(p:vec2f)->f32 { var p3=fract(vec3f(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
fn noise(p:vec2f)->f32 { let i=floor(p); var f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2f(1,0)),f.x),mix(hash(i+vec2f(0,1)),hash(i+1.),f.x),f.y); }
fn fbm(p:vec2f)->f32 { return .53*noise(p)+.268*noise(p*2.031+21.)+.135*noise(p*4.09-11.)+.067*noise(p*8.18+43.); }
fn linear(c:vec3f)->vec3f { return c*(c*(c*.305306+.682171)+.012523); }
fn skyUV(d:vec3f)->vec2f {return vec2f(atan2(d.z,d.x)/6.2831853+.5,acos(clamp(d.y,-1.,1.))/pi);}
struct Full { @builtin(position) p:vec4f, @location(0) uv:vec2f };
fn fullVertex(vi:u32)->Full { let uv=vec2f(f32((vi<<1u)&2u),f32(vi&2u));return Full(vec4f(uv.x*2.-1.,1.-uv.y*2.,0.,1.),uv);}
@vertex fn full(@builtin(vertex_index) vi:u32)->Full {return fullVertex(vi);}
@vertex fn skyFull(@builtin(vertex_index) vi:u32)->Full {var o=fullVertex(vi);o.p.z=1.;return o;}
`;
function cloudMicrostructure(device){
  // Four periodic cellular bands share a volume. A nearest feature centre measures the distance
  // to the centre of a small droplet cluster. All subsequent filtering is true trilinear.
  const size=64,values=new Uint8Array(size*size*size*4);
  let seed=0x709a3157;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let band=0;band<4;band++){
    const cells=[4,7,11,16][band],points=new Float32Array(cells*cells*cells*3);
    for(let j=0;j<points.length;j++)points[j]=.07+.86*random();
    for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const px=x*cells/size,py=y*cells/size,pz=z*cells/size,ix=px|0,iy=py|0,iz=pz|0;
      let best=2;
      for(let k=-1;k<=1;k++)for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
        const index=3*((ix+i+cells)%cells+cells*((iy+j+cells)%cells+cells*((iz+k+cells)%cells)));
        const dx=px-ix-i-points[index],dy=py-iy-j-points[index+1],dz=pz-iz-k-points[index+2];
        best=Math.min(best,dx*dx+dy*dy+dz*dz);
      }
      values[4*(x+size*(y+size*z))+band]=255*Math.max(0,1-Math.sqrt(best)*.96);
    }
  }
  const texture=device.createTexture({size:[size,size,size],dimension:'3d',format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture},values,{bytesPerRow:size*4,rowsPerImage:size},[size,size,size]);
  return texture;
}
const renderSky = renderCommon+/* wgsl */`
@group(0) @binding(0) var cloudS:sampler;
@group(0) @binding(1) var cloudData:texture_3d<f32>;
fn density(p:vec3f)->f32 {
 let h=(p.y-905.)/690.;
 if(h<0. || h>1.){return 0.;}
 let uv=p.xz*.00047+vec2f(3.6,-8.1);
 let warp=vec2f(noise(uv*1.61+11.),noise(uv*1.69-4.))*.41;
 let cover=.64*fbm(uv+warp)+.36*noise(uv*1.77+warp+2.14);
 let q=vec3f(p.x+h*115.,p.y*.78,p.z-h*77.)*.00062+vec3f(.17,.31,.68);
 let puff=textureSampleLevel(cloudData,cloudS,q,0.);
 let coarse=.69*puff.r+.22*puff.g+.09*puff.b;
 let base=(cover-.422)*2.56+coarse*.77-.37;
 let loft=h+.11*(.52-coarse)+.10*(.50-puff.g);
 let profile=smoothstep(-.015,.17,loft)*(1.-smoothstep(.13,1.,loft));
 let bulk=base-(1.-profile)*.49;
 if(bulk<-.018){return 0.;}
 let small=textureSampleLevel(cloudData,cloudS,q*3.12+vec3f(.11,.57,.26),0.);
 let fray=dot(small,vec4f(.39,.30,.20,.11));
 let curl=textureSampleLevel(cloudData,cloudS,q*8.17+.17*small.rgb,0.);
 let edge=bulk+.27*(fray-.54)+.12*(dot(curl,vec4f(.39,.28,.21,.12))-.49)-.067;
 return smoothstep(-.017,.197,edge)*mix(.60,1.,fray);
}
@fragment fn skyBake(in:Full)->@location(0) vec4f {
 let phi=(in.uv.x-.5)*2.*pi; let th=in.uv.y*pi; let d=vec3f(cos(phi)*sin(th),cos(th),sin(phi)*sin(th));
 let mu=max(dot(d,sun),0.);let h=max(d.y,0.);
 let zen=vec3f(.039,.175,.485);let horizon=mix(vec3f(.49,.65,.90),vec3f(2.21,1.10,.36),pow(mu,3.));
 var col=mix(horizon,zen,pow(clamp(h/.83,0.,1.),.39))+vec3f(1.42,.64,.16)*pow(mu,26.)*.49+vec3f(1.7,1.18,.53)*pow(mu,290.)*.55;
 if(d.y>.014){
   let start=905./max(d.y,.024);let stepSize=690./max(d.y,.045)/52.;
   var trans=1.;var scatter=vec3f(0.);
   let rayPhase=.5+.19*sin(phi*499.+d.y*537.)+.11*sin(phi*627.-d.y*611.);
   for(var j=0;j<52;j++){
     let p=d*(start+(f32(j)+rayPhase)*stepSize);let den=density(p);
     if(den>.003){
       let depth=.32*density(p+sun*28.)+.66*density(p+sun*83.)+.97*density(p+sun*188.)+.83*density(p+sun*391.);
       let ht=clamp((p.y-905.)/690.,0.,1.);
       let bounce=mix(vec3f(.114,.158,.223),vec3f(.391,.436,.531),smoothstep(.04,.83,ht))*(.72+.28*exp(-depth));
       let direct=vec3f(1.37,.984,.64)*(exp(-depth*1.69)*.82+.20*exp(-depth*.29));
       let silver=vec3f(1.32,.79,.38)*pow(mu,11.)*exp(-depth*1.88);
       let alpha=1.-exp(-den*stepSize*.0091);
       scatter+=trans*alpha*(bounce+direct+silver);trans*=1.-alpha;
       if(trans<.008){break;}
     }
   }
   let fade=smoothstep(.025,.148,d.y);col=mix(col,scatter+trans*col,fade);
   col+=vec3f(34.,22.,9.)*(1.-smoothstep(.0047,.0068,acos(min(mu,1.))))*mix(1.,trans,fade);
   let cirrusUV=vec2f(d.x*2.65+.47*d.z,d.z*.63)/(.12+h)*7.;
   let wisps=pow(clamp(fbm(cirrusUV+vec2f(.12*sin(cirrusUV.y),.07*sin(cirrusUV.x*2.13)))-.33,0.,1.),2.4)*.44;
   col=mix(col,vec3f(1.04,1.02,1.00),wisps*trans);
 }else{col=mix(vec3f(.050,.059,.035),horizon,smoothstep(-.12,.018,d.y));}
 return vec4f(col,1.);
}
`;
const renderUniform=/* wgsl */`
struct Params { vp:mat4x4f, prevVP:mat4x4f, invVP:mat4x4f, wide:mat4x4f, nearSun:mat4x4f, xform:array<mat4x4f,6>, prevXform:array<mat4x4f,6>, cam:vec4f, car:vec4f, game:vec4f, res:vec4f, jitter:vec4f, origin:vec4f, wake:array<vec4f,24>, wakeBounds:vec4f, lens:vec4f, carShadowBounds:vec4f };
@group(0) @binding(0) var<uniform> g:Params;
`;
const renderGeom=/* wgsl */`
struct Vertex { @location(0) p:vec3f,@location(1) n:vec3f,@location(2) c:vec3f,@location(3) ids:vec2f,@location(4) uv:vec2f,@location(5) posYaw:vec4f,@location(6) size:vec4f };
struct Vary { @builtin(position) pos:vec4f,@location(0) wp:vec3f,@location(1) n:vec3f,@location(2) c:vec3f,@location(3) uv:vec2f,@location(4) @interpolate(flat) ids:vec2u,@location(5) old:vec4f };
fn yaw(v:vec3f,s:f32,c:f32)->vec3f{return vec3f(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);}
fn spectatorLook(p:vec2f,at:vec2f,lateral:vec2f)->vec2f{
 let d=at-p;let d2=dot(d,d);
 let sn=.68*dot(d,lateral)*inverseSqrt(max(1.,d2))*(1.-smoothstep(16.*16.,105.*105.,d2));
 return vec2f(sn,sqrt(max(.01,1.-sn*sn)));
}
fn neckOffset(lever:vec2f,turn:vec2f)->vec2f{
 return vec2f(lever.x*(turn.y-1.)+lever.y*turn.x,lever.y*(turn.y-1.)-lever.x*turn.x);
}
fn vert(v:Vertex,passId:i32)->Vary { let s=sin(v.posYaw.w);let c=cos(v.posYaw.w); let id=vec2u(v.ids+.01); let group=min(id.y,5u);var local=v.p;var normal=v.n;var pigment=v.c;var fabricUV=v.uv;var previousOffset=vec3f(0.);
 if(v.size.w>0.){
   let packed=u32(v.size.w);let dye=vec3f(f32(packed&127u),f32((packed>>7u)&127u),f32((packed>>14u)&127u))*(1./127.);
   let mirror=select(1.,-1.,(packed&2097152u)!=0u);let waist=select(0.,.79,(packed&4194304u)!=0u);
   let y=local.y-waist;
   local.z*=mirror;normal.z*=mirror;
   if((packed&8388608u)!=0u && g.lens.x>0. && passId==0 && any(v.uv!=vec2f(0.))){
     let lateral=vec2f(s,c);let lever=v.uv*vec2f(1.,mirror);
     let turn=spectatorLook(v.posYaw.xz,g.xform[1][3].xz,lateral);
     let oldTurn=spectatorLook(v.posYaw.xz,g.prevXform[1][3].xz,lateral);
     let now=neckOffset(lever,turn);let was=neckOffset(lever,oldTurn);
     local.x+=now.x;local.z+=now.y;
     previousOffset=yaw(vec3f(was.x-now.x,0.,was.y-now.y)*v.size.xyz,s,c);
     let weight=smoothstep(.003,.078,length(lever));normal=mix(normal,yaw(normal,turn.x,turn.y),weight);
   }
   let shirt=id.x>=144u && id.x<=151u;
   if(shirt || id.x==115u){pigment*=dye;}
   if(shirt){
     fabricUV=vec2f(v.p.z,y);
   }
   // Change the proportions of a repeated figure around the waist, without
   // changing its brim, hand or eye dimensions.
   let stock=fract(dot(dye,vec3f(9.31,19.45,13.04)))-.5;
   let midsection=smoothstep(-.03,.17,y)*(1.-smoothstep(.34,.61,y));
   local.z*=1.+stock*.29*midsection;local.x*=1.+stock*.24*midsection;
   normal.z/=1.+stock*.29*midsection;normal.x/=1.+stock*.24*midsection;
 }
 var p=yaw(local*v.size.xyz,s,c)+v.posYaw.xyz;
 if(id.x==14u || id.x==16u){let w=sin(g.cam.w*1.53+p.x*.41+p.z*.23)+.47*sin(g.cam.w*2.3+p.x*.76);p.x+=w*select(.023,.063,id.x==14u)*clamp(v.uv.y,0.,1.);}
 let obj=vec4f(p,1.);let wp=(g.xform[group]*obj).xyz;let n=(g.xform[group]*vec4f(yaw(normal/max(v.size.xyz,vec3f(.0001)),s,c),0.)).xyz;var pos=g.vp*vec4f(wp,1.);
 if(passId==1){pos=g.wide*vec4f(wp,1.);}else if(passId==2){pos=g.nearSun*vec4f(wp,1.);}else{pos=vec4f(pos.xy+g.jitter.xy*pos.w,pos.zw);}let old=g.prevVP*g.prevXform[group]*(obj+vec4f(previousOffset,0.));
 return Vary(pos,wp,normalize(n),pigment,fabricUV,id,vec4f(old.xy+g.jitter.zw*old.w,old.zw)); }
@vertex fn vs(v:Vertex)->Vary {return vert(v,0);}
@vertex fn vsWide(v:Vertex)->Vary{return vert(v,1);}
@vertex fn vsNear(v:Vertex)->@builtin(position) vec4f {
 let group=min(u32(v.ids.y+.01),5u);let wp=g.xform[group]*vec4f(v.p,1.);
 return g.nearSun*vec4f(wp.xyz,1.);
}
`;
const reflectionProbeCount=16,reflectionProbeSize=320;
const reflectionSites=Array.from({length:reflectionProbeCount},(_,i)=>{
  const p=trackSample(TRACK_LENGTH*i/reflectionProbeCount,new Float32Array(6));
  return 'vec3f('+p[0].toFixed(5)+','+(p[1]+1.15).toFixed(5)+','+p[2].toFixed(5)+')';
}).join(',');
const renderResources=/* wgsl */`
@group(0) @binding(1) var linearS:sampler;
@group(0) @binding(2) var leaves:texture_2d<f32>;
@group(0) @binding(3) var grain:texture_2d<f32>;
@group(0) @binding(4) var sky:texture_2d<f32>;
@group(0) @binding(5) var wideShadow:texture_depth_2d;
@group(0) @binding(6) var nearShadow:texture_depth_2d;
@group(0) @binding(7) var shadowS:sampler_comparison;
@group(0) @binding(8) var probe:texture_cube_array<f32>;
@group(0) @binding(9) var pavement:texture_2d<f32>;
@group(0) @binding(10) var vergeAtlas:texture_2d<f32>;
@group(0) @binding(12) var isotropic:sampler;
@group(0) @binding(13) var forestIrradiance:texture_2d<f32>;
@group(0) @binding(14) var woodlandMaps:texture_2d_array<f32>;
@group(0) @binding(15) var contactMap:texture_2d<f32>;
@group(0) @binding(16) var aggregateTile:texture_2d<f32>;
fn trackPrint(ij:vec2i)->vec2f{
 let mark=textureLoad(contactMap,vec2i(clamp(ij.x,0,511),ij.y&4095),0);
 let stamp=dot(round(mark.ba*255.),vec2f(256.,1.))*(1./32.);
 let age=max(0.,g.cam.w%2048.-stamp);
 let stored=round(mark.g*255.);
 let displaced=select(stored,128.-stored,stored>=128.)/127.;
 return vec2f(mark.r*(1.-smoothstep(3.,20.,age)),displaced*(1.-smoothstep(.14,1.55,age)));
}
fn leafValue(uv:vec2f)->vec4f { return textureSampleBias(leaves,linearS,clamp(uv,vec2f(.002),vec2f(.998)),-.35); }
// Integrating each wire over the pixel footprint preserves subpixel coverage.
fn wireArea(q:vec2f,gauge:f32)->vec2f {return floor(q)*gauge+min(fract(q),vec2f(gauge));}
fn wire(uv:vec2f)->f32 {
 let gauge=.046;let q=vec2f(uv.x+uv.y,uv.x-uv.y)*8.7+.5*gauge;
 let span=max(fwidth(q),vec2f(.006));
 let coverage=(wireArea(q+.5*span,gauge)-wireArea(q-.5*span,gauge))/span;
 return clamp(coverage.x+coverage.y-coverage.x*coverage.y,0.,1.);
}
// An empty fragment stage keeps the depth-only bundle valid on WebKit.
@fragment fn shadowNearFs(){}
@fragment fn shadowFs(i:Vary){if(i.ids.x==14u && leafValue(i.uv).a<.42){discard;}if(i.ids.x==20u && wire(i.uv)<.49){discard;} }
fn visibility(wp:vec3f,n:vec3f,dist:f32,ground:bool)->f32 {
 let offset=wp+n*(.022+.013*(1.-abs(dot(n,sun))));let a=g.wide*vec4f(offset,1.);let b=g.nearSun*vec4f(wp+n*.009,1.);
 let uv=vec2f(.5,-.5)*a.xy+.5;let nearUV=vec2f(.5,-.5)*b.xy+.5;
 let dx=(.6+smoothstep(12.,180.,dist)*1.45)/f32(textureDimensions(wideShadow).x);
 var light=1.;if(all(uv>vec2f(.001)) && all(uv<vec2f(.999)) && a.z>0. && a.z<1.){let z=a.z-.00016;light=.25*(textureSampleCompareLevel(wideShadow,shadowS,uv+vec2f(-.77,-.26)*dx,z)+textureSampleCompareLevel(wideShadow,shadowS,uv+vec2f(.31,-.83)*dx,z)+textureSampleCompareLevel(wideShadow,shadowS,uv+vec2f(.79,.41)*dx,z)+textureSampleCompareLevel(wideShadow,shadowS,uv+vec2f(-.32,.89)*dx,z));}
 if(all(nearUV>g.carShadowBounds.xy) && all(nearUV<g.carShadowBounds.zw) && b.z>0. && b.z<1.){let z=b.z-.00039;let center=textureSampleCompareLevel(nearShadow,shadowS,nearUV,z);if(ground){let span=(.65+min(8.3,1.22*distance(wp.xz,g.car.xz)))/f32(textureDimensions(nearShadow).x);var v=center;for(var k=0;k<8;k++){let angle=f32(k)*2.399963+.4;let off=vec2f(cos(angle),sin(angle))*sqrt((.45+f32(k))/8.)*span;v+=textureSampleCompareLevel(nearShadow,shadowS,nearUV+off,z);}light=min(light,v/9.);}else{light=min(light,center);}}return light;
}
struct Surface { color:vec4f, motion:vec2f };
fn groundNoise(p:vec2f,scale:f32)->vec4f {return textureSample(grain,isotropic,p*scale);}
fn skyColor(d:vec3f)->vec3f{return textureSampleLevel(sky,linearS,skyUV(d),0.).rgb;}
fn localReflection(d:vec3f,lod:f32)->vec3f {
 return mix(textureSampleLevel(probe,linearS,d,i32(g.origin.x),lod).rgb,textureSampleLevel(probe,linearS,d,i32(g.origin.y),lod).rgb,g.origin.z);
}
const probeSites=array<vec3f,${reflectionProbeCount}>(${reflectionSites});
fn projectedProbe(p:vec3f,d:vec3f,index:i32,lod:f32)->vec3f{
 let data=textureSampleLevel(probe,linearS,d,index,lod);
 let offset=p-probeSites[index];
 let unitOffset=offset*min(data.a,.24);
 // The alpha channel is inverse radial depth. Sky samples have zero parallax.
 let perpendicular=unitOffset-dot(unitOffset,d)*d;
 let lookup=normalize(d+perpendicular/sqrt(1.+dot(perpendicular,perpendicular)*3.));
 return textureSampleLevel(probe,linearS,lookup,index,lod).rgb;
}
fn positionReflection(p:vec3f,d:vec3f,lod:f32)->vec3f{
 let a=projectedProbe(p,d,i32(g.origin.x),lod);let b=projectedProbe(p,d,i32(g.origin.y),lod);
 return mix(a,b,g.origin.z);
}
fn environment(d:vec3f,r:f32)->vec3f {
 return mix(localReflection(d,min(5.,.5+r*14.5)),skyColor(d),smoothstep(.13,.43,d.y));
}
fn objectGrainUV(local:vec3f)->vec2f {
 return local.xy+local.z*vec2f(.739,.371);
}
override alphaCut:bool=true;
override surfaceMaterial:u32=0u;
override plantSurface:bool=false;
// The two colour passes exclude incompatible materials before pipeline compilation.
override opaquePass:bool=false;
override glassPass:bool=false;
fn surface(i:Vary,front:bool,probeMode:bool)->Surface {
 let plantID=select(select(0u,15u,i.ids.x==15u),16u,i.ids.x==16u);let material=select(select(i.ids.x,surfaceMaterial,surfaceMaterial!=0u),plantID,plantSurface);
 let id=select(material,0u,glassPass);
 let isRoad=!opaquePass && !glassPass && material==10u;
 let isPane=!opaquePass && material==3u;let isFence=!opaquePass && material==20u;
 let group=select(i.ids.y,0u,surfaceMaterial!=0u || plantSurface);let p=i.wp;let delta=g.cam.xyz-p;let dist=length(delta);let v=delta/max(dist,.001);var n=normalize(i.n);if(dot(n,v)<0.){n=-n;}
 var col=linear(i.c);var rough=.73;var metal=0.;var wet=0.;var transp=1.;var occ=1.;var foliage=0.;var emit=vec3f(0.);
 if(isRoad){let u=i.uv;let deposits=textureSample(pavement,linearS,vec2f(u.x/${typeof TRACK_WIDTH==='number'?TRACK_WIDTH:11.8}+.5,u.y/${typeof TRACK_LENGTH==='number'?TRACK_LENGTH:860}));let wear=deposits.rgb;let t=groundNoise(p.xz,.45);let med=groundNoise(p.xz,.037);let large=groundNoise(p.xz,.006);let prox=1.-smoothstep(19.,95.,dist);
 let chip=textureSample(aggregateTile,linearS,p.xz*1.25);
 let bed=groundNoise(p.xz,1.64);
 let base=.93+.24*(med.r-.5)+.19*(t.r-.5)+.12*(large.r-.5);
 // The lighter mineral streaks on fractured gravel persist along with the rough binder.
 let lithology=.45+1.54*chip.b+.22*chip.a;
 col*=base*mix(1.,lithology,prox)*vec3f(.988+.039*chip.b,1.,1.018-.049*chip.b);
 let line=sin(u.y*.019+.7)*2.18+sin(u.y*.0059)*.91;let lineD=abs(u.x-line);let trackRubber=exp(-lineD*lineD*.115);let wheels=exp(-pow((lineD-.75)*2.1,2.));let stripes=groundNoise(vec2f(u.x*.83,u.y*.013),1.);col*=1.-.26*trackRubber-.15*wheels*stripes.g;
 let seam=abs(fract((u.y+.11*sin(u.x*1.4))/36.)-.5)*36.;col*=.76+.24*smoothstep(.014,.06+min(.1,fwidth(u.y)),seam);
 let filmCoord=vec2f(u.x/${TRACK_WIDTH}+.5,u.y/${TRACK_LENGTH});
 var contact=vec2f(0.);
 if(!probeMode && g.car.w>.5 && dist<54.){
   let texel=filmCoord*vec2f(512.,4096.)-.5;let ij=vec2i(floor(texel));let fraction=fract(texel);
   contact=mix(mix(trackPrint(ij),trackPrint(ij+vec2i(1,0)),fraction.x),mix(trackPrint(ij+vec2i(0,1)),trackPrint(ij+vec2i(1,1)),fraction.x),fraction.y)*(1.-smoothstep(39.,54.,dist));
 }
 // A skim of water saturates the binder before it submerges a crushed stone.
 // The four scales below run from camber/ruts to stone crowns in millimetres.
 let supply=deposits.a*(1.-smoothstep(5.81,5.94,abs(u.x)));
 let course=.57*(med.r-.5)+.43*(large.r-.5);
 let relief=.64*(t.r-.48)+.40*(bed.a-.42)+.18*(bed.r-.5)+1.17*course;
 let banked=max(0.,-contact.y);let swept=max(0.,contact.y);
 let level=max(supply-1.09*swept+.71*banked,contact.x*.32)-relief;
 let pores=max(smoothstep(.03,.45,supply-.19*relief),contact.x);
 let fringe=clamp(.56*fwidth(level),.026,.16);
 let open=smoothstep(.51-fringe,.90+fringe,level);
 let threshold=(level-.46)*1.29;
 
 let crowns=.09+.76*chip.a+.31*(bed.g-.49);
 let difference=threshold-crowns;
 let footprint=clamp(.068+.71*fwidth(difference),.071,.34);
 let mineral=smoothstep(-footprint,footprint,difference);
 let flooded=mix(mineral,1.,smoothstep(.69,.98,level));
 let freeSurface=open*flooded*(1.-.73*swept);
 let saturated=max(banked*.76,pores)*(1.-.48*max(0.,chip.a-threshold));
 wet=clamp(.026*pores+.14*flooded*pores+.82*freeSurface,0.,1.);
 col*=mix(vec3f(1.),vec3f(.40,.43,.46),saturated)*mix(1.,.83,freeSurface);
 rough=mix(.87,.61,saturated);rough=mix(rough,.29,flooded*pores);rough=mix(rough,.105,freeSurface);
 let filmSurface=p+vec3f(0.,banked*.006,0.);let roadN=normalize(cross(dpdy(filmSurface),dpdx(filmSurface)));n=select(roadN,-roadN,roadN.y<0.);
 let chipNormal=(chip.rg*2.-1.)*(.65+.28*saturated)*(1.-.96*freeSurface);
 n=normalize(n+vec3f(chipNormal.x+(t.r-.5)*.060,0.,chipNormal.y+(bed.g-.5)*.054));
 // The film between stone crowns returns a broad reflection of the local
 // treeline. Only an uninterrupted water surface resolves a reflected silhouette.
 if(!probeMode && pores>.02){
   let broadSky=localReflection(reflect(-v,n),5.);
   let edge=pow(1.-clamp(dot(n,v),0.,1.),3.);
   emit+=min(broadSky,vec3f(.84))*((.006+.030*edge)*pores*(1.-.63*freeSurface));
 }
 if(!probeMode && wet>.04 && all(p.xz>=g.wakeBounds.xy) && all(p.xz<=g.wakeBounds.zw) && distance(p.xz,g.car.xz)<26.){var wave=vec2f(0.);var turmoil=0.;for(var j=0u;j<u32(g.origin.w);j++){let w=g.wake[j];if(w.w<.008){continue;}let deltaW=p.xz-w.xy;let d2=dot(deltaW,deltaW);if(d2>3.2){continue;}let dW=sqrt(max(.0001,d2));let ring=dW-(.073+w.z*1.12);let envelope=exp(-ring*ring*28.)*w.w*(1.-smoothstep(.18,1.03,w.z));let crest=cos(ring*29.2);wave+=deltaW/dW*envelope*crest*.102;turmoil+=envelope*.08;}n=normalize(n+vec3f(wave.x,0.,wave.y)*wet);rough=min(.96,rough+min(.22,turmoil)*wet);col+=vec3f(.037,.049,.053)*min(.38,turmoil)*wet;}
 let decal=1.-smoothstep(5.81,5.91,abs(u.x));let oil=wear.r*(.74+.27*chip.b)*decal;
 col*=1.-.31*oil-.42*wear.g*decal-.68*wear.b*decal;
 rough=max(.12,rough-.20*oil*(1.-wet)-.15*wear.g);
 }else if(id==13u || id==19u || id==12u || id==11u){let t=groundNoise(p.xz,.049);let q=groundNoise(p.xz,.56);let broad=groundNoise(p.xz,.007).r;
 if(id==13u){col*=.56+.42*t.r+.47*q.g+.51*broad;col=mix(col,col*vec3f(1.49,1.11,.68),smoothstep(.44,.67,broad*.5+t.r*.5));}
 if(id==19u){let hills=groundNoise(p.xz*.0019+p.y*.00072,1.);let run=groundNoise(vec2f(p.x*.0043+p.z*.006,p.y*.00165)+hills.r*.67,1.);let ridge=smoothstep(.35,.71,run.r*.61+hills.g*.39);let forestry=groundNoise(p.xz*.10+p.y*.022,1.);col*=.36+.63*t.r+.44*broad+.44*ridge+.33*forestry.g;col=mix(col,col*vec3f(1.42,1.10,.85),ridge*.45);n=normalize(n+vec3f(run.g-.5,0.,hills.g-.5)*.64);}
 if(id==12u){let pebble=groundNoise(p.xz,.19);let fine=groundNoise(p.xz,1.35);let peb=pebble.a;col*=.31+.36*t.r+.25*fine.b+.56*peb+.50*pebble.g;n=normalize(n+vec3f(pebble.g-.5,0.,peb-.5)*.54);}
 if(id==11u){col*=.79+.29*t.r+.10*q.g;}
 }else if(id==14u){let l=leafValue(i.uv);if(alphaCut && l.a<.42){discard;}col*=l.rgb*1.48;foliage=1.;rough=.87;
 }else if(id==21u){let axis=abs(n);let q=select(select(p.yz,p.xy,axis.z>axis.x),p.xz,axis.y>max(axis.x,axis.z));let drift=groundNoise(q*vec2f(.76,1.)+p.y*.011,.067);let leavesN=groundNoise(q,.66);let speck=groundNoise(q,1.67);let sunPatch=smoothstep(.41,.67,drift.r*.53+leavesN.r*.47);let direct=smoothstep(.34,.64,leavesN.g+speck.b*.11);col*=.46+.78*sunPatch+.44*direct+.25*(speck.g-.5);col=mix(col,col*vec3f(1.12,1.04,.70),sunPatch*.5);n=normalize(n+vec3f(leavesN.g-.5,leavesN.b-.5,leavesN.r-.5)*.66);foliage=.79;rough=.88;
 }else if(id==16u){col*=.52+.73*clamp(i.uv.y,0.,1.);foliage=1.;
 }else if(id==15u){
   let pitch=i.uv;
   // The cambium is parameterized around each limb. A texture metre does not expand
   // as a branch ascends or turns, retaining the ridges around forks.
   let warp=groundNoise(pitch*vec2f(.071,.043),1.).rg;
   let barkUV=vec2f(pitch.x*.76,pitch.y*.49)+vec2f(warp.x*.074,warp.y*.12);
   let rind=textureSample(woodlandMaps,linearS,barkUV,2).rgb;
   let knots=textureSample(woodlandMaps,linearS,barkUV,3).rg*2.-1.;
   let blade=groundNoise(pitch*vec2f(.31,.085),1.);
   let barkColor=linear(rind);
   col=barkColor*(vec3f(.57)+linear(i.c)*vec3f(3.83,3.79,3.62));
   col*=.84+.282*blade.r;
   let dx=dpdx(p);let dy=dpdy(p);let tc=dpdx(pitch);let td=dpdy(pitch);
   let t=dx*td.y-dy*tc.y;
   let T=t*inverseSqrt(max(1.e-12,dot(t,t)))*sign(tc.x*td.y-td.x*tc.y);
   let B=cross(T,n);
   n=normalize(n+(T*knots.x+B*knots.y)*.98);rough=.95;
 }else if(isFence){
   transp=wire(i.uv);
   if(alphaCut && transp<select(.003,.39,probeMode)){discard;}
   metal=.47;rough=.57;
  }else if(id==1u){
   rough=.29;metal=.43;let yp=dot(p-g.xform[1][3].xyz,g.xform[1][1].xyz);let lower=1.-smoothstep(.30,.97,yp);col*=vec3f(.758,.849,1.00)*(1.-lower*.21);}else if(id==2u){rough=.54;}else if(id==4u){metal=.86;rough=.24;}
 else if(isPane){rough=.048;metal=.12;transp=.235;col*=vec3f(.62,.78,.94);}else if(id==5u){metal=.65;rough=.20;col*=.98;}
 else if(id==6u){let lp=transpose(mat3x3f(g.xform[1][0].xyz,g.xform[1][1].xyz,g.xform[1][2].xyz))*(p-g.car.xyz);let uvL=lp.xy;let bulb=exp(-dot(vec2f((abs(lp.x)-.627)*13.,(lp.y-.608)*24.),vec2f((abs(lp.x)-.627)*13.,(lp.y-.608)*24.)));let prismatic=.5+.5*cos(uvL.x*490.)*cos(uvL.y*356.);metal=.26;rough=.22;emit=col*(.10+.24*bulb+g.game.z*(1.2+5.2*bulb))*(.86+.14*prismatic);col*=.81+.22*prismatic;}
 else if(id==118u){
   let xf=g.xform[1];let seat=transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz))*(p-xf[3].xyz);
   let basis=mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz);
   let normalL=transpose(basis)*n;
   let u=seat.x+seat.z*.62*smoothstep(.30,.89,abs(normalL.x));
   let vSeat=seat.y+seat.z*.75*abs(normalL.y);
   let threads=vec2f(u*341.+vSeat*48.,vSeat*388.-u*32.);
   let yarn=cos(threads*6.283185)*exp(-2.9*fwidth(threads)*fwidth(threads));
   let wale=vSeat*71.+u*13.;
   let rib=cos(wale*6.283185)*exp(-2.4*pow(fwidth(wale),2.));
   let grain=groundNoise(vec2f(u,vSeat),7.4);
   let centre=abs(seat.x)-.346;
   let frontSeat=select(0.,1.,seat.z<.86);
   let inset=(1.-smoothstep(.132,.163,abs(centre)))*frontSeat;
   let twill=(u*98.+vSeat*119.)*6.283185;
   let jacquard=.5+.5*cos(twill)*exp(-.10*pow(fwidth(twill),2.));
   col*=vec3f(.82,.93,1.06)*(.86+.28*grain.r+.084*rib+.08*yarn.x+.055*yarn.y+.105*jacquard*inset);
   n=normalize(n+basis*vec3f(yarn.x*.077,rib*.102+yarn.y*.075,0.));
   occ=.68+.16*smoothstep(.54,1.16,seat.y);rough=.98;
 }
 else if(id==117u){rough=.94;metal=0.;}
 else if(id==53u){rough=.245;metal=.025;occ=.82;}
 else if(id==45u){let u=i.uv.y*212.;let wav=cos(u*6.28318)*exp(-3.*fwidth(u)*fwidth(u));col*=.97+.042*wav;metal=.52;rough=.39;}
 else if(id==46u || (id==7u && group>=2u)){
   let xf=g.xform[group];
   let axis=mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz);
   let uv=objectGrainUV(transpose(axis)*(p-xf[3].xyz));
   let mold=groundNoise(uv,1.85);let weather=groundNoise(uv,.63);
   let tire=id==7u;
   let lateral=select(normalize(xf[0].xyz),normalize(xf[2].xyz),abs(dot(n,normalize(xf[0].xyz)))>.85);
   let tangent=normalize(lateral-n*dot(lateral,n));
   n=normalize(n+(tangent*(mold.g-.5)+cross(n,tangent)*(mold.b-.4167))*select(.083,.047,tire));
   rough=select(.53+.105*weather.r+.073*(mold.a-.5),.78+.12*weather.r,tire);
   col*=select(1.04,.89,tire)+.14*weather.r+.075*(mold.a-.5);
 }else if(id==42u){metal=.38;rough=.34;}else if(id==7u){rough=.82;col*=.83+.20*groundNoise(p.xy,2.3).r;}else if(id==8u){rough=.95;occ=.43;col*=.72;}
 else if(id==9u){emit=col*1.6;}else if(id==17u){rough=.69;col*=.73+.34*groundNoise(p.xz,.68).b;}else if(id==18u){wet=1.;rough=.065;}
 ${typeof worldMaterialsWGSL==='string'?worldMaterialsWGSL.replaceAll('discard;','if(alphaCut){discard;}'):''}
 if((id==17u || id==23u) && abs(i.uv.x)<7.7){
   let paintUV=vec2f(clamp(i.uv.x/${TRACK_WIDTH}+.5,.001,.999),i.uv.y/${TRACK_LENGTH});
   let water=textureSample(pavement,linearS,paintUV).a;
   let runoff=1.-smoothstep(5.93,7.20,abs(i.uv.x));
   let wetPaint=smoothstep(.12,.90,water)*runoff;
   col*=1.-wetPaint*.35;rough=mix(rough,.245,wetPaint);wet=wetPaint*select(.36,.64,id==17u);
 }
 let nv=max(.015,dot(n,v));let nl=max(0.,dot(n,sun));let refl=reflect(-v,n);let horizon=smoothstep(-.55,.80,n.y);let light=visibility(p,n,dist,group==0u);
 var amb=mix(vec3f(.125,.14,.157),vec3f(.306,.400,.56),horizon);let fieldUV=(p.xz+vec2f(156.,249.))/490.;
 if(all(fieldUV>vec2f(.001)) && all(fieldUV<vec2f(.999)) && id!=19u){
   let fr=textureSampleLevel(forestIrradiance,isotropic,fieldUV,0.);
   let cover=fr.r*(1.-smoothstep(max(0.,fr.g*40.*.20),max(.5,fr.g*40.*.94),p.y-(fr.b*32.-16.)));
   amb*=mix(vec3f(1.),vec3f(.54,.65,.57),cover);
 }let sunlight=vec3f(3.47,2.12,1.10);let h=normalize(v+sun);let nh=max(0.,dot(n,h));let vh=max(.0,dot(v,h));let a2=pow(max(.06,rough),4.);let den=1.+nh*nh*(a2-1.);let D=a2/max(.000003,pi*den*den);let k=pow(rough+1.,2.)*.125;let G=1./max(.01,4.*(nv*(1.-k)+k)*(nl*(1.-k)+k));
 let f0=mix(vec3f(.041),col,metal);let fs=f0+(1.-f0)*pow(1.-vh,5.);var color=col*(1.-metal*.72)*(amb*occ+sunlight*(nl*light*select(1.,.45,id==8u)+foliage*(.14+.24*max(dot(-n,sun),0.))*light));
 var directSpec=sunlight*min(vec3f(5.),fs*(D*G))*light*nl;if(isRoad){let gloss=exp2(-max(0.,1.-dot(refl,sun))*11900.);let grit=groundNoise(i.uv*vec2f(1.7,.87),1.).g;directSpec*=.085*(1.-wet*.96);directSpec/=1.+dot(directSpec,vec3f(.213,.715,.072))*3.1;directSpec+=vec3f(1.23,.91,.48)*gloss*wet*wet*light*(.26+.74*grit);}color+=directSpec;
 if(id==118u){
   // Light entering the cabin comes through two layers of glass. Velvet
   // pile cools at grazing incidence and opens slightly on the shoulder rolls.
   let xf=g.xform[1];let localN=transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz))*n;
   let window=.57+.27*abs(localN.x)+.24*max(.0,localN.y);
   let wrap=max(0.,(dot(n,sun)+.19)/1.19);
   let fibres=pow(1.-nv,3.5)*.052*sqrt(col);
   color=col*(amb*window*occ*1.15+sunlight*vec3f(.82,.90,.96)*(.72*nl+.28*wrap)*light*.56)+fibres+directSpec*.047;
 }
 if(id==125u){
   let reflected=environment(refl,.115);
   let chromeTint=vec3f(.927,.953,.948);
   color=(reflected*.66+sqrt(max(reflected,vec3f(0.)))*.24+amb*.79)*chromeTint+directSpec*.56;
 }
 if(id==124u){
   let xf=g.xform[1];let nn=transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz))*n;
   let returnLight=localReflection(refl,2.7);
   let front=max(0.,-nn.z);
   let fres=.024+.28*pow(1.-nv,4.8);
   color=col*(amb*.86+sunlight*nl*light*.38)*(1.-.56*abs(nn.x))
     +fres*returnLight*(.22+.33*front+.23*max(0.,nn.y))+directSpec*.072;
 }
 if(id==126u){
   let pitch=i.uv.y*840.;let ridge=.5+.5*cos(6.283*pitch)*exp(-3.*pow(fwidth(pitch),2.));
   color=col*(amb*.94+sunlight*.13*light)*(.70+.58*ridge)+directSpec*.015;
 }
 if(id==117u){color=col*(amb*.73+sunlight*.29*nl*light)+directSpec*.028;}
 if(id==120u){
   // Light wraps the soft transition under a cheek or on the far side of a forearm.
   let wrapped=max(0.,(dot(n,sun)+.23)/1.23);
   let bounce=(1.-light)*vec3f(.096,.067,.047);
   color=col*(amb+sunlight*mix(nl,wrapped,.42)*light+bounce)+directSpec*.19;
 }
 if(id==115u || (id>=144u && id<=151u)){
   let uv=i.uv;let dx=fwidth(uv);
   // Warm undyed yarn is visible where the screen-printed or woven motif
   // crosses a cotton fold. Derivative filtering integrates the finest checks.
   let cloth=col;let cream=vec3f(.62,.55,.44)*(.5+.50*clamp(length(i.c),0.,1.));
   var clothColor=cloth;
   if(id==145u){
     let x=abs(fract(uv.x/.058+.5)-.5);let y=abs(fract(uv.y/.081+.47)-.5);
     let warp=1.-smoothstep(.14,.15+min(.27,dx.x/.058),x);
     let weft=1.-smoothstep(.14,.15+min(.27,dx.y/.081),y);
     let gold=(1.-smoothstep(.025,.031+min(.22,dx.y/.081),abs(y-.30)))*.19;
     clothColor=mix(cloth*(1.-.62*warp)*(1.-.46*weft),cream,gold);
   }else if(id==146u){
     let armpit=smoothstep(.092,.107,abs(uv.x)+.16*(uv.y-.40));
     let seam=smoothstep(.087,.092,abs(uv.x)+.16*(uv.y-.40))-armpit;
     clothColor=mix(cloth,cloth*.37+vec3f(.039,.053,.063),armpit*.77);
     clothColor=mix(clothColor,cream,seam*.72);
   }else if(id==147u){
     let y=abs(uv.y-.395);let w=max(dx.y,.0012);
     let breastBand=1.-smoothstep(.014,.015+w,y);
     let stripe=1.-smoothstep(.002,.0028+w,abs(y-.026));
     clothColor=mix(cloth,cream,.78*breastBand+.54*stripe);
   }else if(id==148u){
     let u=(uv-vec2f(.0,.388))/vec2f(.085,.050);
     let ring=1.-smoothstep(.066,.12+min(.34,length(fwidth(u))),abs(length(u)-.87));
     let diagonal=1.-smoothstep(.14,.22+min(.28,fwidth(u.y)),abs(u.y+.30*u.x));
     let crest=ring+diagonal*(1.-smoothstep(.82,.90,length(u)))*.63;
     clothColor=mix(cloth,cream,crest*.55);
   }else if(id==149u){
     let x=abs(uv.x-.054);let y=uv.y-.414;
     let pocket=(1.-smoothstep(.030,.036,x))*smoothstep(-.043,-.037,y)* (1.-smoothstep(.017,.020,y));
     let lip=pocket*smoothstep(.005,.010,y);
     clothColor=cloth*(1.-pocket*.12+lip*.22);
   }else if(id==150u){
     let part=smoothstep(.011,.017,abs(uv.x)+.62*(.434-uv.y));
     let placket=1.-smoothstep(.003,.009,abs(uv.x));
     let eyelet=1.-smoothstep(.12,.32,length(vec2f(uv.x/.011,(fract(uv.y/.064)-.5)*3.5)));
     clothColor=mix(cream*.68,cloth,part)*(.98-.60*placket)+vec3f(.30)*eyelet;
   }
   if(id>=144u && id<=151u){
     let lateral=abs(uv.x);
     let armFold=.48-abs(uv.x)*.59;
     let belly=.215+.27*uv.x-.82*uv.x*uv.x;
     let diagonal=.343-.89*uv.x;
     let y=uv.y;
     let roll=(1.-smoothstep(.016,.085,abs(y-armFold)))*smoothstep(.038,.116,lateral);
     let buckle=(1.-smoothstep(.015,.10,abs(y-belly)))*(.51+.49*smoothstep(.05,.14,lateral));
     let chest=(1.-smoothstep(.018,.075,abs(y-diagonal)))*.33;
     let ridge=.82*roll*sin(77.*(y-armFold))+.63*buckle*sin(108.*(y-belly))+.34*chest*sin(121.*(y-diagonal));
     let collar=exp(-pow((y-.525)*37.,2.))*exp(-pow(uv.x*14.,2.));
     let hem=exp(-pow((y-.128)*81.,2.));
     clothColor*=1.+.27*ridge-.23*collar-.083*hem;
   }
   let fuzz=pow(1.-nv,3.)*(.020+.056*nl*light);
   color=clothColor*(amb+sunlight*nl*light+vec3f(.045,.036,.029)*(1.-light))+fuzz*sqrt(clothColor)+directSpec*.19;
 }
 if(id==123u){
   let xf=g.xform[1];let basis=transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz));
   let lp=basis*(p-xf[3].xyz);let nn=basis*n;
   let top=smoothstep(.71,1.05,lp.y);
   let window=.34+.30*abs(nn.x)+.32*max(-nn.z,0.)+.11*max(nn.y,0.);
   let throat=exp(-14.*abs(lp.x+.346))*smoothstep(.97,1.035,lp.y);
   let weave=groundNoise(objectGrainUV(lp),9.4).g;
   color=col*(amb*(.51+.42*window)+sunlight*nl*light*.45+vec3f(.036,.034,.033))
       *(.89+.18*weave)*(.73+.27*top)*(1.-.35*throat)+directSpec*.27;
 }
 if(id==121u){
   let xf=g.xform[1];let lp=transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz))*(p-xf[3].xyz);
   let side=clamp((lp.x+.37)*3.+.45,.16,.82);
   let eyeShade=.63+.23*smoothstep(1.17,1.19,lp.y);
   color=col*(amb*(.47+.34*side)+sunlight*.21*nl*light)*eyeShade+directSpec*.036;
 }
 if(!probeMode && (id==46u || (id==7u && group>=2u))){
   let tire=id==7u;
   let irradiance=mix(amb,localReflection(refl,5.),select(.69,.44,tire));
   let grazing=.040+.61*pow(1.-nv,5.);
   color+=irradiance*grazing*select(.78,.43,tire);
 }
 if(id==119u){
   var reflected=mix(vec3f(.068,.077,.059),vec3f(.33,.42,.54),smoothstep(-.22,.85,refl.y));
   if(!probeMode){reflected=mix(reflected,localReflection(refl,4.0),.73);}
   let fres=mix(col*.55,vec3f(.80),pow(1.-nv,4.7));
   color+=reflected*fres*(.78-.36*rough);
 }
 if(id==53u && !probeMode){
   let xf=g.xform[1];let headRay=transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz))*refl;
   let opening=smoothstep(-.39,.04,headRay.y)*(1.-smoothstep(.46,.79,headRay.y));
   let throughWindow=opening*max(smoothstep(.05,.68,-headRay.z),smoothstep(.40,.87,abs(headRay.x)));
   let glow=mix(vec3f(.038,.044,.043),localReflection(refl,2.1).rgb,throughWindow*.72);
   let normalLocal=transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz))*n;
   let fromWindow=.16+.49*max(-normalLocal.z,0.)+.18*abs(normalLocal.x);
   let reflectedFloor=max(0.,-normalLocal.y)*vec3f(.106,.081,.055);
   let fluorescent=mix(vec3f(.054,.046,.032),vec3f(.092,.127,.148),smoothstep(-.32,.73,headRay.y));
   let fibreglass=mix(fluorescent,glow,.73);
   let lipShade=.75+.25*smoothstep(1.107,1.22,(transpose(mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz))*(p-xf[3].xyz)).y);
   color=col*(amb*(.42+.51*fromWindow)+sunlight*nl*light*.46+reflectedFloor)*lipShade
        +directSpec*.70+fibreglass*(.103+.69*pow(1.-nv,4.8));
 }
 if(id==1u || isPane || id==4u || id==5u || id==6u || id==42u || id==45u){var env=skyColor(refl);if(!probeMode && group>0u){env=environment(refl,rough);}
 if(id==45u){env=max(env,vec3f(.16,.18,.19));}
 let fres=f0+(max(vec3f(1.-rough*.42),f0)-f0)*pow(1.-nv,5.);
 if(id==1u){
   let xf=g.xform[1];let axis=mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz);
   let carP=transpose(axis)*(p-xf[3].xyz);
   let coat=.041+.959*pow(1.-nv,5.);
   let side=smoothstep(.89,.985,abs(dot(n,axis[0])));
   let pressing=smoothstep(.44,.54,carP.y)*(1.-smoothstep(.71,.80,carP.y));
   let coatN=normalize(n+axis[1]*(.065-dot(n,axis[1]))*mix(.29,.0664,pressing)*side);
   let flakeN=normalize(n+axis[1]*(.065-dot(n,axis[1]))*mix(.77,.1594,pressing)*side);
   let skinRay=reflect(-v,coatN);let ray=transpose(axis)*skinRay;
   var clear=env;var powder=env;
   if(!probeMode){
     // A dielectric coat sees a narrower cone than aluminium flakes embedded
     // in the pigment. Both use the same reflection axis and the track probes.
     let lod=1.32+.48*(1.-nv);
     clear=positionReflection(p,skinRay,lod);
     powder=localReflection(reflect(-v,flakeN),3.96);
     if(carP.y>1.375 && ray.y>.07){
       let railHit=carP.xz+ray.xz*((1.545-carP.y)/ray.y);
       let footHit=carP.xz+ray.xz*((1.501-carP.y)/ray.y);
       let rungHit=carP.xz+ray.xz*((1.560-carP.y)/ray.y);
       let blur=.005+.019*(1.-max(.0,ray.y))+clamp(length(fwidth(railHit))*.50,.001,.012);
       let rail=(1.-smoothstep(.017-blur,.017+blur,abs(abs(railHit.x)-.237)))*
         (1.-smoothstep(1.315-blur,1.315+blur,abs(railHit.y-.280)));
       let closeRung=clamp(round((rungHit.y+.888)/.292),0.,8.)*.292-.888;
       let rung=(1.-smoothstep(.026-blur,.026+blur,abs(rungHit.y-closeRung)))*
         (1.-smoothstep(.248-blur,.248+blur,abs(rungHit.x)));
       let carrier=(1.-smoothstep(.025-blur,.025+blur,min(abs(footHit.y+.083),abs(footHit.y-.939))))*
         (1.-smoothstep(.685-blur,.685+blur,abs(footHit.x)));
       clear=mix(clear,amb*.67+vec3f(.055,.057,.059),max(rail,rung)*.85);
       clear=mix(clear,amb*.19+vec3f(.021,.026,.029),carrier*.92);
     }
   }
   let Y=vec3f(.213,.715,.072);
   let tint=mix(vec3f(dot(powder,Y)),powder,.57);
   let flake=groundNoise(objectGrainUV(carP),3.60);
   let pigment=vec3f(.025)+col*.29;
   // Convolution attenuates fine bright markings in the base coat. A single
   // narrower image remains visible on the varnish, strongest at grazing angles.
   let bonded=mix(powder,clear,.84+.12*coat);
   color=color*(1.-.50*coat)+tint*pigment*(1.-coat)+bonded*coat*.90
     +sunlight*.0095*flake.r*nl*light;
 }

 else if(isPane){
   let xf=g.xform[1];let axis=mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz);
   let lp=transpose(axis)*(p-xf[3].xyz);let eye=transpose(axis)*v;
   if(i.c.r<.10 && i.c.g>.96){
     // Smoke polycarbonate under the headliner. The front and side windows are the
     // two principal light sources reflected by the panoramic visor.
     let r=transpose(axis)*refl;let elevation=smoothstep(-.46,-.03,r.y)*(1.-smoothstep(.39,.65,r.y));
     let frontWindow=smoothstep(.04,.74,-r.z);
     let quarterWindow=smoothstep(.39,.86,abs(r.x))*(1.-smoothstep(.54,.84,r.z));
     let pillar=1.-.66*exp(-pow((abs(r.x)-.73)*24.,2.))*smoothstep(.15,.60,-r.z);
     let panes=elevation*max(frontWindow,quarterWindow);
     let rail=exp(-pow((r.y+.11-.12*abs(r.x))/.085,2.));
     let cavity=mix(vec3f(.033,.039,.044)+rail*vec3f(.026,.037,.043),(.71*env+vec3f(.073,.093,.112))*pillar,panes);
     let incidence=max(.01,nv);let f=.131+.83*pow(1.-incidence,4.8);
     let thickness=1./sqrt(1.-(1.-incidence*incidence)/2.53);
     let shade=.95+1.00*smoothstep(1.167,1.218,lp.y);
     let transmit=exp(-shade*thickness)*(1.-f);
     transp=1.-transmit;
     color=(cavity*f*vec3f(.85,1.02,1.11)+vec3f(.0040,.0072,.0095)*(transp-f))/transp;
   }else if(i.c.r<.97 || i.c.g<.20){
     let windshield=i.c.r>.97;
     let outer=dot(i.n,v)>0.;
     let backlight=!windshield && abs(dot(n,axis[2]))>.57;
     let quarter=select(0.,1.,!windshield && lp.z>.43 && !backlight);
     // Snell's law sets the path through the glass; the perpendicular and
     // parallel Fresnel terms vary with both the surface and the sight line.
     let indexOfRefraction=1.515;
     let cosGlass=sqrt(1.-(1.-nv*nv)/(indexOfRefraction*indexOfRefraction));
     let a=(nv-indexOfRefraction*cosGlass)/(nv+indexOfRefraction*cosGlass);
     let b=(indexOfRefraction*nv-cosGlass)/(indexOfRefraction*nv+cosGlass);
     let perp=a*a;let parallel=b*b;
     let ordinary=.5*(perp+parallel);
     let top=select(smoothstep(1.275,1.399,lp.y),smoothstep(1.30,1.412,lp.y),windshield);
     // Both sides of a pane transmit the same light. Looking clear
     // across the cabin accumulates the absorption of its two panes.
     let thickness=select(.335+.155*quarter,.212+.17*top,windshield);
     let through=exp(-thickness/cosGlass);
     // A low-reflectance surface reduces the broad head-on veil and
     // retains the angular rise of dielectric reflection toward the edge.
     let normalF=pow((indexOfRefraction-1.)/(indexOfRefraction+1.),2.);
     let angular=clamp((ordinary-normalF)/(1.-normalF),0.,1.);
     let faceReturn=select(select(.008,.020,backlight),.013,windshield);
     let fresnel=mix(faceReturn,1.,angular);
     // The probe retains trees and buildings overhead. Opposing panes transmit the charcoal inner trim.
     var outside=env;
     if(!probeMode){
       let pane=positionReflection(p,refl,.27+.18*quarter);outside=mix(pane,env,select(.028,.12,windshield));
       // The roof load is absent from the static radiance probes. Intersect the reflected
       // ray with its lower faces only where the glass actually sees them above the roof.
       let ray=transpose(axis)*refl;
       if(ray.y>.07 && lp.y>1.08 && outer){
         let hit=lp.xz+ray.xz*((1.565-lp.y)/ray.y);
         let edge=clamp(length(fwidth(hit)),.001,.026);
         let span=(1.-smoothstep(1.315-edge,1.315+edge,abs(hit.y-.28)));
         let rail=(1.-smoothstep(.017-edge,.017+edge,abs(abs(hit.x)-.239)))*span;
         let closest=clamp(round((hit.y+.888)/.292),0.,8.)*.292-.888;
         let rung=(1.-smoothstep(.024-edge,.024+edge,abs(hit.y-closest)))*(1.-smoothstep(.25-edge,.25+edge,abs(hit.x)));
         let roofCross=lp.xz+ray.xz*((1.423-lp.y)/ray.y);
         let roofBlocks=step(abs(roofCross.x),.63)*step(-.18,roofCross.y)*step(roofCross.y,1.34);
         let seesBar=max(rail,rung)*(1.-roofBlocks);
         outside=mix(outside,amb*.56+vec3f(.028,.034,.038),seesBar);
       }
     }
     let internal=vec3f(.018,.023,.029)+.009*smoothstep(-.8,.3,refl.y);
     let glassR=select(internal,outside,outer);
     let attenuation=through*(1.-fresnel);
     transp=1.-attenuation;
     color=(glassR*fresnel+vec3f(.0021,.0054,.0046)*(transp-fresnel))/max(.001,transp);
   }else if(lp.z>1.50){
     // One continuous parameter follows the mould around the rear quarter.
     // Prism pitch and the widths of the individual optical cells use millimetres.
     let red=i.c.g>.39;let signal=i.c.g>.30 && !red;
     let uv=i.uv;let f=uv.x;let y=uv.y;
     let side=sign(lp.x);let ny=axis[1];
     let tangent=normalize(cross(ny,n))*side;
     let signedEye=vec2f(dot(v,tangent),dot(v,ny));
     let backUV=uv+signedEye*vec2f(.057,.246)/max(.70,nv);
     let cells=select(5.2,6.8,red);
     let pitch=uv.x*69.+.17*sin(uv.y*5.5+.7);
     let phase=6.2831853*pitch;
     let clearFlute=cos(phase)*exp(-2.3*pow(fwidth(pitch),2.));
     let ribHeight=.5+.5*cos(6.2831853*(y*5.8+.17*cos(f*27.)))*exp(-2.8*pow(fwidth(y)*5.8,2.));
     let fine=uv*vec2f(74.,12.);
     let diamonds=cos((fine.x+fine.y)*3.14159)*cos((fine.x-fine.y)*3.14159)*exp(-1.4*dot(fwidth(fine),fwidth(fine)));
     let amberSection=smoothstep(.465,.500,backUV.x)*(1.-smoothstep(.753,.785,backUV.x))*f32(signal);
     let dye=mix(select(vec3f(.383,.416,.368),vec3f(.402,.011,.014),red),vec3f(.785,.239,.033),amberSection);
     let groove=(.72+.26*ribHeight+.18*clearFlute+.12*diamonds);
     let ribN=normalize(n+tangent*(.39*clearFlute+.054*diamonds)+ny*(.30*(ribHeight-.5)));
     let inCell=vec2f(fract(backUV.x*cells+.23)-.5,(backUV.y-.5)*.90);
     let parabolic=normalize(n-tangent*inCell.x*2.9-ny*inCell.y*2.26);
     let direction=reflect(-v,parabolic);
     let skyReturn=environment(direction,.19);
     let cutoff=smoothstep(-.27,.63,dot(direction,n));
     let rearIrr=amb*.23+skyReturn*(.22+.50*cutoff);
     let wall=smoothstep(.37,.48,abs(inCell.x));
     let shade=(1.-.43*wall)*(.82+.18*groove);
     let cellCenter=select(select(.358,.599,signal),select(.396,.464,lp.y>.603),red);
     let bulb=vec2f((backUV.x-cellCenter)/.125,(backUV.y-.48)/.462);
     let envelope=exp(-dot(bulb,bulb)*1.39);
     let fres=.044+.90*pow(1.-nv,5.);
     let blackSeal=(1.-smoothstep(.013,.034,f)) + smoothstep(.952,.980,f);
     let fused=.92-.31*smoothstep(.78,.99,abs(y-.5)*2.);
     let plateLight=environment(reflect(-v,ribN),.16);
     let inner=dye*(rearIrr*(.48+1.52*envelope)+plateLight*.34+amb*.18)*shade*groove*fused;
     let brakeLight=select(0.,g.game.z,red)*vec3f(.57,.014,.003)*(.16+3.59*envelope)*groove;
     let shellLight=env*fres+max(vec3f(0.),plateLight-vec3f(.13))*.052;
     let opacity=mix(.81,.98,blackSeal);
     transp=max(opacity,fres);
     color=(shellLight+(1.-fres)*(inner+brakeLight)*(1.-.82*blackSeal))/transp;
   }else{
     let amber=i.c.b<.75;let side=sign(lp.x);
     let nx=axis[0]*side;let ny=axis[1];let nz=-axis[2];
     let sx=abs(lp.x);let view=vec3f(dot(v,nx),dot(v,ny),dot(v,nz));
     let uv=vec2f((sx-.5025)/.130,(lp.y-.631)/.084);
     let glassEnv=environment(refl,.085);
     let F=.041+.92*pow(1.-nv,5.);
     if(amber){
       let bend=clamp(atan2((sx-.635)/.102,(-1.684-lp.z)/.095)/1.495,0.,1.);
       let along=vec2f(bend,clamp((lp.y-.631)/.073,-1.03,1.03));
       let angle=bend*1.495;
       let tangent=normalize(nx*cos(angle)-nz*sin(angle));
       let localV=vec2f(dot(v,tangent),dot(v,ny));
       let thick=along+vec2f(-.107*localV.x,-.27*localV.y)/max(.58,nv);
       let ridge=along.x*22.+.16*sin(along.y*3.6);
       let fold=cos(6.283185*ridge)*exp(-2.3*pow(fwidth(ridge),2.));
       let ledge=along.y*3.76+.27*sin(9.5*along.x);
       let bars=cos(6.283185*ledge)*exp(-2.3*pow(fwidth(ledge),2.));
       let fluted=normalize(n+tangent*(fold*.42)+ny*bars*.154);
       let glint=environment(reflect(-v,fluted),.14);
       let aux=vec2f((thick.x-.420)/.224,(thick.y+.04)/.58);
       let radial=length(aux);let lamp=exp(-2.6*radial*radial);
       let mirrorN=normalize(n-tangent*clamp(aux.x*1.05,-1.46,1.46)-ny*clamp(aux.y*.74,-1.28,1.28));
       let inside=environment(reflect(-v,mirrorN),.205);
       // The clear outer shell covers a ribbed amber return around the bulb.
       // Rays crossing the deeper valleys pass through more coloured plastic.
       let insideCos=sqrt(1.-(1.-nv*nv)/2.43);
       let wallPath=(.18+.50*exp(-.51*radial*radial)+.86*lamp+.063*(.5-.5*fold))/insideCos;
       let amberGlass=exp(-vec3f(.014,.55,2.29)*wallPath);
       let ferrule=(1.-smoothstep(.09,.192,abs(radial-.735)))*.162;
       let prism=.91+.095*fold+.062*bars;
       let diffuser=(inside*.34+amb*.93+glint*.20)*amberGlass*prism*(1.-ferrule);
       let bound=max(abs(along.y),abs(bend-.5)*2.);
       let rim=smoothstep(.88,1.,bound);
       transp=max(F,.81);
       color=(F*glassEnv+(1.-F)*mix(diffuser,(amb*.71+glint*.52)*mix(vec3f(.85,.85,.79),amberGlass,.66),rim*.60))/transp;

     }else{
       // Uncoated outer glass transmits the actual mesh of the silvered bowl.
       // The inner pressing only redirects the ray where its local slope differs
       // from the outer face. Clear parts show the geometry at full parallax.
       let face=(i.uv-vec2f(.5025,.631))/vec2f(.1305,.0855);
       let absFace=abs(face);
       let apron=smoothstep(.34,.88,-face.y);
       let wing=smoothstep(.33,.92,absFace.x);
       let centre=smoothstep(.10,.53,1.-absFace.x)*(1.-smoothstep(.32,.82,absFace.y));
       let row=floor((face.y+1.)*2.5);
       let pitch=mix(.091,.126,wing);
       let cell=(face.x+(.031+.061*wing)*face.y*face.y*sign(face.x)
         +(.042*row+.013*sign(face.x))*wing)/pitch;
       let ph=fract(cell)-.5;
       let slope=sin(6.283185*ph)*exp(-3.5*pow(fwidth(cell),2.));
       let spread=(.145+.43*wing+.29*apron+.112*smoothstep(.18,.90,face.y))*(1.-.51*centre);
       let frontNormal=normalize(n+nx*(.0065*face.x)+ny*(.012*face.y));
       let backNormal=normalize(frontNormal+nx*(spread*slope)
         +ny*(.044*wing*sin(row*1.71)+.097*apron)*(.73+.27*slope));
       let viewRay=-v;
       let glassRay=refract(viewRay,frontNormal,1./1.519);
       let through=refract(glassRay,backNormal,1.519);
       let localRay=vec3f(dot(through,nx),dot(through,ny),dot(through,nz));
       let ray=vec3f(localRay.xy,min(-.12,localRay.z));
       let start=face*vec2f(.1305,.0730);
       let curvature=vec2f(3.27,6.15);
       let A=dot(curvature*ray.xy,ray.xy);let B=2.*dot(curvature*start,ray.xy)-ray.z;
       let C=dot(curvature*start,start)-.075;
       let t=max(0.,-2.*C/max(.045,B+sqrt(max(.0,B*B-4.*A*C))));
       let point=start+ray.xy*t;
       let mirrorN=normalize(vec3f(-2.*curvature*point,1.));
       let reflected=reflect(ray,mirrorN);
       let beyond=point+reflected.xy*t*(-ray.z)/max(.08,reflected.z);
       let left=min(.117-abs(beyond.x),.067-abs(beyond.y));
       let exit=smoothstep(-.011,.004,left)*smoothstep(.05,.28,reflected.z);
       let worldRay=nx*reflected.x+ny*reflected.y+nz*reflected.z;
       let returnLight=localReflection(worldRay,.34+wing*.30);
       let second=localReflection(normalize(worldRay+ny*.97+nx*.24),2.52);
       let redirected=mix(second*.39+amb*.115,returnLight,exit);
       let shift=length(through-viewRay);
       let seal=max(absFace.x,smoothstep(.75,1.,absFace.y));
       let redirect=clamp(shift*2.10,0.,.67)*(1.-smoothstep(.853,.975,seal));
       let path=1./max(.48,-dot(glassRay,frontNormal));
       let unpolar=.046+.948*pow(1.-nv,5.);
       let etched=(1.-smoothstep(.018,.071,abs(ph+.465)))*spread;
       let ridgeLight=localReflection(reflect(-v,backNormal),.51);
       let glaze=glassEnv*unpolar+ridgeLight*(.026+etched*.055);
       let absorption=1.-exp(-.056*path);
       let tint=vec3f(.941,.974,.949);
       transp=min(.94,unpolar+.025+absorption+redirect*(1.-unpolar-absorption));
       color=(glaze+redirect*(1.-unpolar-absorption)*redirected*tint+absorption*vec3f(.020,.032,.026))/transp;
     }
   }
 }
 else {color+=env*fres*(1.-rough*.6);} }
 if(id==55u){
   // Polished aluminium returns the sky as well as the dark approach road. The
   // housing blocks grazing exit rays and gives the optical well its depth.
   let xf=g.xform[1];let axis=mat3x3f(xf[0].xyz,xf[1].xyz,xf[2].xyz);
   let local=transpose(axis)*(p-xf[3].xyz);let exitRay=transpose(axis)*refl;
   let forward=select(exitRay.z,-exitRay.z,local.z<0.);
   let escape=smoothstep(-.28,.42,forward+max(0.,abs(exitRay.x)*.53)*smoothstep(.618,.713,abs(local.x)));
   let outside=environment(refl,.120);
   color=mix(amb*vec3f(.53,.54,.49),max(outside,amb*.32),escape)*mix(vec3f(.81),i.c,.33)+directSpec*.65+amb*.128;
   if(local.z< -1.48 && i.c.r>.81 && abs(local.x)>.365 && abs(local.x)<.641){
     // Rays intercepted by the lower half of the aluminised shell can make a
     // second specular return through the opening. Grazing escape catches
     // the brighter glass of the overlapping lower ledge.
     let unit=vec2f((abs(local.x)-.5025)/.1205,(local.y-.630)/.075);
     let back=normalize(axis*vec3f(-.79*unit.x*sign(local.x),1.01+.17*unit.y,-.44));
     let secondRay=reflect(refl,back);
     let second=environment(secondRay,.15);
     let returnStrength=(1.-smoothstep(-.27,.60,forward))*(.42+.16*max(0.,unit.y));
     let other=environment(normalize(refl+back*.83),.23);
     color+=returnStrength*(.42*second+.56*other+.38*amb);
     let glassRing=smoothstep(.77,.99,max(abs(unit.x),abs(unit.y)));
     color+=glassRing*.12*amb;
   }
 }
 if(id==56u){
   let rimLight=environment(refl,.16)*.47+amb*1.10+sunlight*light*max(0.,dot(n,sun))*.17;
   color=rimLight*i.c*vec3f(.934,.945,.897)+directSpec*.46;
 }
 if(isPane && group==1u && i.c.r<.97){
   let lp=transpose(mat3x3f(g.xform[1][0].xyz,g.xform[1][1].xyz,g.xform[1][2].xyz))*(p-g.xform[1][3].xyz); 
   if(lp.z>1.34 && abs(dot(n,g.xform[1][2].xyz))>.65){
     // Each printed silver-frit track turns down toward the side or bottom
     // busbar. The rounding follows the glass coordinates and its pixel footprint.
     let u=abs(i.uv.x);let t=i.uv.y;var coverage=0.;
     for(var k=0u;k<11u;k++){
       let j=f32(k);let x=u-(.185+.027*j);
       let turn=.5*(x+sqrt(x*x+.0017));
       let offset=t-(.193+.0615*j-1.32*turn);
       let w=max(.00075,fwidth(offset));
       coverage=max(coverage,(1.-smoothstep(max(0.,.00070-.51*w),.00070+.51*w,abs(offset)))*min(1.,.00140/w));
     }
     let bottom=(1.-smoothstep(.0015,.0046,abs(t-.127)))*smoothstep(.225,.265,u);
     let right=(1.-smoothstep(.0021,.0059,abs(u-.876)))*(1.-smoothstep(.392,.417,t));
     let frit=max(coverage*.76,max(bottom,right)*.47)*smoothstep(.106,.123,t)*(1.-smoothstep(.871,.889,u));
     color=mix(color,vec3f(.149,.085,.044),frit);transp+=frit*(1.-transp)*.50;
   }
 }
 color+=emit;if(group==0u && (isRoad || id==11u || id==13u || id==12u)){let local=transpose(mat3x3f(g.xform[1][0].xyz,g.xform[1][1].xyz,g.xform[1][2].xyz))*(p-g.car.xyz);let under=exp(-pow(abs(local.x)/.86,4.)-pow(abs(local.z)/1.62,4.));let wp=vec2f((abs(local.x)-.666)/.24,min(abs(local.z+1.143),abs(local.z-1.218))/.27);let wheel=exp(-dot(wp,wp));color*=max(.11,(1.-.53*under)*(1.-.75*wheel));}
 let fog=1.-exp(-dist*(.00071+.00039*exp(-max(0.,p.y-g.car.y)*.038))*select(1.,.53,id==19u));let haze=mix(vec3f(.49,.628,.823),vec3f(1.22,.800,.365),pow(max(0.,dot(-v,sun)),6.)*select(1.,.34,id==19u));color=mix(color,haze,fog);
 let prev=i.old.xy/max(.0001,i.old.w)*vec2f(.5,-.5)+.5;return Surface(vec4f(color,select(select(0.,wet*.98,isRoad || id==18u || id==17u || id==23u),transp,isPane || isFence)),i.pos.xy*g.res.zw-prev); }
struct GOut { @location(0) hdr:vec4f, @location(1) motion:vec2f };
@fragment fn fs(i:Vary,@builtin(front_facing) front:bool)->GOut {let s=surface(i,front,false);return GOut(s.color,s.motion);}
@fragment fn reflectOpaque(i:Vary,@builtin(front_facing) front:bool)->@location(0) vec4f {
 return vec4f(surface(i,!front,false).color.rgb,1.);
}
@fragment fn reflectGlass(i:Vary,@builtin(front_facing) front:bool)->@location(0) vec4f {
 return surface(i,!front,false).color;
}
@fragment fn probeFs(i:Vary,@builtin(front_facing) front:bool)->@location(0) vec4f {return vec4f(surface(i,front,true).color.rgb,1./max(.24,distance(i.wp,g.cam.xyz)));}
`;
const renderBg=/* wgsl */`
fn direction(uv:vec2f)->vec3f {let q=g.invVP*vec4f(uv*vec2f(2.,-2.)+vec2f(-1.,1.)-g.jitter.xy,.999,1.);return normalize(q.xyz/q.w-g.cam.xyz);}
@fragment fn background(i:Full)->GOut {let d=direction(i.uv);let c=skyColor(d);let old=g.prevVP*vec4f(d,0.);let olduv=(old.xy/max(.00001,old.w)+g.jitter.zw)*vec2f(.5,-.5)+.5;return GOut(vec4f(c,0.),i.uv-olduv);}
@fragment fn mirrorSky(i:Full)->@location(0) vec4f {
 let ray=direction(i.uv);let haze=positionReflection(g.car.xyz,ray,2.1);
 return vec4f(mix(haze,skyColor(ray),smoothstep(.14,.44,ray.y)),1.);
}
@fragment fn probeBg(i:Full)->@location(0) vec4f {return vec4f(skyColor(direction(i.uv)),0.);}
`;
const renderEffects=/* wgsl */`
struct Effect { posAge:vec4f, params:vec4f };
@group(1) @binding(0) var<storage,read> effects:array<Effect,${roadEffectsCount}>;
struct FxV {
 @builtin(position) pos:vec4f,@location(0) uv:vec2f,@location(1) data:vec3f,@location(2) world:vec3f,
 @location(3) @interpolate(flat) centerAngle:vec4f,@location(4) @interpolate(flat) radiiSeed:vec4f,
 @location(5) old:vec4f
};
@vertex fn fxVert(@builtin(vertex_index) v:u32,@builtin(instance_index) instance:u32)->FxV {
 let extra=instance>=${roadEffectsCount}u;
 let sample=instance%128u;let droplet=extra && sample<126u;
 let cluster=select(0.,f32(sample)-125.,extra && !droplet);
 var id=instance;if(extra){id=160u+(instance-${roadEffectsCount}u)/128u;}
 let e=effects[id];let kind=e.params.w;let age=e.posAge.w;
 let empty=FxV(vec4f(2,2,2,1),vec2f(0),vec3f(0),vec3f(0),vec4f(0),vec4f(1),vec4f(0));
 if(kind<.5 || (kind>2.5 && age>.84)){return empty;}
 let c=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,-1),vec2f(1,1),vec2f(-1,1))[v];
 let ang=e.params.x;let pos=e.posAge.xyz;
 var coords=c;var data=vec3f(age,kind,f32(id));var p=pos;var centerAngle=vec4f(0);var radiiSeed=vec4f(1);var advect=vec3f(0);
 if(kind>2.5){
   let tire=(id-160u)/${waterPulseCount}u;let strength=e.params.z;let speed=e.params.y;
   let forward=vec3f(sin(ang),0.,-cos(ang));let axle=vec3f(-forward.z,0.,forward.x);
   let outward=axle*select(-1.,1.,tire%2u==1u);
   let emission=hash(pos.xz*1.71+vec2f(10.34+cluster*4.93,f32(tire)*5.8));
   let index=f32(sample);let sampleId=vec2f(index+f32(id)*.83,emission*35.);
   let r=vec4f(hash(sampleId+4.8),hash(sampleId-7.63),hash(sampleId+11.7),hash(sampleId-19.41));
   let up=vec3f(0,1,0);let kick=clamp(abs(speed)*.083,.24,1.45)*(.43+.57*strength);
   if(droplet){
     // Each tyre ejects water from a finite patch throughout the exposure.
     let slot=sample;
     if(slot<8u){
       // Two strips of water peel from the outer tread shoulder. Each strip
       // accounts for a short interval of release as the wheel rolls forward.
       let stream=slot/4u;let part=slot%4u;let f=f32(stream);
       let seed=hash(pos.xz+vec2f(3.45,f*8.73));
       let lifetime=.073+.040*seed+.025*strength;
       if(age>lifetime || strength<.12+f*.14){return empty;}
       let u=(f32(part)+.5+.5*c.x)*.25;
       coords.x=u*2.-1.;let duration=.030+.008*seed;
       let t=mix(max(0.,age-duration),age,u);
       let releaseTime=age-t;
       let edge=fract(kind);let outSpeed=kick*(.74+.82*seed+1.83*edge);
       let vz=kick*(.45+.73*seed+.85*edge);
       let carry=(1.-exp(-3.35*t))/3.35;
       let phase=t*(34.+23.*seed)+seed*6.283;
       let width=(1.-.56*u)*(.016+.022*seed+.012*strength)*(1.-.60*smoothstep(.048,lifetime,t));
       let w=c.y*width;
       p=pos+forward*(speed*(releaseTime+.24*carry)+w+.011*sin(phase))
         +outward*(.008+f*.018+outSpeed*carry+w*(.18+.35*cos(phase)))
         +up*(.004+vz*carry-4.905*t*t+w*(.22+.46*sin(phase)));
       data=vec3f(t/lifetime,5.,strength*smoothstep(.0,.017,age)*(1.-smoothstep(.040,lifetime,age)));
       
       radiiSeed=vec4f(forward,seed);
       advect=forward*speed*.24+outward*outSpeed+up*(vz-9.81*t);
     }else{
     let delay=r.w*.028;let t=age-delay;
     // Fine atomized drops lose momentum in the air. Only a few larger drops
     // break free of a deep contact patch and clear the near wake.
     let bead=smoothstep(.51,.94,r.y)*smoothstep(.12,.64,strength);
     let gust=noise(pos.xz*1.26+outward.xz*.23);
     let lip=fract(kind);
     let finger=select(0.,smoothstep(.19,.91,lip+strength*.26)*smoothstep(.0,.017,t)*(1.-smoothstep(.047,.126,t)),slot<12u);
     let vertical=(.44+.79*r.x+1.60*bead+.77*lip)*kick*(.58+.66*gust);
     let drag=mix(6.8,1.48,bead)*(.74+.52*r.z);
     let carry=exp(-drag*t);let lift=(1.-carry)/drag;
     let height=(vertical+9.81/drag)*lift-9.81*t/drag;
     if(t<=0. || height<-.010 || r.z>min(.96,.12+strength*(.71+.56*gust))){return empty;}
     let initial=pos+forward*speed*(delay-.013)+axle*(r.z-.5)*.13;
     let released=forward*speed*(.16+.59*r.y)+outward*kick*(.19+2.72*r.z*r.z+.91*bead+1.61*lip)*(.39+1.14*gust);
     let lateralAir=axle*(1.60*(gust-.45)+.56*(r.x-.5));
     let air=vec3f(.72,0.,-.31)+forward*speed*.095+lateralAir;
     let center=initial+(released-air)*lift+air*t+up*height;
     let toEye=normalize(g.cam.xyz-center);
     let velocity=(released-air)*carry+air+up*((vertical+9.81/drag)*carry-9.81/drag);
     advect=velocity;
     let now=g.vp*vec4f(center,1.);
     let was=g.prevVP*vec4f(center-velocity*g.game.x,1.);
     if(now.w<=.085 || was.w<=.085){return empty;}
     let delta=(now.xy/now.w-was.xy/was.w)*g.res.xy*.5;
     let travel=length(delta);let axis=select(vec2f(0,1),delta/max(.001,travel),travel>.01);
     let xAxis=normalize(vec3f(g.vp[0].x,g.vp[1].x,g.vp[2].x));
     let yAxis=vec3f(g.vp[0].y,g.vp[1].y,g.vp[2].y);
     let ppm=length(yAxis)*g.res.y*.5/now.w;
     let upAxis=normalize(yAxis);let across=xAxis*(-axis.y)+upAxis*axis.x;
     let along=xAxis*axis.x+upAxis*axis.y;
     let radius=(.00080+.0027*bead+.00043*r.x*r.y+finger*.00085)*ppm;
     let major=radius*(1.+.45*bead)+finger*(.002+.009*r.y)*ppm;
     let sprayGroup=slot>=16u && (slot&1u)==0u;
     let groupRadius=(.006+.029*r.x+.065*t)*ppm;
     let width=select(sqrt(radius*radius+.47),max(1.1,groupRadius),sprayGroup);let extent=sqrt(major*major+.47)+min(2.8,travel*.082);
     let coverage=radius*major/(width*extent);
     let longAxis=select(extent,width*(1.02+.42*r.w),sprayGroup);
     p=center+(across*c.x*width+along*c.y*longAxis)/ppm;
     data=vec3f(.09+.88*bead,4.+.80*finger,strength*(.49+.65*bead+.21*finger)*coverage*(1.-smoothstep(.23,.56,t))*smoothstep(0.,.010,t));
     if(sprayGroup){
       data=vec3f(bead,6.,strength*(.17+.34*bead)*(1.-smoothstep(.18,.49,t))*smoothstep(0.,.022,t));
       centerAngle=vec4f(r.xy,r.z+emission,r.w);
     }
     }
   }else{
     // Mist follows the shed edge of a spray sheet. The compact packets grow,
     // turn in the wheel wake and dilute independently after the sheet breaks.
     let lip=fract(kind);let eddy=noise(pos.xz*1.31+vec2f(3.46,2.11));
     let ttl=.20+.11*emission+.10*strength;
     if(age>=ttl){return empty;}
     let delay=.008*cluster;let flight=max(0.,age-delay);let t=flight/ttl;let phase=emission*6.28;
     let drag=4.7+2.7*eddy;let carry=exp(-drag*flight);let drift=(1.-carry)/drag;
     let air=vec3f(.77,0.,-.34)+forward*speed*.093+axle*(eddy-.46)*2.30;
     // Coarse drops leave laterally. Fine droplets entrained in the tyre wake
     // divide into two vortices, with different diameters and angular phases.
     let lateralSpeed=.38+1.82*lip+1.09*emission+cluster*.26;
     let release=forward*speed*(.17+.32*emission)+outward*kick*lateralSpeed;
     let v0=kick*(.34+.83*lip+.45*strength+emission*.67+cluster*.11);
     let swirl=sin(phase+age*(11.+5.*lip))-sin(phase);
     let rise=v0*drift-.15*age*age;
     let radius=vec3f(.045+.047*lip+flight*(.78+.72*eddy),.035+.032*strength+flight*(.35+.41*eddy),.071+.056*strength+flight*(.47+.65*emission));
     let turn=age*(12.+5.*lip)+phase;
     let rollRadius=flight*(.26+.32*strength);
     let center=pos+forward*(speed*delay)+(release-air)*drift+air*flight
       +outward*(.020+swirl*.043+rollRadius*sin(turn))+up*(.011+rise+rollRadius*(cos(turn)-.30));
     advect=(release-air)*carry+air+outward*(.048*(11.+5.*lip)*cos(phase+age*(11.+5.*lip)))+up*(v0*carry-.30*age);
     let toEye=normalize(g.cam.xyz-center);let right=normalize(cross(up,toEye));let top=cross(toEye,right);
     let projectedX=vec3f(dot(right,axle),right.y,dot(right,forward))*radius;
     let projectedY=vec3f(dot(top,axle),top.y,dot(top,forward))*radius;
     p=center+right*c.x*length(projectedX)*1.13+top*c.y*length(projectedY)*1.13;
     let dilution=1./(1.+3.8*age+9.*age*age);
     data=vec3f(t,3.,strength*(.58+.66*lip)*select(.85,.64,cluster>0.)*dilution*smoothstep(.0,.055,t)*(1.-smoothstep(.42,1.,t)));
     centerAngle=vec4f(center,ang);radiiSeed=vec4f(radius,emission);
   }
 }else if(kind>1.5){
   let dir=normalize(g.cam.xyz-pos);let right=normalize(cross(vec3f(0,1,0),dir));let up=cross(dir,right);
   p=pos+(right*c.x+up*c.y)*max(.12,e.params.z);
 }else{
   p=pos+vec3f(c.x*cos(ang)*e.params.z+c.y*sin(ang)*e.params.y,0.,c.y*cos(ang)*e.params.y-c.x*sin(ang)*e.params.z)*.5;
 }
 var clip=g.vp*vec4f(p,1.);clip.x+=g.jitter.x*clip.w;clip.y+=g.jitter.y*clip.w;clip.z-=.000005*clip.w;
 let old=g.prevVP*vec4f(p-advect*g.game.x,1.);
 return FxV(clip,coords,data,p,centerAngle,radiiSeed,vec4f(old.xy+g.jitter.zw*old.w,old.zw));
}
struct FxOut {@location(0) hdr:vec4f,@location(1) motion:vec4f};
fn shadeEffect(i:FxV)->FxOut {if(i.data.y>2.5){
 let eyeRay=normalize(i.world-g.cam.xyz);
 var alpha:f32;var samplePos=i.world;
 if(i.data.y>5.5){
   // A small packet holds distinct drops. Integrate each drop across a pixel
   // before resolving the density at the soft edge of the packet.
   let seed=i.centerAngle;let q=i.uv*(3.4+2.2*seed.y)+seed.xw*63.;
   let cell=floor(q);let u=fract(q)-.5;
   let offset=vec2f(hash(cell+seed.x*23.+5.),hash(cell-seed.y*19.+3.))-.5;
   let local=u-offset*.64;let r=.065+.21*hash(cell+seed.z*37.);
   let footprint=clamp(.51*length(fwidth(q)),.020,.48);
   let spread=sqrt(r*r+footprint*footprint);
   let coverage=(r*r/(spread*spread))*(1.-smoothstep(max(0.,spread-footprint),spread+footprint,length(local)));
   let edge=1.-smoothstep(.06+.16*seed.w,.77+.20*seed.x,dot(i.uv,i.uv));
   alpha=i.data.z*coverage*edge;
 }else if(i.data.y>4.95){
   let age=i.data.x;let uv=i.uv;
   let pert=noise(i.world.xz*59.+vec2f(i.radiiSeed.w*13.,-age*.73));
   let airHole=noise(i.world.xz*116.+vec2f(pert*1.7,i.radiiSeed.w*31.));
   let fill=1.-smoothstep(.51,.79,airHole+age*.25);
   let rim=smoothstep(.72,.97,abs(uv.y));
   let n0=normalize(cross(dpdy(i.world),dpdx(i.world)));
   let n=normalize(select(n0,-n0,dot(n0,eyeRay)>0.)+i.radiiSeed.xyz*(pert-.5)*.36);
   let incident=reflect(eyeRay,n);let env=localReflection(incident,1.2);
   let light=visibility(i.world,vec3f(0,1,0),distance(i.world,g.cam.xyz),false);
   let glint=pow(max(0.,dot(sun,incident)),140.)*light;
   let fres=.034+.80*pow(1.-abs(dot(n,eyeRay)),4.);
   let water=mix(vec3f(.058,.082,.091),min(env,vec3f(2.)),.44+.45*fres)
     +vec3f(2.1,1.57,1.02)*glint;
   alpha=i.data.z*fill*(.11+.35*fres+.12*rim)*(1.-smoothstep(.56,1.,abs(uv.x)))*(1.-smoothstep(.90,1.,abs(uv.y)));
   let prevUV=i.old.xy/max(.001,i.old.w)*vec2f(.5,-.5)+.5;
   return FxOut(vec4f(water,alpha),vec4f(i.pos.xy*g.res.zw-prevUV,0.,alpha));
 }else if(i.data.y>3.5){
   let taper=1.+(i.data.y-4.)*i.uv.y*.42;
   let r2=dot(i.uv*vec2f(taper,1.),i.uv*vec2f(taper,1.));if(r2>=1.){discard;}
   alpha=i.data.z*(.38+.44*i.data.x)*(1.-smoothstep(.0,1.,r2));
 }else{
   let center=i.centerAngle.xyz;let a=i.centerAngle.w;
   let axle=vec3f(cos(a),0.,sin(a));let forward=vec3f(axle.z,0.,-axle.x);
   let invRadius=1./i.radiiSeed.xyz;let delta=i.world-center;
   let q=vec3f(dot(delta,axle),delta.y,dot(delta,forward))*invRadius;
   let d=vec3f(dot(eyeRay,axle),eyeRay.y,dot(eyeRay,forward))*invRadius;
   let closest=-dot(q,d)/dot(d,d);let middle=q+closest*d;let miss=dot(middle,middle);
   if(miss>=1.){discard;}
   // Integrate the varying concentration across the ellipsoid in world space.
   let halfChord=sqrt((1.-miss)/dot(d,d));samplePos+=eyeRay*closest;
   let seed=i.radiiSeed.w;let time=i.data.x;
   var integral=0.;
   for(var k=0;k<3;k++){
     let offset=(f32(k)-1.)*.67*halfChord;let q3=middle+d*offset;
     let weight=max(0.,1.-dot(q3,q3));let edge=q3.x*(seed*1.46-.73)+q3.z*.63;
     // Two neighbouring folds of fine droplets shear at different rates and
     // tear along the crest. Their density is advected with this wheel packet.
     let uv=q3.xz*vec2f(1.8,1.35)+vec2f(.51*q3.y+seed*29.,-.46*q3.y+seed*13.);
     let roll=noise(uv+vec2f(.34*time,-.82*time));
     let torn=noise(uv*2.58+vec2f(roll*1.52+.48*time,-.57*time));
     let tubes=noise(uv*4.73+vec2f(roll*.72-torn*.36,-1.22*time));
     let y1=q3.y+.24*edge-(roll-.5)*1.96-torn*.36+.12;
     let y2=q3.y-.31*edge+(roll-.5)*1.22+torn*.55-.06;
     let sheet=exp(-y1*y1*20.)*smoothstep(.18,.73,torn);
     let lip=exp(-y2*y2*36.)*smoothstep(.33,.78,roll)*(.29+.95*tubes);
     integral+=weight*(.03+1.72*sheet+1.49*lip)*(.35+1.19*tubes);
   }
   alpha=1.-exp(-i.data.z*halfChord*integral*.72);

 }
 let skyFill=localReflection(normalize(vec3f(-eyeRay.x,.83,-eyeRay.z)),4.).rgb;
 let light=visibility(samplePos,vec3f(0,1,0),distance(samplePos,g.cam.xyz),false);
 let forwardLight=.045+.28*pow(max(0.,dot(eyeRay,sun)),6.);
 let dome=mix(vec3f(dot(skyFill,vec3f(.213,.715,.072))),skyFill,.18);
 var scatter=vec3f(.099,.100,.096)+min(dome,vec3f(.92))*.60+light*vec3f(1.22,.93,.70)*(forwardLight+.042);
 if(i.data.y>3.5 && i.data.y<4.95){
   let right=normalize(cross(vec3f(0,1,0),eyeRay));let top=cross(eyeRay,right);
   let waterNormal=normalize(-eyeRay*sqrt(max(.012,1.-dot(i.uv,i.uv)))+right*i.uv.x+top*i.uv.y);
   let incident=reflect(eyeRay,waterNormal);let lobe=localReflection(incident,2.8);
   let glint=pow(max(0.,dot(sun,incident)),80.)*light;
   scatter=mix(scatter,.12+min(lobe,vec3f(1.42))*.79,.47)+vec3f(1.28,.97,.65)*glint;
 }
 let prevUV=i.old.xy/max(.001,i.old.w)*vec2f(.5,-.5)+.5;
 return FxOut(vec4f(scatter,alpha),vec4f(i.pos.xy*g.res.zw-prevUV,0.,alpha));
}if(i.data.y>1.5){let r=length(i.uv+vec2f(noise(i.uv*3.+i.data.z)-.5,noise(i.uv*4.+i.data.z)-.5)*.38);let a=(1.-smoothstep(.12,1.,r))*.27*clamp(1.-i.data.x*.55,0.,1.);return FxOut(vec4f(.66,.64,.59,a),vec4f(0));}return FxOut(vec4f(.027,.024,.022,.40*(1.-smoothstep(.7,1.,abs(i.uv.x)))*(.72+.28*cos(i.uv.x*37.))),vec4f(0));}
@fragment fn fxFrag(i:FxV)->FxOut {return shadeEffect(i);}
@group(1) @binding(1) var backgroundHDR:texture_2d<f32>;
@group(1) @binding(2) var opticalExposure:texture_2d<f32>;
fn tone(c:vec3f)->vec3f{let x=max(c*1.03,vec3f(0.));let ac=clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0),vec3f(1));return pow(ac,vec3f(1./2.2));}
@fragment fn sprayDisplay(i:FxV)->@location(1) vec4f {
 let sample=shadeEffect(i).hdr;
 let uv=i.pos.xy*g.res.zw;let exposure=textureLoad(opticalExposure,vec2i(0),0).r;
 var light=sample.rgb;
 if(i.data.y>3.5){
   let transmitted=textureSampleLevel(backgroundHDR,isotropic,clamp(uv+i.uv*g.res.zw*2.3,vec2f(.001),vec2f(.999)),0.).rgb;
   let rim=smoothstep(.15,.88,dot(i.uv,i.uv));
   light=mix(transmitted,light,select(.43+.51*rim,.72,i.data.y>5.5));
 }
 let vignette=1.-.105*pow(length((uv-.5)*1.48),2.5);
 return vec4f(tone(light*exposure*vignette),sample.a);
}
`;
const renderPost=renderCommon+renderUniform+/* wgsl */`
@group(0) @binding(1) var samp:sampler;
@group(0) @binding(2) var hdr:texture_2d<f32>;
@group(0) @binding(3) var depth:texture_depth_2d;
@group(0) @binding(4) var motion:texture_2d<f32>;
@group(0) @binding(5) var lowT:texture_2d<f32>;
@group(0) @binding(6) var hist:texture_2d<f32>;
@group(0) @binding(7) var reflectedRoad:texture_2d<f32>;
@group(0) @binding(8) var mirrorScene:texture_2d<f32>;
fn zAt(uv:vec2f)->f32 {return textureLoad(depth,clamp(vec2i(uv*g.res.xy),vec2i(0),vec2i(g.res.xy)-1),0);}
fn world(uv:vec2f,z:f32)->vec3f {let q=g.invVP*vec4f(uv*vec2f(2.,-2.)+vec2f(-1.,1.)-g.jitter.xy,z,1.);return q.xyz/q.w;}
fn colorAt(uv:vec2f)->vec4f{return textureSampleLevel(hdr,samp,uv,0.);}
fn reflectionAt(p:vec3f,normal:vec3f,water:f32)->vec4f{
 if(water<.035){return vec4f(0.);}let view=normalize(g.cam.xyz-p);
 // Depressions collect a shallow film. Its free surface is smoother than the triangle slope.
 let grade=.030*cos((p.x+p.z)*.020);
 let groundSlope=vec2f(grade+.0405*cos(p.x*.015),grade+.0496*cos(p.z*.016));
 let wind=vec2f(sin(p.x*2.03+p.z*.97)+.47*sin(p.z*3.81-p.x*.68),cos(p.x*1.76-p.z*1.22));
 let aggregate=vec2f(noise(p.xz*3.6),noise(p.zx*3.3+9.))-.5;
 let slope=-groundSlope*mix(.90,.70,water)+wind*.0011+aggregate*(.021-.019*water);
 var n=normalize(vec3f(slope.x,1.,slope.y));
 if(all(p.xz>=g.wakeBounds.xy) && all(p.xz<=g.wakeBounds.zw) && distance(p.xz,g.car.xz)<25.){var wave=vec2f(0.);for(var j=0u;j<u32(g.origin.w);j++){let w=g.wake[j];if(w.w<.02){continue;}let v=p.xz-w.xy;let d2=dot(v,v);if(d2>3.1){continue;}let dst=sqrt(max(.0001,d2));let ring=dst-(.073+w.z*1.12);wave+=v/dst*exp(-ring*ring*28.)*cos(ring*29.2)*(.038*w.w)*(1.-smoothstep(.18,1.03,w.z));}n=normalize(n+vec3f(wave.x,0.,wave.y)*water);}
 let r=reflect(-view,n);let nv=clamp(dot(n,view),0.,1.);
 let carSlope=.030*cos((g.car.x+g.car.z)*.020);
 let plane=normalize(vec3f(-carSlope-.0405*cos(g.car.x*.015),1.,-carSlope-.0496*cos(g.car.z*.016)));
 // Near the car, intersect the ray at body distance. On the far shore, use a
 // smooth optical path so a silhouette's depth discontinuity cannot tear the water.
 let toBody=g.car.xyz+vec3f(0.,.67,0.)-p;
 let bodyAlong=clamp(dot(toBody,r),.10,7.);
 let separation=length(toBody-r*bodyAlong);
 let nearby=(1.-smoothstep(.94,2.9,separation))*(1.-smoothstep(4.5,10.,length(toBody)));
 let shore=mix(58.,210.,smoothstep(11.,110.,distance(p,g.cam.xyz)));
 let opticalPath=mix(shore,bodyAlong,nearby);
 let sample=p+r*opticalPath;
 let at=g.vp*vec4f(sample-2.*plane*dot(sample-g.car.xyz,plane),1.);
 let source=at.xy/max(.01,at.w)*vec2f(.5,-.5)+.5;
 let projected=g.vp*vec4f(p,1.);
 let pixelUV=projected.xy/projected.w*vec2f(.5,-.5)+.5;
 let micro=smoothstep(.54,.93,water);
 // Exposed aggregate interrupts the image of a tree before the last moisture dries.
 let energy=min(.46,(.022+.91*pow(1.-nv,5.20))*(.052+.37*micro+.59*nearby));
 return vec4f(source-pixelUV,mix(2.8+(1.-micro)*20.5,1.45+(1.-micro)*5.4,nearby),energy);
}
fn meterScene()->f32 {
 var sum=0.;var weights=0.;
 for(var y=0;y<7;y++){for(var x=0;x<9;x++){
   let cell=(vec2f(f32(x),f32(y))+.5)/vec2f(9,7);
   let prior=textureSampleLevel(hdr,samp,cell,0.).rgb;
   let lum=clamp(dot(prior,vec3f(.2126,.7152,.0722)),.007,2.);
   let delta=cell-vec2f(.5,.47);let weight=1.-min(.72,dot(delta,delta)*1.64);
   sum+=weight*log2(lum);weights+=weight;
 }}
 let key=log2(.099);
 let stops=clamp((key-sum/weights)*.64,-.12,.76);
 let old=textureLoad(hist,vec2i(0),0).a;
 let adapt=1.-exp(-g.game.x*select(1.75,.85,exp2(stops)>old));
 return mix(old,exp2(stops),select(adapt,1.,g.game.w>.5 || old<.5));
}
struct LowOut { @location(0) ambient:vec4f, @location(1) wetReflection:vec4f };
@fragment fn small(i:Full)->LowOut {let uv=i.uv;let d=zAt(uv);let p=world(uv,d);let dst=length(p-g.cam.xyz);let radius=clamp(g.res.y*.30/max(1.,dst),2.,46.);var ao=0.;var bloom=vec3f(0.);let screenSun=g.vp*vec4f(sun,0.);let sunUV=screenSun.xy/max(.0001,screenSun.w)*vec2f(.5,-.5)+.5;var beams=0.;let n=normalize(cross(dpdy(p),dpdx(p)));let N=select(n,-n,dot(n,g.cam.xyz-p)<0.);
 for(var j=0;j<6;j++){let a=f32(j)*2.39996+.3;let off=vec2f(cos(a),sin(a))*sqrt((f32(j)+.5)/6.);let c=colorAt(uv+off*g.res.zw*4.).rgb;let br=max(c.r,max(c.g,c.b));bloom+=c*max(0.,br-1.15)/max(.001,br);
 if(d<.999995 && dst<120.){let u=uv+off*g.res.zw*radius;let s=world(u,zAt(u))-p;let l=length(s);ao+=max(0.,dot(N,s/max(.0001,l))-.12)*(1.-smoothstep(.08,1.8,l));}}
 if(screenSun.w>0. && dot(sunUV-uv,sunUV-uv)<.9){for(var j=0;j<10;j++){let u=mix(uv,sunUV,(f32(j)+.5)*.039);beams+=smoothstep(.99994,1.,zAt(u))*(1.-f32(j)*.071);} }
 var reflection=reflectionAt(p,N,colorAt(uv).a);if(all(i.p.xy<vec2f(1.))){reflection.r=meterScene();}return LowOut(vec4f(bloom/6.+vec3f(.98,.62,.28)*beams*.013*exp(-length(sunUV-uv)*4.),1.-min(.38,ao*.102)),reflection);}
fn composedRoad(uv:vec2f,source:vec4f)->vec3f{
 if(source.a<=.012){return source.rgb;}
 let mirror=textureSampleLevel(reflectedRoad,samp,max(uv,1.5/vec2f(textureDimensions(reflectedRoad))),0.);
 let reflectedUV=uv+mirror.xy;
 let edge=min(reflectedUV,1.-reflectedUV);
 let weight=mirror.a*source.a*(.64+.36*source.a)*smoothstep(.0005,.02,min(edge.x,edge.y));
 if(weight<.0001){return source.rgb;}
 let radius=g.res.zw*mirror.z;
 let light=textureSampleLevel(mirrorScene,samp,reflectedUV,0.).rgb*.32+.17*(
  textureSampleLevel(mirrorScene,samp,reflectedUV+radius*vec2f(.82,.56),0.).rgb+
  textureSampleLevel(mirrorScene,samp,reflectedUV+radius*vec2f(-.56,.82),0.).rgb+
  textureSampleLevel(mirrorScene,samp,reflectedUV+radius*vec2f(-.82,-.56),0.).rgb+
  textureSampleLevel(mirrorScene,samp,reflectedUV+radius*vec2f(.56,-.82),0.).rgb);
 let luma=dot(light,vec3f(.213,.715,.072));
 let reflected=light*.70/(1.+.94*luma);
 return mix(source.rgb,reflected,weight);
}
fn tone(c:vec3f)->vec3f{let x=max(c*1.03,vec3f(0.));let ac=clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0),vec3f(1));return pow(ac,vec3f(1./2.2));}
struct PostOut { @location(0) history:vec4f,@location(1) display:vec4f };
@fragment fn resolve(i:Full)->PostOut {let uv=i.uv;let pixel=vec2i(i.p.xy);let z=textureLoad(depth,pixel,0);let raw=textureLoad(hdr,pixel,0);let vel=textureLoad(motion,pixel,0).xy;let lo=textureSampleLevel(lowT,samp,uv,0.);var curr=composedRoad(uv,raw);
 // Integrate the aperture on surfaces outside the focus plane. Reject samples
 // across an in-focus occluder to keep thin foreground geometry intact.
 let invZ=(1.-z)/.085+z/2600.;
 let defocus=min(6.8,g.lens.y*abs(1.-g.lens.x*invZ));
 if(defocus>1.05){
   let disk=array<vec2f,8>(vec2f(.230,.079),vec2f(-.369,.268),vec2f(.060,-.536),vec2f(.430,.443),
     vec2f(-.705,-.034),vec2f(.592,-.513),vec2f(-.115,.858),vec2f(-.546,-.793));
   var integral=curr*.60;
   var support=.60;
   for(var t=0;t<8;t++){
     let u=uv+disk[t]*defocus*g.res.zw;
     let zTap=zAt(u);let inverseTap=(1.-zTap)/.085+zTap/2600.;
     let cover=1.-smoothstep(.10,.37,(inverseTap-invZ)*g.lens.x);
     integral+=cover*composedRoad(u,colorAt(u));
     support+=cover;
   }
   curr=mix(curr,integral/support,smoothstep(1.05,1.68,defocus)*.96);
 }
 let w=uv-vel;let hp=textureSampleLevel(hist,samp,w,0.);let a=colorAt(uv+g.res.zw*vec2f(-1,-1)).rgb;let b=colorAt(uv+g.res.zw*vec2f(1,-1)).rgb;let c=colorAt(uv+g.res.zw*vec2f(-1,1)).rgb;let d=colorAt(uv+g.res.zw*vec2f(1,1)).rgb;let mn=min(curr,min(min(a,b),min(c,d)));let mx=max(curr,max(max(a,b),max(c,d)));let loBox=max(vec3f(0),mn-(mx-mn)*.025);let hiBox=mx+(mx-mn)*.025;let history=clamp(hp.rgb,loBox,hiBox);
 let actualMotion=vel-(g.jitter.xy-g.jitter.zw)*vec2f(.5,-.5);
 let motionLength=length(actualMotion*g.res.xy);
 let invDepth=1.-z;
 let depthMismatch=abs(invDepth-hp.a)/max(.000025, max(invDepth,hp.a));
 let depthAgreement=1.-smoothstep(.055,.28,depthMismatch);
 let inside=all(w==clamp(w,vec2f(.001),vec2f(.999)));
 let historyShare=mix(.84,.65,smoothstep(2.,17.,motionLength))*depthAgreement;
 let temporal=mix(curr,history,select(0.,historyShare,inside && g.game.w<.5));
 var finalColor=temporal;
 if(motionLength>1.65 && g.game.w<.5 && abs(g.game.y)>1.){
   let speed=smoothstep(3.,19.,abs(g.game.y));
   let frameTime=max(.001,g.game.x);
   let shortSpan=min(10.,motionLength*min(.95,mix(.0039,.0048,speed)/frameTime));
   let roadSpan=min(mix(24.,38.,speed),motionLength*mix(.013,.020,speed)/frameTime);
   var span=shortSpan;
   if(raw.a<.22 && roadSpan>shortSpan){
     // A static rail or kerb follows the camera projection. Droplets covering
     // that surface carry their own velocity while depth still refers to the road.
     let ndc=uv*vec2f(2.,-2.)+vec2f(-1.,1.)-g.jitter.xy;
     let previous=g.prevVP*(g.invVP*vec4f(ndc,z,1.));
     let oldUV=(previous.xy/previous.w+g.jitter.zw)*vec2f(.5,-.5)+.5;
     let disagreement=length((uv-oldUV-vel)*g.res.xy);
     let stable=(1.-smoothstep(.85,3.5,disagreement))*(1.-smoothstep(.035,.22,raw.a));
     span=mix(shortSpan,roadSpan,stable);
   }
   let shutter=actualMotion*(span/motionLength);
   let pairs=clamp(i32(ceil(span*.31)),1,11);
   var blurred=temporal;
   var total=1.;
   for(var j=1;j<=pairs;j++){
     let t=f32(j)/(2.*f32(pairs)+1.);
     for(var side=-1;side<=1;side+=2){
       let u=uv+f32(side)*shutter*t;
       let ip=clamp(vec2i(u*g.res.xy),vec2i(0),vec2i(g.res.xy)-1);
       let nd=textureLoad(depth,ip,0);
       let nv=textureLoad(motion,ip,0).xy;
       let relZ=(z-nd)/max(.00024,invDepth);
       let relV=length((nv-vel)*g.res.xy)/max(2.,motionLength);
       let behind=smoothstep(.033,.23,-relZ);
       let weight=(1.-smoothstep(.05,.21,relZ))*(1.-smoothstep(.22,.74,relV)*(1.-.74*behind))*(1.-.41*t);
       blurred+=weight*composedRoad(u,colorAt(u));
       total+=weight;
     }
   }
   finalColor=mix(temporal,blurred/total,smoothstep(1.65,5.2,motionLength)*.90);
 }
 let blur=(textureSampleLevel(lowT,samp,uv+g.res.zw*vec2f(-8,-6),0.).rgb+textureSampleLevel(lowT,samp,uv+g.res.zw*vec2f(8,6),0.).rgb+textureSampleLevel(lowT,samp,uv+g.res.zw*vec2f(-6,8),0.).rgb+textureSampleLevel(lowT,samp,uv+g.res.zw*vec2f(6,-8),0.).rgb)*.25;
 finalColor=finalColor*lo.a+lo.rgb*.14+blur*.23;finalColor*=1.-.105*pow(length((uv-.5)*1.48),2.5);let dith=(fract(52.9829189*fract(dot(i.p.xy,vec2f(.06711056,.00583715))))-.5)/255.;let exposure=textureLoad(reflectedRoad,vec2i(0),0).r;return PostOut(vec4f(temporal,select(invDepth,exposure,all(pixel==vec2i(0)))),vec4f(tone(finalColor*exposure)+dith,1.));}
`;
function rendererTiles(device){
 const size=256, levels=9;
 const sampleHash=(x,y)=>{let a=Math.imul(x,73856093)^Math.imul(y,19349663);a=Math.imul(a^(a>>>16),0x45d9f3b);return ((a^(a>>>16))>>>0)/4294967296};
 function field(x,y,k){let ix=Math.floor(x*k/size),iy=Math.floor(y*k/size),a=x*k/size-ix,b=y*k/size-iy;a*=a*(3-2*a);b*=b*(3-2*b);const h=(u,v)=>sampleHash((u+k)%k,(v+k)%k);return (h(ix,iy)*(1-a)+h(ix+1,iy)*a)*(1-b)+(h(ix,iy+1)*(1-a)+h(ix+1,iy+1)*a)*b;}
 function upload(bytes,leaf){const tex=device.createTexture({size:[size,size],format:'rgba8unorm',mipLevelCount:levels,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});let n=size;
 for(let level=0;level<levels;level++){device.queue.writeTexture({texture:tex,mipLevel:level},bytes,{bytesPerRow:n*4},[n,n]);if(n===1)break;const m=n>>1,out=new Uint8Array(m*m*4);for(let y=0;y<m;y++)for(let x=0;x<m;x++){const j=(y*m+x)*4;const s=(y*2*n+2*x)*4;for(let ch=0;ch<4;ch++){let v=(bytes[s+ch]+bytes[s+4+ch]+bytes[s+4*n+ch]+bytes[s+4*n+4+ch])*.25;if(leaf&&ch===3)v=Math.min(255,v*1.09);out[j+ch]=v;}}bytes=out;n=m;}
 return tex.createView();}
 const pixels=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const j=(y*size+x)*4;const n=field(x,y,8)*.54+field(x,y,16)*.25+field(x,y,32)*.13+field(x,y,64)*.08;pixels[j]=n*255;pixels[j+1]=(field(x,y,63)*.54+sampleHash(x,y)*.46)*255;pixels[j+2]=Math.pow(sampleHash(x+55,y+17),1.4)*255;const cx=x/8,cy=y/8,ix=Math.floor(cx),iy=Math.floor(cy);let closest=3,stone=0;for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const xx=(ix+a+32)%32,yy=(iy+b+32)%32,dx=cx-ix-a-.16-sampleHash(xx+37,yy)*.68,dy=cy-iy-b-.15-sampleHash(xx,yy+65)*.70;const ds=dx*dx+dy*dy;if(ds<closest){closest=ds;stone=sampleHash(xx+17,yy+49);}}pixels[j+3]=Math.max(4,Math.min(249,Math.round((.38+stone*.45-Math.sqrt(closest)*.28)*255)));}tyreBedTile=pixels;const grain=upload(pixels,false);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d',{willReadFrequently:true});let seed=478114;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
 const leaves=[];ctx.lineCap='round';function twig(x,y,angle,len,th,depth){const bend=(rand()-.5)*.30,ex=x+Math.cos(angle+bend)*len,ey=y+Math.sin(angle+bend)*len;ctx.strokeStyle=depth>1?'#776a4d':'#929663';ctx.lineWidth=th;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+Math.cos(angle)*len*.56,y+Math.sin(angle)*len*.56,ex,ey);ctx.stroke();if(depth>0){twig(ex,ey,angle+bend+(rand()-.5)*.34,len*(.56+rand()*.12),th*.57,depth-1);for(let j=0;j<3;j++){const at=.29+j*.24;twig(x+(ex-x)*at,y+(ey-y)*at,angle+(j%2===0?-1:1)*(.51+rand()*.48),len*(.47+rand()*.17),th*.53,depth-1);}}else{for(let j=0;j<7;j++){const t=rand();leaves.push([x+(ex-x)*t+(rand()-.5)*14,y+(ey-y)*t+(rand()-.5)*9,angle+(j%2?1:-1)*(.4+rand()*.7),12+rand()*16,3.8+rand()*5.9,rand()]);}}}
 twig(250,5,1.53,173,6.2,3);twig(253,64,1.04,143,4.6,3);twig(251,79,2.1,156,4.1,3);
 for(const [x,y,a,l,w,k] of leaves){ctx.save();ctx.translate(x,y);ctx.rotate(a);const b=Math.floor(108+k*134);ctx.fillStyle=`rgb(${b*.89},${b},${b*.77})`;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(l*.43,w,l,0);ctx.quadraticCurveTo(l*.56,-w*.85,0,0);ctx.fill();ctx.restore();}
 const sm=document.createElement('canvas');sm.width=sm.height=size;const sc=sm.getContext('2d',{willReadFrequently:true});sc.drawImage(canvas,0,0,size,size);const data=sc.getImageData(0,0,size,size).data;return {grain,leaves:upload(data,true)};
}
function renderSunMatrix(out,o,x,y,z,extent,depth){const dx=RENDER_SUN[0],dy=RENDER_SUN[1],dz=RENDER_SUN[2];const rl=Math.sqrt(dz*dz+dx*dx),rx=dz/rl,rz=-dx/rl,ux=dy*rz,uy=dz*rx-dx*rz,uz=-dy*rx;out[o]=rx/extent;out[o+1]=ux/extent;out[o+2]=-dx/depth;out[o+3]=0;out[o+4]=0;out[o+5]=uy/extent;out[o+6]=-dy/depth;out[o+7]=0;out[o+8]=rz/extent;out[o+9]=uz/extent;out[o+10]=-dz/depth;out[o+11]=0;out[o+12]=-(rx*x+rz*z)/extent;out[o+13]=-(ux*x+uy*y+uz*z)/extent;out[o+14]=.5+(dx*x+dy*y+dz*z)/depth;out[o+15]=1;}
async function initRenderer(canvas,scene){
 if(!navigator.gpu)throw Error('WebGPU is not available in this browser.');
 const gq=window.graphicsQuality||localStorage.getItem('race_quality')||'medium';
 const wideShadowSize=gq==='low'?1024:gq==='high'?4096:2048;
 const nearShadowSize=gq==='low'?256:gq==='high'?768:512;const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('WebGPU adapter unavailable.');const canTime=adapter.features.has('timestamp-query');const device=await adapter.requestDevice({requiredFeatures:canTime?['timestamp-query']:[]});device.addEventListener('uncapturederror',e=>console.error('WebGPU:',e.error.message));device.lost.then(i=>console.error('WebGPU device lost:',i.message));
 const ctx=canvas.getContext('webgpu'),format=navigator.gpu.getPreferredCanvasFormat();ctx.configure({device,format,alphaMode:'opaque'});const queue=device.queue;
 const TU=GPUTextureUsage,BU=GPUBufferUsage, SS=GPUShaderStage;const W=canvas.width,H=canvas.height;
 const target=(size,fmt,ex=0)=>device.createTexture({size,format:fmt,usage:TU.RENDER_ATTACHMENT|TU.TEXTURE_BINDING|ex});const tex=(w,h,f)=>target([w,h],f).createView();const buffer=(arr,use)=>{const b=device.createBuffer({size:Math.max(4,arr.byteLength),usage:use,mappedAtCreation:true});new Float32Array(b.getMappedRange()).set(arr);b.unmap();return b};
 const visibility=typeof visibleScene==='function'?visibleScene(device,scene):null;const vertex=visibility?null:buffer(packSceneVertices(scene.vertices,scene.vertices.length/13),BU.VERTEX),instances=visibility?null:buffer(scene.instances,BU.VERTEX);const U=new Float32Array(404),prior=new Float32Array(96);const uniform=device.createBuffer({size:U.byteLength,usage:BU.UNIFORM|BU.COPY_DST});const effects=device.createBuffer({size:roadEffectsCount*32,usage:BU.STORAGE|BU.COPY_DST});
 const sam=device.createSampler({addressModeU:'repeat',addressModeV:'repeat',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',maxAnisotropy:4});const iso=device.createSampler({addressModeU:'repeat',addressModeV:'repeat',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear'});const postS=device.createSampler({magFilter:'linear',minFilter:'linear'});const shadowS=device.createSampler({compare:'less-equal',minFilter:'linear',magFilter:'linear'});
 const trackWater=tireWaterTexture(device),aggregateView=createAggregateMap(device);const maps=rendererTiles(device),woodland=createWoodlandMaps(device),forestSky=typeof createForestIrradiance==='function'?createForestIrradiance(device,scene):maps.grain,canopyAtlas=typeof worldCanopyAtlas==='function'?worldCanopyAtlas(device):maps.leaves,verge=typeof worldVergeTile==='function'?worldVergeTile(device):maps.grain,asphaltHistory=typeof createPavementMap==='function'?createPavementMap(device):maps.grain,wide=tex(wideShadowSize,wideShadowSize,'depth32float'),near=tex(nearShadowSize,nearShadowSize,'depth32float'),pan=tex(4096,2048,'rgba16float');const probeCount=reflectionProbeCount,probeTex=device.createTexture({size:[reflectionProbeSize,reflectionProbeSize,probeCount*6],mipLevelCount:6,format:'rgba16float',usage:TU.RENDER_ATTACHMENT|TU.TEXTURE_BINDING});const probeView=probeTex.createView({dimension:'cube-array'});const probeDummy=target([1,1,6],'rgba16float').createView({dimension:'cube-array'});const depDummy=tex(1,1,'depth32float');const probeDepth=tex(reflectionProbeSize,reflectionProbeSize,'depth32float');
 const mirrorScale=gq==='low'?6:3,mirrorWidth=Math.max(1,Math.ceil(W/mirrorScale)),mirrorHeight=Math.max(1,Math.ceil(H/mirrorScale));
 const mirrorView=tex(mirrorWidth,mirrorHeight,'rgba16float'),mirrorDepth=tex(mirrorWidth,mirrorHeight,'depth32float');
 const mirrorUniform=device.createBuffer({size:U.byteLength,usage:BU.UNIFORM|BU.COPY_DST});
 const depth=tex(W,H,'depth32float'),hdr=tex(W,H,'rgba16float'),motion=tex(W,H,'rg16float'),low=tex(Math.max(1,W>>2),Math.max(1,H>>2),'rgba16float'),reflectionBuffer=tex(Math.max(1,W>>2),Math.max(1,H>>2),'rgba16float'),hist=[tex(W,H,'rgba16float'),tex(W,H,'rgba16float')];
 const shader=(label,code)=>device.createShaderModule({label,code:'diagnostic(off, derivative_uniformity);\n'+code});const skyMod=shader('céu atmosférico',renderSky),mainCode=renderCommon+renderUniform+renderGeom+renderResources+renderBg+renderEffects,mainMod=shader('materiais e geometria',typeof withCanopy==='function'?withCanopy(mainCode):mainCode),postMod=shader('pós-processamento',renderPost);
 for(const mod of [skyMod,mainMod,postMod]){const info=await mod.getCompilationInfo();const errs=info.messages.filter(x=>x.type==='error');if(errs.length)throw Error(errs.map(e=>`${mod.label} ${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));}
 const VL=[{arrayStride:48,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x3'},{shaderLocation:3,offset:36,format:'float16x2'},{shaderLocation:4,offset:40,format:'float32x2'}]},{arrayStride:32,stepMode:'instance',attributes:[{shaderLocation:5,offset:0,format:'float32x4'},{shaderLocation:6,offset:16,format:'float32x4'}]}];
 const use=SS.VERTEX|SS.FRAGMENT;const sceneLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:use,buffer:{}},{binding:1,visibility:SS.FRAGMENT,sampler:{}},...[2,3,4].map(binding=>({binding,visibility:SS.FRAGMENT,texture:{}})),...[5,6].map(binding=>({binding,visibility:SS.FRAGMENT,texture:{sampleType:'depth'}})),{binding:7,visibility:SS.FRAGMENT,sampler:{type:'comparison'}},{binding:8,visibility:SS.FRAGMENT,texture:{viewDimension:'cube-array'}},{binding:9,visibility:SS.FRAGMENT,texture:{}},{binding:10,visibility:SS.FRAGMENT,texture:{}},{binding:11,visibility:SS.FRAGMENT,texture:{}},{binding:12,visibility:SS.FRAGMENT,sampler:{}},{binding:13,visibility:SS.FRAGMENT,texture:{}},{binding:14,visibility:SS.FRAGMENT,texture:{viewDimension:'2d-array'}},{binding:15,visibility:SS.FRAGMENT,texture:{}},{binding:16,visibility:SS.FRAGMENT,texture:{}}]});const effectsLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:SS.VERTEX,buffer:{type:'read-only-storage'}}]});const postLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:SS.FRAGMENT,buffer:{}},{binding:1,visibility:SS.FRAGMENT,sampler:{}},...[2,3,4,5,6,7].map(binding=>({binding,visibility:SS.FRAGMENT,texture:binding===3?{sampleType:'depth'}:{}})),{binding:8,visibility:SS.FRAGMENT,texture:{}}]});
 const sprayLayout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:SS.VERTEX,buffer:{type:'read-only-storage'}},
   {binding:1,visibility:SS.FRAGMENT,texture:{}},{binding:2,visibility:SS.FRAGMENT,texture:{}}
 ]});
 const sprayPipeLayout=device.createPipelineLayout({bindGroupLayouts:[sceneLayout,sprayLayout]});
 const scenePipe=device.createPipelineLayout({bindGroupLayouts:[sceneLayout]}),fxPipe=device.createPipelineLayout({bindGroupLayouts:[sceneLayout,effectsLayout]}),postPipe=device.createPipelineLayout({bindGroupLayouts:[postLayout]});
 const group=(layout,list)=>device.createBindGroup({layout,entries:list.map((resource,binding)=>({resource,binding}))});const bindings=(buf,w,n,c)=>group(sceneLayout,[{buffer:buf},sam,maps.leaves,maps.grain,pan,w,n,shadowS,c,asphaltHistory,verge,canopyAtlas,iso,forestSky,woodland,trackWater.view,aggregateView]);const envBG=bindings(uniform,wide,near,probeView),shadowBG=bindings(uniform,depDummy,depDummy,probeDummy),fxBG=group(effectsLayout,[{buffer:effects}]);
 const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}};const mainTargets=[{format:'rgba16float'},{format:'rg16float'}];const glassTargets=[{format:'rgba16float',blend},{format:'rg16float',writeMask:0}];const effectTarget={format:'rgba16float',blend:{color:blend.color,alpha:{srcFactor:'zero',dstFactor:'one-minus-src-alpha',operation:'add'}}};const one=[{format:'rgba16float'}];
 function pipeline(label,module,layout,vert,frag,targets,geo,depth,write){const desc={label,layout,vertex:{module,entryPoint:vert,buffers:geo?VL:[]},fragment:{module,entryPoint:frag,targets},primitive:{topology:'triangle-list',cullMode:'none'}};if(label==='plantas opacas')desc.fragment.constants={alphaCut:false,plantSurface:true};if(label==='cor e velocidade')desc.fragment.constants={alphaCut:false,opaquePass:true};if(label==='vidro')desc.fragment.constants={glassPass:true};if(label==='copas')desc.fragment.constants={surfaceMaterial:127};if(label==='folhas na água')desc.fragment.constants={surfaceMaterial:127};if(label==='sólidos na água')desc.fragment.constants={alphaCut:false};if(label==='asfalto')desc.fragment.constants={alphaCut:false,surfaceMaterial:10};if(depth)desc.depthStencil={format:'depth32float',depthWriteEnabled:write,depthCompare:label==='reconstrução temporal'?'always':'less-equal'};return device.createRenderPipelineAsync(desc);}
 const [skyPipe,opaquePipe,roadPipe,maskedPipe,leavesPipe,glassPipe,backPipe,widePipe,nearPipe,prPipe,prBg,mirrorPipe,mirrorLeavesPipe,mirrorSkyPipe,mirrorGlassPipe,effPipe,smallPipe,resolvePipe,plantPipe]=await Promise.all([
 pipeline('panorama',skyMod,'auto','full','skyBake',one,false,false,false),pipeline('cor e velocidade',mainMod,scenePipe,'vs','fs',mainTargets,true,true,true),pipeline('asfalto',mainMod,scenePipe,'vs','fs',mainTargets,true,true,true),pipeline('folhagem e recortes',mainMod,scenePipe,'vs','fs',mainTargets,true,true,true),pipeline('copas',mainMod,scenePipe,'vs','fs',mainTargets,true,true,true),pipeline('vidro',mainMod,scenePipe,'vs','fs',glassTargets,true,true,false),pipeline('céu',mainMod,scenePipe,'skyFull','background',mainTargets,false,true,false),pipeline('sombra circuito',mainMod,scenePipe,'vsWide','shadowFs',[],true,true,true),pipeline('sombra carro',mainMod,scenePipe,'vsNear','shadowNearFs',[],true,true,true),pipeline('reflexo local',mainMod,scenePipe,'vs','probeFs',one,true,true,true),pipeline('céu local',mainMod,scenePipe,'full','probeBg',one,false,true,false),pipeline('sólidos na água',mainMod,scenePipe,'vs','reflectOpaque',one,true,true,true),pipeline('folhas na água',mainMod,scenePipe,'vs','reflectOpaque',one,true,true,true),pipeline('distância na água',mainMod,scenePipe,'skyFull','mirrorSky',one,false,true,false),pipeline('vidros na água',mainMod,scenePipe,'vs','reflectGlass',[glassTargets[0]],true,true,false),pipeline('fumaça e marcas',mainMod,fxPipe,'fxVert','fxFrag',[effectTarget,{format:'rg16float',blend}],false,true,false),pipeline('oclusão e luz',postMod,postPipe,'full','small',[{format:'rgba16float'},{format:'rgba16float'}],false,false,false),pipeline('reconstrução temporal',postMod,postPipe,'full','resolve',[{format:'rgba16float'},{format}],false,true,false),pipeline('plantas opacas',mainMod,scenePipe,'vs','fs',mainTargets,true,true,true)]);
 const sprayBG=group(sprayLayout,[{buffer:effects},hdr,reflectionBuffer]);
 const sprayDisplayPipe=await pipeline('água suspensa',mainMod,sprayPipeLayout,'fxVert','sprayDisplay',[{format:'rgba16float',writeMask:0},{format,blend}],false,true,false);
 const ca=(view)=>({view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}),da=(view)=>({view,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'});const pass=(views,d)=>{const res={colorAttachments:views.map(ca)};if(d)res.depthStencilAttachment=da(d);return res};
 const exec=(enc,desc,list)=>{const p=enc.beginRenderPass(desc);p.executeBundles(list);p.end()};
 function makeBundle(formats,depth,setup){const desc={colorFormats:formats};if(depth)desc.depthStencilFormat='depth32float';if(depth==='read')desc.depthReadOnly=true;const b=device.createRenderBundleEncoder(desc);setup(b);return [b.finish()];}
 const drawGeo=visibility?visibility.draw:(b,filter)=>{b.setVertexBuffer(0,vertex);b.setVertexBuffer(1,instances);for(const batch of scene.batches)if(filter(batch)&&batch.instanceCount)b.draw(batch.count,batch.instanceCount,batch.first,batch.firstInstance);};
 // The dynamic depth map contains only five rigid groups. Bound their
 // projections once per frame so empty texels need no comparison samples.
 const casterBoxes=new Float64Array(6*6);
 for(let group=1;group<6;group++){
   const k=group*6;
   casterBoxes.fill(Infinity,k,k+3);casterBoxes.fill(-Infinity,k+3,k+6);
 }
 for(const batch of scene.batches){
   if(!batch.shadow || !batch.car)continue;
   for(let k=batch.first*13;k<(batch.first+batch.count)*13;k+=13){
     const group=scene.vertices[k+10]*6;
     for(let j=0;j<3;j++){
       const x=scene.vertices[k+j];
       casterBoxes[group+j]=Math.min(casterBoxes[group+j],x);
       casterBoxes[group+3+j]=Math.max(casterBoxes[group+3+j],x);
     }
   }
 }
 function boundCarShadow(){
   let minU=1,minV=1,maxU=0,maxV=0;
   for(let group=1;group<6;group++){
     const k=group*6,t=80+group*16;
     for(let corner=0;corner<8;corner++){
       const x=casterBoxes[k+(corner&1)*3],y=casterBoxes[k+1+((corner>>1)&1)*3],z=casterBoxes[k+2+((corner>>2)&1)*3];
       const wx=U[t]*x+U[t+4]*y+U[t+8]*z+U[t+12];
       const wy=U[t+1]*x+U[t+5]*y+U[t+9]*z+U[t+13];
       const wz=U[t+2]*x+U[t+6]*y+U[t+10]*z+U[t+14];
       const u=.5+.5*(U[64]*wx+U[68]*wy+U[72]*wz+U[76]);
       const v=.5-.5*(U[65]*wx+U[69]*wy+U[73]*wz+U[77]);
       minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);
     }
   }
   // 8.95 texels is the largest disk radius, plus subpixel rasterization,
   // bilinear depth comparisons and floating-point round-off.
   const guard=11/nearShadowSize;
   U[400]=Math.max(.001,minU-guard);U[401]=Math.max(.001,minV-guard);
   U[402]=Math.min(.999,maxU+guard);U[403]=Math.min(.999,maxV+guard);
 }
 U[400]=U[401]=.001;U[402]=U[403]=.999;
 const wideB=makeBundle([],true,b=>{b.setBindGroup(0,shadowBG);b.setPipeline(widePipe);drawGeo(b,s=>s.shadow&&!s.car)}),nearB=makeBundle([],true,b=>{b.setBindGroup(0,shadowBG);b.setPipeline(nearPipe);drawGeo(b,s=>s.shadow&&s.car)});
 const smallB=hist.map((view,i)=>makeBundle(['rgba16float','rgba16float'],false,b=>{
   const smallBinds=group(postLayout,[{buffer:uniform},postS,hdr,depth,motion,hist[i],hist[1-i],hist[i],mirrorView]);
   b.setPipeline(smallPipe);b.setBindGroup(0,smallBinds);b.draw(3);
 }));
 // A single-material pipeline frees registers occupied by glass and car optics
 // in the general shader. Mixed batches continue through the general pipeline.
 for(const batch of scene.batches){
   if(!batch.masked)continue;
   let canopy=true;
   for(let v=batch.first;v<batch.first+batch.count;v+=3){
     const id=scene.vertices[v*13+9];if(id<127||id>142){canopy=false;break;}
   }
   batch.canopy=canopy;
 }
 // Each grass blade is already smaller than the specular footprint at the
 // road edge. Keep shrubs, the forest silhouette, trunks, cars and circuit furniture.
 for(const batch of scene.batches){
   if(!batch.firstInstance||batch.car||!batch.shadow)continue;
   let fine=true;
   for(let j=batch.first;j<batch.first+batch.count&&fine;j++){
     const k=j*13,mat=scene.vertices[k+9];
     if(mat>=127&&mat<=142){fine=scene.vertices[k+3]<0.;}
     else{fine=mat===16&&scene.vertices[k+1]<.75;}
   }
   batch.mirrorFineGrass=fine;
 }
 // Homogeneous trunks and ground plants do not contain glass, metal,
 // pavement or a moving object. Choose the restricted shader at bundle creation.
 for(const batch of scene.batches){
   if(!batch.firstInstance || batch.masked || batch.car || batch.spectator || batch.transparent)continue;
   let simple=true;
   for(let j=batch.first;j<batch.first+batch.count && simple;j+=3){
     const id=scene.vertices[j*13+9];simple=id===0 || id===15 || id===16;
   }
   batch.plantSurface=simple;
 }
 // A cell of the optical field interpolates its four corner coordinates.
 // Their component-wise bounds enclose all possible bilinear positions.
 // Rasterise only regions from which the final optical filter can read.
 const maskCode=`
 struct Region { lo:vec2f, hi:vec2f };
 @group(0) @binding(0) var opticalField:texture_2d<f32>;
 @group(0) @binding(1) var<storage,read_write> compiledBounds:array<Region>;
 @group(1) @binding(0) var<storage,read> bounds:array<Region>;
 var<workgroup> low:array<vec2f,64>;
 var<workgroup> high:array<vec2f,64>;
 var<workgroup> wet:array<f32,64>;
 fn kernel(cell:vec2u,dim:vec2u)->vec3f{
   let q=min(cell,dim-1u);let data=textureLoad(opticalField,q,0);
   return vec3f((vec2f(q)+.5)/vec2f(dim)+data.xy,data.a);
 }
 @compute @workgroup_size(64)
 fn buildMasks(@builtin(local_invocation_index) k:u32,@builtin(workgroup_id) id:vec3u){
   let dim=textureDimensions(opticalField);let tile=id.xy*8u;
   let v=kernel(tile+vec2u(k%9u,k/9u),dim);var l=v.xy;var h=v.xy;var w=v.z;
   if(k<17u){let n=k+64u;let e=kernel(tile+vec2u(n%9u,n/9u),dim);l=min(l,e.xy);h=max(h,e.xy);w=max(w,e.z);}
   low[k]=l;high[k]=h;wet[k]=w;workgroupBarrier();
   for(var stride=32u;stride>0u;stride>>=1u){
     if(k<stride){low[k]=min(low[k],low[k+stride]);high[k]=max(high[k],high[k+stride]);wet[k]=max(wet[k],wet[k+stride]);}
     workgroupBarrier();
   }
   if(k==0u){
     let pad=9./vec2f(dim);let live=wet[0]>0.;
     let p0=select(vec2f(0.),clamp(low[0]-pad,vec2f(0.),vec2f(1.)),live);
     let p1=select(vec2f(0.),clamp(high[0]+pad,vec2f(0.),vec2f(1.)),live);
     compiledBounds[id.x+id.y*((dim.x+7u)/8u)]=Region(p0,p1);
   }
 }
 @vertex fn waterTiles(@builtin(vertex_index) k:u32,@builtin(instance_index) instance:u32)->@builtin(position) vec4f {
   let r=bounds[instance];
   let uv=vec2f(select(r.lo.x,r.hi.x,(k&1u)!=0u),select(r.lo.y,r.hi.y,(k&2u)!=0u));
   return vec4f(uv*vec2f(2.,-2.)+vec2f(-1.,1.),1.,1.);
 }
 @fragment fn waterMask()->@location(0) vec4f {return vec4f(0.);}
 `;
 const maskMod=shader('células especulares',maskCode);
 const maskPipe=await device.createRenderPipelineAsync({label:'região amostrada da água',layout:'auto',
   vertex:{module:maskMod,entryPoint:'waterTiles'},fragment:{module:maskMod,entryPoint:'waterMask',targets:[{format:'rgba16float',writeMask:0}]},
   primitive:{topology:'triangle-strip'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'always'}});
 const tileX=Math.ceil(Math.max(1,W>>2)/8),tileY=Math.ceil(Math.max(1,H>>2)/8),tileCount=tileX*tileY;
 const boundsBuffer=device.createBuffer({size:tileCount*16,usage:BU.STORAGE});
 const emptyGroup=group(maskPipe.getBindGroupLayout(0),[]),maskGroup=group(maskPipe.getBindGroupLayout(1),[{buffer:boundsBuffer}]);
 const computeMask=await device.createComputePipelineAsync({label:'amplitude da água',layout:'auto',compute:{module:maskMod,entryPoint:'buildMasks'}});
 const computeGroup=group(computeMask.getBindGroupLayout(0),[reflectionBuffer,{buffer:boundsBuffer}]);
 function findWetTiles(enc){const pass=enc.beginComputePass();pass.setPipeline(computeMask);pass.setBindGroup(0,computeGroup);pass.dispatchWorkgroups(tileX,tileY);pass.end();}
 const mirrorBind=bindings(mirrorUniform,wide,near,probeView);
 const mirrorB=makeBundle(['rgba16float'],true,b=>{
   b.setPipeline(maskPipe);b.setBindGroup(0,emptyGroup);b.setBindGroup(1,maskGroup);b.draw(4,tileCount);
   b.setBindGroup(0,mirrorBind);b.setPipeline(mirrorPipe);drawGeo(b,s=>(s.shadow||s.car)&&!s.canopy&&!s.transparent&&!s.mirrorFineGrass,true);
   b.setPipeline(mirrorLeavesPipe);drawGeo(b,s=>s.canopy&&s.shadow&&!s.mirrorFineGrass,true);
   b.setPipeline(mirrorSkyPipe);b.draw(3);
   b.setPipeline(mirrorGlassPipe);drawGeo(b,s=>s.transparent&&(s.shadow||s.car),true);
 });
 const mirrorP=pass([mirrorView],mirrorDepth);
 mirrorP.depthStencilAttachment.depthClearValue=0;
 mirrorP.depthStencilAttachment.depthStoreOp='discard';
 const sceneB=makeBundle(['rgba16float','rg16float'],true,b=>{b.setBindGroup(0,envBG);b.setPipeline(roadPipe);drawGeo(b,s=>s.asphalt,true);b.setPipeline(opaquePipe);drawGeo(b,s=>!s.transparent&&!s.masked&&!s.asphalt,true,plantPipe,opaquePipe);b.setPipeline(maskedPipe);drawGeo(b,s=>s.masked&&!s.canopy,true);b.setPipeline(leavesPipe);drawGeo(b,s=>s.canopy,true);b.setPipeline(backPipe);b.draw(3);b.setPipeline(glassPipe);drawGeo(b,s=>s.fence);drawGeo(b,s=>s.transparent&&!s.fence);b.setPipeline(effPipe);b.setBindGroup(1,fxBG);b.draw(6,160);b.draw(6,roadEffectsCount-smokeFirst,0,smokeFirst)});
 const postB=hist.map((view,i)=>makeBundle(['rgba16float',format],'read',b=>{b.setPipeline(resolvePipe);b.setBindGroup(0,group(postLayout,[{buffer:uniform},postS,hdr,depth,motion,low,hist[1-i],reflectionBuffer,mirrorView]));b.draw(3);
   b.setPipeline(sprayDisplayPipe);b.setBindGroup(0,envBG);b.setBindGroup(1,sprayBG);
   b.draw(6,4*waterPulseCount,0,160);b.draw(6,4*waterPulseCount*128,0,roadEffectsCount);
 }));
 const wideP=pass([],wide),nearP=pass([],near),sceneP=pass([hdr,motion],depth),smallP=pass([low,reflectionBuffer]),postP=hist.map(view=>pass([view,view]));
 for(const desc of postP)desc.depthStencilAttachment={view:depth,depthReadOnly:true};
 for(let i=0;i<6;i++){for(let j=0;j<4;j++){U[80+i*16+j*5]=1;U[176+i*16+j*5]=1;}}let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,baseY=0;const tr=new Float32Array(6);if(typeof trackSample==='function'){for(let i=0;i<128;i++){trackSample(TRACK_LENGTH*i/128,tr);minX=Math.min(minX,tr[0]);maxX=Math.max(maxX,tr[0]);minZ=Math.min(minZ,tr[2]);maxZ=Math.max(maxZ,tr[2]);baseY+=tr[1]/128;}}else{minX=minZ=-110;maxX=maxZ=110;}
 const cx=.5*(maxX+minX),cz=.5*(maxZ+minZ),extent=Math.max(90,Math.hypot(maxZ-minZ,maxX-minX)*.50+38);renderSunMatrix(U,48,cx,baseY,cz,extent,extent*3.);renderSunMatrix(U,64,0,0,0,4.0,12.);U[284]=W;U[285]=H;U[286]=1/W;U[287]=1/H;queue.writeBuffer(uniform,0,U);
 const cloudVolume=cloudMicrostructure(device),cloudS=device.createSampler({addressModeU:"repeat",addressModeV:"repeat",addressModeW:"repeat",magFilter:"linear",minFilter:"linear"});
 const cloudGroup=group(skyPipe.getBindGroupLayout(0),[cloudS,cloudVolume.createView()]);
 const bake= device.createCommandEncoder();let bakePass=bake.beginRenderPass(pass([pan]));bakePass.setPipeline(skyPipe);bakePass.setBindGroup(0,cloudGroup);bakePass.draw(3);bakePass.end();exec(bake,wideP,wideB);queue.submit([bake.finish()]);cloudVolume.destroy();
 if(typeof trackSample==='function')trackSample(0,tr);const probePos=[tr[0],tr[1]+1.03,tr[2]];const faces=[[1,0,0],[ -1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],ups=[[0,1,0],[0,1,0],[0,0,-1],[0,0,1],[0,1,0],[0,1,0]];
 for(let probeId=0;probeId<probeCount;probeId++){if(typeof trackSample==='function')trackSample(probeId*TRACK_LENGTH/probeCount,tr);probePos[0]=tr[0];probePos[1]=tr[1]+1.15;probePos[2]=tr[2];
 const probeEnc=device.createCommandEncoder();for(let face=0;face<6;face++){const pu=U.slice(),dir=faces[face],up=ups[face],right=[dir[1]*up[2]-dir[2]*up[1],dir[2]*up[0]-dir[0]*up[2],dir[0]*up[1]-dir[1]*up[0]];for(let j=0;j<3;j++)right[j]*=-1;const pos=probePos;const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];const nearZ=.15,farZ=1500,A=farZ/(farZ-nearZ),B=-nearZ*A;for(let j=0;j<3;j++){pu[j*4]=right[j];pu[j*4+1]=up[j];pu[j*4+2]=dir[j]*A;pu[j*4+3]=dir[j];}pu[12]=-dot(right,pos);pu[13]=-dot(up,pos);pu[14]=B-A*dot(dir,pos);pu[15]=-dot(dir,pos);
 // Inverse projection lifts NDC coordinates into a ray for the environment pass.
 for(let j=0;j<3;j++){pu[32+j]=right[j];pu[36+j]=up[j];pu[40+j]=pos[j]/B;pu[44+j]=dir[j]-A*pos[j]/B;}pu[35]=0;pu[39]=0;pu[43]=1/B;pu[47]=-A/B;pu.set(pos,272);pu[284]=pu[285]=reflectionProbeSize;pu[286]=pu[287]=1/reflectionProbeSize;
 const pb=buffer(pu,BU.UNIFORM);const bg=bindings(pb,wide,depDummy,probeDummy);const faceView=probeTex.createView({dimension:'2d',baseArrayLayer:face+6*probeId,arrayLayerCount:1,mipLevelCount:1});const p=probeEnc.beginRenderPass(pass([faceView],probeDepth));p.setBindGroup(0,bg);p.setPipeline(prBg);p.draw(3);p.setPipeline(prPipe);drawGeo(p,s=>!s.car&&(!s.transparent||s.fence));p.end();}queue.submit([probeEnc.finish()]);}
 // Linear radiance downsampling supplies the roughness-dependent reflection lobe.
 const mipMod=shader('filtragem especular',renderCommon+`@group(0) @binding(0) var mipSampler:sampler;@group(0) @binding(1) var sourceMip:texture_2d<f32>;@fragment fn reduce(i:Full)->@location(0) vec4f {let du=1./vec2f(textureDimensions(sourceMip));var c=vec4f(0.);for(var y=0;y<3;y++){for(var x=0;x<3;x++){let off=vec2f(f32(x)-1.,f32(y)-1.)*du*.85;let wt=select(1.,2.,x==1)*select(1.,2.,y==1);c+=textureSampleLevel(sourceMip,mipSampler,i.uv+off,0.)*wt;}}return c*.0625;}`);const mipPipe=await pipeline('convolução angular',mipMod,'auto','full','reduce',one,false,false,false);const mipLayout=mipPipe.getBindGroupLayout(0),mipEnc=device.createCommandEncoder();
 for(let level=1;level<6;level++){for(let layer=0;layer<probeCount*6;layer++){const mipView=(m)=>probeTex.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:m,mipLevelCount:1});const p=mipEnc.beginRenderPass(pass([mipView(level)]));p.setPipeline(mipPipe);p.setBindGroup(0,group(mipLayout,[postS,mipView(level-1)]));p.draw(3);p.end();}}queue.submit([mipEnc.finish()]);
 const mirrorU=new Float32Array(U.length),reflectM=new Float32Array(16);
 const mirrorVP=mirrorU.subarray(0,16),mirrorInverse=mirrorU.subarray(32,48);
 function updateMirror(frame){
   const x=frame.car[0],y=frame.car[1],z=frame.car[2],common=.030*Math.cos((x+z)*.020);
   const dx=common+.0405*Math.cos(x*.015),dz=common+.0496*Math.cos(z*.016);
   const unit=1/Math.sqrt(dx*dx+1+dz*dz),nx=-dx*unit,ny=unit,nz=-dz*unit,level=nx*x+ny*y+nz*z;
   const m=reflectM;
   m[0]=1-2*nx*nx;m[1]=-2*nx*ny;m[2]=-2*nx*nz;
   m[4]=m[1];m[5]=1-2*ny*ny;m[6]=-2*ny*nz;
   m[8]=m[2];m[9]=m[6];m[10]=1-2*nz*nz;
   m[12]=2*level*nx;m[13]=2*level*ny;m[14]=2*level*nz;m[15]=1;
   mirrorU.set(U);multiply(mirrorVP,frame.vp,m);invert(mirrorInverse,mirrorVP);
   const dist=2*(nx*frame.cam[0]+ny*frame.cam[1]+nz*frame.cam[2]-level);
   mirrorU[272]=frame.cam[0]-dist*nx;mirrorU[273]=frame.cam[1]-dist*ny;mirrorU[274]=frame.cam[2]-dist*nz;
   mirrorU[284]=mirrorWidth;mirrorU[285]=mirrorHeight;mirrorU[286]=1/mirrorWidth;mirrorU[287]=1/mirrorHeight;
   
   queue.writeBuffer(mirrorUniform,0,mirrorU);
 }
 // Both ripple kernels ignore samples below .008 and restrict support to
 // a circle of at most sqrt(3.2) metres. Preserve the accumulation order.
 function writeWakes(wakes){
   let count=0,x0=1e6,z0=1e6,x1=-1e6,z1=-1e6;
   if(wakes)for(let i=0;i<wakes.length;i+=4){
     const strength=wakes[i+3];if(strength<.008)continue;
     const x=wakes[i],z=wakes[i+1],dst=296+4*count++;
     U[dst]=x;U[dst+1]=z;U[dst+2]=wakes[i+2];U[dst+3]=strength;
     x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);
   }
   U[295]=count;U[392]=x0-1.80;U[393]=z0-1.80;U[394]=x1+1.80;U[395]=z1+1.80;
 }
 let serial=0,index=0,lastJx=0,lastJy=0,timingSets=null,queryBuffer=null,readBuffer=null,sampleCount=0;const jitX=[0,-.25,.25,-.375,.125,-.125,.375,-.4375],jitY=[-.1667,.1667,-.3889,-.0556,.2778,-.2778,.0556,.3889];const submit=[null];const timedNear={...nearP,timestampWrites:null},timedPost=postP.map(p=>({...p,timestampWrites:null}));const draw=(frame)=>{if(visibility)visibility.update(frame.vp);trackWater.update();U[279]=filmActive?1:0;const cut=serial===0||frame.cut,j=serial&7,jx=jitX[j]*2/W,jy=jitY[j]*2/H;writeWakes(frame.wakes);U.set(frame.vp,0);U.set(frame.prevVP,16);U.set(frame.invVP,32);U.set(frame.transforms,80);U.set(cut?frame.transforms:prior,176);prior.set(frame.transforms);U.set(frame.cam,272);U[275]=frame.time;U.set(frame.car,276);U[280]=frame.dt;U[281]=frame.speed;U[282]=frame.brake;U[283]=cut?1:0;U[288]=jx;U[289]=jy;U[290]=cut?jx:lastJx;U[291]=cut?jy:lastJy;lastJx=jx;lastJy=jy;renderSunMatrix(U,64,frame.car[0],frame.car[1]+.65,frame.car[2],3.85,27.);boundCarShadow();const probeT=(frame.s||0)*probeCount/(typeof TRACK_LENGTH==='number'?TRACK_LENGTH:1),probe0=Math.floor(probeT),localT=probeT-probe0;
 U[396]=frame.focus;U[397]=frame.apertureRadius;U[292]=probe0%probeCount;U[293]=(probe0+1)%probeCount;U[294]=localT*localT*(3.-2.*localT);queue.writeBuffer(uniform,0,U);updateMirror(frame);if(frame.effects)queue.writeBuffer(effects,0,frame.effects);
 const enc=device.createCommandEncoder();const sampling=timingSets&&frame.sample>=0&&frame.sample<sampleCount;
 if(sampling){
   const set=timingSets[Math.floor(frame.sample/1024)],first=(frame.sample%1024)*2;
   const head=timedNear.timestampWrites,tail=timedPost[index].timestampWrites;
   head.querySet=set;head.beginningOfPassWriteIndex=first;
   tail.querySet=set;tail.endOfPassWriteIndex=first+1;
 }
 exec(enc,sampling?timedNear:nearP,nearB);exec(enc,sceneP,sceneB);exec(enc,smallP,smallB[index]);findWetTiles(enc);exec(enc,mirrorP,mirrorB);const final=postP[index];final.colorAttachments[1].view=ctx.getCurrentTexture();exec(enc,sampling?timedPost[index]:final,postB[index]);submit[0]=enc.finish();queue.submit(submit);index^=1;serial++;};
 // Reserve a unique pair of timestamp slots for every measured frame.
 // Resolve after the lap, so no measured frame waits on reuse of a counter pair.
 function startTiming(count){
   if(!canTime)throw Error('Consultas timestamp-query indisponíveis.');
   if(timingSets || !Number.isInteger(count) || count<1)throw Error('Amostragem de GPU inválida.');
   sampleCount=count;timingSets=[];
   for(let begin=0;begin<count;begin+=1024){
     timingSets.push(device.createQuerySet({type:'timestamp',count:2*Math.min(1024,count-begin)}));
   }
   queryBuffer=device.createBuffer({size:16*count,usage:BU.QUERY_RESOLVE|BU.COPY_SRC});
   readBuffer=device.createBuffer({size:16*count,usage:BU.COPY_DST|BU.MAP_READ});
   timedNear.timestampWrites={querySet:timingSets[0],beginningOfPassWriteIndex:0};
   for(const p of timedPost)p.timestampWrites={querySet:timingSets[0],endOfPassWriteIndex:1};
 }
 async function finishTiming(){
   if(!timingSets)return [];
   const enc=device.createCommandEncoder();
   for(let k=0;k<timingSets.length;k++){
     const first=k*1024,frames=Math.min(1024,sampleCount-first);
     enc.resolveQuerySet(timingSets[k],0,2*frames,queryBuffer,first*16);
   }
   enc.copyBufferToBuffer(queryBuffer,0,readBuffer,0,16*sampleCount);
   queue.submit([enc.finish()]);await readBuffer.mapAsync(GPUMapMode.READ);
   const data=new BigUint64Array(readBuffer.getMappedRange()),result=new Float64Array(sampleCount);
   for(let i=0;i<sampleCount;i++)result[i]=Number(data[i*2+1]-data[i*2])/1e6;
   readBuffer.unmap();queryBuffer.destroy();readBuffer.destroy();
   for(const q of timingSets)q.destroy();
   timingSets=null;sampleCount=0;
   return result;
 }
 return {draw,startTiming,finishTiming,device,canTime,width:W,height:H};
}
