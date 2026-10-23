(async function(){
  'use strict';
  const out=document.getElementById('results'),results=[];
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const record=(name,extra)=>{results.push({name,pass:true,...extra});out.textContent=JSON.stringify(results,null,2);};
  try{
    const XRAY=(await (await fetch('../scatters/xray_wk1995_ions.json')).json()).table;
    const ff=(el,s2)=>{const e=XRAY[el];return e.a.reduce((f,a,i)=>f+a*Math.exp(-e.b[i]*s2),e.c);};
    // the same synthetic P1 structure as tests/cf-adaptive.test.cjs
    const cell={a:6,b:7,c:8,alpha:90,beta:90,gamma:90},B=1.2,atoms=[['Fe',.11,.23,.37],['Fe',.61,.71,.19],['O',.31,.52,.83],['O',.82,.14,.62],['O',.47,.88,.08],['O',.05,.41,.55]],list=[];
    for(let h=-5;h<=5;h++)for(let k=-6;k<=6;k++)for(let l=0;l<=7;l++){
      if(l===0 && (k<0 || (k===0 && h<=0)))continue;
      const s2=(h*h/36+k*k/49+l*l/64)/4,d=1/Math.sqrt(4*s2);if(d<1.1)continue;
      let re=0,im=0;for(const [el,x,y,z] of atoms){const f=ff(el,s2)*Math.exp(-B*s2),p=2*Math.PI*(h*x+k*y+l*z);re+=f*Math.cos(p);im+=f*Math.sin(p);}
      list.push({h_orig:h,k_orig:k,l_orig:l,intensity:2*(re*re+im*im),tth:2*Math.asin(1.5406/(2*d))*180/Math.PI,d,fwhm:.02});
    }
    const histogramAtoms=[['Fe',2],['O',4]].map(([el,count])=>({element:el,count,a:XRAY[el].a,b:XRAY[el].b,c:XRAY[el].c}));
    const base={type:'run-charge-flipping',gridSize:32,thresholdSigma:1.1,seed:7,cell,symops:[{r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]}],laueClass:'-1',symLambda:0,weakFraction:.15,weakGrouping:'cluster',
      overlapTolTth:0,overlapFwhmFraction:0,minPeakSeparation:.6,maxPeaks:12,peakHeightCutoff:.04,applyLP:false,hklList:list,histogramMatching:true,histogramAtoms};
    function run(job){return new Promise((resolve,reject)=>{const w=new Worker('../js/charge_flipping_worker.js'),info=[];const t=setTimeout(()=>{w.terminate();reject(Error('CF worker timed out'));},120000);
      w.onmessage=e=>{const m=e.data||{};if(m.type==='cf-info')info.push(m.message);if(m.type==='cf-error'){clearTimeout(t);w.terminate();reject(Error(m.message));}if(m.type==='cf-result'){clearTimeout(t);w.terminate();resolve({r:m.results,info});}};w.postMessage(job);});}
    const corr=(a,b)=>{let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;let sab=0,saa=0,sbb=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;sab+=x*y;saa+=x*x;sbb+=y*y;}return sab/Math.sqrt(saa*sbb);};
    // one matching step (cycle 10), so the two backends have not yet diverged chaotically
    const gpu=await run({...base,maxIterations:11,backend:'gpu'}),cpu=await run({...base,maxIterations:11,backend:'cpu'});
    check(gpu.r.backend==='gpu','The GPU path fell back: '+gpu.info.join(' | '));
    check(gpu.r.histogramMatching && gpu.r.histogramMatching.applied && cpu.r.histogramMatching.applied,'Histogram matching was not reported by both backends');
    const c=corr(gpu.r.map,cpu.r.map);
    check(c>.98,'GPU and CPU maps after one matching step differ: correlation '+c);
    record('the GPU histogram matching agrees with the CPU reference after its first step',{correlation:+c.toFixed(5),B:+gpu.r.histogramMatching.B.toFixed(3)});
    const long=await run({...base,maxIterations:80,backend:'gpu'});
    check(long.r.backend==='gpu' && Number.isFinite(long.r.bestR) && long.r.bestR<.5,'A full GPU run with matching: backend '+long.r.backend+', R '+long.r.bestR);
    record('a full GPU search with histogram matching converges',{bestR:+long.r.bestR.toFixed(4)});
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
