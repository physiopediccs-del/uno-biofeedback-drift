// Index static topology once, then compact the visible instances for indirect draws.
// The immutable instances also feed the whole-circuit shadow map and reflection probes.
function visibleScene(device,scene){
  const usage=GPUBufferUsage,words=13,source=scene.vertices,total=source.length/words;
  const bits=new Uint32Array(source.buffer,source.byteOffset,source.length);
  let capacity=1;while(capacity<total*2)capacity*=2;
  const hashTable=new Uint32Array(capacity),indices=new Uint32Array(total),mask=capacity-1;
  const unique=new Float32Array(source.length),uniqueBits=new Uint32Array(unique.buffer);
  let used=0;
  for(let i=0;i<total;i++){
    const off=i*words;let h=2166136261;
    for(let k=0;k<words;k++)h=Math.imul(h^bits[off+k],16777619);
    let slot=(h^(h>>>16))&mask;
    while(hashTable[slot]){
      const off2=(hashTable[slot]-1)*words;let same=true;
      for(let k=0;k<words;k++)if(bits[off+k]!==uniqueBits[off2+k]){same=false;break}
      if(same)break;slot=(slot+1)&mask;
    }
    if(!hashTable[slot]){
      const j=used*words;for(let k=0;k<words;k++)uniqueBits[j+k]=bits[off+k];
      hashTable[slot]=++used;
    }
    indices[i]=hashTable[slot]-1;
  }
  function upload(array,flags){
    const buffer=device.createBuffer({size:array.byteLength,usage:flags,mappedAtCreation:true});
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));buffer.unmap();return buffer;
  }
  // Protect disconnected surfaces (for example a hand touching a sleeve) when
  // clustering small details of a distant spectator. Each cluster preserves
  // a representative normal and pigment from that one connected surface.
  const batches=scene.batches,lodDraw=new Int32Array(batches.length);
  lodDraw.fill(-1);
  // A second index range replaces fine, distant wood. Leaf cards have
  // encoded billboard axes and always retain their complete geometry.
  const wood=new Uint8Array(batches.length);
  for(let j=0;j<batches.length;j++){
    const b=batches[j];if(!b.firstInstance || b.masked || b.car || b.spectator || b.count<900)continue;
    let bark=false,other=false;
    for(let k=b.first;k<b.first+b.count && !other;k+=3){
      const material=source[k*words+9];bark ||= material===15;other=material!==15 && material!==0;
    }
    if(bark && !other)wood[j]=1;
  }
  let extraIndices=0,extraInstances=0,lodCount=0;
  for(let j=0;j<batches.length;j++){const b=batches[j];if(!b.spectator&&!wood[j])continue;
    extraIndices+=b.count;
    extraInstances+=b.instanceCount;
  }
  const detailIndices=new Uint32Array(total+extraIndices);
  detailIndices.set(indices);
  let detailEnd=total;
  const lodRanges=[];
  function simplifyMesh(batch,cell){
    const first=detailEnd,localIDs=new Map(),original=[],remap=new Uint32Array(batch.count),parent=new Int32Array(batch.count);
    function root(i){while(i!==parent[i]){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    for(let i=0;i<batch.count;i++){
      const global=indices[batch.first+i];let local=localIDs.get(global);
      if(local===undefined){local=original.length;localIDs.set(global,local);original.push(global);parent[local]=local;}
      remap[i]=local;
      if(i%3===2){const component=root(remap[i-2]);parent[root(remap[i-1])]=component;parent[root(local)]=component;}
    }
    const grid=new Map(),groups=[];
    const cluster=new Uint32Array(original.length);
    for(let i=0;i<original.length;i++){
      const p=original[i]*words,x=unique[p],y=unique[p+1],z=unique[p+2];
      const key=((root(i)*2048+Math.floor(x/cell)+768)*2048+Math.floor(y/cell)+768)*2048+Math.floor(z/cell)+768;
      let g=grid.get(key);
      if(g===undefined){g=groups.length;grid.set(key,g);groups.push({sum:new Float64Array(words),count:0});}
      cluster[i]=g;const group=groups[g];group.count++;
      for(let j=0;j<words;j++)group.sum[j]+=unique[p+j];
    }
    // Select an actual sample for topology and interpolation, rather than moving
    // surface points off the original mesh. A nearby smooth sample preserves
    // the original normal, skin tone and garment folds.
    const nearest=new Uint32Array(groups.length),cost=new Float64Array(groups.length);cost.fill(Infinity);
    for(const group of groups)for(let j=0;j<words;j++)group.sum[j]/=group.count;
    for(let i=0;i<original.length;i++){
      const global=original[i],o=global*words,g=cluster[i],mean=groups[g].sum;
      let error=0;
      for(let k=0;k<3;k++){
        const dx=unique[o+k]-mean[k],dn=unique[o+k+3]-mean[k+3],dc=unique[o+k+6]-mean[k+6];
        error+=dx*dx+.000065*dn*dn+.00016*dc*dc;
      }
      if(error<cost[g]){cost[g]=error;nearest[g]=global;}
    }
    for(let i=0;i<batch.count;i+=3){
      const a=nearest[cluster[remap[i]]],b=nearest[cluster[remap[i+1]]],c=nearest[cluster[remap[i+2]]];
      if(a===b||b===c||a===c)continue;
      detailIndices[detailEnd++]=a;detailIndices[detailEnd++]=b;detailIndices[detailEnd++]=c;
    }
    return {first,count:detailEnd-first};
  }
  for(let j=0;j<batches.length;j++)if(batches[j].spectator||wood[j]){
    lodDraw[j]=lodCount++;lodRanges.push(simplifyMesh(batches[j],wood[j] ? .185 : .066));
  }
  // A draw can use a local 16-bit index whenever every vertex it references
  // lies within one 65,536-vertex span. The base-vertex addend restores the
  // original global ID exactly, including in the generated LOD ranges.
  const shortBatch=new Uint8Array(batches.length),baseVertex=new Uint32Array(batches.length);
  const indexStart=new Uint32Array(batches.length),lodIndexStart=new Uint32Array(lodRanges.length);
  let shortCount=0;
  for(let j=0;j<batches.length;j++){
    const batch=batches[j];
    let low=0xffffffff,high=0;
    for(let k=batch.first,end=k+batch.count;k<end;k++){
      low=Math.min(low,detailIndices[k]);high=Math.max(high,detailIndices[k]);
    }
    if(high-low>65535)continue;
    shortBatch[j]=1;baseVertex[j]=low;
    shortCount+=batch.count+(lodDraw[j]>=0?lodRanges[lodDraw[j]].count:0);
  }
  // The long range starts on a 4-byte boundary. Draws bind the entire buffer
  // and switch index format only on transitions between the two widths.
  const longOffset=Math.ceil(shortCount/2)*4;
  const packedIndices=new Uint8Array(longOffset+(detailEnd-shortCount)*4);
  const shorts=new Uint16Array(packedIndices.buffer,0,shortCount);
  const longs=new Uint32Array(packedIndices.buffer,longOffset);
  let shortAt=0,longAt=0;
  function pack(first,count,j){
    if(shortBatch[j]){
      const start=shortAt,base=baseVertex[j];
      for(let k=first;k<first+count;k++)shorts[shortAt++]=detailIndices[k]-base;
      return start;
    }
    const start=longOffset/4+longAt;
    longs.set(detailIndices.subarray(first,first+count),longAt);longAt+=count;
    return start;
  }
  for(let j=0;j<batches.length;j++){
    const b=batches[j];indexStart[j]=pack(b.first,b.count,j);
    const k=lodDraw[j];
    if(k>=0)lodIndexStart[k]=pack(lodRanges[k].first,lodRanges[k].count,j);
  }
  const vb=upload(packSceneVertices(unique,used),usage.VERTEX),ib=upload(packedIndices,usage.INDEX);
  const transforms=scene.instances,staticBuffer=upload(transforms,usage.VERTEX);
  const compacted=new Float32Array(transforms.length+extraInstances*8);
  const visibleBuffer=device.createBuffer({size:compacted.byteLength,usage:usage.VERTEX|usage.COPY_DST});
  const templates=new Map(),shapes=[];
  let nextFar=transforms.length/8;
  // Keep contiguous runs of the large, world-space mesh. Its index order and
  // the complete mesh used by reflection probes and shadows stay intact.
  const chunkFirst=new Uint32Array(batches.length+1),chunks=[];
  const triangleBlock=384;
  for(let j=0;j<batches.length;j++){
    const b=batches[j];chunkFirst[j]=chunks.length;
    if(b.firstInstance!==0 || b.car || b.masked || b.transparent || b.count<triangleBlock*6)continue;
    for(let first=b.first;first<b.first+b.count;first+=triangleBlock*3){
      const count=Math.min(triangleBlock*3,b.first+b.count-first);
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity;
      for(let i=first;i<first+count;i++){
        const k=i*words,x=source[k],y=source[k+1],z=source[k+2];
        x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);z0=Math.min(z0,z);z1=Math.max(z1,z);
      }
      chunks.push({first,count,x:(x0+x1)*.5,y:(y0+y1)*.5,z:(z0+z1)*.5,rx:(x1-x0)*.5+.65,ry:(y1-y0)*.5+.65,rz:(z1-z0)*.5+.65});
    }
  }
  chunkFirst[batches.length]=chunks.length;
  const runGroups=new Array(batches.length);
  let runEnd=batches.length+lodCount;
  for(let i=0;i<batches.length;i++){
    const blockCount=chunkFirst[i+1]-chunkFirst[i];
    if(!blockCount)continue;
    const capacity=Math.min(10,Math.ceil(blockCount/2));
    runGroups[i]={start:runEnd,capacity};
    runEnd+=capacity;
  }
  const startIndex=new Uint32Array(chunks.length),endIndex=new Uint32Array(chunks.length);
  const breakRank=new Float64Array(chunks.length),largestBreaks=new Float64Array(10);
  const args=new Uint32Array(5*runEnd);
  for(let j=0;j<lodRanges.length;j++){
    const k=5*(batches.length+j);args[k]=lodRanges[j].count;args[k+2]=lodIndexStart[j];
  }
  for(let j=0;j<batches.length;j++){
    const b=batches[j];args[5*j]=b.count;args[5*j+1]=b.instanceCount;args[5*j+2]=indexStart[j];args[5*j+3]=baseVertex[j];
    if(lodDraw[j]>=0)args[5*(batches.length+lodDraw[j])+3]=baseVertex[j];
    if(b.firstInstance===0)continue;
    let shp=templates.get(b.firstInstance);
    if(!shp){shp={first:b.firstInstance,count:b.instanceCount,radius:0,bottom:Infinity,top:-Infinity,vegetation:false,batchIndices:[],sphere:new Float32Array(5*b.instanceCount)};templates.set(b.firstInstance,shp);shapes.push(shp)}
    if((b.spectator||wood[j]) && shp.far===undefined){shp.far=nextFar;shp.angularThreshold=wood[j] ? .052 : .028;nextFar+=shp.count;}
    shp.batchIndices.push(j);
    let r2=shp.radius*shp.radius;
    for(let k=b.first;k<b.first+b.count;k++){
      const p=k*words,mat=source[p+9],y=source[p+1];
      const card=mat>=127&&mat<=142;
      const extent=card?Math.hypot(source[p+3],source[p+4]):0;
      let reach=source[p]*source[p]+y*y+source[p+2]*source[p+2];
      if(card){const bound=Math.sqrt(reach)+extent;reach=bound*bound;}
      shp.vegetation ||= card || mat===15;
      shp.bottom=Math.min(shp.bottom,y-extent);
      shp.top=Math.max(shp.top,y+extent);
      r2=Math.max(r2,reach);
    }
    shp.radius=Math.sqrt(r2);
  }
  for(const shp of shapes){
    // Test a second sphere halfway up the crown. Each camera-facing card
    // contributes its entire diagonal, in any orientation, to the bound.
    let centerY=0,radius=shp.radius;
    if(shp.vegetation && !shp.batchIndices.some(id=>batches[id].spectator)){
      const mid=(shp.bottom+shp.top)*.5;
      let raised=0;
      for(const id of shp.batchIndices){
        const b=batches[id];
        for(let i=b.first;i<b.first+b.count;i++){
          const p=i*words,mat=source[p+9];
          const card=mat>=127&&mat<=142?Math.hypot(source[p+3],source[p+4]):0;
          raised=Math.max(raised,Math.hypot(source[p],source[p+1]-mid,source[p+2])+card);
        }
      }
      if(raised<radius){centerY=mid;radius=raised;}
    }
    for(let j=0;j<shp.count;j++){
      const k=(shp.first+j)*8,s=5*j,scale=Math.max(transforms[k+4],transforms[k+5],transforms[k+6]);
      shp.sphere[s]=transforms[k];shp.sphere[s+1]=transforms[k+1]+centerY*transforms[k+5];shp.sphere[s+2]=transforms[k+2];
      shp.sphere[s+3]=radius*scale+.65;
      // Keep the original distance from camera to instance for the LOD.
      shp.sphere[s+4]=shp.radius*scale+.65;
    }
  }
  const indirect=upload(args,usage.INDIRECT|usage.COPY_DST),planes=new Float32Array(24);
  function draw(encoder,filter,visible,plantPipe,opaquePipe){
    let active=false;
    encoder.setVertexBuffer(0,vb);let currentFormat=-1;
    for(let i=0;i<batches.length;i++){
      const b=batches[i];if(!b.instanceCount||!filter(b))continue;
      if(plantPipe && !!b.plantSurface!==active){
        active=!!b.plantSurface;encoder.setPipeline(active?plantPipe:opaquePipe);
      }
      if(shortBatch[i]!==currentFormat){
        currentFormat=shortBatch[i];encoder.setIndexBuffer(ib,currentFormat?'uint16':'uint32');
      }
      if(visible && runGroups[i]){
        const group=runGroups[i];encoder.setVertexBuffer(1,staticBuffer);
        for(let j=0;j<group.capacity;j++)encoder.drawIndexedIndirect(indirect,(group.start+j)*20);
      }else if(!visible||b.firstInstance===0){
        encoder.setVertexBuffer(1,staticBuffer);
        encoder.drawIndexed(b.count,b.instanceCount,indexStart[i],baseVertex[i],b.firstInstance);
      }else{
        encoder.setVertexBuffer(1,visibleBuffer,b.firstInstance*32);
        encoder.drawIndexedIndirect(indirect,i*20);
        if(lodDraw[i]>=0){
          encoder.setVertexBuffer(1,visibleBuffer,templates.get(b.firstInstance).far*32);
          encoder.drawIndexedIndirect(indirect,(batches.length+lodDraw[i])*20);
        }
      }
    }
  }
  const viewportHeight=typeof gameCanvas==='undefined'?1440:gameCanvas.height;
  function update(v){
    // Use projected size. A zoomed-in TV camera retains the detailed figure
    // farther down the straight than the wider chase and hood cameras.
    const focal=viewportHeight*.5*Math.sqrt(v[1]*v[1]+v[5]*v[5]+v[9]*v[9]);
    for(let j=0;j<6;j++){
      const a=j>>1,sign=(j&1)?-1:1,k=j*4;
      for(let q=0;q<4;q++)planes[k+q]=v[q*4+3]+sign*v[q*4+a];
      const nx=planes[k],ny=planes[k+1],nz=planes[k+2];const n=1/Math.sqrt(nx*nx+ny*ny+nz*nz);for(let q=0;q<4;q++)planes[k+q]*=n;
    }
    // Split the visible index ranges at their largest gaps. Other gaps
    // remain inside a draw, preserving coverage within the draw-call budget.
    for(let i=0;i<runGroups.length;i++){
      const group=runGroups[i];if(!group)continue;
      let count=0,previousEnd=-1,rankCount=0;
      for(let j=chunkFirst[i];j<chunkFirst[i+1];j++){
        const c=chunks[j];let visible=true;
        for(let k=0;k<24;k+=4){
          const nx=planes[k],ny=planes[k+1],nz=planes[k+2];
          const support=c.rx*Math.abs(nx)+c.ry*Math.abs(ny)+c.rz*Math.abs(nz);
          if(c.x*nx+c.y*ny+c.z*nz+planes[k+3]+support<0){visible=false;break;}
        }
        if(!visible)continue;
        if(c.first!==previousEnd){
          startIndex[count]=c.first;
          if(count>0 && group.capacity>1){
            const rank=(c.first-previousEnd)*(chunks.length+1)+count;
            breakRank[count]=rank;
            const limit=group.capacity-1;
            let t=Math.min(rankCount,limit);
            if(t<limit || rank>largestBreaks[t-1]){
              if(t===limit)t--;
              while(t>0 && largestBreaks[t-1]<rank){largestBreaks[t]=largestBreaks[t-1];t--;}
              largestBreaks[t]=rank;
              if(rankCount<limit)rankCount++;
            }
          }
          count++;
        }
        previousEnd=c.first+c.count;endIndex[count-1]=previousEnd;
      }
      let used=0;
      let threshold=0;
      if(count>group.capacity)threshold=group.capacity>1?largestBreaks[rankCount-1]:Infinity;
      let a=0;
      for(let j=0;j<count;j++){
        if(j===0 || breakRank[j]>=threshold){
          a=5*(group.start+used++);args[a+1]=1;args[a+2]=startIndex[j];
        }
        args[a]=endIndex[j]-args[a+2];
      }
      const delta=indexStart[i]-batches[i].first;
      for(let j=0;j<used;j++){
        const k=5*(group.start+j);args[k+2]+=delta;args[k+3]=baseVertex[i];
      }
      for(let j=used;j<group.capacity;j++)args[5*(group.start+j)+1]=0;
    }
    for(let i=0;i<shapes.length;i++){
      const shp=shapes[i];let count=0,farCount=0;
      for(let j=0;j<shp.count;j++){
        const sp=shp.sphere,o=j*5,x=sp[o],y=sp[o+1],z=sp[o+2],r=sp[o+3];let inside=true;
        for(let k=0;k<24;k+=4)if(x*planes[k]+y*planes[k+1]+z*planes[k+2]+planes[k+3]<-r){inside=false;break}
        if(inside){
          const src=(shp.first+j)*8;
          const distant=shp.far!==undefined && v[3]*x+v[7]*transforms[src+1]+v[11]*z+v[15]-sp[o+4]>focal*shp.angularThreshold*Math.max(transforms[src+4],transforms[src+5],transforms[src+6]);
          const dst=(distant?shp.far+farCount++:shp.first+count++)*8;
          for(let k=0;k<8;k++)compacted[dst+k]=transforms[src+k];
        }
      }
      if(shp.batchIndices.length>1 && farCount){
        compacted.copyWithin((shp.first+count)*8,shp.far*8,(shp.far+farCount)*8);
      }
      for(let j=0;j<shp.batchIndices.length;j++){
        const id=shp.batchIndices[j];args[id*5+1]=lodDraw[id]<0?count+farCount:count;
        if(lodDraw[id]>=0)args[(batches.length+lodDraw[id])*5+1]=farCount;
      }
    }
    device.queue.writeBuffer(visibleBuffer,0,compacted);device.queue.writeBuffer(indirect,0,args);
  }
  return {draw,update};
}
