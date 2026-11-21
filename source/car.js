// Fiat Uno Mille EP. Dimensions and axle positions are expressed in metres.
const WHEEL_RADIUS = .279;
const WHEEL_CENTERS = [[-.665,.279,-1.143],[.665,.279,-1.143],[-.665,.279,1.218],[.665,.279,1.218]];
function buildCar() {
  const body=1, paint=[.57,.735,.837], glass=[.52,.68,.69], seal=[.067,.075,.076],
    trim=[.115,.124,.132], rubber=[.158,.162,.164], silver=[.73,.748,.751],
    darkMetal=[.22,.241,.25], chrome=[.85,.877,.884], headcloth=[.52,.51,.475],
    seats=[.223,.241,.244], fabric=[.258,.278,.275], dark=[.052,.055,.057],
    pi=Math.PI, sin=Math.sin, cos=Math.cos;
  const sub=(a,b)=>a.map((x,i)=>x-b[i]), dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),
    cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
    norm=a=>{let s=Math.hypot(...a)||1;return a.map(x=>x/s)},
    mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t), add=(a,b)=>a.map((v,i)=>v+b[i]),
    scale=(a,s)=>a.map(v=>v*s), sat=x=>Math.min(1,Math.max(0,x)), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function face(a,b,c,d,n,col,m=0,g=body) {
    if(dot(cross(sub(b,a),sub(c,a)),n)<0) G.quad(d,c,b,a,col,m,g);
    else G.quad(a,b,c,d,col,m,g);
  }
  function tri(a,b,c,n,col,m=0,g=body) {
    if(dot(cross(sub(b,a),sub(c,a)),n)<0) G.tri(a,c,b,col,m,g);else G.tri(a,b,c,col,m,g);
  }
  function surface(fn,us,vs,dir,col,mat=0,g=body,withUV=false) {
    const ns=[],ps=[],uv=withUV?[]:null;
    for(const u of us)for(const v of vs) {
      const du=sub(fn(Math.min(us.at(-1),u+.0002),v),fn(Math.max(us[0],u-.0002),v)),
        dv=sub(fn(u,Math.min(vs.at(-1),v+.0002)),fn(u,Math.max(vs[0],v-.0002)));
      let n=norm(cross(du,dv)); if(dot(n,dir)<0)n=scale(n,-1); ns.push(n);const p=fn(u,v);ps.push(p);
      if(uv)uv.push(typeof withUV==='function'?withUV(p):[u,v]);
    }
    for(let i=1;i<us.length;i++)for(let j=1;j<vs.length;j++){
      let a=(i-1)*vs.length+j-1,b=i*vs.length+j-1,c=b+1,d=a+1;
      if(dot(cross(sub(ps[b],ps[a]),sub(ps[c],ps[a])),dir)<0)[b,d]=[d,b];
      G.tri(ps[a],ps[b],ps[c],col,mat,g,ns[a],ns[b],ns[c],uv&&uv[a],uv&&uv[b],uv&&uv[c]);G.tri(ps[a],ps[c],ps[d],col,mat,g,ns[a],ns[c],ns[d],uv&&uv[a],uv&&uv[c],uv&&uv[d]);
    }
  }
  // Smooth normals across stamped and upholstered lofts. End caps retain a separate seam.
  function loft(rows,wrapped,outward,col,mat,chooseColor=null,omit=null){
    const end=rows.length-1,width=rows[0].length,last=width-1;
    const normals=rows.map((row,j)=>row.map((p,i)=>{
      const a=wrapped?row[(i+width-1)%width]:row[Math.max(0,i-1)],b=wrapped?row[(i+1)%width]:row[Math.min(last,i+1)],
        low=rows[Math.max(0,j-1)][i],high=rows[Math.min(end,j+1)][i];
      let n=norm(cross(sub(b,a),sub(high,low)));return dot(n,outward(p))<0?scale(n,-1):n;
    }));
    for(let j=1;j<=end;j++)for(let i=0;i<(wrapped?width:last);i++){
      let k=(i+1)%width,p=rows[j-1][i],q=rows[j-1][k],r=rows[j][k],t=rows[j][i];
      if(omit && omit(j,i,p,q,r,t))continue;
      const np=normals[j-1][i],nq=normals[j-1][k],nr=normals[j][k],nt=normals[j][i],c=chooseColor?chooseColor(j,i):col;
      if(dot(cross(sub(q,p),sub(r,p)),np)>0){
        G.tri(p,q,r,c,mat,body,np,nq,nr);G.tri(p,r,t,c,mat,body,np,nr,nt);
      }else{G.tri(p,r,q,c,mat,body,np,nr,nq);G.tri(p,t,r,c,mat,body,np,nt,nr);}
    }
  }
  function seq(a,b,n){return Array.from({length:n+1},(_,i)=>a+(b-a)*i/n);}
  const box=(c,s,k=trim,m=2,g=body)=>G.box(c,s,k,m,g);
  const bar=(a,b,w,h,c,m=2,g=body)=>G.beam(a,b,w,h,c,m,g);
  const tube=(a,b,r,c,m=2,g=body,seg=10,r2=r)=>G.cyl(a,b,r,r2,seg,c,m,g);
  function line(ps,r,col,mat=2,g=body,segments=7) {for(let i=1;i<ps.length;i++)tube(ps[i-1],ps[i],r,col,mat,g,segments);}
  function sample(points,t) {
    if(t<=points[0][0])return points[0][1];
    for(let i=1;i<points.length;i++)if(t<=points[i][0]){
      let a=points[i-1],b=points[i];return a[1]+(b[1]-a[1])*(t-a[0])/(b[0]-a[0]);
    }return points.at(-1)[1];
  }
  // Smooth monotone Hermite interpolation keeps highlight lines continuous through pressed sheet metal.
  function profile(points) {
    const delta=[],slope=[];
    for(let j=1;j<points.length;j++)delta.push((points[j][1]-points[j-1][1])/(points[j][0]-points[j-1][0]));
    slope.push(delta[0]);for(let j=1;j<points.length-1;j++){
      const a=delta[j-1],b=delta[j];slope.push(a*b<=0?0:2*a*b/(a+b));}slope.push(delta.at(-1));
    return t=>{if(t<=points[0][0])return points[0][1];
      for(let j=1;j<points.length;j++)if(t<=points[j][0]){const [x,y]=points[j-1],dx=points[j][0]-x,q=(t-x)/dx,h=1-q;
        return y*h*h*(1+2*q)+points[j][1]*q*q*(3-2*q)+dx*q*h*(slope[j-1]*h-slope[j]*q);}
      return points.at(-1)[1];};
  }
  function rounded(corners,r,steps=5) {
    const pts=[];for(let i=0;i<corners.length;i++) {
      const a=corners[(i+corners.length-1)%corners.length],b=corners[i],c=corners[(i+1)%corners.length],
        radius=Array.isArray(r)?r[i]:r,limit=Array.isArray(r)?.29:.22,ab=sub(a,b),bc=sub(c,b),p=add(b,scale(norm(ab),Math.min(radius,Math.hypot(...ab)*limit))),
        q=add(b,scale(norm(bc),Math.min(radius,Math.hypot(...bc)*limit)));
      for(let k=0;k<=steps;k++){let t=k/steps;pts.push(mix(mix(p,b,t),mix(b,q,t),t));}
    }return pts;
  }
  function panel(outer,fn,normal,rings,core) {
    const contours=rings.map(([p,r,e])=>rounded(p,r).map(q=>fn(...q,e)));
    for(let k=1;k<contours.length;k++) {
      const a=contours[k-1],b=contours[k],data=rings[k-1];
      if(data[4]===1){
        const ua=rounded(data[0],data[1]),next=rings[k],ub=rounded(next[0],next[1]);
        const vert=(q,e)=>{const [x,y]=q,du=sub(fn(x+.0003,y,e),fn(x-.0003,y,e)),dv=sub(fn(x,y+.0003,e),fn(x,y-.0003,e));let n=norm(cross(du,dv));return [fn(x,y,e),dot(n,normal)<0?scale(n,-1):n];};
        const emit=(p,q,r)=>{if(dot(cross(sub(q[0],p[0]),sub(r[0],p[0])),normal)<0)[q,r]=[r,q];G.tri(p[0],q[0],r[0],data[3],1,body,p[1],q[1],r[1]);};
        for(let i=0;i<ua.length;i++){let j=(i+1)%ua.length,len=Math.hypot(...sub(a[i],a[j])),steps=Math.max(1,Math.ceil(len/.050));
          let p=vert(ua[i],data[2]),q=vert(ub[i],next[2]);
          for(let h=1;h<=steps;h++){let t=h/steps,r=vert(mix(ua[i],ua[j],t),data[2]),s=vert(mix(ub[i],ub[j],t),next[2]);
            emit(p,r,s);emit(p,s,q);p=r;q=s;}}
      }else for(let i=0;i<a.length;i++){let j=(i+1)%a.length;face(a[i],a[j],b[j],b[i],normal,data[3],data[4]);}
    }
    if(!core)return;
    const inn=contours.at(-1);
    if(core[1]===3){
      const [poly,r,e]=rings.at(-1),uv=rounded(poly,r),mid=poly.reduce((a,p)=>add(a,scale(p,1/poly.length)),[0,0]);
      const vertex=q=>{const a=q[0],b=q[1],n=norm(cross(sub(fn(a+.0004,b,e),fn(a-.0004,b,e)),sub(fn(a,b+.0004,e),fn(a,b-.0004,e))));
        return [fn(a,b,e),dot(n,normal)<0?scale(n,-1):n,q];};
      const emit=(a,b,c)=>{if(dot(cross(sub(b[0],a[0]),sub(c[0],a[0])),normal)<0)[b,c]=[c,b];
        G.tri(a[0],b[0],c[0],core[0],3,body,a[1],b[1],c[1],a[2],b[2],c[2]);};
      let prev=uv.map(()=>vertex(mid));
      for(let t of [.2,.4,.6,.8,1]){let ring=uv.map(v=>vertex(mix(mid,v,t)));for(let i=0;i<uv.length;i++){
        let j=(i+1)%uv.length;emit(prev[i],ring[i],ring[j]);if(t>.2)emit(prev[i],ring[j],prev[j]);}prev=ring;}
    }else{
      const cen=inn.reduce((tot,p)=>add(tot,scale(p,1/inn.length)),[0,0,0]);
      for(let i=0;i<inn.length;i++)tri(cen,inn[i],inn[(i+1)%inn.length],normal,core[0],core[1]);
    }
  }
  function rect(x0,y0,x1,y1){return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];}
  // Inner visor must blend before the surrounding panes of the car.
  buildDriverHelmet();
  const zf=-1.757,zr=1.763;
  const edgeY=profile([[zf,.725],[-1.65,.753],[-1.42,.790],[-.90,.864],[-.676,.901],[-.18,.911],[1.18,.911],[1.42,.909],[1.61,.900],[1.745,.879],[zr,.876]]);
  const frontOutline=profile([[zf,.694],[-1.73,.716],[-1.66,.731],[-1.55,.757],[-1.31,.767],[-1.04,.770]]);
  const rearOutline=profile([[1.29,.770],[1.48,.767],[1.62,.749],[zr,.716]]);
  const wplan=z=>z<-.78?frontOutline(z):z>.98?rearOutline(z):.770;
  // The door is a long, slightly convex pressing. The narrow bead is stamped into
  // its skin, and the upper shoulder rolls into the sill of the glass.
  const section=profile([[.18,-.061],[.239,-.043],[.250,-.0386],[.275,-.034],[.331,-.0225],
    [.418,-.012],[.515,-.0023],[.558,.0008],[.627,.0058],[.701,.0082],[.742,.0075],
    [.773,.0060],[.805,.0024],[.838,-.0041],[.870,-.0131],[.907,-.0258],[.945,-.0378],[1.,-.053]]);
  const jamb=.524,upperJamb=.515;
  function latchPocket(z,y){
    const v=(y-.784)/.057;
    if(Math.abs(v)>=1)return 0;
    const w=.031*(1-v*v)**.76,u=(z-jamb-.001)/w;
    if(u<=-.20||u>=1)return 0;
    const a=sat((u+.20)/.32),b=sat((1-u)/.37),h=sat((1-Math.abs(v))/.26);
    return a*a*(3-2*a)*b*b*(3-2*b)*h*h*(3-2*h);
  }
  // Relative height between the two folds and lateral displacement in metres.
  const pressingSection=profile([[-1.50,0],[-.90,-.0030],[-.40,-.0011],[-.11,.0008],[-.032,.0024],
    [0,.0029],[.055,-.0019],[.15,-.0063],[.31,-.0067],[.76,.0027],[.945,.0058],
    [1.01,.0068],[1.09,.0065],[1.33,.0028],[1.69,0]]);
  function eased(t){t=sat(t);return t*t*(3.-2.*t);}
  function lowerFold(z){
    const d=Math.abs(z-(z<0?-1.143:1.218)),radius=z<0?.378:.392;
    const rim=.253+Math.sqrt(Math.max(0.,radius*radius-d*d));
    const baseline=.559+.022*z,delta=Math.max(.023-Math.abs(baseline-rim),0.);
    return Math.max(baseline,rim)+delta*delta/.092;
  }
  function upperFold(z,low){return Math.max(.685+.023*z,low+.080);}
  function pressing(z,y){
    if(y<=.378||y>=.843)return 0;
    const d=Math.abs(z-(z<0?-1.143:1.218));
    const low=lowerFold(z),high=upperFold(z,low);
    const v=(y-low)/(high-low),cap=.078-.028*eased(v);
    const wing=.035+.965*eased((d-cap)/.212);
    const panel=eased((z+.80)/.32)*eased((.64-z)/.27);
    const end=eased((z+1.715)/.155)*eased((1.721-z)/.15);
    const relief=(.78+.22*eased((z+.70)/1.20))*(1.-.11*panel)*(.38+.62*end)*wing;
    // The door and both wings turn in a little before the folded panel edges.
    const front=eased((z+.934)/.23)*eased((-.646-z)/.17);
    const rear=eased((z-.519)/.26)*eased((1.074-z)/.24);
    const door=eased((z+.645)/.36)*eased((.524-z)/.32);
    const crown=(.0052*door+.0028*front+.0042*rear)*eased((y-.386)/.15)*eased((.842-y)/.12);
    return crown+.91*relief*pressingSection(v)*eased((y-.378)/.036)*eased((.843-y)/.028);
  }
  const sideX=(y,z)=>{
    const axle=z<0?-1.143:1.218,dist=Math.hypot((z-axle)*1.025,y-.253);
    // The broad EP side pressing is nearly straight in plan. Its rolled wheel
    // flange turns within a few centimetres of the opening.
    const rise=sat((dist-.337)/.061);
    const flange=.00085*(1.-rise*rise*(3.-2.*rise));
    const between=sat((z+.863)/.082)*sat((.936-z)/.094);
    // The sill has a shallow rolled shoulder above an upright face; the return lies below it.
    const shoulder=-.0023*Math.exp(-(((y-.354)/.0070)**2))+.0034*Math.exp(-(((y-.327)/.020)**2));
    const skin=.0015*(1-sat(((z+.02)/1.77)**2))+shoulder*between;
    return wplan(z)+section(y)+flange+pressing(z,y)+skin-.0009*Math.exp(-(((y-.269)/.0055)**2))-.026*latchPocket(z,y);
  };
  const side=(s,z,y,off=0)=>[s*(sideX(y,z)+off),y,z];
  function archBase(z) {
    // Between each wheel opening and the end of the car, the wing meets
    // the upper rim of the bumper. There is no painted skin behind its return.
    let floor=z>1.218?.529:z< -1.143?.498:.296;
    for(let axle of [-1.143,1.218]) {
      const d=(z-axle)/.335;
      if(Math.abs(d)<1.03)floor=Math.max(floor,.253+.345*Math.sqrt(Math.max(0,1-d*d)));
    }return floor;
  }
  const zset=new Set(seq(zf,zr,75));
  for(let wheel of [-1.143,1.218])for(let a of seq(0,pi,36))zset.add(wheel+.335*cos(a));
  for(const z of [zf+.005,zr-.005,-1.684,-.638,1.61,1.704])zset.add(z);
  const recessStart=jamb-.016,recessEnd=jamb+.040;
  zset.add(recessStart);zset.add(recessEnd);
  const zs=[...zset].sort((a,b)=>a-b);
  for(let s of [-1,1]) {
    // Keep the mesh rows attached to both folds as they meet the fenders.
    const ys=[.238,.249,.272,.294,.296,.301,.313,.321,.323,.327,.335,.343,.346,.350,.351,.354,.358,.362,.364,.367,.371,
      .393,.418,.440,.469,.489,.493,.500,.510,.523,.537,.545,.548,.551,.554,.557,.559,.561,.563,.566,.570,.574,.579,.586,
      .597,.615,.636,.650,.661,.670,.677,.683,.685,.690,.695,.701,.705,.717,.724,.740,.765,.780,.798,.820,.845,.850,.870,.896,.920,.940];
    const sideVertex=(z,yy)=>{
      const low=lowerFold(z),high=upperFold(z,low);
      const top=.798-.074*eased((z-.375)/.095)*eased((.712-z)/.109);
      let row=yy;
      if(yy>.44&&yy<top){
        if(yy<.559)row=.440+(low-.440)*(yy-.440)/.119;
        else if(yy<.685)row=low+(high-low)*(yy-.559)/.126;
        else row=high+(top-high)*(yy-.685)/(top-.685);
        row=yy+(row-yy)*eased((z+1.684)/.115)*eased((1.704-z)/.118);
      }
      const y=clamp(row,archBase(z),edgeY(z));
      const dxdy=(sideX(y+.0025,z)-sideX(y-.0025,z))/.005,dxdz=(sideX(y,z+.005)-sideX(y,z-.005))/.010;
      return [side(s,z,y),norm([s,-dxdy,-dxdz]),[z+32,y]];};
    const verts=z=>ys.map(y=>sideVertex(z,y));
    let prev=verts(zs[0]);
    function sheet(a,b,c){if(Math.abs(a[0][1]-b[0][1])+Math.abs(b[0][1]-c[0][1])<.00001)return;
      if(dot(cross(sub(b[0],a[0]),sub(c[0],a[0])),[s,0,0])<0)[b,c]=[c,b];
      G.tri(a[0],b[0],c[0],paint,1,body,a[1],b[1],c[1],a[2],b[2],c[2]);}
    for(let k=1;k<zs.length;k++){const next=verts(zs[k]);for(let j=1;j<ys.length;j++){
      if(zs[k-1]>=recessStart && zs[k]<=recessEnd && ys[j-1]>=.724 && ys[j]<=.845)continue;
      if(zs[k]<=-1.684 && ys[j-1]>=.493 && ys[j]<=.705)continue;
      if(zs[k-1]>=1.704 && ys[j-1]>=.548 && ys[j]<=.798)continue;
      sheet(prev[j-1],next[j-1],next[j]);sheet(prev[j-1],next[j],prev[j]);}prev=next;}
    // Resolve the stamped handle pocket locally, sharing the edge samples
    // and normals of the surrounding door panel.
    const pocketZ=[...new Set([...zs.filter(z=>z>=recessStart&&z<=recessEnd),...seq(recessStart,recessEnd,18)])].sort((a,b)=>a-b);
    const pocketY=[...new Set([...ys.filter(y=>y>=.724&&y<=.845),...seq(.724,.845,24)])].sort((a,b)=>a-b);
    let strip=pocketY.map(y=>sideVertex(pocketZ[0],y));
    for(let i=1;i<pocketZ.length;i++){
      const next=pocketY.map(y=>sideVertex(pocketZ[i],y));
      for(let j=1;j<next.length;j++){
        sheet(strip[j-1],next[j-1],next[j]);sheet(strip[j-1],next[j],strip[j]);
      }
      strip=next;
    }
    for(let ax of [-1.143,1.218]){
      const arc=seq(0,pi,54);
      const lip=(a,e)=>{const z=ax+(.335+e)*cos(a),y=.253+(.345+e)*sin(a);
        return side(s,z,y,.00115*Math.exp(-(((e-.0033)/.0076)**2))-.0013*Math.exp(-e*430));};
      // Roll the end of the fender into the bumper joint at its mounting
      // height. The rolled edge shares the finish coordinates of the outer panel.
      const hemHeight=ax>0?.530:.499;
      function visibleLip(t,e){
        const cutoff=Math.asin((hemHeight-.253)/(.345+e));
        const sillAngle=Math.asin((.296-.253)/(.345+e));
        const a=ax>0?cutoff+t*(pi-sillAngle-cutoff):sillAngle+t*(pi-cutoff-sillAngle);
        return lip(a,e);
      }
      surface(visibleLip,seq(0,1,52),[0,.0007,.0017,.003,.0045,.006,.009,.012,.017,.023],
        [s,.08,0],paint,1,body,p=>[p[2]+32,p[1]]);
      const innerAngle=Math.asin((.296-.253)/.345),wellArc=seq(ax>0?0:innerAngle,ax>0?pi-innerAngle:pi,54);
      surface((a,w)=>{const p=lip(a,0);p[0]-=s*w;return p;},wellArc,[0,.012,.10,.18],[0,-1,0],dark,2);
      const pocket=[s*.555,.250,ax];
      for(let i=1;i<arc.length;i++){const a=arc[i-1],b=arc[i];
        const end=t=>[s*.555,.253+.344*sin(t),ax+.335*cos(t)];
        tri(pocket,end(a),end(b),[s,0,0],[.087,.092,.093],2);}
      const axleX=s*.624;
      bar([axleX,.225,ax+.108],[s*.411,.297,ax-.212],.045,.036,darkMetal,4);
      tube([s*.545,.29,ax],[s*.469,.425,ax+.093],.017,[.186,.202,.203],4);
      if(ax>0){
        const guard=(u,v)=>{
          const round=.013*(u*u)**3;
          return [s*(.644+.052*u),.254+round+(.125-round)*v,
            ax+.308-.017*u*u-.030*v*v+.009*(1-v)];
        };
        surface(guard,seq(-1,1,12),[0,.12,.34,.70,1],[s*.25,-.1,1],[.104,.111,.114],7);
      }
    }
    const sillStart=-1.143+.335*Math.sqrt(1.-((.296-.253)/.345)**2);
    const sillEnd=1.218-.335*Math.sqrt(1.-((.296-.253)/.345)**2);
    surface((z,t)=>{
      const p=side(s,z,.296),under=Math.max(0.,(t-.23)/.77);
      p[0]-=s*(.012*t+.086*under);p[1]-=.010*(1.-(1.-t)**3)+.024*under;
      return p;
    },seq(sillStart,sillEnd,32),[0,.09,.23,.42,1],[s*.38,-.92,0],paint,1,body,p=>[p[2]+32,p[1]]);
  }
  box([0,.252,.035],[1.29,.096,3.13],dark,2);
  for(const ax of [-1.143,1.218])tube([-.67,.269,ax],[.67,.269,ax],.035,darkMetal,4);
  // The shallow transverse silencer and the curled outlet are visible under the rear valance.
  const mufflerAng=seq(0,2*pi,32).slice(0,-1);
  const silencer=(x,a,r)=>[-.405+(x+.412)*.82,.231+.060*r*Math.sign(cos(a))*Math.abs(cos(a))**.90,
      1.519+.105*r*Math.sign(sin(a))*Math.abs(sin(a))**.92];
  const mufflerRows=[[-.412,.86],[-.409,.98],[-.403,1.014],[-.394,.986],[-.36,1],[.103,1],[.110,1.015],[.116,.98],[.119,.89]]
    .map(([x,r])=>mufflerAng.map(a=>silencer(x,a,r)));
  loft(mufflerRows,true,p=>[0,p[1]-.231,p[2]-1.519],[.311,.320,.300],42,
    (j,k)=>{const shade=.92+.055*sin(k*.3927)+.048*cos(j*2.67+k*.27);return [.311*shade,.32*shade,.30*shade];});
  for(const end of [0,mufflerRows.length-1]){const row=mufflerRows[end],center=[row[0][0],.231,1.519];
    for(let j=0;j<row.length;j++)tri(center,row[j],row[(j+1)%row.length],[end?1:-1,0,0],[.30,.308,.285],42);}
  line([[.14,.206,-1.1],[.16,.201,-.33],[.13,.193,.38],[-.32,.212,.92],[-.34,.238,1.445]],.025,[.314,.318,.300],4,body,12);
  line([[-.401,.226,1.534],[-.454,.221,1.545],[-.483,.219,1.593],[-.492,.232,1.692],[-.498,.244,1.783]],.024,[.356,.365,.348],4,body,24);
  const lipA=[-.498,.244,1.780],lipB=[-.498,.244,1.786];
  tube(lipA,lipB,.0246,[.462,.469,.447],4,body,26);tube(lipB,add(lipB,[0,0,.0006]),.0203,dark,2,body,26);
  // A stamped centre panel turns down over a hem; the shoulders of the front wings
  // stay proud of the two longitudinal depressions just inboard of them.
  const hood=(u,z)=>{
    const e=edgeY(z),t=Math.abs(u),x=u*sideX(e,z),len=sat((z-zf)/1.119);
    const shoulder=.030*Math.exp(-(((t-.815)/.115)**2))-.014*Math.exp(-(((t-.671)/.047)**2));
    const crest=.017*(1-t*t)+.012*Math.sqrt(Math.max(0,1-sat((t-.923)/.077)**2));
    const relief=shoulder*(.19+.81*Math.sin(pi*len)**.72)*(1-sat((t-.960)/.040));
    return [x,e+crest*(.46+.54*Math.sin(len*pi*.54))+relief,z];
  };
  const hoodUs=[...new Set([...seq(-1,1,58),...seq(-1,-.923,12),...seq(.923,1,12)])].sort((a,b)=>a-b);
  const hoodStart=zf+.014;
  // The thin dark reveal lies below the edge of the bonnet. A separate flange
  // carries the fender continuously over the wheel, ending at the corner light.
  const hoodZ=seq(hoodStart,-.638,42), seamU=.991;
  const outerUs=hoodUs.filter(u=>u>-seamU && u<seamU);
  const grille0=-.757,grille1=-.689,span=.337,hoodU=[-seamU,...outerUs,seamU];
  const cutZ=(a,b)=>[a,...hoodZ.filter(z=>a<z&&z<b),b];
  for(const zz of [cutZ(hoodStart,grille0),cutZ(grille1,-.638)]){
    surface(hood,hoodU,zz,[0,1,-.10],paint,1);
  }
  for(const [a,b] of [[-seamU,-span],[span,seamU]]){
    surface(hood,[a,...hoodU.filter(u=>a<u&&u<b),b],cutZ(grille0,grille1),[0,1,-.10],paint,1);
  }
  // Pressed intake slots share their outer edge with the scuttle. Each has a rolled
  // painted rim and a recessed throat above the dark air plenum.
  const slotCount=25,cellWidth=2*span/slotCount;
  for(let j=0;j<slotCount;j++){
    const u0=-span+j*cellWidth,u1=u0+cellWidth;
    const seat=(u,z,depth)=>{const p=hood(u,z);p[1]+=depth;return p;};
    const rim=rect(u0+.0041,grille0+.0075,u1-.0041,grille1-.009),
      mouth=rect(u0+.0054,grille0+.0087,u1-.0054,grille1-.0106),
      throat=rect(u0+.0070,grille0+.0120,u1-.0070,grille1-.0143);
    panel(null,seat,[0,1,-.10],[[rect(u0,grille0,u1,grille1),.00002,0,paint,1],
      [rim,.0037,.00015,[.135,.152,.159],2],[mouth,.0033,-.00090,[.098,.107,.108],8],[throat,.0028,-.003]],
      [[.061,.065,.066],8]);
  }
  for(const s of [-1,1]){
    const wing=(t,z)=>hood(s*(seamU+(1-seamU)*t),z);
    surface(wing,[.38,.50,.72,.89,1],hoodZ,[0,1,-.1],paint,1);
    surface((t,z)=>{const q=wing(t*.38,z);q[1]-=.001+.0025*Math.sin(pi*t);return q;},[0,.25,.5,.75,1],hoodZ,[0,1,0],dark,2);
  }
  line(seq(-.76,.76,54).map(u=>hood(u,-.786+.018*(u/.76)**6)),.0014,[.116,.144,.156],2);
  const noseHeight=profile([[.49,.493],[.505,.509],[.54,.5567],[.721,.7058],[.745,.728]]);
  const nose=(x,y,e=0)=>[x,noseHeight(y),zf-.035*(1-Math.pow(Math.abs(x)/.708,5))+.083*(.714-y)-e];
  const tailPress=profile([[.28,-.012],[.524,-.014],[.537,-.010],[.566,-.006],[.669,-.003],[.739,.0005],
    [.774,.002],[.788,.001],[.793,-.002],[.798,.0062],[.804,.0106],[.825,.012],[.852,.013],[.875,.009],[.894,.003]]);
  const tail=(x,y,e=0)=>{
    const xb=Math.abs(x)/.720,lower=sat((.802-y)/.082),edge=sat((Math.abs(x)-.449)/.049);
    // Draw depth varies from the folded sill through the plate field to the
    // upper return. The outboard lamp flanges sit on their original seats.
    // The field around the number plate is a shallow pressing. A 4 mm
    // crown across it preserves a continuous treeline reflection.
    const t=sat((y-.512)/.282),crown=.004*4*t*(1-t);
    const field=(1-Math.min(1,Math.abs(x)/.495)**5)**2;
    return [x,y,zr+.036*(1-xb**4)+tailPress(y)*(1-.49*xb**7)
      +crown*field*(1-.44*Math.min(1,(x/.49)**2))-.009*edge*edge*(3-2*edge)*lower+e];};
  const fxs=seq(-.699,.699,52);
  const lowerFront=seq(-.636,.636,48);
  surface((x,t)=>nose(x,.505+.037*t,-.002-.009*(1-t)**2),lowerFront,seq(0,1,8),[0,0,-1],paint,1);
  surface((x,t)=>nose(x,.493+.011*t,-.014-.009*(1-t)),lowerFront,[0,.5,1],[0,0,-1],trim,2);
  surface((x,y)=>nose(x,y,-.100),fxs,[.53,.735],[0,0,-1],dark,2);
  const brow=(u,t)=>{
    const p=hood(u,hoodStart),end=nose(p[0],.724,-.002);
    const edge=.7086+.0014*(1-u*u),a=t*pi*.5;
    return [p[0],edge+(p[1]-edge)*cos(a),p[2]+(end[2]-p[2])*sin(a)];
  };
  surface(brow,hoodUs,seq(0,1,15),[0,.65,-.7],paint,1);
  const hem=(u,t)=>{const edge=brow(u,1);return add(edge,[0,-.0028*t,.0088*t]);};
  surface(hem,hoodUs,[0,.35,1],[0,-1,-.25],[.363,.464,.510],1);
  const gap=(x,t)=>nose(x,.716+.011*t,-.004-.006*t);
  surface(gap,fxs,[0,.5,1],[0,0,-1],[.082,.103,.110],2);

  const rearSkin=(lo,hi,start,end)=>{
    surface((x,t)=>tail(x,start+(Math.min(end,.889-.012*(x/.72)**2)-start)*t),seq(lo,hi,Math.ceil((hi-lo)*39)),seq(0,1,Math.ceil((end-start)*111)),[0,0,1],paint,1);
  };
  rearSkin(-.494,.494,.506,.891);
  for(const sign of [-1,1]){
    const lo=sign<0?-.717:.494,hi=sign<0?-.494:.717;
    rearSkin(lo,hi,.506,.548);rearSkin(lo,hi,.798,.891);
  }

  function bumper(rear) {
    const h=rear?1:-1,ze=rear?1.821:1.824;
    const sectionPoints=rear?[[.284,-.031],[.292,-.014],[.307,.004],[.342,.024],[.362,.034],[.409,.056],
      [.420,.061],[.426,.058],[.431,.052],[.437,.061],[.444,.069],[.470,.073],[.506,.068],[.523,.058],[.531,.044],[.533,.013]]:
      [[.253,-.014],[.259,-.001],[.269,.014],[.293,.029],[.336,.049],[.367,.061],[.376,.061],[.381,.054],
        [.386,.061],[.395,.070],[.431,.074],[.468,.072],[.483,.064],[.495,.047],[.501,.014]];
    const depthAt=profile(sectionPoints),ys=[...new Set([...sectionPoints.map(p=>p[0]),...seq(sectionPoints[0][0],sectionPoints.at(-1)[0],55)])].sort((a,b)=>a-b);
    const ventLow=.449,ventHigh=.486,ventHalf=.302,round=.0095;
    const mouth=y=>{
      const f=clamp(Math.min(y-ventLow,ventHigh-y)/round,0,1);
      return ventHalf-round*(1.-Math.sqrt(1.-(1.-f)**2));
    };
    if(!rear){
      for(const y of [ventLow,ventLow+.0013,ventLow+.0042,ventLow+round,ventHigh-round,ventHigh-.0042,ventHigh-.0013,ventHigh])ys.push(y);
      ys.sort((a,b)=>a-b);
    }
    let curve=[];
    for(let y of ys){const off=depthAt(y);
      const low=1-sat((y-(rear?.287:.253))/.150),taper=low*low;
      const rad=(rear?.097:.090)+.041*taper,w=.696+off*.090-.080*taper,deep=ze-.069+off;
      const cornerY=x=>y+.027*taper*(Math.abs(x)/.785)**3;
      const row=[];
      const tailEnd=u=>{
        const tipY=cornerY(.77)+.002*taper;
        const wheelEdge=(rear?1.218:1.143)+.335*Math.sqrt(Math.max(0,1-((tipY-.253)/.345)**2));
        const z=(deep-rad)*(1-u)+(wheelEdge+.0015)*u;
        const blend=u*u*(3-2*u),edge=sideX(tipY,h*wheelEdge)+.009-.014*taper;
        const x=(w+rad)*(1-blend)+edge*blend;
        return [x,cornerY(x)+.002*taper*u,h*z];
      };
      for(const u of [1,.76,.43,.17]){const q=tailEnd(u);q[0]=-q[0];row.push(q);}
      for(let a of seq(pi/2,0,24)){const x=-(w+rad*sin(a));row.push([x,cornerY(x),h*(deep-rad+rad*cos(a))]);}
      const centre=seq(-w,w,40).slice(1,-1);
      if(!rear){const width=mouth(y);centre.push(-width,width);centre.sort((a,b)=>a-b);}
      for(let x of centre)row.push([x,cornerY(x),h*(deep+.012*(1-(x/w)**2))]);
      for(let a of seq(0,pi/2,24)){const x=w+rad*sin(a);row.push([x,cornerY(x),h*(deep-rad+rad*cos(a))]);}
      for(const u of [.17,.43,.76,1])row.push(tailEnd(u));curve.push(row);
    }
    const through=rear?null:(j,i,p,q,r,t)=>ys[j-1]>=ventLow && ys[j]<=ventHigh &&
      Math.abs((p[0]+q[0])*.5)<mouth(ys[j-1]) && Math.abs((r[0]+t[0])*.5)<mouth(ys[j]);
    loft(curve,false,p=>[p[0]*Math.abs(p[0])**9,-.035,h*.33],trim,46,null,through);
    // The moulding curls in to meet the wheelhouse on both sides. Close
    // the end face so views from behind a wheel see the thickness of the plastic.
    for(const index of [0,curve[0].length-1]){
      const fold=p=>[p[0]-Math.sign(p[0])*.047,p[1]+.0007,p[2]+h*.009];
      for(let j=1;j<curve.length;j++){
        const a=curve[j-1][index],b=curve[j][index];
        face(a,b,fold(b),fold(a),[0,0,-h],[.099,.109,.113],46);
      }
    }
    // Fold the upper and lower edges towards the inside normal of their
    // outline. Along the wheel opening the fold only travels inboard.
    function returnEdge(row,width,lift,up){
      const inner=row.map((p,i)=>{
        const a=row[Math.max(0,i-1)],b=row[Math.min(row.length-1,i+1)];
        const dx=b[0]-a[0],dz=b[2]-a[2],k=h*width/Math.max(.0001,Math.hypot(dx,dz));
        return [p[0]+k*dz,p[1]+lift,p[2]-k*dx];
      });
      for(let i=1;i<row.length;i++)face(row[i-1],row[i],inner[i],inner[i-1],[0,up,0],trim,46);
    }
    returnEdge(curve[0],.072,.014,-1);
    returnEdge(curve.at(-1),.044,.002,1);
    if(!rear){
      // Each slot has a raised upper lip, a recessed dark throat and a
      // sloped lower wall. The moulding curves around both outer corners.
      const fs=(x,y,e=0)=>{let off=depthAt(y),w=.696+off*.09;
        return [x,y,-(ze-.069+off+.012*(1-(x/w)**2)+e)];};
      // The upper rim occludes the inlet vanes and the deep return under a raised eye.
      const edgeRows=ys.filter(y=>y>=ventLow && y<=ventHigh);
      const shell=[];
      for(const y of edgeRows)shell.push([mouth(y),y]);
      const rimSpan=y=>curve[ys.indexOf(y)].map(p=>p[0]).filter(x=>Math.abs(x)<mouth(y)-1e-7);
      for(const x of rimSpan(ventHigh).reverse())shell.push([x,ventHigh]);
      for(let j=edgeRows.length-1;j>=0;j--){const y=edgeRows[j];shell.push([-mouth(y),y]);}
      for(const x of rimSpan(ventLow))shell.push([x,ventLow]);
      const ring=(relief,sx,sy)=>shell.map(([x,y])=>fs(x*sx,(ventLow+ventHigh)*.5+(y-(ventLow+ventHigh)*.5)*sy,relief));
      const lip=ring(0,1,1),rolled=ring(-.0043,.995,.895),back=ring(-.042,.949,.69);
      for(let j=0;j<shell.length;j++){const k=(j+1)%shell.length;
        face(lip[j],lip[k],rolled[k],rolled[j],[0,0,-1],[.167,.172,.172],46);
        face(rolled[j],rolled[k],back[k],back[j],[0,0,-1],[.105,.113,.115],46);
      }
      const centre=fs(0,(ventLow+ventHigh)*.5,-.049);
      for(let i=0;i<back.length;i++)tri(centre,back[i],back[(i+1)%back.length],[0,0,-1],[.058,.064,.063],2);
      for(let k=-3;k<=3;k++){
        const x=k*.0795;
        bar(fs(x-.0014,ventLow+.002,-.017),fs(x+.0014,ventHigh-.002,-.015),.007,.022,[.129,.138,.138],46);
      }
      for(const s of [-1,1]){
        const map=(x,y,e)=>fs(s*x,y,e);
        const outer=[[.311,.307],[.609,.312],[.657,.351],[.656,.375],[.312,.371]];
        const inner=[[.319,.314],[.604,.317],[.645,.353],[.645,.365],[.319,.362]];
        panel(null,map,[0,-.3,-1],[[outer,.012,.001,trim,46],[inner,.008,.0031]],[[.118,.127,.131],46]);
        for(const [y,length] of [[.318,.282],[.333,.297],[.348,.314]]){
          const opening=rect(.323,y-.0032,.323+length,y+.0064);
          const upper=rect(.325,y-.0023,.321+length,y+.0042);
          const deep=rect(.327,y-.0008,.319+length,y+.0024);
          panel(null,map,[0,-.2,-1],[[opening,.0038,.0043,[.179,.187,.186],46],
            [upper,.0031,.0075,[.061,.067,.070],2],[deep,.0024,.0042]],[[.045,.050,.051],2]);
        }
      }
      // Black stamped metal air guide behind the lower edge of the painted front panel.
      const apron=seq(-.60,.60,32).map(x=>{const center=1-(x/.603)**4;
        return [[x,.267,-1.71],[x,.241,-1.73],[x,.221-.026*center,-1.71+.012*(x/.60)**2],
          [x,.210-.026*center,-1.655+.026*(x/.60)**2]];});
      loft(apron,false,p=>[0,-.34,-.66],[.141,.151,.152],2);
    }
  }
  bumper(false);bumper(true);
  // Frame, rubber glazing channels and continuous crown of the roof.
  const cabinX=(z,y)=>sideX(edgeY(z),z)-.121*sat((y-.91)/.495)-.005*((z-.36)/1.4)**2;
  const cabin=(s,z,y,e=0)=>{const b=sample([[-.676,.901],[jamb,.906],[1.745,.879]],z);
    const gap=edgeY(z)-b;return [s*(cabinX(z,y)+e),y+gap*sat((1.39-y)/(1.39-b)),z];};
  const panelSide=(s,zz,yy,k=0)=>cabin(s,zz,yy,k);
  const frontSide=[[-.676,.901],[jamb,.906],[upperJamb,1.412],[-.191,1.405]];
  const rearSide=[[jamb,.906],[1.745,.879],[1.345,1.381],[upperJamb,1.412]];
  for(let s of [-1,1]){
    const cf=(z,y,e)=>panelSide(s,z,y,e),N=[s,.18,0];
    const panes=[
      [frontSide,[[-.600,.930],[jamb-.041,.942],[upperJamb-.055,1.366],[-.174,1.359]],.018],
      [rearSide,[[jamb+.045,.944],[1.573,.938],[1.281,1.347],[upperJamb+.024,1.366]],[.054,.127,.073,.048]]];
    for(let [outer,win,rad] of panes){
      const cen=win.reduce((p,v)=>add(p,scale(v,.25)),[0,0]), shrink=d=>win.map(p=>add(cen,scale(sub(p,cen),1-d)));
      panel(outer,cf,N,[[outer,.001,0,paint,1],[win,rad,.000,seal,2],[shrink(.019),rad,.003,[.125,.134,.134],2],[shrink(.038),rad,-.003]], [glass,3]);
      // Cloth-covered pillar and inner pinch seal give the far side of the cabin its own interior finish.
      const inward=[-s,-.18,0];
      panel(outer,cf,inward,[[outer,.001,-.021,[.270,.280,.269],8],[win,rad,-.024,[.172,.178,.174],2],
        [shrink(.034),rad,-.018,trim,2],[shrink(.047),rad,-.006]],null);
    }
    // Door shut lines, reveals, latch, quarter window fasteners and drip rail.
    const door=[[-.669,.895],[-.67,.78],[-.684,.54],[-.672,.415],[-.657,.381],[-.614,.367],[jamb-.034,.367],[jamb-.010,.376],[jamb-.003,.423],[jamb,.90]];
    const shut=[];for(let i=1;i<door.length;i++){const a=door[i-1],b=door[i],d=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.018);
      for(let k=0;k<d;k++){let t=k/d;shut.push(side(s,a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),.004));}}
    shut.push(side(s,jamb,.90,.004));line(shut,.0025,[.092,.123,.132],2,body,5);
    line([cabin(s,jamb,.906,.004),cabin(s,upperJamb,1.411,.004)],.003,[.104,.143,.159],2);
    const rz=seq(-.191,1.345,44);
    const crown=(z,t)=>{const seam=sample([[-.191,1.405],[upperJamb,1.412],[1.345,1.381]],z);
      return cabin(s,z,seam+(roofY(z)-seam)*t,.002+.0018*Math.sin(Math.PI*t));};
    surface(crown,rz,[0,.5,1],[s,.24,0],paint,1);
    line(seq(-.17,1.35,30).map(z=>cabin(s,z,roofY(z)-.003,.006)),.0068,paint,1);
    // The EP handle occupies a notch in the door edge. Its push paddle
    // sits inside the black recess, below a separate lock cylinder.
    const latch=(u,v,e=0)=>side(s,jamb+u,.784+v,e);
    const socket=(u,v)=>{
      const a=v*.045,w=.023*(1-v*v)**.83;
      return latch(.0005+u*w,a,.0007);
    };
    surface(socket,seq(0,1,8),seq(-.97,.97,22),[s,0,0],[.077,.087,.090],2);
    const paddle=(u,v)=>{
      const w=.0155*(1-.095*v*v);
      return latch(.0044+u*w,v*.017,.007+.002*Math.cos(pi*.50*v)*Math.sin(pi*u));
    };
    surface(paddle,[0,.13,.48,.84,1],[-1,-.78,.60,.85,1],[s,.06,.18],[.223,.235,.235],2);
    const keyCenter=side(s,jamb-.029,.850,.003);
    const lockPt=h=>add(keyCenter,[s*h,0,0]);
    tube(lockPt(0),lockPt(.0006),.0119,seal,2,body,20,.0124);
    tube(lockPt(.0006),lockPt(.0030),.0121,silver,4,body,24,.0095);
    tube(lockPt(.0031),lockPt(.0038),.0088,[.415,.439,.434],4,body,24);
    bar(add(lockPt(.0039),[0,-.004,-.0009]),add(lockPt(.0041),[0,.005,.0002]),.0021,.0020,dark,2);
    for(let t of [.20,.78]) {const q=cabin(s,jamb+.059+(upperJamb-jamb-.028)*t,.97+.345*t,.001);
      tube(q,add(q,[s*.009,0,0]),.0087,darkMetal,4,body,10);}
    const cap=side(s,1.090,.778,.003);
    if(s<0){tube(cap,add(cap,[s*.003,0,0]),.052,seal,2,body,30);
      tube(add(cap,[s*.004,0,0]),add(cap,[s*.009,0,0]),.046,trim,2,body,30);
      tube(add(cap,[s*.009,0,0]),add(cap,[s*.012,0,0]),.014,silver,4,body,12);}
  }
  function roofY(z){return sample([[-.191,1.405],[-.11,1.420],[.23,1.431],[.65,1.433],[.99,1.428],[1.24,1.409],[1.345,1.381]],z);}
  const roof=(u,z)=>{const y=roofY(z);return [u*cabinX(z,y),y+.023*(1-u*u),z];};
  surface(roof,seq(-1,1,18),seq(-.191,1.345,30),[0,1,0],paint,1);
  // The rear glass sits proud of its rubber gasket. Front glass has a slight cylindrical sweep.
  function screen(rear,u,t,offset=0) {
    const za=rear?1.745:-.676,zb=rear?1.345:-.191,ya=rear?.879:.901,yb=rear?1.381:1.405;
    const z=za+(zb-za)*t,y=ya+(yb-ya)*t,x=u*cabinX(z,y),mid=1-u*u;
    const bow=rear?mid*(.017*(1-t)+.040*sin(pi*t)):.026*mid*sin(pi*t);
    return [x,y+mid*(rear?.009:.029)*(1-t)+mid*.023*t,z+(rear?1:-1)*(offset+bow)];
  }
  for(let rear of [false,true]){
    let sf=(u,t,e)=>screen(rear,u,t,e),n=[0,.73,rear?1:-1],out=rect(-1,0,1,1),rim=rect(-.967,.041,.967,.957),
      gasket=rect(-.955,.062,.955,.944),edge=rect(-.942,.074,.942,.933);
    if(rear){
      const hem=rect(-.982,.018,.982,.980),lip=rect(-.956,.058,.956,.947),
        groove=rect(-.945,.071,.945,.935),bead=rect(-.935,.079,.935,.926),inside=rect(-.921,.094,.921,.910);
      panel(out,sf,n,[[out,.0001,-.002,paint,1],[hem,.100,.006,paint,1],[lip,.122,.0085,seal,2],
        [groove,.115,.0150,[.151,.157,.159],2],[bead,.108,.0165,trim,2],[inside,.097,.0100]],[glass,3]);
      // The liftgate has a shut line of its own, inboard of the welded C-pillars.
      for(const s of [-1,1]){
        const meridian=seq(.028,.990,36).map(t=>sf(s*(.993-.010*Math.sin(pi*t)),t,.001));
        line(meridian,.0025,[.122,.155,.172],2,body,8);
      }
      line(seq(-.966,.966,36).map(u=>sf(u,.993,.0016)),.0025,[.120,.146,.160],2,body,8);
    }else panel(out,sf,n,[[out,.0001,0,paint,1],[rim,.065,.003,seal,2],[gasket,.053,.006,[.120,.135,.139],2],[edge,.045,.004]],[[.988,.134,.980],3]);
  }
  // Bridge the hatch pressing above its vertical rear panel, and the scuttle under the windscreen.
  surface((u,v)=>{
    const a=tail(u*.717,.889-.012*u*u),b=screen(true,u,0),p=mix(a,b,v);
    p[1]+=.0042*Math.sin(pi*v)*(1-.45*u*u);
    return p;
  },seq(-1,1,42),seq(0,1,10),[0,1,1],paint,1);
  surface((u,v)=>mix(hood(u,-.638),screen(false,u,0),v),seq(-1,1,34),[0,1],[0,1,-.2],paint,1);
  // The grille is an actual pair of perforated openings. Sloping chrome bars identify the period nose.
  function inset(faceFn,c,n,outer,corner,border,outerColor,innerColor,innerMat,depth=0) {
    const [x0,y0,x1,y1]=c, r0=rect(x0,y0,x1,y1),r1=rect(x0+border,y0+border,x1-border,y1-border);
    panel(r0,faceFn,n,[[r0,corner,depth,outerColor,outer],[r1,Math.max(.001,corner-border),depth+.002]],[innerColor,innerMat]);
  }
  const Nf=[0,0,-1],Nr=[0,0,1];
  for(const [bottom,split,lo,hi] of [[.543,.609,.555,.606],[.609,.722,.617,.669]]){
    const outer=rect(-.369,bottom,.369,split),lip=rect(-.354,lo-.0035,.354,hi+.0035),
      reveal=rect(-.351,lo,.351,hi),inner=rect(-.343,lo+.005,.343,hi-.002);
    panel(outer,nose,Nf,[[outer,.0035,.003,paint,1],[lip,.007,.005,paint,1],
      [reveal,.0058,.0025,[.152,.164,.162],2],[inner,.004,-.019]],null);
    surface((x,y)=>nose(x,y,-.088),seq(-.349,.349,26),[lo,hi],Nf,[.121,.133,.132],126,body,true);
    // Extruded cooling tubes catch a thin line of sky through the
    // near lattice. Their upper facets slope back into the radiator.
    for(let j=0;j<2;j++){
      const y=lo+.008+j*.022,steps=seq(-.346,.346,20);
      const section=[[0,-.060],[.0027,-.050],[.0058,-.050],[.0110,-.072]];
      for(let k=1;k<section.length;k++){
        const [dy0,d0]=section[k-1],[dy1,d1]=section[k];
        surface((x,t)=>nose(x,y+dy0+(dy1-dy0)*t,d0+(d1-d0)*t),
          steps,[0,1],k===3?[0,1,-.3]:Nf,k===3?[.232,.256,.245]:[.117,.130,.130],124);
      }
    }
    for(const x of seq(-.334,.334,39)){
      // A trapezoidal injection-moulded rib has a broad root and a rounded,
      // polished leading edge. Open squares disclose the deeper cooling tubes.
      const sides=[[-.0024,-.0210],[-.0019,-.017],[-.0012,-.0154],[.0012,-.0154],[.0019,-.017],[.0024,-.0210]];
      for(let j=1;j<sides.length;j++){
        const [a,e]=sides[j-1],[b,f]=sides[j];
        surface((u,h)=>nose(x+a+(b-a)*u-.0008*h,lo+(hi-lo)*h,e+(f-e)*u),[0,1],[0,1],
          [Math.sign(a+b),0,-.6],j===3?[.184,.206,.197]:[.095,.112,.106],124);
      }
    }
    const railY=(lo+hi)*.50-.002;
    surface((x,t)=>nose(x,railY+.0020*t,-.025-.0050*t),seq(-.347,.347,25),[0,.57,1],
      [0,.55,-1],[.222,.241,.238],124);
    for(const x of [-.315,.315]){
      const mid=(lo+hi)*.5,c=nose(x,mid,-.004);
      box(c,[.017,.012,.003],[.088,.098,.095],2);
      tube(nose(x,mid,-.004),nose(x,mid,-.0023),.0032,[.133,.142,.138],2,body,12);
    }
  }
  for(let i=0;i<5;i++){
    const x=(i-2)*.0225+.023;
    const stripe=(u,v,d)=>nose(x+u-.043*v,.552+.118*v,d);
    bar(stripe(0,0,.0085),stripe(0,1,.0085),.0087,.0070,[.114,.125,.128],2);
    const section=[[-.0039,.014],[-.0031,.0173],[-.0016,.0189],[.0027,.0186],[.0039,.016], [.0041,.014]];
    for(let k=1;k<section.length;k++){
      const a=section[k-1],b=section[k];
      surface((u,v)=>stripe(a[0]+(b[0]-a[0])*u,v,a[1]+(b[1]-a[1])*u),
        [0,1],[.012,.50,.988],Nf,[.728,.746,.745],125);
    }
  }
  // The registration plate fits into a separate moulded carrier. The
  // chamfer and two mounting lugs cast a shadow over the bumper.
  const bracket=(x,y,e=0)=>[x,y,-(1.846+e+.0038*(1-(x/.28)**2))];
  const boss=rect(-.262,.313,.262,.458),bevel=rect(-.251,.320,.251,.454),
    pocket=rect(-.229,.317,.229,.450),mount=rect(-.225,.321,.225,.447);
  panel(null,bracket,Nf,[[boss,.015,-.016,[.120,.128,.134],46],
    [bevel,.011,.006,[.168,.176,.177],46],
    [pocket,.009,.012,[.077,.084,.089],46],[mount,.008,.002]],[[.094,.101,.105],46]);
  for(const sign of [-1,1]){
    const x=sign*.237;
    const p=bracket(x,.433,.009);
    tube(p,add(p,[0,0,-.0035]),.0042,[.285,.301,.302],4,body,12);
  }
  for(let s of [-1,1]){
    // A continuous opening follows the sweep of the corner. The fluted face stands
    // forward of a deep stamped housing which receives a separate rectangular reflector.
    const head=(x,y,e=0)=>{
      const u=(x-.5030)/.131,v=(y-.632)/.085;
      const lateral=x+.0059*v-.0047*v*u;
      const q=nose(s*lateral,y,e-.010);
      q[2]+=.0075*u*u+.009*(x-.501)+.002*v*v;
      return q;
    };
    // The painted end of each grille opening turns into the displaced
    // headlight seat. The two contours follow the same trapezoidal seam.
    surface((u,y)=>{
      const inner=nose(s*.362,y,.004),outer=head(.368,y,.0014);
      const p=mix(inner,outer,u);p[2]-=.0017*Math.sin(pi*u);return p;
    },[0,.33,.62,.86,1],seq(.546,.721,25),Nf,paint,1);
    const clear=[1,.99,.96],amber=[1,.84,.52];
    const outer=rect(.366,.540,.636,.721),seat=rect(.369,.543,.635,.718),bezel=rect(.374,.547,.631,.715),
      recess=rect(.380,.554,.625,.707),opening=rect(.385,.560,.622,.702);
    panel(null,head,Nf,[
      [outer,.009,-.002,seal,2],[seat,.009,.001,[.23,.245,.237],2],
      [bezel,.009,.0019,[.507,.531,.506],56],[recess,.010,.0045,[.814,.833,.794],56],
      [opening,.013,-.004,[.569,.594,.572],55],
      [opening,.013,-.020,[.204,.218,.205],4],
      [opening,.015,-.069]
    ],[[.073,.083,.080],2]);
    const bowl=(a,r,offset=0)=>{
      const c=cos(a),d=sin(a),u=r*Math.sign(c)*Math.abs(c)**.49,v=r*Math.sign(d)*Math.abs(d)**.49;
      const x=.5025+.1192*u,y=.630+.0736*v;
      const flanks=.00175*sin(7.8*u+.7*v)*(.39+.61*Math.abs(u)**1.3);
      const spread=.00245*sin(v*8.7+.96*u)*Math.abs(v)**1.15+.0018*Math.cos(3.5*v-2.7*u);
      const D=-.065+.039*u*u+.032*v*v+.0046*u*v+flanks+spread;
      return head(x,y,D+offset);
    };
    surface(bowl,seq(0,2*pi,80),seq(.008,1,22),Nf,[.832,.849,.846],55);
    const shellRim=seq(0,2*pi,72).map(a=>bowl(a,.975,.0007));
    line(shellRim,.0015,[.56,.575,.551],56,body,7);
    // Retaining ferrule, molybdenum lead, quartz envelope and aluminised half-shield of the H4 lamp.
    const hub=head(.505,.633,-.060);
    tube(hub,head(.505,.633,-.050),.0081,[.463,.480,.443],56,body,24,.0068);
    tube(head(.505,.633,-.051),head(.505,.633,-.034),.0049,[.646,.633,.572],56,body,20,.0043);
    const filamentU=seq(0,2*pi,22),holderR=seq(0,1,12);
    surface((a,t)=>{
      const radius=.0067*Math.sqrt(Math.max(.00001,1.-t*t));
      return head(.505+radius*cos(a),.633+radius*1.17*sin(a),-.036+.0104*t);
    },filamentU,holderR,Nf,[.587,.600,.567],55);
    bar(head(.508,.591,-.048),head(.505,.628,-.043),.0015,.0019,[.454,.467,.429],55);
    // A polished outer face and its 4 mm edge. Beam-spreading prisms are moulded on the inside.
    const pane=(x,y,along=0)=>{
      const u=(x-.5025)/.129,v=(y-.630)/.083;
      return head(x,y,.0098+.0094*(1-u*u)*(.78-.19*v*v)+along);
    };
    const coverRect=rect(.372,.546,.633,.717),coverUV=rounded(coverRect,.009,8);
    const rimRing=coverUV.map(([x,y])=>pane(x,y,-.0044)),frontRing=coverUV.map(([x,y])=>pane(x,y));
    loft([rimRing,frontRing],true,p=>[p[0]-s*.501,p[1]-.630,-.18],[.717,.749,.714],55);
    panel(null,pane,Nf,[[coverRect,.009,0]],[clear,3]);
    // The indicator is narrower than the low-beam aperture and wraps onto the wing.
    // Its silver bowl is visible through amber polycarbonate, with an unlit clear bulb.
    const turn=(k,y,e=0)=>{
      const lo=head(.635,y,.001),last=side(s,-1.684,noseHeight(y),.004);
      const ax=Math.abs(lo[0]),bx=Math.abs(last[0]),arc=k*1.495;
      const xx=ax+(bx-ax)*Math.sin(arc)/Math.sin(1.495);
      const zz=lo[2]+(last[2]-lo[2])*(1-Math.cos(arc))/(1-Math.cos(1.495));
      return [s*(xx+e*Math.sin(arc)),noseHeight(y),zz-e*Math.cos(arc)];
    };
    const lowerCorner=(k,y,e)=>{
      const angle=1.495*k,ya=noseHeight(y),front=nose(s*.636,y,e),sidePoint=side(s,-1.684,ya);
      const x=front[0]+(sidePoint[0]-front[0])*Math.sin(angle)/Math.sin(1.495);
      const z=front[2]+(sidePoint[2]-front[2])*(1.-Math.cos(angle))/(1.-Math.cos(1.495));
      return [x,ya,z];
    };
    surface((k,t)=>lowerCorner(k,.505+.037*t,-.002-.009*(1-t)**2),seq(0,1,34),seq(0,1,9),[s*.64,0,-1],paint,1);
    surface((k,t)=>lowerCorner(k,.493+.011*t,-.014-.009*(1-t)),seq(0,1,34),[0,.5,1],[s*.64,0,-1],trim,2);
    surface((k,t)=>mix(lowerCorner(k,.542,-.002),turn(k,.546,.0005),t),
      seq(0,1,34),[0,.25,.60,1],[s*.64,.28,-1],paint,1);
    const signBowl=(k,y)=>{
      const v=(y-.632)/.087,u=(k-.42)/.57;
      return turn(k,y,-.044+.029*Math.min(1,u*u)+.015*v*v);
    };
    surface(signBowl,seq(0,1,48),seq(.544,.718,19),[s*.65,0,-1],[.792,.789,.726],55);
    tube(turn(.33,.630,-.040),turn(.33,.630,-.031),.014,[.438,.447,.418],55,body,20,.010);
    // The wing closes the curved top of the opening all the way back to the
    // leading hem. This crown follows the indicator instead of ending in mid-air.
    const lipReturn=(k,h)=>{
      const low=turn(k,.719,.0002),z=Math.max(hoodStart,low[2]);
      const half=sideX(edgeY(hoodStart),hoodStart);
      const hemPoint=hem(s*sat(Math.abs(low[0])/half),1);
      const shoulder=hood(s,z),t=sat((k-.48)/.44);
      const top=mix(hemPoint,shoulder,t*t*(3-2*t));
      const v=mix(low,top,h);v[0]+=s*.0014*Math.sin(h*pi);return v;
    };
    surface(lipReturn,seq(0,1,34),[0,.23,.48,.72,1],[s*.58,.25,-1],paint,1);
    const sideSliver=(k,y)=>turn(k,y,.003+.0035*(1-((y-.631)/.09)**2));
    surface(sideSliver,seq(.014,.985,45),seq(.545,.718,10),[s*.65,0,-1],amber,3);
    const joint=seq(.544,.717,20).map(y=>turn(.005,y,.005));
    line(joint,.0023,[.111,.123,.117],2,body,7);
    for(let y of [.543,.719])line(seq(0,1,33).map(k=>turn(k,y,.001)),.0020,[.301,.333,.314],4,body,7);
    const sideRepeat=side(s,-.850,.615,.002);
    box(sideRepeat,[.012,.030,.074],seal,2);box(add(sideRepeat,[s*.009,0,0]),[.007,.020,.058],[.77,.46,.133],5);
  }
  // A single moulding follows the rear quarter. The circular corner makes the
  // four optical chambers turn onto the flank without separate flat end caps.
  for(const s of [-1,1]){
    const shade=[[.361,.063,.058],[.412,.056,.060],[.383,.329,.264],[.387,.395,.364]];
    const dyes=[[1,.41,.34],[1,.41,.34],[1,.34,.39],[1,.28,.50]];
    const edges=[.548,.603,.669,.734,.798];
    const arc=seq(0,1,64),inner=.497;
    const cluster=(t,y,depth=0)=>{
      const x0=inner+.004*(y-.674)/.125;
      const cornerX=.6875,xz=.037,zz=.036,edgeZ=tail(s*cornerX,y)[2]-.003;
      let x,z,nx=0,nz=1;
      if(t<.641){
        const a=t/.641;x=x0+(cornerX-x0)*a;z=tail(s*x,y)[2]-.003;
      }else if(t<.832){
        const a=(t-.641)/.191*pi*.5;nx=Math.sin(a);nz=Math.cos(a);
        x=cornerX+xz*nx;z=edgeZ-zz*(1-nz);
      }else{
        const a=(t-.832)/.168;nx=1;nz=0;z=edgeZ-zz+(1.704-edgeZ+zz)*a;
        const x1=Math.abs(side(s,1.704,y,.002)[0]);
        x=cornerX+xz+(x1-cornerX-xz)*a;
      }
      return [s*(x+nx*depth),y,z+nz*depth];
    };
    const skin=(t,y,d=0)=>cluster(t,y,d+.007*Math.sin(.20+2.58*t)+.0025*Math.cos((y-.677)*8.2));
    surface((u,v)=>skin(u,v,-.029),arc,edges,[s*.35,0,1],[.08,.086,.079],2);
    // EP seals have one perimeter bead, ultrasonically welded partitions and a dark lower sill.
    for(const edge of [edges[0],edges[4]]){
      const top=edge===edges[4],edgeY=edge+(top?.0015:-.0015);
      surface((u,t)=>skin(u,edgeY+(top?-1:1)*t*.0055,-.002+.0055*Math.sin(pi*t*.80)),
        arc,[0,.20,.55,.85,1],[s*.3,0,1],seal,2);
    }
    for(const t of [0,1]){
      const end=t===1;
      surface((u,y)=>skin(end?1-u*.020:u*.020,y,.001+.0048*Math.sin(pi*u)),[0,.28,.60,1],edges,[s*.4,0,1],seal,2);
    }
    for(let row=0;row<4;row++){
      const low=edges[row]+(row===0?.0055:.0013),high=edges[row+1]-(row===3?.0055:.0013);
      const y=v=>low+(high-low)*v;
      const cover=(u,v)=>skin(u,y(v),.0029+.0018*Math.sin(pi*v));
      surface((u,v)=>skin(u,y(v),-.026+.013*(2*v-1)**2+.003*Math.cos(u*11)),
        arc,seq(0,1,8),[s*.38,0,1],shade[row],row<2?6:55);
      surface(cover,seq(.014,.986,64),seq(0,1,8),[s*.38,0,1],dyes[row],3,body,true);
      if(row<3){
        surface((u,v)=>skin(u,high+v*.0026,.0007*Math.sin(v*pi)),arc,[0,.38,.72,1],[s*.38,0,1],[.117,.093,.079],2);
      }
    }
    const hatchGap=[[.480,.533],[.484,.654],[.485,.748],[.486,.775],[.489,.786],[.498,.794],[.510,.797],[.694,.797],[.707,.807],[.709,.872]];
    line(hatchGap.map(([x,y])=>tail(s*x,y,.0037)),.0041,[.090,.112,.124],2,body,8);
    line(seq(.490,.701,18).map(x=>tail(s*x,.800,.002)),.0015,[.633,.733,.800],1,body,7);
  }
  inset(tail,[-.455,.527,.470,.536],Nr,2,.003,.002,seal,dark,2,.005);
  // Glyphs are rasterised once into horizontal polygon runs. There are no external maps.
  function label(text,font,fn,width,height,color,mat=0,group=body) {
    const cv=document.createElement('canvas');cv.width=260;cv.height=64;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.font=font;const metric=ctx.measureText(text);
    const w=Math.min(256,Math.ceil(metric.width)+3),h=Math.min(62,Math.ceil(metric.actualBoundingBoxAscent+metric.actualBoundingBoxDescent)+3);
    ctx.fillStyle='#fff';ctx.fillText(text,1,metric.actualBoundingBoxAscent+1);
    const data=ctx.getImageData(0,0,w,h).data;
    for(let y=0;y<h;y++)for(let x=0;x<w;){
      while(x<w&&data[(y*w+x)*4+3]<110)x++;let a=x;while(x<w&&data[(y*w+x)*4+3]>=110)x++;
      if(a<x) {const x0=(a/w-.5)*width,x1=(x/w-.5)*width,y0=(.5-y/h)*height,y1=(.5-(y+1)/h)*height;
        const p=fn(x0,y1),q=fn(x1,y1),r=fn(x1,y0),s=fn(x0,y0);G.quad(p,q,r,s,color,mat,group);}
    }
  }
  for(let h of [-1,1]){
    const y=h>0?.624:.382,z=h>0?1.809:-1.857;
    const rearMount=tail(0,y,.008)[2],mountSlope=(tail(0,y+.001)[2]-tail(0,y-.001)[2])*500;
    const plate=(u,v,e=0)=>h>0?[u*.902,y+(v-y)*.902,rearMount+mountSlope*(v-y)*.902+e]:[-u,v,z-e];
    inset(plate,[-.224,y-.065,.224,y+.065],[0,0,h],4,.009,.0038,[.58,.597,.596],[.054,.055,.052],117);
    label('Mille EP','italic bold 41px Arial',(x,v)=>plate(x,y+v,.0035),.323,.078,[.800,.812,.791],117);
    for(let x of [-.205,.205]){let p=plate(x,y+.041,.005);tube(p,add(p,[0,0,h*.002]),.0045,silver,4,body,7);}
  }
  const badge=(u,v,e=0)=>tail(-.564+u,.839+v,e);
  inset(badge,[-.067,-.018,.067,.018],Nr,4,.003,.002,chrome,[.060,.098,.195],2,.005);
  label('F I A T','italic bold 33px Arial',(u,v)=>badge(u,v,.008),.114,.026,silver,4);
  const milleScript=(u,v)=>tail(.526+u,.838+v,.0062);
  const epScript=(u,v)=>tail(.604+u,.839+v,.0063);
  label('Mille','italic 39px Arial',milleScript,.097,.027,[.674,.720,.722],4);
  label('EP','italic bold 34px Arial',epScript,.045,.026,[.648,.257,.192],0);
  inset(tail,[.282,.625,.443,.667],Nr,2,.008,.004,seal,trim,2,.007);
  tube(tail(.424,.646,.011),tail(.424,.646,.013),.008,silver,4,body,10);
  // Both windscreens have a single articulated steel wiper. Its primary
  // bridge distributes the spring force through two rocking yokes to the rubber.
  for(const rear of [false,true]){
    const sign=rear?1:-1,heel=rear?-.090:.016,mid=rear?.454:.536,
      first=rear?.133:.181,last=rear?.823:.918;
    const glassAt=(u,t,e)=>screen(rear,u,t,e);
    const path=u=>(rear?.116:.091)+(rear?.044:.042)*u+.018*(1-u*u);
    const blade=(u,e=0,h=0)=>glassAt(u,path(u)+h,e);
    const foot=glassAt(heel,-.006,.016),hinge=glassAt(heel+.048,.034,.030);
    tube(foot,add(foot,[0,.005,sign*.013]),.017,[.076,.082,.084],2,body,20,.013);
    bar(add(foot,[0,.004,sign*.012]),hinge,.022,.011,[.129,.139,.142],2);
    const elbow=glassAt(mid-.15,path(mid)-.024,.036),joint=blade(mid,.042,.004);
    bar(hinge,elbow,.014,.009,[.134,.144,.145],4);
    bar(elbow,joint,.011,.008,[.165,.175,.177],4);
    const span=seq(first,last,30),rubberSection=[[-.005,.004],[-.003,.010],[.005,.015],[.009,.009],[.004,.004]];
    for(let k=1;k<rubberSection.length;k++){
      const a=rubberSection[k-1],b=rubberSection[k];
      surface((u,t)=>blade(u,a[1]+(b[1]-a[1])*t,a[0]+(b[0]-a[0])*t),
        span,[0,1],[0,.53,sign],[.090,.096,.097],2);
    }
    const length=last-first,outer0=first+.155*length,outer1=last-.155*length;
    for(const x of [outer0,outer1]){
      const pivot=blade(x,.028,.001);
      const shoulder=blade((x+mid)*.5,.038,.002);
      bar(joint,shoulder,.010,.008,[.153,.164,.168],2);
      bar(shoulder,pivot,.007,.007,[.124,.134,.138],2);
      for(const u of [x-.135*length,x+.135*length]){
        const tip=blade(u,.014);
        bar(pivot,tip,.006,.0045,[.157,.167,.164],2);
        tube(tip,add(tip,[0,0,sign*.003]),.0042,[.177,.184,.184],4,body,8);
      }
    }
  }
  // The cabin is hollow. Individual mouldings can be seen through the glass from either side.
  box([0,.355,.22],[1.39,.105,2.67],trim,8);
  // The inner door cards and rear-quarter liners fold over the exposed sill.
  // The painted outer skin is several centimetres outboard of these trim panels.
  for(const s of [-1,1]){
    for(const [za,zb] of [[-.665,jamb-.008],[jamb-.001,1.730]]){
      const inner=(z,t)=>{
        const upper=edgeY(z)-.004;
        const y=.350+(upper-.350)*t;
        const roll=.041+.017*Math.sin(Math.PI*t)+.013*Math.exp(-(((t-.85)/.088)**2));
        return [s*(sideX(y,z)-roll),y,z];
      };
      const sections=seq(za,zb,36);
      surface(inner,sections,seq(0,1,19),[-s,0,0],[.209,.216,.210],8);
      surface((z,t)=>{
        const innerLip=inner(z,1),y=innerLip[1]+.0048*Math.sin(Math.PI*t);
        return [innerLip[0]+s*(.024*t),y,z];
      },sections,seq(0,1,7),[0,1,0],[.189,.194,.190],8);
      const piping=sections.map(z=>inner(z,.86));line(piping,.0031,[.152,.158,.153],8,body,6);
    }
    const sideGrip=(z,y,e=0)=>[s*(sideX(y,z)-.056-e),y,z];
    line([sideGrip(-.284,.700,.006),sideGrip(-.241,.680,.033),
      sideGrip(-.029,.677,.034),sideGrip(.010,.695,.009)],.011,[.185,.192,.190],8,body,8);
    tube(sideGrip(-.378,.599,.012),sideGrip(-.378,.599,.023),.022,[.178,.183,.176],8,body,12);
    bar(sideGrip(-.378,.599,.025),sideGrip(-.420,.575,.027),.014,.012,trim,8);
    tube(sideGrip(-.420,.575,.028),sideGrip(-.420,.575,.038),.011,trim,8,body,10);
  }
  function cushion(x,y,z,w,h,d,tilt,col){
    const pts=rounded(rect(-w/2,-d/2,w/2,d/2),Math.min(w,d)*.18,6);
    let layers=[[-.50,.87],[-.40,.97],[-.19,1],[.26,1],[.42,.96],[.50,.84]];
    const at=(u,v,yy)=>[x+u,y+yy*cos(tilt)-v*sin(tilt),z+yy*sin(tilt)+v*cos(tilt)];
    let rows=layers.map(([yy,s])=>pts.map(([u,v])=>at(u*s,v*s,yy*h)));
    for(let k=1;k<rows.length;k++)for(let i=0;i<pts.length;i++){let j=(i+1)%pts.length,a=rows[k-1][i],b=rows[k-1][j];
      let guide=sub(mix(a,b,.5),[x,y,z]);face(a,b,rows[k][j],rows[k][i],guide,col,8);}
    let top=rows.at(-1),center=at(0,0,h*.50);for(let i=0;i<top.length;i++)tri(center,top[i],top[(i+1)%top.length],[0,1,0],col,8);
  }
  // Each seat section follows the foam profile. Bolsters, stitched inset and head restraint share its rake.
  const sections={
    squab:[[0,.78,.81],[.10,.90,.93],[.34,.98,.98],[.61,1,1],[.84,.98,.93],[.96,.91,.82],[1,.80,.66]],
    back:[[0,.69,.70],[.04,.83,.84],[.12,.95,.99],[.28,1,1],[.48,.98,.92],[.71,.94,.84],[.87,.88,.76],[.94,.82,.66],[.984,.72,.52],[1,.56,.35]],
    head:[[0,.63,.43],[.047,.79,.64],[.13,.91,.86],[.31,.99,.98],[.55,1,1],[.72,.978,.96],[.84,.927,.875],[.93,.824,.71],[.98,.656,.49],[1,.452,.28]]
  };
  const cloth=[.177,.199,.210],insetCloth=[.291,.318,.323],edgeThread=[.123,.149,.150];
  function upholster(x,z,y0,height,halfWidth,halfDepth,lean,kind){
    const guides=sections[kind],width=profile(guides.map(p=>[p[0],p[1]])),depth=profile(guides.map(p=>[p[0],p[2]]));
    const n=32,angles=seq(0,2*pi,n).slice(0,-1),ts=seq(0,1,kind==='head'?16:20);
    const shape=(t,a)=>{
      let co=cos(a),si=sin(a),u=Math.sign(co)*Math.abs(co)**.52,v=Math.sign(si)*Math.abs(si)**.65;
      const lateral=halfWidth*width(t)*u,front=si<0;
      let yy=y0+height*t,zz=z+t*lean+halfDepth*depth(t)*v;
      if(kind==='back'&&front){let flank=Math.exp(-(((Math.abs(u)-.78)/.22)**2)),lumbar=Math.exp(-(((t-.32)/.23)**2));
        zz-=.029*flank*Math.sin(Math.PI*t)**.68+.013*lumbar*(1-u*u);}
      if(kind==='back'&&!front){
        const sidePadding=Math.exp(-(((Math.abs(u)-.79)/.15)**2));
        const welt=Math.exp(-(((Math.abs(u)-.642)/.045)**2));
        const shoulder=Math.exp(-(((t-.78)/.14)**2));
        zz+=Math.sin(pi*t)**.74*(.012*sidePadding-.009*welt)
          +.013*shoulder*(1-u*u)-.0065*(1-u*u)*Math.exp(-(((t-.48)/.21)**2));
        const dart=t-(.77-.062*u*u+.024*u);
        zz-=.0045*Math.exp(-((dart/.033)**2))*(.36+.64*Math.abs(u));
      }
      if(kind==='head'){
        const seam=.24+.07*(1-u*u);
        zz+=.0043*(1-u*u)*Math.sin(2.12*pi*t)-Math.sign(v)*.0029*Math.exp(-(((t-seam)/.043)**2));
      }
      if(kind==='squab')yy+=.019*Math.exp(-(((Math.abs(u)-.79)/.19)**2))*Math.sqrt(t);
      if(kind==='head')zz-=.007*(1-u*u)*Math.sin(Math.PI*t);
      return [x+lateral,yy,zz];
    };
    const rows=ts.map(t=>angles.map(a=>shape(t,a)));
    loft(rows,true,p=>[p[0]-x,0,p[2]-(z+lean*(p[1]-y0)/height)],cloth,118,(r,k)=>{
      const a=(k+.5)*2*pi/n,t=ts[r],front=Math.max(-sin(a),0),u=Math.abs(cos(a));
      if(kind==='back'&&front>.30&&u<.72&&t>.13&&t<.88){
        const piping=(u>.57&&u<.72)?.78:1.;
        return scale(insetCloth,piping*(.96+.044*cos(t*30.)));
      }
      if(kind==='head')return scale(cloth,1.12-.32*u*u-.10*(1-t));
      return scale(cloth,.84+.18*Math.abs(sin(a)));});
    const close=(r,normY)=>{const row=rows[r],mid=row.reduce((v,p)=>add(v,scale(p,1/row.length)),[0,0,0]);for(let i=0;i<n;i++)tri(mid,row[i],row[(i+1)%n],[0,normY,0],cloth,118);};
    close(0,-1);close(ts.length-1,1);
    if(kind==='back'){
      for(const a of [4.13,5.298])line(seq(.13,.87,24).map(t=>add(shape(t,a),[0,0,-.0014])),.0018,edgeThread,8,body,5);
      for(let t of [.25,.34,.43,.52,.61,.70,.79])line(seq(4.13,5.298,14).map(a=>add(shape(t,a),[0,0,-.0011])),.0013,[.246,.265,.247],8,body,4);
      for(const a of [1.09,pi-1.09]){
        line(seq(.12,.89,28).map(t=>add(shape(t,a),[0,0,.0010])),.0014,edgeThread,8,body,5);
      }
      const shoulder=seq(.665,pi-.665,32).map(a=>{
        const u=Math.sign(cos(a))*Math.abs(cos(a))**.52;
        return add(shape(.77-.062*u*u+.024*u,a),[0,0,.0011]);});
      line(shoulder,.00155,edgeThread,8,body,5);
    }else if(kind==='head'){
      for(const a of [0,pi])line(seq(.11,.91,16).map(t=>add(shape(t,a),[a===0?.0012:-.0012,0,0])),.00145,edgeThread,8,body,5);
      line(seq(.18,pi-.18,32).map(a=>{
        const u=Math.sign(cos(a))*Math.abs(cos(a))**.52;
        return add(shape(.24+.07*(1-u*u),a),[0,0,.0013]);}),.00135,edgeThread,8,body,5);
    }
  }
  for(let x of [-.346,.346]) {
    // The empty passenger seat is one adjustment notch farther back on its rails.
    const slide=x>0?.128:0, recline=x>0?.041:0;
    upholster(x,.095+slide,.439,.134,.245,.251,-.017,'squab');
    upholster(x,.288+slide,.524,.491,.248,.074,.106+recline,'back');
    for(let xx of [-.076,.076]){
      tube([x+xx,1.003,.387+slide+recline],[x+xx,1.090,.399+slide+recline],.0065,[.445,.466,.461],4);
      tube([x+xx,1.006,.389+slide+recline],[x+xx,1.015,.391+slide+recline],.012,trim,2);}
    upholster(x,.394+slide+recline,1.054,.165,.139,.059,.018,'head');
    box([x,.438,.155],[.240,.088,.315],trim,2);
  }
  cushion(0,.525,1.010,1.180,.135,.415,0,cloth);
  upholster(0,1.182,.545,.366,.592,.065,.083,'back');
  const parcel=(u,t)=>{
    const z=1.264+t*(.432-.040*u*u),edge=.688-.026*t-.030*t*t;
    return [u*edge,.890-.010*t+.004*(1-u*u)-.004*Math.exp(-(((t-.08)/.046)**2)),z];
  };
  const rearDeck=[.218,.224,.217];
  surface(parcel,seq(-1,1,23),seq(0,1,16),[0,1,0],rearDeck,8);
  for(const t of [0,1]){
    const welt=seq(-1,1,25).map(u=>parcel(u,t));line(welt,.0054,[.174,.181,.177],8,body,6);
  }
  // The instrument cowling rises out of the padded fascia. The passenger shelf remains recessed.
  const fasciaSection=[[.666,-.322],[.710,-.288],[.791,-.290],[.837,-.305],[.873,-.342],[.889,-.402],[.885,-.511],[.852,-.616],[.805,-.635],[.722,-.589],[.666,-.542]];
  const dashX=seq(-.673,.673,60),dashRows=fasciaSection.map(([yy,zz])=>dashX.map(x=>{
    let bend=.056*(x/.67)**2,dome=.016*Math.exp(-(((x+.34)/.24)**4));
    return [x,yy+dome-.013*(x/.67)**4,zz-bend];
  }));
  loft(dashRows,false,p=>[0,p[1]-.766,p[2]+.440],[.178,.189,.194],2);
  const pod=(u,t)=>{const arch=Math.sqrt(Math.max(0,1-(u/.205)**2));
    return [-.345+u,.858+(.021+.080*arch)*Math.sin(Math.PI*t*.63),-.474+.174*t-.008*(u/.205)**2];};
  surface(pod,seq(-.205,.205,36),seq(0,1,16),[0,1,.34],[.141,.157,.163],2);
  const gaugeFace=(u,v)=>[-.345+u,.855+v,-.295-v*.12];
  inset(gaugeFace,[-.170,-.028,.170,.061],[0,0,1],2,.022,.006,seal,[.123,.135,.132],2,0);
  for(let u of [-.087,.072]){
    let p=gaugeFace(u,.011);tube(p,add(p,[0,0,.003]),.041,[.061,.076,.078],2,body,32);
    for(let k=0;k<13;k++){const a=-2.07+k*.34;
      bar(add(p,[sin(a)*.031,cos(a)*.031,.005]),add(p,[sin(a)*.037,cos(a)*.037,.005]),.0017,.0015,[.680,.702,.648],0);}
    bar(add(p,[0,0,.005]),add(p,[-.025,.008,.006]),.002,.002,[.757,.533,.288],0);
  }
  const vents=(x,y,z,w,h)=>{box([x,y,z],[w,h,.015],seal,2);
    for(let k=1;k<5;k++)bar([x-w*.45,y-h*.49+k*h/5,z+.011],[x+w*.45,y-h*.49+k*h/5,z+.011],.004,.003,[.209,.218,.214],2);};
  vents(-.574,.807,-.322,.100,.057);vents(.092,.802,-.271,.217,.057);vents(.588,.807,-.323,.098,.057);
  for(let x of [-.405,-.307,.344,.429])for(let k=0;k<7;k++){
    bar([x+k*.006,.878,-.553],[x+k*.006+.013,.880,-.497],.002,.002,[.075,.083,.085],2);}
  for(let s of [-1,1]) {
    box([s*.699,.674,.1145],[.047,.394,1.312],cloth,8);
    cushion(s*.667,.692,.014,.072,.064,.301,.023,trim);
    bar(cabin(s,upperJamb-.075,1.210,-.024),[s*.526,.586,.178],.031,.004,[.118,.126,.127],8);
  }
  // Three-spoke steering wheel in the inclined column plane.
  tube([-.338,.764,-.385],[-.338,.893,-.152],.035,dark,2);
  const steer=(a,r,e=0)=>[-.338+sin(a)*r,.906+cos(a)*r*.856+e*.52,-.156-cos(a)*r*.518+e*.86];
  line(seq(0,2*pi,64).map(a=>steer(a,.161)),.015,[.167,.178,.176],2,body,12);
  for(let a of [-1.59,1.59,Math.PI]){
    const v1=steer(a-.14,.034,-.009),v2=steer(a+.14,.034,-.009),
      v3=steer(a+.079,.154),v4=steer(a-.079,.154);
    face(v1,v2,v3,v4,[0,.52,.86],[.186,.193,.190],2);
    for(let [aa,bb] of [[v1,v4],[v2,v3]])bar(aa,bb,.007,.007,trim,2);}
  cushion(-.338,.907,-.145,.122,.077,.042,-.16,[.155,.165,.165]);
  bar([-.378,.865,-.209],[-.477,.872,-.181],.012,.012,seal,2);
  box([0,.451,-.044],[.126,.122,.364],trim,2);tube([0,.50,.002],[0,.641,-.039],.009,trim,2);
  tube([0,.643,-.039],[0,.664,-.043],.025,seal,2);
  bar([.055,.510,.211],[.055,.571,.361],.021,.025,seal,2);
  // A period full-face helmet, cloth overalls and gloves. The wrists terminate on the steering rim.
  const suit=[.172,.224,.250],seamCol=[.283,.329,.343],glove=[.164,.183,.183],cx=-.346;
  function form(path,sections,col,mat=123) {
    const ang=seq(0,2*pi,24).slice(0,-1);
    const rings=path.map((p,i)=>{const p0=path[Math.max(0,i-1)],p1=path[Math.min(path.length-1,i+1)],along=norm(sub(p1,p0)),
        base=norm(cross(along,Math.abs(along[0])>.95?[0,0,1]:[1,0,0])),right=norm(cross(base,along)),[w,d]=sections[i];
      return ang.map(a=>add(p,add(scale(right,cos(a)*w),scale(base,sin(a)*d))));});
    const axis=norm(sub(path.at(-1),path[0])),center=path[0],radial=p=>{const v=sub(p,center);return sub(v,scale(axis,dot(v,axis)));};
    loft(rings,true,radial,col,mat);
    for(let k of [0,path.length-1]){const ring=rings[k],n=scale(axis,k?1:-1);
      for(let i=0;i<ring.length;i++)tri(path[k],ring[i],ring[(i+1)%ring.length],n,col,mat);}
  }
  const torso=[[cx,.584,.161],[cx-.002,.64,.169],[cx-.008,.746,.185],[cx-.009,.865,.167],[cx-.003,.951,.148],[cx+.004,1.000,.135],[cx+.008,1.027,.133]];
  form(torso,[[.106,.077],[.156,.113],[.163,.113],[.177,.110],[.193,.105],[.169,.085],[.088,.064]],suit);
  for (const dx of [-1,1]){
    const grip=dx<0?1.08:1.39,shoulder=[cx+dx*.157,.956-dx*.012,.138+dx*.014],elbow=[cx+dx*.216,.799-dx*.019,-.005+dx*.020],wrist=steer(dx*(grip+.10),.162,.055);
    const arm=[shoulder,mix(shoulder,elbow,.34),mix(shoulder,elbow,.78),elbow,mix(elbow,wrist,.27),mix(elbow,wrist,.74),wrist];
    form(arm,[[.067,.064],[.061,.063],[.049,.052],[.047,.047],[.046,.050],[.041,.041],[.035,.033]],suit);
    line(arm.map((p,i)=>add(p,[dx*(.047-i*.0019),.006,-.014])),.0025,seamCol,123,body,5);
    const patch=(u,t)=>{const sh=add(shoulder,[dx*.015,.048,.010]),end=mix(shoulder,elbow,.455),p=mix(sh,end,t),a=(.48+u*.53)*Math.PI;
      return add(p,[dx*(.057-.009*t)*sin(a),.016*(1-t),(.062-.011*t)*cos(a)]);};
    surface(patch,seq(0,1,7),seq(0,1,5),[dx,.22,-.28],[.378,.406,.390],123);
    for(let h of [.11,.87])line(seq(0,1,9).map(k=>patch(k,h)),.0016,[.539,.526,.444],123,body,5);
    line([add(shoulder,[dx*.030,.036,-.044]),add(shoulder,[dx*.018,.029,-.056]),add(shoulder,[-dx*.044,.022,-.062])],.0033,[.446,.469,.460],123,body,6);
    const fore=norm(sub(wrist,elbow)),cuff=add(wrist,scale(fore,-.033));form([cuff,wrist],[[.039,.037],[.033,.031]],[.226,.241,.239]);
    form([cuff,add(cuff,scale(fore,.0058))],[[.0392,.0374],[.0384,.0365]],[.425,.446,.412]);
    // Sections of the driving gloves follow the toroidal rim. Each fingertip rolls around
    // its front face; the thumb opposes the other four digits on the inner return.
    const hand=(side,radial,forward)=>steer(dx*(grip+side/.161),.161+radial,forward);
    const gloveRing=seq(0,2*pi,16).slice(0,-1);
    const dorsal=[.241,.253,.241],leather=[.108,.132,.125];
    function gloveLoft(rings,centres,tone){
      const radial=new Map();for(let k=0;k<rings.length;k++)for(const p of rings[k])radial.set(p,sub(p,centres[k]));
      loft(rings,true,p=>radial.get(p),tone,123);
      for(const k of [0,rings.length-1]){
        const r=rings[k],n=norm(sub(centres[k],centres[k===0?1:k-1]));
        for(let j=0;j<r.length;j++)tri(centres[k],r[j],r[(j+1)%r.length],n,tone,123);
      }
    }
    const palm=[[.016,.001,.059,.022,.013],[.014,.003,.049,.030,.016],[.008,.003,.039,.035,.017],
      [.004,.006,.032,.039,.015],[-.001,.011,.026,.037,.014],[-.003,.016,.022,.033,.011]];
    const palmAt=(a,p)=>hand(p[0]+cos(a)*p[3],p[1]+sin(a)*p[4],p[2]-.006*cos(a)**2+.002*sin(a)*cos(a));
    gloveLoft(palm.map(p=>gloveRing.map(a=>palmAt(a,p))),palm.map(p=>hand(...p.slice(0,3))),glove);
    for(let i=0;i<4;i++){
      const off=-.029+.0174*i,radius=[.0090,.0094,.0087,.0076][i];
      const segments=seq(0,1,11),centres=[];
      const rows=segments.map(t=>{
        const reach=[2.44,2.93,2.67,2.05][i],a=.37+.11*i+t*reach;
        const spread=off+.0017*(i-1.1)*t+.0017*sin(pi*t*.97)*(i-1.6);
        const centre=.0191+.0029*cos(2.6*t)+.0016*sin(i*1.8+t*2.1);
        const fingerRadius=radius*(.94+.105*sin(t*pi*2.9)**2)*(1-.22*t)*Math.sqrt(Math.min(1,(1.013-t)*7.2));
        centres.push(hand(spread,centre*sin(a),centre*cos(a)));
        return gloveRing.map(q=>hand(spread+fingerRadius*cos(q),sin(a)*(centre+.95*fingerRadius*sin(q)),cos(a)*(centre+.95*fingerRadius*sin(q))));
      });
      gloveLoft(rows,centres,i===0?dorsal:glove);
      // A flat aramid panel follows the back of each knuckle, with sewn ends.
      surface((t,v)=>{const a=.70+.075*i+t*.65,dist=.02135+radius;
          return hand(off+v*radius*.56,dist*sin(a),dist*cos(a));},
        seq(0,1,8),[-1,0,1],[dx*.85,.32,-.19],dorsal,123);
    }
    const thumbPath=[hand(-.007,-.012,.043),hand(-.016,-.020,.034),hand(-.026,-.021,.025),hand(-.035,-.020,.014),hand(-.037,-.020,.009),hand(-.036,-.020,.007)];
    form(thumbPath,[[.014,.012],[.013,.013],[.012,.011],[.009,.010],[.006,.007],[.003,.004]],leather);
    line(palm.slice(1).map(q=>palmAt(.50*pi,q)),.0018,[.446,.452,.415],123,body,6);
    const tab=(u,t)=>{const q=palm[2],a=Math.PI*(.42+.32*u);return hand(.006+cos(a)*.036+.003*t,.005+sin(a)*.015,.041-.012*t);};
    surface(tab,seq(0,1,7),[0,.5,1],[dx,.4,-.2],[.469,.337,.270],123);
    const knee=[cx+dx*.110,.633,-.223],hip=[cx+dx*.086,.611,.135],foot=[cx+dx*.093,.431,-.47];
    form([hip,mix(hip,knee,.56),knee,mix(knee,foot,.45),foot],[[.084,.072],[.078,.073],[.066,.066],[.058,.055],[.041,.044]],suit);
  }
  line([[cx,.705,.051],[cx-.004,.806,.047],[cx-.004,.908,.048],[cx,.971,.057],[cx+.001,1.003,.054]],.0023,[.397,.404,.370],123,body,5);
  // Curved quilting runs down each side of the placket and turns around the clavicle.
  // Local relief catches the light through the two side windows.
  for(const side of [-1,1]){
    for(const y0 of [.828,.861,.899]){
      const seam=seq(0,1,15).map(x=>{
        const xx=.034+x*.105, y=y0+.047*x+.009*sin(pi*x);
        const front=.172-.107*Math.sqrt(Math.max(0,1-((xx+.005)/.172)**2));
        return [cx+side*xx,y,front-.011-.010*x];
      });
      line(seam,.00123,[.396,.445,.470],123,body,5);
    }
    const panel=(u,v)=>{
      const x=.048+.121*u, y=1.001-.027*u-.049*v, z=.130-.093*Math.sqrt(Math.max(0,1-(x/.191)**2))+.018*u;
      return [cx+side*x,y,z-.004-.007*v];
    };
    surface(panel,seq(0,1,11),[0,.5,1],[side*.35,.4,-1],[.459,.476,.462],123);
    line(seq(0,1,11).map(u=>panel(u,.92)),.00165,[.599,.385,.263],123,body,5);
  }
  // Shoulder belt and stitched collar.
  const belt=[[cx-.131,1.003,.117],[cx-.084,.939,.067],[cx-.021,.853,.049],[cx+.055,.748,.060],[cx+.110,.665,.066]];
  for(let i=1;i<belt.length;i++){const a=belt[i-1],b=belt[i],l=[.017,.012,0];
    face(sub(a,l),add(a,l),add(b,l),sub(b,l),[0,.3,-1],[.138,.145,.145],123);}
  form([[cx+.005,1.004,.137],[cx+.009,1.039,.135],[cx+.009,1.073,.134]],[[.081,.072],[.071,.067],[.062,.057]],[.236,.250,.239]);
  line(seq(0,2*pi,36).map(a=>[cx+.009+.073*sin(a),1.036+.003*cos(a),.135+.064*cos(a)]),.0022,[.455,.440,.375],123,body,6);
  // The helmet and its optics are emitted before the exterior windows, so each layer
  // of polycarbonate and glass composes with the opaque driver in the correct order.
  function buildDriverHelmet(){
  const cx=-.346, shell=[.265,.330,.353], carbon=[.149,.167,.175], gasket=[.108,.113,.112], ventDark=[.058,.065,.069];
  const sectionsH=[[0,.64,.65],[.043,.80,.76],[.108,.893,.87],[.205,.959,.976],[.35,.985,.995],[.54,1,1],
    [.69,.971,.971],[.81,.885,.90],[.913,.69,.71],[.974,.397,.43],[.998,.091,.108],[1,.007,.007]];
  const hw=profile(sectionsH.map(p=>[p[0],p[1]])),hd=profile(sectionsH.map(p=>[p[0],p[2]]));
  const headFrame=(x,y,z)=>[cx+.011+.9968*x+.0799*z,1.163+.99908*y+.0429*z,.138-.0799*x+.99588*z-.0429*y];
  function helmetAt(a,t,off=0){
    const c=cos(a),b=Math.max(0,c),jaw=.044*(b**1.64)*Math.exp(-(((t-.175)/.184)**2));
    const channel=.0034*Math.exp(-(((Math.abs(a)-.55)/.098)**2)-(((t-.877)/.105)**2));
    return headFrame((.1225*hw(t)+off-channel)*sin(a),.270*(t-.50)-.012*b**2*(1-t)**8,
      -(.142*hd(t)+off-channel)*c-jaw+.005*t);
  }
  const outward=p=>[p[0]-cx,(p[1]-1.163)*.8,p[2]-.138];
  const allA=seq(-pi,pi,120).slice(0,-1);
  // The cheek and eyebrow edges converge behind the visor hinge at each temple.
  function bounds(a){
    const aa=Math.abs(a),u=Math.min(1,aa/1.325),round=Math.sqrt(Math.max(0,1-u**8));
    return [.553-(.151-.024*u*u)*round,.553+(.164-.051*u*u)*round];
  }
  function chinOpening(a){
    const u=(Math.abs(a)-.293)/.222,round=Math.sqrt(Math.max(0,1-Math.min(1,Math.abs(u))**6));
    const mid=.206+.038*Math.min(1,a*a/.32);return [mid-.035*round,mid+.035*round];
  }
  function band(aa,n,low,high,depth,tone,material,wrap){
    const rows=seq(0,1,n).map(q=>aa.map(a=>helmetAt(a,low(a)+(high(a)-low(a))*q,depth(a,q))));
    loft(rows,wrap,outward,tone,material);return rows;
  }
  const zoff=()=>0;
  band(allA,8,()=>.007,a=>chinOpening(a)[0],zoff,shell,53,true);
  band(allA,8,a=>chinOpening(a)[1],a=>bounds(a)[0],zoff,shell,53,true);
  const crown=band(allA,26,a=>bounds(a)[1],()=>.998,zoff,shell,53,true);
  const apex=helmetAt(0,1);
  for(let i=0;i<allA.length;i++)tri(apex,crown.at(-1)[i],crown.at(-1)[(i+1)%allA.length],[0,1,0],shell,53);
  function lip(aa,boundary,inset,tone){
    const rings=[.0013,-.0015,-inset].map(d=>aa.map(a=>helmetAt(a,boundary(a),d)));
    loft(rings,false,outward,tone,2);
  }
  for(let s of [-1,1]){
    const va=seq(s*.072,s*.514,27);
    lip(va,a=>chinOpening(a)[0],.009,carbon);lip(va,a=>chinOpening(a)[1],.009,carbon);
    band(va,4,a=>chinOpening(a)[0]-.003,a=>chinOpening(a)[1]+.003,()=>-.0092,ventDark,8,false);
    for(let d of [-.014,.012])line(va.map(a=>helmetAt(a,.206+.038*Math.min(1,a*a/.32)+d,-.0042)),.0010,carbon,2,body,6);
    const va2=seq(s*.31,s*.65,14),low=a=>.823+.042*(Math.abs(a)-.31);
    const intake=band(va2,5,low,a=>low(a)+.048,(a,v)=>.0006+.005*(1-v)*Math.max(0,1-((Math.abs(a)-.48)/.17)**2),shell,53,false);
    const front=intake[0];
    for(let j=1;j<va2.length;j++)face(front[j-1],front[j],helmetAt(va2[j],low(va2[j])-.005,.0005),helmetAt(va2[j-1],low(va2[j-1])-.005,.0005),[0,-.3,-1],gasket,8);
  }
  const lensA=seq(-1.325,1.325,74);
  for(let j=0;j<=1;j++){lip(lensA,a=>bounds(a)[j],.009,gasket);
    line(lensA.map(a=>helmetAt(a,bounds(a)[j],.0008)),.0024,gasket,2,body,8);}
  // A curved smoke visor overlaps the opening. Its corner has its own tear-off post and lock.
  const visorA=seq(-1.52,1.52,86);
  const visor=[.030,.985,.99];
  const visorB=(a,i)=>{const u=Math.min(1,Math.abs(a)/1.52),v=Math.sqrt(Math.max(.00002,1-u**7));
    return i===0?.554-(.173-.022*u*u)*v:.554+(.181-.049*u*u)*v;};
  const visorD=(a,v)=>.0033+.002*(1-Math.min(1,(a/1.52)**2))+.0034*Math.sin(v*pi);
  band(visorA,12,a=>visorB(a,0),a=>visorB(a,1),visorD,visor,3,false);
  line(visorA.map(a=>helmetAt(a,visorB(a,0),visorD(a,0))),.00105,[.229,.248,.243],2,body,6);
  const decoA=seq(.64,2*pi-.64,76);
  const fl=ang=>Math.abs(Math.atan2(sin(ang),cos(ang)));
  const stripe=a=>.137+.163*(.5-.5*cos(fl(a)))+.027*sin(fl(a)*2.2);
  const stripeWidth=a=>.096*Math.sqrt(Math.max(0,Math.min(1,(fl(a)-.64)/.82)))+.012*(1-cos(2*fl(a)));
  band(decoA,5,stripe,a=>stripe(a)+stripeWidth(a),()=>.0006,[.153,.188,.196],53,false);
  band(decoA,2,a=>stripe(a)+stripeWidth(a)+.010,a=>stripe(a)+stripeWidth(a)+.016,()=>.00065,[.54,.317,.215],53,false);
  line(allA.concat(allA[0]).map(a=>helmetAt(a,.028,.0014)),.0035,gasket,2,body,8);
  for(let s of [-1,1]){
    const bolt=helmetAt(s*1.49,.552,.004),vec=[s*.0034,0,0];
    tube(bolt,add(bolt,vec),.0125,gasket,2,body,22);
    const plate=add(bolt,vec),cap=add(plate,[s*.0020,0,0]);tube(plate,cap,.0089,[.394,.419,.416],42,body,18);
    tube(cap,add(cap,[s*.0007,0,0]),.0037,carbon,2,body,6);
    const tear=helmetAt(s*1.09,.613,.006),tip=add(tear,[s*.0027,0,-.0009]);tube(tear,tip,.00385,[.467,.480,.455],42,body,14);
  }
  const latchA=seq(-1.29,-1.14,10);
  band(latchA,4,a=>visorB(a,0)-.022,a=>visorB(a,0)+.029,()=>.0076,carbon,2,false);
  const skin=[.539,.387,.311];
  const faceWidth=profile([[0,.020],[.075,.044],[.20,.058],[.33,.073],[.51,.082],[.67,.085],[.85,.083],[1,.060]]);
  const faceDepth=profile([[0,.066],[.063,.076],[.17,.083],[.26,.085],[.35,.087],[.50,.088],[.65,.090],[.78,.096],[1,.091]]);
  function facePoint(a,t,out=0){
    const aa=Math.abs(a),nose=.034*Math.exp(-((a/.243)**2)-(((t-.463)/.102)**2))+.018*Math.exp(-((a/.165)**2)-(((t-.555)/.161)**2)),
      lip=.0062*Math.exp(-((a/.36)**4)-(((t-.279)/.069)**2)),
      cheek=.009*Math.exp(-(((aa-.62)/.37)**2)-(((t-.45)/.18)**2)),
      brow=.0072*Math.exp(-(((aa-.39)/.31)**2)-(((t-.705)/.055)**2)),
      socket=-.0055*Math.exp(-(((aa-.40)/.24)**2)-(((t-.624)/.044)**2));
    const xx=(faceWidth(t)+out)*sin(a),yy=.218*(t-.50),zz=-cos(a)*(faceDepth(t)+out)-nose-cheek-lip-brow-socket;
    return [cx+.011+.9968*xx+.0799*zz,1.151+.9991*yy+.043*zz,.123-.0799*xx+.9958*zz-.043*yy];
  }
  const faceRings=seq(0,1,46).map(t=>seq(-pi,pi,64).slice(0,-1).map(a=>facePoint(a,t)));
  loft(faceRings,true,p=>[p[0]-cx,.22*(p[1]-1.14),p[2]-.128],skin,121);
  // The flame-resistant knit covers the cheeks and nose below the binocular opening.
  const balaclava=[.322,.344,.332],eyeAngles=seq(-pi,pi,62).slice(0,-1);
  const eyeBounds=a=>{const u=Math.min(1,Math.abs(a)/1.05),e=Math.sqrt(Math.max(0,1-u**6));
    return [.629-(.080+.025*Math.exp(-(((u-.48)/.34)**2))-.037*Math.exp(-((u/.19)**2)))*e,.629+.085*e];};
  const fabricBand=(lo,hi)=>{const rows=seq(0,1,12).map(v=>eyeAngles.map(a=>facePoint(a,lo(a)+(hi(a)-lo(a))*v,.0029)));
    loft(rows,true,p=>[p[0]-cx,(p[1]-1.15)*.30,p[2]-.123],balaclava,8);};
  fabricBand(()=>.007,a=>eyeBounds(a)[0]);fabricBand(a=>eyeBounds(a)[1],()=>.990);
  const eyelidA=seq(-1.05,1.05,32);
  for(const k of [0,1])line(eyelidA.map(a=>facePoint(a,eyeBounds(a)[k],.0032)),.0014,[.256,.270,.261],8,body,6);
  const detail=(pts,w,col)=>line(pts.map(([a,t])=>facePoint(a,t,.001)),w,col,121,body,7);
  for(let d of [-1,1]){
    const eye=(x,y)=>facePoint(d*(.407+x*.167),.625+.016*y+.002*x,.0016);
    const eyering=seq(0,2*pi,24).map(k=>eye(cos(k),sin(k)*(1-.18*Math.abs(cos(k)))));
    const center=eye(0,0);
    for(let k=1;k<eyering.length;k++)tri(center,eyering[k-1],eyering[k],[0,0,-1],[.522,.475,.419],121);
    tube(center,add(center,[0,0,-.0018]),.0037,[.166,.137,.107],121,body,14);
    line(seq(-1,1,13).map(x=>eye(x,Math.sqrt(1-x*x))),.00145,[.261,.182,.137],121,body,6);
    const brow=seq(-1,1,12),browPos=x=>facePoint(d*(.416+x*.184),.680+.012*(1-x*x)+.003*x,.0014);
    const browR=x=>.0007+.00155*Math.sqrt(Math.max(0,1-x*x));
    for(let k=1;k<brow.length;k++)tube(browPos(brow[k-1]),browPos(brow[k]),browR(brow[k-1]),[.291,.217,.165],121,body,7,browR(brow[k]));
    detail([[d*.050,.420],[d*.116,.425],[d*.168,.435]],.0015,[.326,.220,.172]);
    detail([[d*.27,.285],[d*.18,.289],[d*.07,.288],[0,.284]],.0017,[.399,.229,.190]);
  }
  form([[cx,1.004,.135],[cx+.007,1.048,.132],[cx+.009,1.087,.131]],[[.050,.046],[.054,.046],[.051,.042]],skin,121);
  }
  // Headliner and interior mirror are visible through the opening of the windshield.
  surface((u,v)=>{let p=roof(.96*u,v);p[1]-=.023;return p;},seq(-1,1,10),seq(-.18,1.32,13),[0,-1,0],headcloth,8);
  tube([0,1.377,-.169],[0,1.309,-.218],.0065,seal,2,body,10);
  const rv=(u,v,e=0)=>[u,1.293+v,-.224+e+.11*u-.08*v];
  const rvo=rect(-.091,-.026,.091,.026),rvi=rect(-.085,-.020,.085,.020);
  panel(null,rv,[0,0,1],[[rvo,.012,-.014,trim,2],[rvo,.013,.001,trim,2],[rvi,.009,.0015]],[[.496,.565,.563],4]);
  const rim=rounded(rvo,.012).map(uv=>rv(...uv,-.014)),rc=rv(0,0,-.018);
  for(let i=0;i<rim.length;i++)tri(rc,rim[i],rim[(i+1)%rim.length],[0,0,-1],trim,2);
  for(let s of [-1,1]){
    const p=cabin(s,-.550,.957);bar(p,add(p,[s*.086,-.006,-.008]),.035,.042,seal,2);
    const mirror=(u,v,e=0)=>[s*(.816+u),.992+v,-.547+e-u*.18];
    for(let k=0;k<5;k++){let c=cabin(s,-.550,.957);
      tube(add(c,[s*(.007+.009*k),.000,0]),add(c,[s*(.012+.009*k),.000,0]),.024,[.134,.139,.143],2,body,10);}
    const angles=seq(0,2*pi,40).slice(0,-1),levels=[[-.078,.42],[-.075,.62],[-.069,.81],[-.059,.92],[-.042,.986],[-.022,1],[.004,.987],[.008,.956]];
    const shell=levels.map(([e,r])=>angles.map(a=>{const u=Math.sign(cos(a))*Math.abs(cos(a))**.38,v=Math.sign(sin(a))*Math.abs(sin(a))**.48;
      return mirror(.081*u*r,.049*v*r,e);}));
    loft(shell,true,p=>[p[0]-s*.816,p[1]-.992,Math.min(0,p[2]+.601)],trim,2);
    const back=shell[0],cen=mirror(0,0,-.078);for(let i=0;i<back.length;i++)tri(cen,back[i],back[(i+1)%back.length],[0,0,-1],trim,2);
    const top=shell.at(-1),edge=angles.map(a=>mirror(.070*Math.sign(cos(a))*Math.abs(cos(a))**.38,.039*Math.sign(sin(a))*Math.abs(sin(a))**.48,.010)),center=mirror(0,0,.009);
    for(let i=0;i<edge.length;i++){const k=(i+1)%edge.length;
      face(top[i],top[k],edge[k],edge[i],[0,0,1],[.090,.098,.103],2);
      tri(center,edge[i],edge[k],[0,0,1],[.506,.584,.604],4);}
  }
  // Tyres have a rounded shoulder, four recessed circumferential grooves, and staggered tread sipes.
  for(let wi=0;wi<4;wi++){
    const g=wi+2,C=WHEEL_CENTERS[wi],s=Math.sign(C[0]);
    const wh=(a,r,ax)=>[C[0]+s*ax,C[1]+r*cos(a),C[2]+r*sin(a)];
    const rubberSection=[
      [-.077,.159],[-.085,.177],[-.085,.208],[-.081,.242],[-.075,.258],[-.066,.270],[-.058,.275],
      [-.044,.278],[-.040,.278],[-.038,.273],[-.035,.273],[-.033,.279],[-.019,.279],[-.017,.273],
      [-.014,.273],[-.012,.279],[.012,.279],[.014,.273],[.017,.273],[.019,.279],
      [.033,.279],[.035,.273],[.038,.273],[.040,.278],[.048,.277],[.058,.275],[.067,.269],
      [.075,.258],[.081,.240],[.085,.212],[.084,.192],[.084,.180],[.077,.169],[.073,.159]];
    const circle=seq(0,2*pi,72);
    function lathe(section,col,m,seg=72){
      const ang=seg===72?circle:seq(0,2*pi,seg);
      for(let j=1;j<section.length;j++) {
        const [x0,r0]=section[j-1],[x1,r1]=section[j],dr=r1-r0,dx=x1-x0;
        const normal=(a)=>norm([-s*dr,dx*cos(a),dx*sin(a)]);
        for(let k=1;k<ang.length;k++){
          const a=ang[k-1],b=ang[k],p=wh(a,r0,x0),q=wh(b,r0,x0),r=wh(b,r1,x1),t=wh(a,r1,x1);
          const na=normal(a),nb=normal(b);
          if(dot(cross(sub(q,p),sub(r,p)),na)>0){
            G.tri(p,q,r,col,m,g,na,nb,nb);G.tri(p,r,t,col,m,g,na,nb,na);
          }else {G.tri(p,r,q,col,m,g,na,nb,nb);G.tri(p,t,r,col,m,g,na,na,nb);}
        }
      }
    }
    lathe(rubberSection,rubber,7);
    lathe([[.083,.181],[.0857,.182],[.0857,.184],[.084,.186]],[.138,.139,.14],7);
    lathe([[.084,.201],[.0865,.202],[.0865,.204],[.085,.205]],[.128,.132,.132],7);
    const emboss=(text,angle,width,height)=>{
      const map=(x,y)=>{const radius=.226+y,aa=angle-s*x/.226,ax=.0855-(radius-.213)*.125;
        return wh(aa,radius,ax+.0013);};
      label(text,'bold 21px Arial',map,width,height,[.245,.248,.245],7,g);};
    emboss('RADIAL',-.45,.143,.022);emboss('165/70 R13',2.53,.164,.017);
    lathe([[.0826,.238],[.0833,.239],[.0827,.240]],[.176,.181,.180],7);
    for(let k=0;k<68;k++){
      const a=k*2*pi/68;
      if(k%17>5&&k%17<14){const p=wh(a,.242,.0818),q=wh(a+.009,.242,.0819),
        r=wh(a+.034,.258,.0758),t=wh(a+.022,.258,.0759);
        face(p,q,r,t,[s,.4*cos(a),.4*sin(a)],[.192,.195,.196],7,g);}
    }
    for(let k=0;k<61;k++){
      let a=k*2*pi/61;
      for(let ss of [-1,1]){
        const t=a+(ss>0?.035:0),p=wh(t,.260,.074*ss),q=wh(t+.022,.274,.060*ss),
          r=wh(t+.038,.278,.043*ss);
        face(p,wh(t+.008,.260,.074*ss),wh(t+.030,.274,.060*ss),q,[ss*.5,cos(t),sin(t)],dark,7,g);
        face(q,wh(t+.030,.274,.060*ss),wh(t+.044,.278,.043*ss),r,[0,cos(t),sin(t)],dark,7,g);
      }
    }
    // Pressed steel wheel beneath the apertures in the moulded EP hubcap.
    tube(wh(0,0,-.072),wh(0,0,.074),.168,darkMetal,4,g,56);
    tube(wh(0,0,.074),wh(0,0,.077),.159,[.122,.135,.142],4,g,56);
    lathe([[.080,.171],[.086,.174],[.091,.172],[.093,.165]],silver,4);
    const hubx=profile([[0,.113],[.023,.114],[.031,.112],[.045,.109],[.066,.105],[.084,.098],[.098,.095],[.112,.093],[.123,.0935],[.148,.102],[.157,.099],[.167,.092]]);
    lathe([[.093,.166],[.099,.157],[.098,.154]],[.606,.628,.639],42);
    const N=[s,0,0],count=15,da=2*pi/count,capColor=[.597,.621,.637];
    const hx=(a,r)=>hubx(r)+.0036*cos(a*count+.67)*Math.exp(-(((r-.130)/.018)**2));
    const rimPoint=(a,r,offset=0)=>{
      const dr=(hx(a,r+.0003)-hx(a,r-.0003))/.0006,da=(hx(a+.0007,r)-hx(a-.0007,r))/.0014/r;
      return [wh(a,r,hx(a,r)+offset),norm([s,-cos(a)*dr+sin(a)*da,-sin(a)*dr-cos(a)*da])];};
    const capTri=(a,b,c,tint)=>{if(dot(cross(sub(b[0],a[0]),sub(c[0],a[0])),N)<0)[b,c]=[c,b];
      G.tri(a[0],b[0],c[0],tint,42,g,a[1],b[1],c[1]);};
    for(let j=0;j<count;j++){
      const a=j*da+pi/2,rings=[[],[],[],[]],params=[[.371,.029,.0],[.255,.024,-.0018],[.218,.0195,-.0076],[.204,.018,-.0125]];
      const rim=[];
      for(let k=0;k<24;k++){const t=k*2*pi/24,dt=cos(t),dr=sin(t),sq=Math.max(Math.abs(dt),Math.abs(dr)),
        u=Math.sign(dt)*Math.abs(dt)**.65,v=Math.sign(dr)*Math.abs(dr)**.73;
        rim.push(rimPoint(a+da*.5*dt/sq,.1255+.0285*dr/sq));
        for(let h=0;h<4;h++){let [w,d,off]=params[h];rings[h].push(rimPoint(a+da*(w*u+.084*v),.126+d*v,off));}}
      let prev=rim;
      for(let h=0;h<4;h++){let next=rings[h],col=h===3?[.361,.386,.398]:h===2?[.474,.511,.530]:capColor;
        for(let k=0;k<24;k++){let l=(k+1)%24;capTri(prev[k],prev[l],next[l],col);capTri(prev[k],next[l],next[k],col);}prev=next;}
    }
    const cr=seq(.001,.098,30);lathe(cr.reverse().map(r=>[hubx(r),r]),capColor,42);
    for(let k=0;k<4;k++){
      let a=pi*.25+k*pi*.5,p=wh(a,.061,hubx(.061)+.0005);
      tube(add(p,[-s*.002,0,0]),add(p,[s*.002,0,0]),.0105,[.263,.278,.283],4,g,14);
      tube(add(p,[s*.002,0,0]),add(p,[s*.0035,0,0]),.0067,silver,4,g,6);
    }
    tube(wh(0,0,.110),wh(0,0,.112),.019,darkMetal,4,g,30);
    for(let k=0;k<5;k++){
      let y=(k-2)*.0050;
      bar([C[0]+s*.113,C[1]+y-.002,C[2]-.012],[C[0]+s*.113,C[1]+y+.003,C[2]+.012],.0025,.0025,chrome,4,g);
    }
  }
  // A portable aluminium ladder, with open channels at the ends and serrations on each rung.
  // The ladder overhangs each transverse roof bar. Webbing wraps under both bars.
  const ladderTop=1.611, length=2.63,mid=.28,z0=mid-length/2,z1=mid+length/2;
  for(let z of [-.083,.939]) {
    for(let s of [-1,1]) {
      let y=roofY(z)-.010;
      box([s*.576,y+.019,z],[.11,.054,.101],seal,2);
      const lip=cabin(s,z,roofY(z)-.011,.005);
      bar(lip,[s*.577,y+.042,z],.040,.078,trim,2);
      bar(cabin(s,z,roofY(z)-.019,.006),lip,.018,.081,darkMetal,4);
      bar([s*.613,y+.005,z],[s*.565,1.509,z],.051,.073,trim,2);
      box([s*.622,y+.011,z],[.022,.042,.074],darkMetal,4);
      tube([s*.629,y+.021,z],[s*.636,y+.021,z],.0105,silver,4,body,8);
    }
    box([0,1.519,z],[1.372,.036,.051],darkMetal,4);
    box([0,1.540,z],[1.284,.008,.046],seal,2);
    for(let s of [-1,1])box([s*.686,1.519,z],[.022,.038,.051],trim,2);
  }
  const rail=.253,bot=1.545,top=ladderTop,alum=[.745,.77,.776],edgeAl=[.848,.859,.864];
  for(let s of [-1,1]){
    // C sections: vertical web, inward flanges, rolled edges; hollow at both ends.
    box([s*rail,(bot+top)/2,mid],[.005,top-bot,length],alum,4);
    for(let y of [bot+.003,top-.003]){
      box([s*(rail-.016),y,mid],[.037,.006,length],edgeAl,4);
      box([s*(rail-.033),y+(y<1.60?.004:-.004),mid],[.003,.013,length],alum,4);
    }
    for(let y of [bot+.021,top-.020])bar([s*(rail+.0028),y,z0+.004],[s*(rail+.0028),y,z1-.004],.003,.004,edgeAl,4);
    for(let z of [z0,z1]){
      box([s*rail,(top+bot)/2,z],[.010,top-bot+.004,.018],[.125,.139,.145],2);
      for(let y of [bot+.003,top-.003])box([s*(rail-.015),y,z],[.040,.012,.018],[.125,.139,.145],2);
    }
  }
  for(let i=0;i<9;i++) {
    let z=z0+.147+i*(length-.294)/8,y=1.577;
    // The oval extrusion has a broad nonslip face. Filter its fine ribs in the surface shader.
    const section=16,ax=rail-.003,profile=[];
    for(let j=0;j<section;j++){
      const a=j*2*pi/section,ny=cos(a),nz=sin(a),yy=.017*Math.sign(ny)*Math.abs(ny)**.61,zz=.026*Math.sign(nz)*Math.abs(nz)**.61;
      const normal=norm([0,ny*.026,nz*.017]);
      profile.push([[-ax,y+yy,z+zz],[ax,y+yy,z+zz],normal,zz]);
    }
    for(let j=0;j<section;j++){
      const a=profile[j],b=profile[(j+1)%section];
      G.tri(a[0],b[0],b[1],alum,45,body,a[2],b[2],b[2],[0,a[3]],[0,b[3]],[1,b[3]]);
      G.tri(a[0],b[1],a[1],alum,45,body,a[2],b[2],a[2],[0,a[3]],[1,b[3]],[1,a[3]]);
    }
    for(let s of [-1,1]){
      const p=[s*(rail+.003),y,z];tube(p,add(p,[s*.002,0,0]),.012,[.56,.586,.59],4,body,12);
      tube(add(p,[s*.002,0,0]),add(p,[s*.003,0,0]),.0065,silver,4,body,8);
    }
  }
  // Textile ratchet straps with stitched borders loop over one rail and below the carrier.
  for(const z of [-.083,.939]){
    for(let s of [-1,1]){
      const route=[
        [s*.312,1.523,z-.028],[s*(rail+.009),top-.009,z-.024],[s*rail,top+.006,z-.017],
        [s*(rail-.036),top+.006,z-.012],[s*(rail-.042),top-.002,z-.011],[s*.161,1.552,z+.016],
        [s*.158,1.505,z+.023],[s*.170,1.496,z+.024],[s*.307,1.496,z-.019],[s*.312,1.523,z-.028]];
      const web=[.622,.286,.092];
      for(let i=1;i<route.length;i++){
        let p=route[i-1],q=route[i],w=[0,0,.014];G.quad(sub(p,w),add(p,w),add(q,w),sub(q,w),web,8,body);
        line([add(p,w),add(q,w)],.0014,[.413,.181,.064],8,body,4);
      }
      const buckle=[s*.276,1.579,z-.025];box(buckle,[.035,.024,.038],darkMetal,4);
      bar(add(buckle,[-.012,0,-.018]),add(buckle,[.014,.013,-.018]),.004,.004,chrome,4);
    }
  }
}
