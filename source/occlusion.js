// Approximate the diffuse visibility integral in the Uno's local coordinate system.
// The two-sided voxel shells retain a bit for each moving part so the tires can
// rotate without carrying a fixed shadow from the wheel arch around with them.
function bakeCarOcclusion(scene) {
  const data=scene.vertices, stride=13, batches=scene.batches;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const part of batches) {
    if(!part.car||part.transparent)continue;
    for(let p=part.first*stride,end=p+part.count*stride;p<end;p+=stride) {
      minX=Math.min(minX,data[p]);minY=Math.min(minY,data[p+1]);minZ=Math.min(minZ,data[p+2]);
      maxX=Math.max(maxX,data[p]);maxY=Math.max(maxY,data[p+1]);maxZ=Math.max(maxZ,data[p+2]);
    }
  }
  if(!Number.isFinite(minX))return;
  const cell=.022,inv=1/cell;
  minX-=2*cell;minY-=2*cell;minZ-=2*cell;
  const nx=Math.ceil((maxX-minX)*inv)+2,ny=Math.ceil((maxY-minY)*inv)+2,nz=Math.ceil((maxZ-minZ)*inv)+2;
  const plane=nx*ny,cells=new Uint8Array(plane*nz);
  const x=new Float64Array(3),y=new Float64Array(3),z=new Float64Array(3);
  function rasterize(p,mask) {
    for(let j=0;j<3;j++) {
      const q=p+stride*j;
      x[j]=(data[q]-minX)*inv;y[j]=(data[q+1]-minY)*inv;z[j]=(data[q+2]-minZ)*inv;
    }
    const abx=x[1]-x[0],aby=y[1]-y[0],abz=z[1]-z[0],acx=x[2]-x[0],acy=y[2]-y[0],acz=z[2]-z[0];
    const ax=Math.abs(aby*acz-abz*acy),ay=Math.abs(abz*acx-abx*acz),az=Math.abs(abx*acy-aby*acx);
    let u=x,v=y,w=z,us=1,vs=nx,ws=plane;
    if(ax>ay&&ax>az){u=y;v=z;w=x;us=nx;vs=plane;ws=1}
    else if(ay>az){u=x;v=z;w=y;us=1;vs=plane;ws=nx}
    const du1=u[1]-u[0],dv1=v[1]-v[0],du2=u[2]-u[0],dv2=v[2]-v[0];
    const area=du1*dv2-du2*dv1;
    if(Math.abs(area)<.045)return;
    const a=1/area,dw1=w[1]-w[0],dw2=w[2]-w[0];
    const u0=Math.floor(Math.min(u[0],u[1],u[2])),u1=Math.floor(Math.max(u[0],u[1],u[2]));
    const v0=Math.floor(Math.min(v[0],v[1],v[2])),v1=Math.floor(Math.max(v[0],v[1],v[2]));
    // Conservative half-cell edge tests also catch the rungs and narrow moldings.
    const e1=.49*(Math.abs(dv2)+Math.abs(du2))*Math.abs(a);
    const e2=.49*(Math.abs(dv1)+Math.abs(du1))*Math.abs(a);
    const e3=.49*(Math.abs(dv1-dv2)+Math.abs(du1-du2))*Math.abs(a);
    for(let j=v0;j<=v1;j++){
      const b=j+.5-v[0];
      for(let i=u0;i<=u1;i++){
        const c=i+.5-u[0],s=(c*dv2-b*du2)*a,t=(du1*b-dv1*c)*a;
        if(s < -e1 || t < -e2 || s+t > 1+e3)continue;
        const h=Math.floor(w[0]+s*dw1+t*dw2);
        cells[i*us+j*vs+h*ws]|=mask;
      }
    }
  }
  for(const part of batches){
    if(!part.car||part.transparent)continue;
    for(let p=part.first*stride,end=p+part.count*stride;p<end;p+=stride*3)rasterize(p,1<<data[p+10]);
  }
  const rayCount=36,dirs=new Float64Array(3*rayCount);
  for(let i=0;i<rayCount;i++){
    const cy=1-2*(i+.5)/rayCount,r=Math.sqrt(1-cy*cy),phi=i*2.3999632297;
    dirs[3*i]=r*Math.cos(phi);dirs[3*i+1]=cy;dirs[3*i+2]=r*Math.sin(phi);
  }
  // Sample short rays densely for hardware and panel gaps. The longer tail
  // supplies softer mutual shading inside the cabin and behind the tires.
  const stops=[.022,.044,.066,.090,.116,.145,.176,.210,.253,.304,.364,.435,.521,.626,.746];
  const weights=stops.map(t=>1/(1+t*2.35));
  const cache=new Map();
  function integral(px,py,pz,dx,dy,dz,group){
    const ix=Math.floor(px),iy=Math.floor(py),iz=Math.floor(pz);
    const normalCode=((Math.round(dx*9)+9)*19+Math.round(dy*9)+9)*19+Math.round(dz*9)+9;
    const key=(((iz*ny+iy)*nx+ix)*6+group)*6859+normalCode;
    const prev=cache.get(key);if(prev!==undefined)return prev;
    const bias=1.45;
    px+=dx*bias;py+=dy*bias;pz+=dz*bias;
    const mask=group===1?0xff:1<<group;
    let sum=0,weight=0;
    for(let i=0;i<rayCount;i++){
      const a=dirs[i*3],b=dirs[i*3+1],c=dirs[i*3+2],cosine=a*dx+b*dy+c*dz;
      if(cosine<=.03)continue;
      weight+=cosine;
      for(let j=0;j<stops.length;j++){
        const t=stops[j]*inv,rx=Math.floor(px+a*t),ry=Math.floor(py+b*t),rz=Math.floor(pz+c*t);
        if(rx<0||ry<0||rz<0||rx>=nx||ry>=ny||rz>=nz)break;
        if(cells[rz*plane+ry*nx+rx]&mask){sum+=cosine*weights[j];break}
      }
    }
    const result=sum/Math.max(weight,.001);cache.set(key,result);return result;
  }
  const strengths=[.33,.25,.32,0,.36,.13,.13,.31,.27,0];
  for(const part of batches){
    if(!part.car||part.transparent)continue;
    for(let p=part.first*stride,end=p+part.count*stride;p<end;p+=stride){
      const strength=strengths[data[p+9]];if(!strength)continue;
      const block=integral((data[p]-minX)*inv,(data[p+1]-minY)*inv,(data[p+2]-minZ)*inv,
        data[p+3],data[p+4],data[p+5],data[p+10]);
      const factor=1-block*strength;
      data[p+6]*=factor;data[p+7]*=factor;data[p+8]*=factor;
    }
  }
}
