// Interleaved geometry is assembled once. Templates share a vertex range on the GPU.
const G = (() => {
  class Stream {
    constructor() { this.data = new Float32Array(13 * 3072); this.n = 0; }
    push(p, n, c, m, g, uv) {
      let i = this.n;
      if (i + 13 > this.data.length) {
        const grown = new Float32Array(this.data.length * 2);
        grown.set(this.data);
        this.data = grown;
      }
      const v = this.data;
      v[i++] = p[0]; v[i++] = p[1]; v[i++] = p[2];
      v[i++] = n[0]; v[i++] = n[1]; v[i++] = n[2];
      v[i++] = c[0]; v[i++] = c[1]; v[i++] = c[2];
      v[i++] = m; v[i++] = g;
      v[i++] = uv ? uv[0] : 0; v[i++] = uv ? uv[1] : 0;
      this.n = i;
    }
  }
  const meshes = [], unit = [0,0,0,0,1,1,1,0];
  const make = () => ({streams:new Array(13).fill(null), instances:[]});
  meshes.push(make());
  meshes[0].instances.push(...unit);
  let mesh = meshes[0];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = a => {const n=Math.hypot(...a)||1; return [a[0]/n,a[1]/n,a[2]/n]};
  function tri(a,b,c,color,m=0,g=0,na=null,nb=null,nc=null,ua=null,ub=null,uc=null,cb=null,cc=null) {
    const face=na||norm(cross([b[0]-a[0],b[1]-a[1],b[2]-a[2]],[c[0]-a[0],c[1]-a[1],c[2]-a[2]]));
    const k = m===3||m===20 ? 2 : (g===0 && (m===19 || m===10 || m===18 || m===13 || m===12 || m===17 || m===22 || m===23 || m===24)) ? 1 : 0;
    const masked=m===14||m===20||m===22||m===24||m===25||(m>=127&&m<=142);
    const key=m===10 && g===0 ? 12 : k+(g===0?0:3)+(masked?6:0);
    const s=mesh.streams[key] || (mesh.streams[key]=new Stream());
    s.push(a,na||face,color,m,g,ua);s.push(b,nb||face,cb||color,m,g,ub);s.push(c,nc||face,cc||color,m,g,uc);
  }
  function quad(a,b,c,d,color,m=0,g=0) {tri(a,b,c,color,m,g);tri(a,c,d,color,m,g)}
  function prism(a,b,u,v,color,m,g) {
    const q=(p,i,j)=>[p[0]+i*u[0]+j*v[0],p[1]+i*u[1]+j*v[1],p[2]+i*u[2]+j*v[2]];
    const base=[q(a,1,1),q(a,-1,1),q(a,-1,-1),q(a,1,-1)],top=[q(b,1,1),q(b,-1,1),q(b,-1,-1),q(b,1,-1)];
    quad(base[3],base[2],base[1],base[0],color,m,g);quad(...top,color,m,g);
    for(let i=0;i<4;i++){let j=(i+1)&3;quad(base[i],base[j],top[j],top[i],color,m,g)}
  }
  function box(p,size,color,m=0,g=0) {
    const x=size[0]*.5,y=size[1]*.5,z=size[2]*.5;
    prism([p[0],p[1]-y,p[2]],[p[0],p[1]+y,p[2]],[x,0,0],[0,0,-z],color,m,g);
  }
  function axes(a,b) {
    const t=norm([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);
    const u=norm(cross(Math.abs(t[1])>.98?[0,0,1]:[0,1,0],t));
    return [u,cross(t,u)];
  }
  function beam(a,b,w,d,color,m=0,g=0) {
    const [u,v]=axes(a,b);prism(a,b,u.map(i=>i*w*.5),v.map(i=>i*d*.5),color,m,g);
  }
  function cyl(a,b,ra,rb,n,color,m=0,g=0) {
    const [u,v]=axes(a,b), normals=[],lo=[],hi=[];
    for(let j=0;j<n;j++){
      const ang=2*Math.PI*j/n,co=Math.cos(ang),si=Math.sin(ang);
      const k=u.map((value,i)=>value*co+v[i]*si);
      normals.push(k); lo.push(a.map((p,i)=>p+ra*k[i]));hi.push(b.map((p,i)=>p+rb*k[i]));
    }
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      tri(lo[i],lo[j],hi[j],color,m,g,normals[i],normals[j],normals[j]);
      tri(lo[i],hi[j],hi[i],color,m,g,normals[i],normals[j],normals[i]);
      if(ra)tri(a,lo[j],lo[i],color,m,g); if(rb)tri(b,hi[i],hi[j],color,m,g);
    }
  }
  return {tri,quad,box,beam,cyl,beginTemplate(){mesh=make();meshes.push(mesh);return meshes.length-1},
    endTemplate(){const id=meshes.indexOf(mesh);mesh=meshes[0];return id},
    markSpectators(seated,standing,profiles){
      for(const id of seated.concat(standing)){
        const model=meshes[id],person=profiles[id],neck=person.neck;model.spectator=true;
        const freeTorso=person.activity===0||person.activity===8||person.activity===10;
        const waist=standing.includes(id)?.79:0;
        for(const stream of model.streams){
          if(!stream)continue;
          const data=stream.data;
          for(let i=0;i<stream.n;i+=13){
            const dx=data[i]-neck[0],dy=data[i+1]-neck[1],dz=data[i+2]-neck[2];
            const lift=Math.max(0,Math.min(1,(dy+.035)/.074));
            const lateral=Math.max(0,Math.min(1,(.205-Math.hypot(dx,dz))/.065));
            const weight=lift*lift*(3-2*lift)*lateral*lateral*(3-2*lateral);
            // A weighted lever arm rotates the head about this spectator's own neck.
            // Unbraced watchers rotate the shoulder girdle slightly with the
            // head. Shoe soles, resting hands and the pelvis keep their supports.
            const rise=Math.max(0,Math.min(1,(data[i+1]-waist-.14)/.35));
            const torso=freeTorso?.115*rise*rise*(3.-2.*rise):0;
            data[i+11]=dx*weight+data[i]*torso;data[i+12]=dz*weight+data[i+2]*torso;
          }
        }
      }
    },
    instance(id,x,y,z,yaw=0,sx=1,sy=sx,sz=sx,appearance=0){meshes[id].instances.push(x,y,z,yaw,sx,sy,sz,appearance)},
    finish(){
      let n=0,ni=0; for(const mesh of meshes){
        if(!mesh.instances.length)continue;
        for(const s of mesh.streams)if(s)n+=s.n;
        ni+=mesh.instances.length;
      }
      const vertices=new Float32Array(n),instances=new Float32Array(ni),batches=[]; let cursor=0,ic=0;
      for(const mesh of meshes){
        if(!mesh.instances.length)continue;
        instances.set(mesh.instances,ic);
        for(let k=0;k<mesh.streams.length;k++){const s=mesh.streams[k]; if(!s)continue;
          vertices.set(s.data.subarray(0,s.n),cursor);
          batches.push({first:cursor/13,count:s.n/13,firstInstance:ic/8,instanceCount:mesh.instances.length/8,asphalt:k===12,transparent:k%3===2,shadow:k<12&&(k%3===0||k===8),car:k%6>=3,masked:k>=6&&k<12&&k!==8,fence:k===8,spectator:!!mesh.spectator});
          cursor+=s.n;
        }
        ic+=mesh.instances.length;
      }
      meshes.length=0;mesh=null;
      return {vertices,instances,batches};
    }};
})();
