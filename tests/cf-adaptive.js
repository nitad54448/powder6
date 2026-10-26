(async function(){
  'use strict';
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));let restoreWorker;
  function check(ok,message){if(!ok)throw Error(message);}
  function record(name,extra){results.push({name,pass:true,...extra});out.textContent=JSON.stringify(results,null,2);}
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV || !w.RV.state || !w.RV.state.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,q=s=>w.document.querySelector(s),errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    function change(el,value){if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
    St.setCalculation('rietveld');
    const ph=St.makePhase({name:'Synthetic Si',sg:St.resolveSG(1),cell:{a:4.2,b:4.6,c:5.1,alpha:83,beta:94,gamma:101},atoms:[{label:'Si1',type:'Si',x:.13,y:.21,z:.32}]});St.addPhase(ph);
    let ds=St.insertDatasets([St.makeDataset({name:'Controlled pattern',tth:Array.from({length:501},(_,i)=>10+i*.2),y:Array(501).fill(100),inst:{bkgN:1,lambda2:0,ratio:0,resolutionType:'simple_pvoigt'}})],{estimate:false,selectAll:true})[0];
    ds.p[ph.key+'.scale']=.002;ds.p.bkg0=10;ds.p.zero=.12;ds.y=w.RVCore.evaluate(St.problemFor([ds]),0).ycalc;
    St.setCalculation('wppf');Object.keys(ds.fit).forEach(n=>ds.fit[n]=n==='bkg0');St.setSetting('maxIter',5);
    await RV.cmd.fit();q('#tab-structure').click();await frame();
    const I=RV.solve.state.ints;check(I && I.det.length>=4,'Real WPPF extraction did not produce usable intensities');
    check(I.profile.profileType==='simple_pvoigt' && I.det.every(r=>r.fwhm>0),'Extraction did not retain the dataset profile and fitted reflection widths');
    check(I.det.every(r=>Math.abs(r.fwhm-w.prepareVoigt(360/Math.PI*Math.asin(I.lambda/(2*r.d)),r.tth,{h_orig:r.h,k_orig:r.k,l_orig:r.l,d:r.d},I.profile).fwhm_total)<1e-10),'Extracted widths differ from the fitted Bragg-angle profiles when zero is nonzero');
    record('real WPPF extraction retains dataset-specific fitted widths for CF diagnostics');
    q('[data-acc="wppf-cf"]').open=true;change(q('#sv-cf-threshold'),'1.07');change(q('#sv-cf-weakFraction'),'.12');change(q('#sv-cf-symLambda'),'.3');change(q('#sv-cf-overlapTol'),'.037');change(q('#sv-cf-iterations'),'12');
    const manual={threshold:RV.solve.state.opts.cf.threshold,weakFraction:RV.solve.state.opts.cf.weakFraction,symLambda:RV.solve.state.opts.cf.symLambda,overlapTol:RV.solve.state.opts.cf.overlapTol};
    change(q('#sv-cf-adaptive'),true);await frame();
    check(+q('#sv-cf-trials').value>=6 && q('#sv-cf-threshold').parentElement.hidden && q('#sv-cf-quality table tbody').rows.length===3,'Adaptive search preview missing');
    record('adaptive CF previews three settings and a bounded budget without overwriting manual choices');
    const NativeWorker=w.Worker;let pendingWorker;
    w.Worker=function(url,options){if(!String(url).includes('charge_flipping_worker'))return new NativeWorker(url,options);pendingWorker={postMessage(){},terminate(){}};return pendingWorker;};
    q('#sv-cf-run').click();
    check(S.busy && q('#busy-track').classList.contains('indet') && /Preparing charge flipping/.test(q('#busy-detail').textContent),'CF shows a false 0% while waiting for its worker');
    pendingWorker.onmessage({data:{type:'cf-status',message:'Compiling the GPU calculation…'}});
    check(q('#busy-track').classList.contains('indet') && /Compiling the GPU calculation/.test(q('#busy-detail').textContent),'GPU startup status is not visible in the running panel');
    pendingWorker.onmessage({data:{type:'cf-progress',iter:3,total:12,R:.4,bestR:.4}});
    check(!q('#busy-track').classList.contains('indet') && parseFloat(q('#busy-track i').style.width)>0 && /cycle 3\/12/.test(q('#busy-detail').textContent),'CF cycles did not update global progress');
    RV.solve.stop();w.Worker=NativeWorker;
    check(!S.busy && !RV.solve.state.cfRun,'CF cannot be stopped during startup');
    record('CF reports preparation and compilation, advances global cycle progress and stops cleanly');
    const OriginalWorker=w.Worker,jobs=[];let stopOnCompare=false,failNext=false;
    w.Worker=function(url,options){const worker=new OriginalWorker(url,options);if(String(url).includes('charge_flipping_worker')){const post=worker.postMessage.bind(worker);worker.postMessage=function(job,transfer){if(job.type==='run-charge-flipping'){jobs.push(job);if(failNext){failNext=false;return post({type:'deliberately-invalid-test-message'});}}if(job.type==='compare-cf-maps' && stopOnCompare){stopOnCompare=false;setTimeout(()=>RV.solve.stop(),0);}return post(job,transfer);};}return worker;};restoreWorker=()=>{w.Worker=OriginalWorker;};
    const model=()=>JSON.stringify({phases:S.phases.map(RV.fitHistory.phaseDoc),datasets:S.datasets.map(d=>({id:d.id,p:d.p,fit:d.fit,inst:d.inst}))}),before=model(),raw=JSON.stringify(I.det);
    async function run(){const count=RV.fitHistory.list('wppf','cf').length;q('#sv-cf-run').click();const until=Date.now()+60000;while(S.busy || RV.fitHistory.list('wppf','cf').length===count){if(Date.now()>until)throw Error('Adaptive CF timed out');await wait(20);}await frame();return RV.solve.state.cf;}
    let result=await run();
    check(result && result.search && result.search.trials.length===6 && Number.isFinite(result.best.bestR),'Adaptive CF did not complete six actual starts');
    check(jobs.length===6 && jobs.every(j=>j.overlapFwhmFraction===.5 && j.weakGrouping==='cluster' && j.hklList.length===I.det.length),'Adaptive jobs changed the reflection set or grouping policy across starts');
    check(new Set(jobs.map(j=>j.seed)).size===2 && new Set(jobs.map(j=>j.thresholdSigma)).size===3,'Settings were not compared with repeated independent seeds');
    check(model()===before && JSON.stringify(I.det)===raw,'Adaptive CF changed the fitted model or measured intensities');
    // the saved-state fingerprint must see a new solution: it answers "did the archive change?" without copying it
    check(RV.project.hasUnsavedChanges(),'A completed charge-flipping result did not mark the project as modified');
    record('actual CF workers execute the previewed settings with paired seeds and unchanged observations',{backend:result.best.backend,bestR:result.best.bestR});
    // the run's own seed: drawn when the field is blank, reported, and the source of every start's seed
    check(Number.isSafeInteger(result.seed) && result.seed>=0 && result.seed<=4294967295 && result.search.seed===result.seed,'The CF run did not record the seed its starts came from: '+result.seed+' / '+(result.search && result.search.seed));
    check(jobs.every(j=>Number.isSafeInteger(j.seed) && j.seed>=0),'A CF start ran without a seed');
    check(RV.ui.logEntries().some(e=>e.msg.includes('seed '+result.seed+'.')),'The Log does not report the CF seed');
    record('a blank CF seed is drawn, recorded in the result and reported in the Log',{seed:result.seed});
    check(result.search.trials.every(r=>Number.isFinite(r.mapCorrelation) && r.mapCorrelation>=0 && r.mapCorrelation<=1),'Map comparisons did not complete');
    RV.layout.structureResult('cf');await frame();check(q('#sv-cf-out').textContent.includes('other independent seeds') && q('#sv-cf-out table tbody').rows.length===6,'Trial diagnostics missing from the selected result');
    const saved=RV.fitHistory.list('wppf','cf').slice(-1)[0];check(saved.solution.search.trials.length===6 && !saved.solution.search.candidates,'Search metadata was lost or temporary candidate maps were archived');
    check(RV.solve.reportSelected().lines.some(l=>l.startsWith('Adaptive search')),'Adaptive diagnostics missing from the report');
    record('result, history and report retain parameters, seeds and origin/hand-invariant map comparisons');
    change(q('#sv-cf-trials'),'1000');await frame();check(q('#sv-cf-run').disabled,'Excessive adaptive budget was accepted');change(q('#sv-cf-trials'),'6');
    stopOnCompare=true;result=await run();check(result.stopped && result.best && result.structure,'Stopping during comparison discarded the best map or failed to extract its sites: '+JSON.stringify({stopped:result.stopped,best:!!result.best,structure:!!result.structure,err:result.err,stage:RV.solve.state.cfRun && RV.solve.state.cfRun.stage,stopOnCompare}));
    check(model()===before && !S.busy,'Stopping adaptive CF changed the model or left editing locked');
    record('stopping during map comparison retains the best map and completes site extraction');
    failNext=true;result=await run();check(result.search.trials.length===6 && result.search.trials.filter(r=>r.error).length===1 && Number.isFinite(result.best.bestR) && !S.busy,'One failed start prevented the remaining search from completing');
    record('an individual worker error is retained in the trial log while the remaining starts complete');
    change(q('#sv-cf-adaptive'),false);await frame();check(!q('#sv-cf-threshold').parentElement.hidden && Object.entries(manual).every(([k,v])=>RV.solve.state.opts.cf[k]===v),'Switching back to manual mode lost the original settings');
    change(q('#sv-cf-trials'),'1');change(q('#sv-cf-seed'),'777');await frame();
    result=await run();const manualJob=jobs[jobs.length-1];
    check(!result.search && manualJob.thresholdSigma===1.07 && manualJob.symLambda===.3 && manualJob.weakFraction===.12 && manualJob.overlapTolTth===.037 && manualJob.overlapFwhmFraction===0,'Manual mode did not use its original numerical settings');
    record('an actual manual CF run retains its original settings and fixed overlap grouping');
    // a typed seed is what the run comes from, so it can be repeated exactly
    check(result.seed===777 && Number.isSafeInteger(manualJob.seed),'A typed CF seed did not reach the run: '+result.seed);
    // an invalid seed either disables Run (the field is marked invalid) or is refused with the message; it never starts
    change(q('#sv-cf-seed'),'abc');await frame();
    const seedRun=q('#sv-cf-run');if(!seedRun.disabled)seedRun.click();await frame();
    check(!S.busy && !RV.solve.state.cfRun && (seedRun.disabled || /seed is a whole number/.test(q('#status-msg').textContent)),'An invalid CF seed started a run: '+q('#status-msg').textContent);
    change(q('#sv-cf-seed'),'');await frame();
    record('a typed CF seed reaches the run; an invalid one is refused before a worker starts');
    // Exercise the centric weak-reflection path on both real backends, not only P1.
    const centricJob={type:'run-charge-flipping',gridSize:16,maxIterations:1,thresholdSigma:1.1,seed:543,cell:{a:5,b:5,c:5,alpha:90,beta:90,gamma:90},symops:[{r:[1,0,0,0,1,0,0,0,1],t:[0,0,0]},{r:[-1,0,0,0,-1,0,0,0,-1],t:[0,0,0]}],symLambda:.5,weakFraction:.25,weakGrouping:'individual',overlapTolTth:.001,applyLP:false,minPeakSeparation:.5,maxPeaks:20,peakHeightCutoff:.04,hklList:Array.from({length:8},(_,i)=>({h_orig:i%3+1,k_orig:Math.floor(i/3),l_orig:1,intensity:(i+1)*10,tth:10+i}))};
    function flip(backend){return new Promise((resolve,reject)=>{const worker=new OriginalWorker('js/charge_flipping_worker.js'),timer=setTimeout(()=>{worker.terminate();reject(Error('Centric CF timed out'));},30000);worker.onmessage=e=>{if(e.data.type==='cf-result'){clearTimeout(timer);worker.terminate();resolve(e.data.results);}else if(e.data.type==='cf-error'){clearTimeout(timer);worker.terminate();reject(Error(e.data.message));}};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};worker.postMessage({...centricJob,backend});});}
    const centricResults=await Promise.all(['cpu','gpu'].map(flip));
    for(const result of centricResults)for(const reflection of centricJob.hklList.slice(0,2)){
      let real=0,imag=0;for(let z=0;z<16;z++)for(let y=0;y<16;y++)for(let x=0;x<16;x++){const phase=2*Math.PI*(reflection.h_orig*x+reflection.k_orig*y+reflection.l_orig*z)/16,v=result.map[x+16*y+256*z];real+=v*Math.cos(phase);imag-=v*Math.sin(phase);}
      check(real*real+imag*imag>1e-6,'Centric weak reflection was discarded on '+result.backend);
    }
    check(RV.solve.gpuBudget.available!==true || centricResults[1].backend==='gpu','Centric CF unexpectedly fell back from a usable GPU');
    record('Centric weak reflections survive actual CPU and GPU map readback',{backends:centricResults.map(r=>r.backend)});
    // A parameter edit invalidates launch immediately, including calls that bypass the disabled button.
    const oldIntensities=RV.solve.state.ints,countBeforeEdit=jobs.length;St.setParam('zero',ds.p.zero+.01,[ds]);
    check(q('#sv-cf-run').disabled && RV.solve.state.ints!==oldIntensities,'CF still offers stale intensities after a parameter edit');
    oldIntensities.stale=true;RV.solve.state.ints=oldIntensities;q('#sv-cf-run').disabled=false;q('#sv-cf-run').click();
    check(!S.busy && !RV.solve.state.cfRun && jobs.length===countBeforeEdit,'CF launched with stale intensities when called directly');RV.solve.state.ints=null;
    record('Parameter edits disable CF and the launch handler independently refuses stale extraction');
    check(!errors.length,'Browser errors: '+errors.join('; '));record('adaptive workflow completes without browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:e.stack || String(e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
  finally{if(restoreWorker)restoreWorker();}
})();
