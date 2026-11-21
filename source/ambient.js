// Integrate the solid angle occupied by nearby crowns in a ground-space irradiance field.
// It shades the diffuse sky bounce under foliage and fades out towards the crown tops.
function createForestIrradiance(device,scene){
  const n=384,span=490,left=-156,front=-249,k=n/span;
  const density=new Float32Array(n*n),heights=new Float32Array(n*n);
  const vertices=scene.vertices,instances=scene.instances;
  for(const part of scene.batches){
    if(!part.firstInstance||!part.masked||!part.instanceCount)continue;
    let x0=1e20,x1=-1e20,z0=1e20,z1=-1e20,base=1e20,top=-1e20;
    for(let v=part.first*13,end=v+part.count*13;v<end;v+=13){
      const id=vertices[v+9];if(id<127||id>142)continue;
      const x=vertices[v],y=vertices[v+1],z=vertices[v+2],r=vertices[v+3],h=vertices[v+4];
      x0=Math.min(x0,x-r);x1=Math.max(x1,x+r);z0=Math.min(z0,z-r);z1=Math.max(z1,z+r);
      base=Math.min(base,y-h);top=Math.max(top,y+h);
    }
    if(!Number.isFinite(top)||top<1)continue;
    for(let j=0;j<part.instanceCount;j++){
      const q=(part.firstInstance+j)*8,wx=instances[q],wz=instances[q+2],h=top*instances[q+5];
      const radius=Math.max(1.2,(x1-x0+z1-z0)*.25*instances[q+4]);
      const sx=radius*1.48+.34*h,sz=radius*1.32+.32*h;
      const amp=(h<3?.20:.80)*Math.min(1,radius/Math.max(2,h*.39));
      const ax=Math.max(0,Math.floor((wx-left-sx*2)*k)),bx=Math.min(n-1,Math.ceil((wx-left+sx*2)*k));
      const az=Math.max(0,Math.floor((wz-front-sz*2)*k)),bz=Math.min(n-1,Math.ceil((wz-front+sz*2)*k));
      for(let z=az;z<=bz;z++)for(let x=ax;x<=bx;x++){
        const dx=((x+.5)/k+left-wx)/sx,dz=((z+.5)/k+front-wz)/sz,t=dx*dx+dz*dz;
        if(t>4)continue;
        const w=amp*Math.exp(-1.75*t);
        density[z*n+x]+=w;heights[z*n+x]+=w*h;
      }
    }
  }
  const img=new Uint8Array(n*n*4);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){
    const i=z*n+x,base=groundAt((x+.5)/k+left,(z+.5)/k+front);
    img[4*i]=Math.round(255*(1-Math.exp(-density[i]*.68)));
    img[4*i+1]=Math.min(255,Math.round(heights[i]/Math.max(.0001,density[i])*6.375));
    img[4*i+2]=Math.max(0,Math.min(255,Math.round((base+16)*7.969)));
    img[4*i+3]=255;
  }
  const tex=device.createTexture({size:[n,n],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture:tex},img,{bytesPerRow:n*4},[n,n]);return tex.createView();
}
