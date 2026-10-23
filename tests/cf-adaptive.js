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
    record('actual CF workers execute the previewed settings with paired seeds and unchanged observations',{backend:result.best.backend,bestR:result.best.bestR});
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
    change(q('#sv-cf-trials'),'1');result=await run();const manualJob=jobs[jobs.length-1];
    check(!result.search && manualJob.thresholdSigma===1.07 && manualJob.symLambda===.3 && manualJob.weakFraction===.12 && manualJob.overlapTolTth===.037 && manualJob.overlapFwhmFraction===0,'Manual mode did not use its original numerical settings');
    record('an actual manual CF run retains its original settings and fixed overlap grouping');
    check(!errors.length,'Browser errors: '+errors.join('; '));record('adaptive workflow completes without browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:e.stack || String(e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
  finally{if(restoreWorker)restoreWorker();}
})();
