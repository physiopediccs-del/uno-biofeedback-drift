// Spectator coordinates are lateral, vertical and forward. The grandstand faces -X.
function makeSpectators(){
  let seed=75219341;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const range=(a,b)=>a+(b-a)*random(),pick=a=>a[Math.floor(random()*a.length)];
  const pi=Math.PI, tau=pi*2, sin=Math.sin,cos=Math.cos,abs=Math.abs,exp=Math.exp;
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const factor=(a,s)=>[a[0]*s,a[1]*s,a[2]*s],mix=(a,b,t)=>add(a,factor(sub(b,a),t));
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=a=>factor(a,1/(Math.hypot(a[0],a[1],a[2])||1));
  const toWorld=p=>[-p[2],p[1],p[0]],tint=(c,t)=>[Math.min(c[0]*t,1),Math.min(c[1]*t,1),Math.min(c[2]*t,1)];
  // Bake the occluded solid angle of the nearby body volumes on each surface.
  // The clothing, hair and face keep their own orientation after a figure is posed.
  const queue=[],occluders=[];
  function volume(p,r){occluders.push([...toWorld(p),r*r]);}
  function mesh(rings,colors,base,n,mat=0,weights=null){queue.push([rings,colors,base,n,mat,weights]);}
  function emitMesh(rings,colors,base,n,mat,weights){
    const count=rings.length,ns=rings.map((row,j)=>row.map((p,k)=>{
      const u=sub(row[(k+1)%n],row[(k+n-1)%n]);
      const v=sub(rings[Math.min(j+1,count-1)][k],rings[Math.max(j-1,0)][k]);
      return norm(cross(u,v));
    }));
    for(let j=0;j<count;j++)for(let k=0;k<n;k++){
      const p=rings[j][k],nn=ns[j][k];let blocked=0;
      for(const o of occluders){
        const x=o[0]-p[0],y=o[1]-p[1],z=o[2]-p[2],rr=x*x+y*y+z*z;
        const dn=x*nn[0]+y*nn[1]+z*nn[2],horizon=.35*Math.sqrt(o[3]);
        if(dn<=-horizon || rr>o[3]*37)continue;
        const distance=Math.sqrt(rr+.00004);
        blocked+=Math.min(.93,o[3]/Math.max(.0002,rr))*Math.max(0,(dn+horizon)/distance)*.70;
      }
      const shade=.39+.61*Math.exp(-1.52*blocked),rgb=colors[j][k];
      rgb[0]*=shade;rgb[1]*=shade**1.06;rgb[2]*=shade**1.10;
    }
    for(let j=1;j<count;j++)for(let k=0;k<n;k++){
      const l=(k+1)%n,lo=rings[j-1],hi=rings[j],ln=ns[j-1],hn=ns[j];
      const a=colors?colors[j-1][k]:base,b=colors?colors[j-1][l]:base,c=colors?colors[j][l]:base,d=colors?colors[j][k]:base;
      const low=weights?weights[j-1]:null,high=weights?weights[j]:null;
      G.tri(lo[k],lo[l],hi[l],a,mat,0,ln[k],ln[l],hn[l],low,low,high,b,c);
      G.tri(lo[k],hi[l],hi[k],a,mat,0,ln[k],hn[l],hn[k],low,high,high,c,d);
    }
  }
  // Vertical lofts preserve the changing curvature of a chin, cheek, shoulders and shoe.
  function form(rows,n,color,shape=null,place=p=>p,mat=0,pigment=null){
    const rings=[],cols=[];
    for(let j=0;j<rows.length;j++){
      const row=rows[j],r=[],c=[];rings.push(r);cols.push(c);
      for(let k=0;k<n;k++){
        const a=k*tau/n,pt=[row[0]+row[3]*sin(a),row[1],row[2]+row[4]*cos(a)];
        const shade=shape?shape(pt,a,j,row):1;
        r.push(toWorld(place(pt)));c.push(tint(pigment?pigment(pt,a,j):color,shade));
      }
    }
    mesh(rings,cols,color,n,mat);
  }
  function bulb(p,rx,ry,rz,color,place,ns=8,mat=0){
    form([[-.004,-.97,.22],[-.004,-.72,.71],[0,-.23,.98],[0,.39,.93],[0,.84,.55],[0,1,.12]]
      .map(([x,y,r])=>[p[0]+x*rx,p[1]+y*ry,p[2],r*rx,r*rz]),ns,color,null,place,mat);
  }
  // Transport the section from joint to joint. The broad face of the wrist
  // stays in the plane of the hand when the arm crosses the body.
  function sleeve(rows,n,color,cloth=0,mat=0,axis=null,weights=null){
    const rings=[],cols=[];
    let right=axis;
    for(let j=0;j<rows.length;j++){
      const q=rows[j],p=q[0],t=norm(sub(rows[Math.min(rows.length-1,j+1)][0],rows[Math.max(j-1,0)][0]));
      const reference=right||[1,0,0],dot=reference[0]*t[0]+reference[1]*t[1]+reference[2]*t[2];
      right=abs(dot)<.986?norm(sub(reference,factor(t,dot))):norm(cross([0,0,1],t));
      const back=norm(cross(t,right)),pts=[],cs=[];
      for(let k=0;k<n;k++){
        const u=k*tau/n,fold=cloth*(.072*cos(3*u+j*.58)+.032*sin(5*u-j*.44));
        const bulge=(q[4]||0)*cos(2*u+.37*j);
        const offset=add(factor(right,q[1]*(1+fold+bulge)*cos(u)),factor(back,q[2]*(1+fold-bulge)*sin(u)));
        pts.push(toWorld(add(p,offset)));
        const light=(q[3]||1)*(1+.068*cloth*sin(j*1.66+u*2.8)+.020*cos(u*2+j*.27));
        cs.push(tint(color,light));
      }
      rings.push(pts);cols.push(cs);
    }
    mesh(rings,cols,color,n,mat,weights);
  }
  function palmAndFingers(wrist,direction,side,fold,skin,state){
    const dir=norm(direction),out=norm(cross(dir,abs(dir[1])>.82?[0,0,1]:[0,1,0]));
    // Thumb side faces inward for a relaxed hand and rotates up at the wheel or face.
    const az=side*(.42+.72*fold),nr=cross(dir,out),broad=add(factor(out,cos(az)),factor(nr,sin(az)));
    const pad=norm(cross(dir,broad)),point=(length,width,depth)=>add(wrist,add(factor(dir,length),add(factor(broad,width),factor(pad,depth))));
    const handWeight=rows=>rows.map(()=>[state,1]);
    const palm=[[point(0,0,0),.025,.014],[point(.018,side*.003,0),.029,.018],[point(.043,side*.004,-.002),.035,.021],[point(.069,-side*.001,-.003),.035,.014],[point(.078,0,-.005),.028,.010]];
    sleeve(palm,9,skin,0,120,broad,handWeight(palm));
    for(let j=0;j<4;j++){
      const across=side*(.023-j*.015),len=[.057,.067,.061,.048][j],r=[.0084,.0086,.0079,.0066][j];
      // Flex the finger at its three phalanges. The little finger folds
      // first; the index remains relatively straight around a camera body.
      const flex=.16+fold*(1.0+.11*j),prox=flex*.65,mid=prox+flex*.86,end=mid+flex*.54;
      const base=.073-.005*abs(j-1),spread=1+.18*(1-fold);
      const kx=base+len*.44*cos(prox),kz=-.003-len*.44*sin(prox);
      const dx=kx+len*.33*cos(mid),dz=kz-len*.33*sin(mid);
      const knuckle=point(base,across,-.002),middle=point(kx,across*spread,kz);
      const distal=point(dx,across*spread,dz),tip=point(dx+len*.23*cos(end),across*spread,dz-len*.23*sin(end));
      const finger=[[knuckle,r,r*.85],[middle,r*.90,r*.80],[distal,r*.65,r*.57],[tip,r*.25,r*.22]];
      sleeve(finger,5,skin,0,120,broad,handWeight(finger));
    }
    const thumb=[[point(.022,side*.022,.002),.014,.013],[point(.042,side*.041,-.004),.013,.011],
      [point(.061,side*(.053-fold*.009),-.015),.009,.008],[point(.070,side*(.054-fold*.016),-.022),.003,.004]];
    sleeve(thumb,6,skin,0,120,broad,handWeight(thumb));
    return point(.063,0,-.004);
  }
  function rod(a,b,r1,r2,col,n=7){G.cyl(toWorld(a),toWorld(b),r1,r2,n,col)}
  function strip(a,b,w,h,col){G.beam(toWorld(a),toWorld(b),w,h,col)}
  const skins=[[.77,.545,.43],[.68,.443,.311],[.85,.655,.515],[.51,.335,.248],[.409,.272,.205],[.66,.482,.362],[.83,.603,.469],[.561,.373,.264]];
  const hairs=[[.129,.096,.079],[.143,.136,.12],[.312,.223,.149],[.266,.16,.095],[.536,.427,.286],[.54,.53,.488],[.219,.181,.141]];
  const shirts=[[.235,.375,.497],[.489,.116,.096],[.217,.226,.232],[.701,.595,.390],[.359,.438,.232],[.165,.200,.304],[.709,.634,.553],[.477,.343,.499],[.630,.318,.200],[.252,.489,.483],[.341,.293,.211],[.433,.516,.568],[.800,.590,.190],[.853,.822,.758],[.085,.338,.270],[.731,.330,.130],[.178,.144,.121],[.429,.177,.252],[.108,.268,.474],[.594,.716,.674],[.655,.414,.421],[.306,.201,.134],[.613,.676,.736],[.387,.457,.396]];
  const trousers=[[.169,.205,.245],[.285,.336,.363],[.255,.271,.259],[.373,.343,.288],[.291,.245,.203],[.179,.20,.212],[.482,.465,.423],[.421,.482,.523],[.496,.390,.257],[.210,.235,.297]];
  function buildPerson(index,standing){
    const woman=index%5===1||index%5===3,age=index%9===2?.68:0,bulk=(index%9===0?range(1.14,1.23):index%6===4?range(.78,.90):range(.90,1.16))*(woman?.93:1);
    const tone=pick(skins),skin=[tone[0]*.97,tone[1]*1.025,tone[2]*1.055],hair=age>.5?pick(hairs.slice(-3)):pick(hairs),shirt=[.90,.90,.90],denim=pick(trousers);
    const trim=tint(shirt,.66),jacket=index%4===0,polo=index%6===2,cap=index%6===0||index%8===5,longHair=woman&&index%3!==2;
    // The pose is built from its supports. The pelvis rotates on the chair,
    // then the rib cage and head counter-rotate to keep a natural eye line.
    const sittingRoles=[7,2,10,5,8,0,9,4,7,11,6,3,8,7,5,2,10,1,0,9];
    const standingRoles=[12,0,6,5,4,12,1,0,11,6,12,3,0,5,4,12,10,0];
    const activity=standing?standingRoles[index-40]:sittingRoles[index%20];
    const l=standing?.79:0,posture=index%8,gesture=index;
    const bearing=(index%2?1:-1),lean=standing?(activity===12?.49:range(-.055,.125)):
      activity===7?range(.61,.80):activity===9?range(.83,.99):activity===2?range(.34,.54):activity===8?range(.27,.46):
      activity===10?range(-.29,-.17):activity===5?range(.29,.48):activity===11?range(.49,.69):range(.04,.31);
    const sideLean=activity===12?.157:activity===5||activity===11?.15:activity===6?-.13:range(-.092,.091);
    const torsoY=range(.94,1.055),twist=activity===5||activity===11?.39:activity===6?-.19:activity===2?.14:range(-.24,.24);
    const load=standing?(activity===12?.061:bearing*range(.044,.084)):sideLean*.26;
    const hemReach=bulk*(index%6===2?1.13:index%7===4?.88:1);
    function torsoP(p){
      const level=Math.min(1,Math.max(0,(p[1]-.088)/.40)),angle=level*twist;
      const ca=cos(angle),sa=sin(angle),x=p[0]*ca+p[2]*sa,z=p[2]*ca-p[0]*sa;
      const fore=lean*(.81+.19*level),spine=(p[1]-.094)*torsoY,sw=sideLean*(.66+.34*level);
      const y=spine*cos(fore)-z*sin(fore),forward=z*cos(fore)+spine*sin(fore);
      return [load+x*cos(sw)+y*sin(sw),l+.094+y*cos(sw)-x*sin(sw),forward+.018*level];
    }
    const hip=(x,y,z)=>[x,y+l,z],headBase=torsoP([0,.593,.014]);
    const yaw=activity===1?.061:activity===2||activity===3?.13:activity===5?.74:activity===11?.47:range(-.61,.61);
    const nod=activity===2?.46:activity===3?.43:activity===9?.07:activity===11?.42:activity===7?-.08:range(-.14,.12);
    const ca=cos(yaw),sa=sin(yaw);
    const skullWidth=range(.90,1.08),jawWidth=range(.87,1.11),faceHeight=range(.92,1.09),noseShape=range(.91,1.10);
    function head(p){
      const jaw=Math.max(0,1-p[1]/.121),x=p[0]*skullWidth*(1+jaw*(jawWidth-1)),h=p[1]*faceHeight,f=p[2]*noseShape;
      const y=h*cos(nod)-f*sin(nod),z=f*cos(nod)+h*sin(nod);
      return [headBase[0]+x*ca+z*sa,headBase[1]+y,headBase[2]+z*ca-x*sa];
    }
    volume(head([0,.117,-.012]),.082);volume(head([0,.060,.010]),.056);
    for(const [y,r] of [[.135,.099],[.271,.097],[.393,.118],[.479,.092]])volume(torsoP([0,y,0]),r*bulk);
    volume(torsoP([-.107*bulk,.46,.006]),.075*bulk);volume(torsoP([.107*bulk,.46,.006]),.075*bulk);
    const suit=(y,w,d,z=0)=>{const belly=exp(-(((y-.245)/.160)**2))*(hemReach-1);return [0,y,z+.039*belly,w*(bulk+.24*belly),d*(bulk+.66*belly)];};
    const style=index%9,hood=style===0||style===6,overshirt=style===3||style===7,tank=style===5,shift=range(-.19,.19);
    // Cloth bridges the rib cage, then gathers at the seated waist and at each armhole.
    const clothShape=(p,a,j)=>{
      const front=Math.max(cos(a),0),side=abs(sin(a)),y=p[1],x=p[0],underArm=exp(-(((y-.392)/.073)**2))*side**4;
      const pec=exp(-(((y-.407)/.087)**2)-(((abs(x)-.081)/.072)**2))*front;
      const hem=exp(-(((y-.168)/.059)**2)),apex=sin(4*a+y*20+.48*index);
      const gathers=.0071*apex+.0039*cos(7*a-y*28+index)+hem*.0073*cos(2*a+y*72);
      p[0]+=(gathers-.012*underArm+pec*.002)*sin(a);
      p[2]+=(gathers+(woman?.039:.019)*pec-.012*underArm)*cos(a);
      p[1]+=.006*cos(2*a+shift*8+y*8)+hem*.0035*sin(5*a+.3*index);
      const neckShadow=exp(-(((y-.515)/.067)**2)-((x/.091)**2))*front;
      const underBust=exp(-(((y-.366-.013*abs(sin(a)))/.027)**2))*front*front;
      return .96-.25*underArm-.28*neckShadow-.073*underBust+.108*apex+.063*cos(7*a-y*28+index)+.051*cos(a-y*10);
    };
    form([suit(.018,.112,.092),suit(.037,.148,.114),suit(.075,.158,.121),suit(.125,.152,.113),suit(.155,.143,.109)],12,denim,clothShape,torsoP);
    const torso=[suit(.107,.157,.126),suit(.119,.162,.127),suit(.138,.151,.116),suit(.156,.157,.118),suit(.191,.148,.105),
      suit(.235,.142,.104),suit(.32,woman?.145:.162,.119,.007),suit(.388,.176,.121,.006),suit(.451,.184,.127,.004),
      suit(.493,woman?.174:.197,.119),suit(.518,woman?.168:.187,.103),suit(.536,.146,.085),suit(.549,.088,.061),suit(.540,.061,.051)];
    const jersey=144+index%8;
    form(torso,22,shirt,(p,a,j)=>{
      const folds=clothShape(p,a,j);
      if(index%11===4 || index%11===8){
        const band=j===4||j===8||j===10;
        return folds*(band?1.36:.88);
      }
      return folds;
    },torsoP,jersey);
    // A raised collar casts a distinct return shadow on the neck.
    const collar=[suit(.524,.090,.073,.005),suit(.539,.088,.068,.006),suit(.557,.073,.061,.005)];
    form(collar,17,tint(shirt,.77),(p,a,j)=>{p[1]-=(.015+.010*(jersey===145))*Math.max(0,cos(a));return .78+.10*j+.08*cos(a*2);},torsoP,115);
    if(hood){
      const hoodRing=[suit(.451,.125,.083,-.063),suit(.469,.153,.091,-.058),suit(.497,.142,.090,-.050),suit(.529,.113,.076,-.046),suit(.555,.077,.064,-.038)];
      form(hoodRing,15,tint(shirt,.83),(p,a,j)=>{p[1]+=.017*sin(a)*sin(a)-.021*cos(a);return .78+.16*cos(a*3+j*.47)+.08*j/4;},torsoP,115);
      for(const side of [-1,1])rod(torsoP([side*.048,.512,.082]),torsoP([side*.051,.414+.019*side,.135]),.0027,.0023,[.604,.576,.485],5);
    }
    if(overshirt || index%10===9){
      // An unbuttoned overshirt exposes a separate cotton layer. Its curved
      // edges follow the rib cage, with a fuller opening at the waist.
      const cotton=[[.731,.690,.598],[.268,.295,.275],[.796,.792,.741],[.338,.402,.452]][index%4];
      let previous=null,previousEdge=null;
      for(let j=0;j<torso.length-1;j++){
        const [xx,y,z,w,depth]=torso[j],upper=Math.max(0,(y-.36)/.20);
        const opening=(.29+.23*upper+.19*Math.cos((y-.09)*8))*(index%2?1.25:.87);
        const center=.071*Math.sin(y*6+index),row=[],edges=[];
        for(let i=0;i<9;i++){
          const side=i/4-1,a=center+side*opening;
          const makePoint=(ang,extra)=>{
            const q=[xx+w*sin(ang),y,z+depth*cos(ang)];clothShape(q,ang,j);q[2]+=extra;
            return toWorld(torsoP(q));
          };
          row.push(makePoint(a,.008+.003*(1-side*side)));
          if(i===0||i===8)edges.push([makePoint(a-side*.044,.013),makePoint(a+side*.048,.018)]);
        }
        if(previous){
          for(let k=1;k<row.length;k++)G.quad(previous[k-1],previous[k],row[k],row[k-1],tint(cotton,.75+.15*j/torso.length+.055*cos(j*.8)),0);
          for(let d=0;d<2;d++)G.quad(previousEdge[d][0],previousEdge[d][1],edges[d][1],edges[d][0],tint(shirt,d?.66:.81),115);
        }
        previous=row;previousEdge=edges;
      }
      for(const side of [-1,1]){
        const lapel=[[side*.067,.542,.045],[side*.130,.509,.087],[side*.072,.430,.145],[side*.037,.485,.128]];
        G.quad(...lapel.map(q=>toWorld(torsoP(q))),tint(shirt,1.02),115);
      }
    }
    if(index%10===2 || index%12===7){
      const bag=pick([[.318,.369,.256],[.188,.231,.266],[.552,.359,.211]]);
      form([[0,.133,-.143,.085,.051],[0,.165,-.155,.130,.078],[0,.251,-.158,.147,.080],
        [0,.350,-.148,.148,.079],[0,.423,-.145,.134,.065],[0,.472,-.131,.081,.044]],
        13,bag,(p,a,j)=>.86+.051*j+.082*cos(a*3+j*.5),torsoP);
      for(const d of [-1,1]){
        const strap=[[d*.124,.381,-.158],[d*.137,.498,-.074],[d*.113,.527,.033],
          [d*.103,.451,.120],[d*.112,.364,.111],[d*.151,.234,.037],[d*.131,.204,-.101]];
        for(let j=1;j<strap.length;j++)strip(torsoP(strap[j-1]),torsoP(strap[j]),.032,.014,tint(bag,.66));
      }
    }
    if(index%7===2 || index%13===4){
      const strap=tint(denim,.73),points=[[.111,.533,.083],[.067,.441,.128],[-.036,.303,.122],[-.140,.162,.074]];
      for(let j=1;j<points.length;j++)strip(torsoP(points[j-1]),torsoP(points[j]),.033,.013,strap);
      form([[-.113,.087,.123,.055,.034],[-.113,.110,.139,.071,.039],[-.113,.159,.142,.073,.040],[-.113,.180,.126,.058,.036]],
        8,tint(denim,1.40),null,torsoP);
    }
    form([suit(.535,.062,.056),suit(.551,.065,.054),suit(.568,.055,.049),suit(.584,.050,.047),suit(.624,.055,.050,.009)],9,skin,
       (p,a,j)=>.73+.045*j+.072*cos(a),torsoP,120);
    if(jacket){
      for(const d of [-1,1]){
        const a=torsoP([d*.058,.533,.056]),b=torsoP([d*.016,.437,.126]),c=torsoP([d*.095,.489,.101]);
        G.tri(toWorld(a),toWorld(b),toWorld(c),tint(shirt,1.16),115);
      }
      const a=torsoP([0,.131,.121]),b=torsoP([0,.308,.123]),c=torsoP([0,.445,.134]);
      rod(a,b,.004,.003,trim,4);rod(b,c,.003,.004,trim,4);
    }else if(polo){
      for(const d of [-1,1]){const a=torsoP([d*.042,.545,.047]),b=torsoP([d*.060,.487,.105]),c=torsoP([d*.091,.526,.079]);
        G.tri(toWorld(a),toWorld(b),toWorld(c),tint(shirt,.63),115);}
    }else if(index%7===3){
      for(const y of [.343,.369])form([suit(y,.169,.125,.007),suit(y+.011,.173,.127,.007)],13,tint(shirt,1.46),null,torsoP,115);
    }
    const headRows=[[0,0,.015,.035,.036],[0,.014,.018,.055,.055],[0,.037,.008,.068,.071],[0,.068,.004,.077,.076],
      [0,.092,.006,.080,.078],[0,.112,.005,.079,.081],[0,.126,.002,.081,.084],[0,.146,.0,.083,.085],
      [0,.173,-.003,.083,.084],[0,.202,-.006,.075,.075],[0,.226,-.006,.051,.055],[0,.238,-.005,.018,.025]];
    const maturity=index%7===2 || index%12===6,truncJaw=woman?.83:1.07;
    const beard=!woman&&(index%7===2||index%6===1),stubble=!woman&&index%4!==0;
    const cheekBone=.009+(index%5)*.0021,noseReach=.97+(index%6)*.059;
    const anatomy=(p,a,j)=>{
      const front=Math.max(0,cos(a)),x=abs(p[0]),y=p[1];
      const jawShape=exp(-(((y-.044)/.039)**2)),cheekWide=exp(-(((y-.094)/.024)**2));
      p[0]*=1.+(truncJaw-1)*jawShape+.045*cheekWide;
      p[2]+=front*(.010*exp(-(((y-.029)/.024)**2)-((x/.036)**2))
        +cheekBone*exp(-(((x-.050)/.028)**2)-(((y-.098)/.022)**2))
        +.008*exp(-(((x-.037)/.027)**2)-(((y-.148)/.014)**2))
        -.008*jawShape*exp(-(((x-.058)/.017)**2)));
      p[2]+=front*(.012*exp(-((x-.045)**2/.00040+(y-.089)**2/.00031))-.013*exp(-((x-.032)**2/.00029+(y-.124)**2/.00009))
        +.011*exp(-((x-.029)**2/.00031+(y-.147)**2/.00008))+.007*exp(-((x-.003)**2/.00042+(y-.025)**2/.00011)));
      const zone=(xc,yc,wx,wy)=>exp(-(((x-xc)/wx)**2)-(((y-yc)/wy)**2));
      // One continuous surface runs from the brow, along the nasal bridge,
      // around each ala and into the philtrum; its profile changes with age.
      const bridge=zone(.002,.109,.012,.034),tip=zone(0,.084,.015,.013),nostril=zone(.014,.078,.009,.009);
      const smile=zone(.020+.30*(.077-y),.062,.005,.021),philtrum=zone(.006,.062,.005,.011);
      p[2]+=front*(.025*bridge+noseReach*.034*tip+.018*nostril-.0035*smile+.002*philtrum);
      p[1]-=.0028*noseReach*tip;

      const orbit=zone(.031,.124,.023,.016),lowerLid=zone(.032,.105,.022,.010),underNose=zone(.011,.070,.016,.009);
      const temple=zone(.068,.132,.015,.040),underLip=zone(.012,.040,.019,.010),jaw=zone(.063,.030,.018,.020);
      const cheek=zone(.049,.092,.025,.017),brow=zone(.032,.147,.022,.012);
      return .94+.043*front+.025*sin(2*a)+front*(-.30*orbit-.17*underNose-.12*underLip-.10*temple-.09*jaw+.105*cheek+.098*brow+.090*lowerLid);
    };
    // Piecewise cubic meridians round the chin into the masseter and
    // temple. Concentrate samples around the eyes and the root of the nose.
    const cheekRows=[];
    for(let i=0;i<headRows.length-1;i++){
      const a=headRows[Math.max(0,i-1)],b=headRows[i],c=headRows[i+1],d=headRows[Math.min(headRows.length-1,i+2)];
      for(let k=0;k<2;k++){
        const t=k*.5;
        const r=b.map((v,axis)=>axis===1?v+(c[axis]-v)*t:
          v+.5*t*(c[axis]-a[axis]+t*(2*a[axis]-5*v+4*c[axis]-d[axis]+t*(3*v-3*c[axis]+d[axis]-a[axis]))));
        cheekRows.push(r);
      }
    }
    function complexion(p,a){
      const x=abs(p[0]),y=p[1],front=Math.max(0,cos(a));
      const at=(px,py,sx,sy)=>exp(-(((x-px)/sx)**2)-(((y-py)/sy)**2));
      const flush=(.078*at(.055,.097,.034,.026)+.068*at(0,.081,.019,.023))*front;
      const eye=front*at(.034,.120,.030,.014);
      const moustache=front*at(.011,.061,.024,.008);
      const low=Math.max(0,Math.min(1,(.067+.43*x-.004*sin(a*5)-y)/.024));
      const hairLine=beard?.70*low+.50*moustache:stubble?.19*low+.18*moustache:0;
      const base=[skin[0]*(1.+flush-.12*eye),skin[1]*(1.-.50*flush-.18*eye),skin[2]*(1.-.66*flush-.14*eye)];
      const lip=front*at(.008,.050,.024,.007);
      base[1]*=1.-.12*lip;base[2]*=1.-.089*lip;
      return mix(base,hair,Math.min(.81,hairLine));
    }
    cheekRows.push(headRows.at(-1));
    const rings=[],colors=[],faceSegments=34;
    for(let j=0;j<cheekRows.length;j++){
      const r=cheekRows[j],circle=[],pigment=[];
      for(let k=0;k<faceSegments;k++){
        const phase=k*tau/faceSegments,a=phase-.54*sin(phase);
        const q=[r[0]+r[3]*sin(a),r[1],r[2]+r[4]*cos(a)],shade=anatomy(q,a,j);
        circle.push(toWorld(head(q)));pigment.push(tint(complexion(q,a),shade));
      }
      rings.push(circle);colors.push(pigment);
    }
    mesh(rings,colors,skin,faceSegments,120);
    for(const d of [-1,1]){
      bulb([d*.081,.100,-.002],.014,.027,.014,tint(skin,.88),head,7);
      const browTone=tint(hair,.77),sclera=mix(skin,[.631,.604,.557],.51);
      // Model the visible cornea as a single lens. The two eyelids
      // meet at the canthi, and the iris remains round inside the almond opening.
      const pupil=[.093,.086,.071],iris=mix(hair,[.299,.244,.176],.34),tear=mix(skin,[.48,.25,.20],.36);
      const eyeTint=[pupil,iris,sclera,tear],cx=d*.033,cy=.123,gaze=.0026*sin(index*2.61);
      const eyeC=(frac,k)=>{
        const a=k*tau/12,x=cos(a),y=sin(a),r=frac===0?.0027:frac===1?.0063:frac===2?.017:.019;
        const height=frac===0?.003:frac===1?.0052:frac===2?.0061:.0079;
        return toWorld(head([cx+x*r+(frac<2?gaze:0),cy+height*y-.0011*d*x,
          .081-.0045*x*x*frac/3-.0020*y*y-.0018*frac]));
      };
      for(let k=0;k<12;k++){
        const j=(k+1)%12;G.tri(toWorld(head([cx+gaze,cy,.082])),eyeC(0,k),eyeC(0,j),pupil,120);
        for(let q=0;q<3;q++)G.quad(eyeC(q,k),eyeC(q+1,k),eyeC(q+1,j),eyeC(q,j),eyeTint[q+1],120);
      }
      const eyebrow=[[d*.012,.141,.086],[d*.026,.145,.090],[d*.042,.143,.084],[d*.058,.134,.073]];
      for(let j=1;j<eyebrow.length;j++)rod(head(eyebrow[j-1]),head(eyebrow[j]),.0053-.00085*j,.0042-.00064*j,browTone,7);
      rod(head([d*.015,.124,.077]),head([d*.036,.127,.079]),.0014,.0016,tint(skin,.52),6);
      rod(head([d*.036,.127,.079]),head([d*.049,.123,.073]),.0016,.0011,tint(skin,.52),6);
      if(index%10===3){bulb([d*.037,.124,.081],.028,.016,.008,[.098,.125,.126],head,10);rod(head([d*.058,.126,.077]),head([d*.082,.127,-.003]),.003,.002,trim);}
    }
    for(const d of [-1,1]){
      const a=head([d*.009,.074,.104]),b=head([d*.017,.074,.100]);
      rod(a,b,.0020,.0011,tint(skin,.40),6);
    }
    for(const d of [-1,1]){
      rod(head([0,.051,.086]),head([d*.019,.052,.084]),.0024,.0016,tint(skin,.42),7);
      rod(head([d*.019,.052,.084]),head([d*.030,.048+(index%3)*.0015,.073]),.0017,.0011,tint(skin,.48),6);
    }
    const lip=[skin[0]*.75,skin[1]*.61,skin[2]*.66];
    form([[0,.046,.073,.011,.005],[0,.049,.077,.024,.007],[0,.052,.078,.023,.006],[0,.055,.077,.013,.005]],10,lip,null,head,120);
    const bald=!woman&&!cap&&index%6===4,hairStyle=index%7,hairline=(p,a,j)=>{
      if(j===0){
        const face=Math.max(cos(a),0),temple=Math.max(0,1-abs(Math.abs(Math.atan2(sin(a),cos(a)))-1.37)/.43);
        p[1]=.147+.027*face-.097*Math.pow((1-cos(a))*.5,.85)+.011*cos(a*3+index)-.034*temple;
        if(bald)p[1]+=.077*(.42+.58*face);
      }
      if(bald&&j>0)p[1]=.220+.027*j/5;
      p[0]+=.002*sin(a*7+index)*sin(a);p[2]+=.003*sin(a*8+index)*cos(a);
      return .87+.12*cos(a*3.0+.36*j)+.08*sin(a*6+j);
    };
    form([[0,.142,-.006,.085,.089],[0,.177,-.007,.088,.089],[0,.210,-.008,.079,.082],[0,.234,-.011,.058,.063],[0,.248,-.012,.024,.026],[0,.249,-.012,.003,.004]],
      15,cap?tint(shirt,.68):hair,hairline,head,cap?115:0);
    if(!cap && !bald && hairStyle!==2 && hairStyle!==6){
      const part=index%2?1:-1;
      for(let k=0;k<6;k++){
        const ang=part*(.18+k*.24),x=sin(ang)*.081,z=cos(ang)*.084-.002;
        const top=.195+.026*cos(ang*1.4),drop=(!longHair?.033:.058)*(.76+.24*sin(k*2.7+index));
        const strand=[[x-part*.014,top-drop,z+.002,.0026,.0025],[x-part*.008,top-drop*.57,z+.004,.011,.0044],[x,top,z,.015,.0065],[x*.88,top+.017,z*.92,.009,.006]];
        form(strand,7,tint(hair,.89+.10*sin(k*5)),null,head);
      }
      if(longHair){
        for(const side of [-1,1]){
          const low=side===part?range(-.038,.012):range(.050,.083);
          const cheekLock=[
            [side*.077,low,.006,.007,.014],[side*.078,low+.013,.009,.017,.025],[side*.084,.073,.014,.018,.031],
            [side*.080,.118,.014,.018,.037],[side*.077,.160,.018,.018,.040],[side*.068,.194,.011,.023,.033]
          ];
          form(cheekLock,9,tint(hair,.94),(p,a,j)=>.96+.12*sin(a*4+j*.32+side),head);
        }
      }
    }
    if(!cap&&!bald&&(hairStyle===2||hairStyle===6)){
      // One connected crown has overlapping lobes and an asymmetric nape.
      const curlRows=[[0,.143,-.012,.091,.099],[0,.159,-.013,.098,.105],[.003,.181,-.012,.104,.113],
        [.003,.208,-.014,.099,.104],[0,.232,-.015,.083,.093],[-.003,.251,-.013,.057,.063],[-.003,.265,-.013,.015,.022]];
      form(curlRows,32,hair,(q,a,j)=>{
        const coil=.008*sin(a*10+j*1.15)+.004*cos(a*13-j*.7),front=Math.max(0,cos(a));
        q[0]+=sin(a)*coil;q[2]+=cos(a)*coil;q[1]+=.005*cos(9*a+j*.87)-(1-front)*.056*(1-j/6)+.034*front*(1-j/6);
        return .82+.19*sin(10*a+j)+.13*cos(13*a-j*.64);
      },head);
    }
    if(!cap&&!bald&&(hairStyle===1||hairStyle===4)){
      // Locks overlap the hairline with different partings, temple lengths and crowns.
      for(let k=0;k<11;k++){
        const a=(k+.29*sin(k*2.32))*tau/11,front=cos(a),h=range(.014,.043);
        const px=.073*sin(a),pz=.080*front-.008,top=.198+.016*cos(a*2+index);
        bulb([px,top,pz],range(.014,.028),h,range(.019,.028),tint(hair,range(.83,1.20)),head,7);
      }
    }
    if(cap){
      form([[0,.171,.073,.081,.053],[0,.177,.080,.078,.057],[0,.182,.078,.071,.053]],12,tint(shirt,.60),null,head,115);
      bulb([0,.248,-.003],.010,.007,.010,trim,head,6,115);
    }else if(index%8===3){
      const hat=pick([[.666,.566,.389],[.501,.449,.365],[.393,.439,.389]]);
      form([[0,.153,0,.124,.123],[0,.158,.001,.130,.132],[0,.174,-.005,.090,.097],[0,.218,-.004,.081,.086],[0,.229,-.006,.068,.070]],
        16,hat,(p,a,j)=>{p[1]+=.009*sin(a+.22)*(j<2?1:.12);return .82+.15*Math.max(0,cos(a));},head);
    }else if(longHair){
      const long=range(-.062,.046);
      form([[0,long,-.034,.074,.043],[0,long+.025,-.039,.086,.052],[0,.080,-.047,.089,.052],[0,.128,-.050,.087,.051],[0,.178,-.046,.081,.045]],13,hair,(p,a,j)=>.90+.12*sin(a*8+.3*j),head);
      if(hairStyle%2===0)bulb([0,.101,-.109],.039,.070,.038,tint(hair,.88),head);
    }else if(index%6===2){
      form([[0,.006,.018,.043,.042],[0,.016,.018,.053,.057],[0,.037,.008,.070,.073],[0,.058,.007,.073,.070]],12,tint(hair,1.14),(p,a,j)=>.75+.18*cos(a),head);
    }
    const shoeColor=pick([[.267,.245,.216],[.177,.194,.204],[.424,.406,.358],[.525,.509,.459],[.670,.650,.592],[.657,.656,.630]]);
    const sole=tint(shoeColor,.53),sleeved=hood||overshirt||style===2;
    const shorts=index%8===2||index%9===4,skirt=woman&&(index%6===1||index%6===5);
    if(skirt){
      const hem=standing?-.217:-.002;
      const rows=standing?
        [suit(hem,.183,.146,.0),suit(hem+.019,.181,.145,.0),suit(-.111,.178,.134,.0),suit(.024,.158,.122),suit(.111,.137,.105)]:
        [suit(hem,.124,.083,.229),suit(.019,.179,.154,.152),suit(.047,.184,.191,.123),suit(.069,.180,.168,.102),suit(.09,.163,.132,.048),suit(.132,.147,.114)];
      form(rows,20,tint(denim,1.29),(p,a,j)=>{
        const pleat=(.011*sin(8*a+.32*j)+.006*cos(4*a-j*.38))*(1-j/(rows.length+1));
        p[0]+=pleat*sin(a);p[2]+=pleat*cos(a);return .87+.15*Math.cos(8*a+.32*j)+.035*j;
      },torsoP);
    }
    const stagger=range(-.065,.071),joints=[],hands=[];
    for(const d of [-1,1]){
      const hipP=hip(d*.089+load,.086+load*d*.11,-.005),knee=standing?[d*.102,.445,d*.038+stagger]:[d*range(.105,.154),.062+range(-.016,.027),range(.325,.392)];
      const ankle=standing?[d*range(.102,.178),.076,stagger+d*.061]:[d*range(.105,.167),-.349,
        Math.min(.40,knee[2]+range(-.072,.025)+(posture%3===0?.092*d:0))];
      if(standing){
        const loaded=d===bearing;
        knee[0]=d*(loaded?.104:.129)+load*.88;
        knee[1]=loaded?.450:.417;knee[2]+=(loaded?-.039:.095);
        ankle[0]=loaded?load+d*.105:d*.201+load*.38;
        ankle[2]+=(loaded?-.046:.145);
      }else if(activity===8&&d>0){
        // External rotation of the hip rests one ankle on the opposite thigh.
        knee[0]=.306;knee[1]=.157;knee[2]=.170;
        ankle[0]=-.094;ankle[1]=.152;ankle[2]=.224;
      }else if(activity===7||activity===9){
        knee[0]=d*(activity===7?.153:.170);knee[1]=.079+(d>0?.015:0);
        knee[2]=.347+(d>0?.051:0);ankle[0]=knee[0]+d*.024;ankle[2]=knee[2]-(d<0?.126:.054);
      }else if(activity===10){
        knee[0]=d*.103+.064;knee[2]=.337;ankle[0]=d*.088+.079;ankle[2]=.48+(d>0?.053:-.103);
      }else if(activity===5||activity===11){
        knee[0]+=.081;ankle[0]+=.093;ankle[2]-=d*.076;
      }else{ankle[2]-=d*.073+.041;}
      volume(mix(hipP,knee,.34),.077);volume(mix(hipP,knee,.77),.060);volume(mix(knee,ankle,.38),.044);
      const thigh1=mix(hipP,knee,.27),thigh2=mix(hipP,knee,.72),shin=mix(knee,ankle,.106);
      const pantRows=[[hipP,.083,.096],[thigh1,.094,.096],[thigh2,.073,.079],[knee,.069,.067],[shin,.057,.058],
        [add(mix(knee,ankle,.29),[d*.005,0,-.010]),.065,.064],[add(mix(knee,ankle,.63),[0,0,-.009]),.047,.051],[mix(knee,ankle,.82),.038,.041],[mix(knee,ankle,.93),.043,.042,.87],[ankle,.043,.044,.91]];
      if(shorts||skirt){
        const skinRows=[[mix(hipP,knee,.46),.073,.070],[thigh2,.060,.059],[mix(hipP,knee,.91),.054,.052],
          [knee,.057,.054],[shin,.047,.045],[mix(knee,ankle,.29),.050,.051],[mix(knee,ankle,.48),.046,.046],
          [mix(knee,ankle,.75),.036,.033],[mix(knee,ankle,.93),.030,.027],[ankle,.033,.026]];
        sleeve(skinRows,11,skin,0,120);
        if(!skirt){
          const hemAt=mix(hipP,knee,.70);sleeve([pantRows[0],pantRows[1],[mix(hipP,knee,.54),.078,.077],[hemAt,.075,.073],[mix(hipP,knee,.73),.072,.070,.78]],12,denim,1);
        }
      }else sleeve(pantRows,10,denim,1);
      const shoeY=ankle[1]-.074,sy=.34*sin(index*.65+d),shoeP=p=>[p[0]*cos(sy)+p[2]*sin(sy)+ankle[0],p[1]+shoeY,p[2]*cos(sy)-p[0]*sin(sy)+ankle[2]];
      form([[0,.005,.044,.047,.109],[0,.018,.045,.050,.112],[0,.030,.045,.051,.111]],9,sole,null,shoeP);
      form([[0,.025,.043,.050,.112],[0,.046,.039,.051,.106],[0,.061,.028,.047,.088],[0,.078,.005,.039,.061],[0,.090,-.005,.032,.036]],9,shoeColor,(p,a,j)=>.92+.04*j,shoeP);
      const sh=torsoP([d*(woman?.154:.171)*bulk,.483,.007]);
      let wrist,pole,rest=null;
      if(activity===1){wrist=head([d*.082,.071,d<0?.102:.169]);pole=add(sh,[d*.070,-.198,.131]);}
      else if(activity===2){wrist=torsoP([d*.123,.198+d*.017,.249]);pole=add(sh,[d*.043,-.222,.057]);}
      else if(activity===3){wrist=d>0?torsoP([.055,.286,.290]):standing?torsoP([-.125,.074,.060]):add(knee,[-.008,.068,.012]);pole=add(sh,[d*.036,-.235,.089]);}
      else if(activity===4){wrist=d>0?torsoP([.044,.199,.164]):torsoP([.040,.270,.171]);pole=add(sh,[d*.054,-.236,.024]);}
      else if(activity===12){
        // The landing rail runs across the body. Both forearms settle
        // on its top, with the hands falling over its track-facing edge.
        rest=[d*(d>0?.174:.157),.992,.206];
        wrist=add(rest,factor(norm([-d*(d>0?.36:.59),-.27,.89]),.226));pole=rest;
      }else if(activity===7||activity===9){
        // Place the sleeve directly onto its thigh. Forearms converge with
        // gravity; one wrist drops through the space between the knees.
        rest=[knee[0]+d*.004,knee[1]+.097,knee[2]-(activity===7?.148:.101)];
        // Slide the contact along the upper leg until the humerus has its
        // resting length. The elbow can lie farther back on a deeper crouch.
        const armLength=(woman?.254:.271)*(1.+.027*sin(index+d));
        const dx=rest[0]-sh[0],dy=rest[1]-sh[1];
        const span=Math.sqrt(Math.max(0,armLength*armLength-dx*dx-dy*dy));
        const back=sh[2]-span,front=sh[2]+span,lo=hipP[2]+.035,hi=knee[2]+.020;
        const chooseFront=front<=hi && (back<lo || abs(front-rest[2])<abs(back-rest[2]));
        rest[2]=Math.max(lo,Math.min(hi,chooseFront?front:back));
        const dir=activity===9&&d>0?norm([-.43,.58,.62]):norm([-d*.44,-.28-d*.14,.86]);
        wrist=add(rest,factor(dir,range(.221,.241)));pole=rest;
      }else if(activity===8){
        wrist=d>0?[-.012,.212,.201]:[-.098,.181,.242];pole=add(sh,[d*.063,-.239,.018]);
      }else if(activity===10&&!standing){
        wrist=d>0?[.218,.004,-.102]:add(knee,[.006,.068,-.096]);pole=add(sh,[d*.069,-.226,-.061]);
      }else if(activity===5||activity===11){
        const open=activity===5&&d>0;
        wrist=open?torsoP([.261,.252,.211]):standing?torsoP([d*.131,.075,.063]):add(knee,[-d*.014,.072,-.043]);
        pole=add(sh,[d*(open?.098:.052),-.220,.019]);
      }else if(activity===6){
        wrist=d<0?torsoP([-.099,.418,.109]):standing?torsoP([.161,.148,.044]):add(knee,[.012,.065,-.051]);pole=add(sh,[d*.072,-.206,.036]);
      }else if(standing){
        const pocket=(index+d)%3===0;wrist=pocket?torsoP([d*.137,.116,.065]):add(sh,[d*.044,-.437,.055]);
        pole=add(sh,[d*.046,-.228,-.018]);
      }else{
        wrist=add(knee,[-d*(index%2?.051:.015),.072,-.070]);pole=add(sh,[d*.026,-.221,.070]);
      }
      const upper=range(.252,.279)*(woman?.97:1),lower=range(.219,.242)*(woman?.97:1);
      const aim=norm(sub(wrist,sh)),reach=Math.max(.135,Math.min(upper+lower-.006,Math.hypot(...sub(wrist,sh))));
      const hand=rest?wrist:add(sh,factor(aim,reach));
      const elbowAxis=sub(pole,sh),projection=elbowAxis[0]*aim[0]+elbowAxis[1]*aim[1]+elbowAxis[2]*aim[2];
      let bend=sub(elbowAxis,factor(aim,projection));
      if(Math.hypot(...bend)<.035)bend=[d*.068,-.017,-.066];
      bend=norm(sub(bend,factor(aim,bend[0]*aim[0]+bend[1]*aim[1]+bend[2]*aim[2])));
      const along=(upper*upper-lower*lower+reach*reach)/(2*reach);
      const elbow=rest||add(add(sh,factor(aim,along)),factor(bend,Math.sqrt(Math.max(0,upper*upper-along*along))));
      volume(mix(sh,elbow,.24),.058);volume(mix(sh,elbow,.71),.046);volume(mix(elbow,hand,.29),sleeved?.054:.043);volume(mix(elbow,hand,.70),sleeved?.044:.031);
      joints.push([sub(hand,sh),sub(elbow,sh),sub(knee,hipP)]);
      volume(hand,.028);
      const fore=norm(sub(hand,elbow)),upAxis=norm(sub(elbow,sh)),muscle=range(.91,1.10)*(woman?.86:1);
      const armUp=t=>add(mix(sh,elbow,t),factor(bend,.006*sin(t*pi)));
      const armLo=t=>add(mix(elbow,hand,t),factor(bend,.005*sin(t*pi)));
      const sections=[],rangeVec=[];
      const freedom=0;
      const push=(p,w,h,light,u,bulge=0)=>{sections.push([p,w*muscle,h*muscle,light,bulge]);rangeVec.push([u*freedom,u*u]);};
      push(armUp(0),.066,.068,.83,0);push(armUp(.22),.068,.074,.98,.08,.05);
      push(armUp(.43),.051,.060,1,.18,.11);push(armUp(.62),.044,.054,1.01,.30,.09);
      // A curved transition rounds the bent elbow; the point of the ulna
      // remains distinct from the fleshy inside of the joint.
      const from=armUp(.76),to=armLo(.20),point=add(elbow,factor(bend,.021));
      const elbowArc=t=>mix(mix(from,point,t),mix(point,to,t),t);
      push(elbowArc(.13),.043,.047,.95,.42,.08);push(elbowArc(.37),.044,.040,.90,.47);
      push(elbowArc(.58),.044,.038,.93,.50,.07);
      push(elbowArc(.83),.041,.042,.96,.55,.08);push(armLo(.25),.044,.047,1.02,.63,.13);
      push(armLo(.42),.041,.043,1,.72,.09);push(armLo(.64),.033,.034,.97,.82,.06);
      push(armLo(.84),.027,.026,.94,.91);push(armLo(.96),.027,.019,1,.98);push(hand,.026,.016,.98,1);
      const armAxis=norm(cross(upAxis,fore)),cut=sleeved?12:tank?1:style===8?5:3;
      const fabric=[],fabricW=[];
      for(let k=0;k<=cut;k++){
        const ss=sections[k],big=hood?.019:overshirt?.013:.008;
        const turn=(k===cut?.85:k===cut-1?1.09:1);
        fabric.push([ss[0],(ss[1]+big)*turn,(ss[2]+big)*turn,k===cut?.83:ss[3],.055]);
        fabricW.push(rangeVec[k]);
      }
      // A sleeve cap runs across the acromion into the shoulder seam. Its
      // rounded crown joins the side of the neck even on a raised arm.
      const acromion=torsoP([d*(woman?.116:.129)*bulk,.507,.009]);
      const crown=mix(acromion,sh,.63);crown[1]+=.012;
      if(!tank){
        fabric.unshift([acromion,.024,.032,.89],[crown,.051,.056,.98]);
        fabricW.unshift([0,0],[0,0]);sleeve(fabric,12,tint(shirt,.88+.048*cos(index)),1,115,armAxis,fabricW);
      }
      if(sleeved){
        const m=sections[cut],last=sections[cut+1];
        sleeve([[m[0],m[1]+.004,m[2]+.004,.72],[last[0],last[1]+.003,last[2]+.003,.82]],11,shirt,.31,115,armAxis,[rangeVec[cut],rangeVec[cut+1]]);
      }else{
        const bare=sections.slice(tank?0:cut),weights=rangeVec.slice(tank?0:cut);
        if(tank){bare.unshift([acromion,.022,.032,.91],[crown,.049,.050,1]);weights.unshift([0,0],[0,0]);}
        sleeve(bare,12,skin,0,120,armAxis,weights);
      }
      // A relaxed wrist tilts down slightly. Raised hands turn their palm toward the circuit.
      let dir=norm(add(fore,[d*.105,-.22+.19*(hand[1]>sh[1]),-.047]));
      if(activity===1)dir=norm([-.58*d,.65,d<0?.23:.58]);
      if(activity===2)dir=norm([-.51*d,.23,.74]);
      if(activity===4)dir=norm([-.37*d,.43,.62]);
      const grip=activity===1||activity===3||activity===4?.84:activity===2?.59:range(.18,.46);
      const palm=palmAndFingers(hand,dir,d,grip,skin,freedom);hands.push(palm);
    }
    if(activity===1){
      // The photographer braces the finder against one brow. The other
      // hand supports the focusing ring farther along the lens barrel.
      const camera=[.111,.118,.115],rim=[.295,.309,.292];
      strip(head([-.071,.112,.131]),head([.078,.112,.131]),.075,.066,camera);
      rod(head([.009,.109,.142]),head([.009,.109,.213]),.043,.038,camera,13);
      rod(head([.009,.109,.207]),head([.009,.109,.244]),.040,.040,rim,13);
      rod(head([.009,.109,.242]),head([.009,.109,.257]),.039,.043,camera,13);
      rod(head([.009,.109,.257]),head([.009,.109,.259]),.034,.032,[.169,.229,.230],13);
      for(const side of [-1,1]){
        const strap=[head([side*.069,.108,.126]),torsoP([side*.102,.288,.150]),torsoP([side*.099,.465,.131]),torsoP([side*.060,.541,.032])];
        for(let k=1;k<strap.length;k++)strip(strap[k-1],strap[k],.013,.005,camera);
      }
    }else if(activity===2){
      const paper=[[.696,.654,.519],[.718,.725,.675],[.714,.661,.535]][index%3];
      const page=(t,v)=>{const q=mix(hands[0],hands[1],t);return [q[0]+(t-.5)*.033,q[1]+(v-.23)*.161+.018*(1-abs(t*2-1)),q[2]+(v-.23)*.142-.017*(1-abs(t*2-1))];};
      for(let k=0;k<4;k++){
        const a=k/4,b=(k+1)/4;
        G.quad(toWorld(page(a,-.05)),toWorld(page(b,-.05)),toWorld(page(b,1)),toWorld(page(a,1)),tint(paper,.87+.09*(k%2)),0);
      }
      for(const y of [.25,.47,.73])strip(add(page(.06,y),[0,.002,.002]),add(page(.47,y+.063),[0,.002,.002]),.007,.005,[.279,.359,.343]);
    }else if(activity===3){
      const a=hands[1];strip(add(a,[-.012,-.024,0]),add(a,[.001,.081,-.032]),.056,.013,[.100,.109,.113]);
      strip(add(a,[-.012,-.011,-.008]),add(a,[.001,.066,-.036]),.048,.006,[.250,.302,.309]);
    }else if(activity===4){
      const a=hands[1],wall=[.516,.608,.574],drink=[.517,.304,.146];
      const pt=(y,z=0)=>[a[0]-.019,a[1]+y,a[2]+.014+z];
      rod(pt(-.078),pt(-.065),.025,.034,wall,10);rod(pt(-.066),pt(.055),.034,.033,wall,10);
      rod(pt(-.042),pt(.007),.035,.034,drink,10);rod(pt(.055),pt(.082),.033,.013,wall,10);
      rod(pt(.082),pt(.096),.014,.014,[.250,.362,.363],9);
    }
    for(const surface of queue)emitMesh(...surface);
    queue.length=0;occluders.length=0;
    const raised=joints.map(arm=>arm[0][1]>-.052),closeFace=joints.map(arm=>arm[0][1]>.089 && abs(arm[0][0])<.16);
    const family=activity?activity+10:closeFace[0]||closeFace[1]?8:raised[0]&&raised[1]?7:raised[0]||raised[1]?6:
      joints[0][0][0]>.24&&joints[1][0][0]<-.24?5:abs(joints[0][0][1]-joints[1][0][1])>.19?4:0;
    return {gesture,lean,sideLean,yaw,joints,activity,family,neck:toWorld(headBase),wardrobe:style,style:cap?0:longHair?1:index%8===3?2:3,build:bulk};
  }
  const seated=[],standing=[],profiles=[];
  for(let i=0;i<40;i++){
    const prepare=(index,up,ids)=>{G.beginTemplate();const profile=buildPerson(index,up),id=G.endTemplate();profiles[id]=profile;ids.push(id);};
    prepare(i,false,seated);
    if(i<18)prepare(i+40,true,standing);
  }
  const columns=98,seats=new Array(columns*7),all=seated.concat(standing);
  // Compare the wrists and elbows after their two-link solve, including
  // mirrored handedness. This gives relaxed poses their true similarity.
  const similarity=Array.from({length:profiles.length},()=>new Float32Array(profiles.length*2));
  for(const a of all)for(const b of all){
    const p=profiles[a],q=profiles[b];
    for(let reverse=0;reverse<2;reverse++){
      let error=0;
      for(let arm=0;arm<2;arm++)for(let joint=0;joint<3;joint++){
        const u=p.joints[arm][joint],v=q.joints[reverse?1-arm:arm][joint];
        const x=u[0]-(reverse?-v[0]:v[0]),y=u[1]-v[1],z=u[2]-v[2];
        error+=[1.0,.47,.21][joint]*(x*x+1.5*y*y+.72*z*z);
      }
      similarity[a][2*b+reverse]=Math.exp(-6.4*error);
    }
  }
  const casual=[[.55,.59,.63],[.28,.31,.34],[.67,.65,.59],[.35,.40,.42],[.60,.56,.52],[.39,.44,.48],[.72,.71,.65],[.41,.38,.36],[.31,.35,.30],[.52,.48,.41],[.34,.40,.51]];
  function assign(row,column,up,role=-1,handedness=0){
    const near=[];
    for(let r=0;r<7;r++)for(let c=Math.max(0,column-21);c<=Math.min(columns-1,column+21);c++){
      const other=seats[r*columns+c];if(!other)continue;
      const dr=r-row,dc=c-column,d2=dr*dr+dc*dc;
      // Along an oblique sightline, two different rows can overlap. Include
      // both approaches to the grandstand when separating repeated outlines.
      const depth=Math.abs(dr),along=Math.max(0,Math.abs(dc)-depth*1.32);
      const w=1/(.84+.24*(.68*dr*dr+along*along));
      near.push([other,w,Math.exp(-d2/136)]);
    }
    const ids=up?standing:seated;let best=Infinity,figure=ids[0],mirror=1;
    for(const id of ids)for(const flip of [1,-1]){
      const p=profiles[id];let cost=random()*.23;
      if(role>=0 && p.activity!==role)continue;
      if(handedness && flip!==handedness)continue;
      if(role<0 && (p.activity===12 || p.activity===11))continue;
      // People sharing a bench pay attention to one another or the track;
      // neighbouring elbows, cameras, papers and phones should read distinctly.
      const block=Math.floor(column/14),event=(block*3+row)%7;
      if(p.activity && ((block+p.activity)%4===0 || event===p.activity))cost-=.65;
      for(const [other,w,wide] of near){
        const q=profiles[other.figure],reverse=Number(flip!==other.mirror);
        if(p.activity && p.activity===q.activity)cost+=5.7*wide+4.1*w;
        if(p.family && p.family===q.family)cost+=2.6*w+.42*wide;
        if(up!==other.up)continue;
        const resemblance=similarity[id][other.figure*2+reverse];
        const head=abs(p.yaw*flip-q.yaw*other.mirror)<.48&&p.style===q.style;
        cost+=(id===other.figure?65*wide:0)+w*(3.6*resemblance*resemblance
          +.74*(p.wardrobe===q.wardrobe)+.51*Number(head)+.31*(p.gesture===q.gesture)
          +(p.activity&&p.activity===q.activity?5.1:0));
      }
      if(cost<best){best=cost;figure=id;mirror=flip;}
    }
    let color=shirts[0];best=Infinity;
    for(let n=0;n<14;n++){
      const base=random()<.48?pick(casual):pick(shirts),brightness=range(.83,1.17);
      const tone=[base[0]*brightness*range(.95,1.05),base[1]*brightness,base[2]*brightness*range(.93,1.07)];
      let cost=random()*.62;
      for(const [other,w] of near){
        const rgb=other.color,dr=tone[0]-rgb[0],dg=tone[1]-rgb[1],db=tone[2]-rgb[2];
        const like=similarity[figure][2*other.figure+Number(mirror!==other.mirror)];
        const distance=dr*dr+1.4*dg*dg+.81*db*db;
        cost+=w*(1+2.9*like*like)*Math.exp(-36*distance);
      }
      if(cost<best){best=cost;color=tone;}
    }
    const channel=v=>Math.min(127,Math.max(1,Math.round(v*127)));
    const follows=[0,7,8,9,10,12].includes(profiles[figure].activity);
    const appearance=channel(color[0])+(channel(color[1])<<7)+(channel(color[2])<<14)+((mirror<0?1:0)<<21)+((up?1:0)<<22)+((follows?1:0)<<23);
    return seats[row*columns+column]={figure,appearance,mirror,color,up,activity:profiles[figure].activity};
  }
  return {seated,standing,assign,profiles};
}
