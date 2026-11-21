// Column-major WebGPU matrices. Every destination is provided by its caller.
function ident(m){m.fill(0);m[0]=m[5]=m[10]=m[15]=1;return m}
function multiply(out,a,b){
  for(let j=0;j<4;j++){
    const i=j*4,x=b[i],y=b[i+1],z=b[i+2],w=b[i+3];
    out[i]=a[0]*x+a[4]*y+a[8]*z+a[12]*w;
    out[i+1]=a[1]*x+a[5]*y+a[9]*z+a[13]*w;
    out[i+2]=a[2]*x+a[6]*y+a[10]*z+a[14]*w;
    out[i+3]=a[3]*x+a[7]*y+a[11]*z+a[15]*w;
  }
}
function invert(out,a){
  const a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7];
  const a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
  const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12;
  const b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
  const s=1/(b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06);
  out[0]=(a11*b11-a12*b10+a13*b09)*s;out[1]=(a02*b10-a01*b11-a03*b09)*s;out[2]=(a31*b05-a32*b04+a33*b03)*s;out[3]=(a22*b04-a21*b05-a23*b03)*s;
  out[4]=(a12*b08-a10*b11-a13*b07)*s;out[5]=(a00*b11-a02*b08+a03*b07)*s;out[6]=(a32*b02-a30*b05-a33*b01)*s;out[7]=(a20*b05-a22*b02+a23*b01)*s;
  out[8]=(a10*b10-a11*b08+a13*b06)*s;out[9]=(a01*b08-a00*b10-a03*b06)*s;out[10]=(a30*b04-a31*b02+a33*b00)*s;out[11]=(a21*b02-a20*b04-a23*b00)*s;
  out[12]=(a11*b07-a10*b09-a12*b06)*s;out[13]=(a00*b09-a01*b07+a02*b06)*s;out[14]=(a31*b01-a30*b03-a32*b00)*s;out[15]=(a20*b03-a21*b01+a22*b00)*s;
}
function cameraMatrix(out,eye,target,scale){
  let zx=eye[0]-target[0],zy=eye[1]-target[1],zz=eye[2]-target[2],n=1/Math.sqrt(zx*zx+zy*zy+zz*zz);zx*=n;zy*=n;zz*=n;
  n=1/Math.sqrt(zx*zx+zz*zz);const xx=zz*n,xz=-zx*n,yx=zy*xz,yy=zz*xx-zx*xz,yz=-zy*xx;
  const b=scale[0],a=scale[1],far=2600,near=.085,q=far/(near-far);
  out[0]=xx*b;out[1]=yx*a;out[2]=q*zx;out[3]=-zx;
  out[4]=0;out[5]=yy*a;out[6]=q*zy;out[7]=-zy;
  out[8]=xz*b;out[9]=yz*a;out[10]=q*zz;out[11]=-zz;
  const t=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);out[12]=-(xx*eye[0]+xz*eye[2])*b;out[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2])*a;out[14]=q*t+near*q;out[15]=-t;
}
function rotateX(m,turns,pair){
  const s=turns[pair],c=turns[pair+1];for(let i=0;i<4;i++){const y=m[i+4],z=m[i+8];m[i+4]=c*y+s*z;m[i+8]=c*z-s*y}
}
function rotateY(m,turns,pair){
  const s=turns[pair],c=turns[pair+1];for(let i=0;i<4;i++){const x=m[i],z=m[i+8];m[i]=c*x-s*z;m[i+8]=c*z+s*x}
}
function rotateZ(m,turns,pair){
  const s=turns[pair],c=turns[pair+1];for(let i=0;i<4;i++){const x=m[i],y=m[i+4];m[i]=c*x+s*y;m[i+4]=c*y-s*x}
}
function translatePivot(m,p,direction){
  const x=p[0]*direction,y=p[1]*direction,z=p[2]*direction;
  for(let i=0;i<4;i++)m[i+12]+=m[i]*x+m[i+4]*y+m[i+8]*z}
