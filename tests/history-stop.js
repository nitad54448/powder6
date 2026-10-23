(async function(){
  'use strict';
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function check(ok,message){if(!ok)throw Error(message);}
  function record(name,extra){results.push({name,pass:true,...extra});out.textContent=JSON.stringify(results,null,2);}
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV || !w.RV.state || !w.RV.state.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,q=s=>w.document.querySelector(s),errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    St.setCalculation('rietveld');
    const ph=St.makePhase({name:'Synthetic Si',sg:St.resolveSG(1),cell:{a:4.2,b:4.6,c:5.1,alpha:83,beta:94,gamma:101},atoms:[{label:'Si1',type:'Si',x:.13,y:.21,z:.32}]});St.addPhase(ph);
    let ds=St.insertDatasets([St.makeDataset({name:'Controlled pattern',tth:Array.from({length:501},(_,i)=>10+i*.2),y:Array(501).fill(100),inst:{bkgN:1,lambda2:0,ratio:0,resolutionType:'simple_pvoigt'}})],{estimate:false,selectAll:true})[0];
    ds.p[ph.key+'.scale']=.002;ds.p.bkg0=10;ds.p.zero=.12;ds.y=w.RVCore.evaluate(St.problemFor([ds]),0).ycalc;
    St.setCalculation('wppf');Object.keys(ds.fit).forEach(n=>ds.fit[n]=n==='bkg0');St.setSetting('maxIter',5);
    await RV.cmd.fit();
    q('#tab-history').click();await frame();
    q('[data-history-method="wppf"]').click();await frame();
    const detail=q('.history-detail');check(detail,'History detail missing');
    const text=detail.textContent;
    check(/All information for this run/.test(text) && /Statistics/.test(text) && /Parameters \(\d+ refined of \d+\)/.test(text) && /Instrument and background/.test(text) && /Phases \(1\)/.test(text),'History detail incomplete: '+text.slice(0,400));
    check(q('[data-history-save]') && !q('[data-history-load]') && q('[data-history-report="all"]') && q('.history-run [data-history-report]'),'History must offer save and report buttons and no Load');
    let saved=[];const stf=RV.ui.saveTextFile;RV.ui.saveTextFile=async(name,txt,mime,o)=>{saved.push({name,txt,o});return {name,downloaded:true};};
    q('.history-run [data-history-report]').click();await wait(50);q('[data-history-save]').click();await wait(50);RV.ui.saveTextFile=stf;
    check(saved.length===2 && /\.txt$/.test(saved[0].name) && /## Parameters/.test(saved[0].txt) && /\.json$/.test(saved[1].name),'Saving did not produce the report and the JSON');
    const json=JSON.parse(saved[1].txt);check(json.format==='powder6-history' && json.history.records.length>=1 && json.history.observations[0].tth.length===501 && json.reports.length===json.history.records.length,'Saved History lacks records, observations or reports');
    record('History shows every detail of a run and saves report and full JSON',{reportLines:saved[0].txt.split('\n').length,jsonKB:Math.round(saved[1].txt.length/1000)});

    // Wyckoff search hard-stopped: the page keeps the finished Z and the live best of the running Z
    const Orig=w.Worker;
    w.Worker=function(url){if(!String(url).includes('wyckoff_worker'))return new Orig(url);const fake={terminate(){},postMessage(job){if(job.type!=='wyckoff-search')return;setTimeout(()=>{
      fake.onmessage({data:{type:'wy-partial',solution:{z:1,assignment:'Si 1a',refinement:{R:.12},searchCC:.9,ranked:true,sites:[{element:'Si',wyckoff:'1a',multiplicity:1,x:.1,y:.2,z:.3}]}}});
      fake.onmessage({data:{type:'wy-progress',wave:1,waves:1,restart:1,restarts:1,generation:5,generations:10,best:.8,cc:.81,z:2,zIndex:2,zCount:2,assignment:'Si 1a, Si 1a',bestSites:[{element:'Si',wyckoff:'1a',multiplicity:1,x:.1,y:.2,z:.3},{element:'Si',wyckoff:'1a',multiplicity:1,x:.6,y:.5,z:.4}]}});
    },20);}};return fake;};
    const before=RV.fitHistory.list('wppf','wy').length;
    q('#tab-structure').click();await frame();
    const fi=q('#sv-formula-wy');fi.value='Si';fi.dispatchEvent(new w.Event('input',{bubbles:true}));fi.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    q('#sv-wy-run').click();await wait(200);
    check(RV.solve.state.wyRun,'Wyckoff run did not start: '+q('#status-msg').textContent+' ints='+!!RV.solve.state.ints+' formula='+RV.solve.state.opts.formula);
    RV.solve.stop();await wait(20);RV.solve.stop();await frame();w.Worker=Orig;
    const wy=RV.solve.state.wy;
    check(wy && !wy.error && wy.sols.length===2 && wy.salvaged && wy.sols[0].z===1 && wy.sols[1].unrefined && wy.sols[1].sites.length===2,'Stopped Wyckoff result was not kept: '+JSON.stringify(wy && (wy.error || wy.sols)));
    check(RV.fitHistory.list('wppf','wy').length===before+1 && !S.busy,'Stopped Wyckoff result missing from History or editing locked');
    RV.layout.structureResult('wy');await frame();
    check(/Kept the best structure/.test(q('#sv-wy-sol').textContent) && /not refined/.test(q('#sv-wy-sol').textContent),'Salvaged result not explained: '+q('#sv-wy-sol').textContent.slice(0,300));
    record('a hard-stopped Wyckoff search keeps the finished Z and the live best, in the panel and in History');

    // Set on a Wyckoff record restores the extraction it came from, not a field nobody reads
    const wyRec=RV.fitHistory.list('wppf','wy').pop(),savedI=wyRec.solution.I;
    RV.solve.state.ints=null;RV.solve.state.wy=null;
    RV.fitHistory.restore(wyRec.id);await frame();
    const sv=RV.solve.state;
    check(sv.wy && sv.wy.sols.length===2 && sv.ints && sv.ints.stamp===savedI.stamp && sv.ints.phaseKey===savedI.phaseKey && sv.dsId===savedI.dsId && sv.extractions[sv.dsId].I===sv.ints && sv.extractions[sv.dsId].stats===St.byId(sv.dsId).stats,'Set did not restore the solution intensities: '+JSON.stringify({ints:!!sv.ints,ds:sv.dsId}));
    check(!('I' in sv),'Set still writes the unused state.I');
    record('Set on a Wyckoff record restores the solution and the intensities it was made from');

    // Delete asks first; Cancel keeps the run, OK removes it and Ctrl+Z brings it back
    q('#tab-history').click();await frame();q('[data-history-method="wppf"]').click();await frame();
    const target=RV.fitHistory.list('wppf','wy')[0];RV.fitHistory.keep(target.id,true);RV.fitHistory.inspect(target.id);await frame();
    const conf=RV.ui.confirm;let asked='';RV.ui.confirm=async(msg)=>{asked=msg;return false;};
    q('[data-history-delete="'+target.id+'"]').click();await wait(30);
    check(/kept/.test(asked) && RV.fitHistory.find(target.id),'Delete of a kept run did not ask, or Cancel removed it');
    RV.ui.confirm=async()=>true;q('[data-history-delete="'+target.id+'"]').click();await wait(30);RV.ui.confirm=conf;
    check(!RV.fitHistory.find(target.id),'Confirmed delete did not remove the run');
    RV.cmd.undo();await frame();check(RV.fitHistory.find(target.id),'Ctrl+Z did not restore the deleted run');
    record('Delete asks first, Cancel keeps the run and Ctrl+Z restores a deleted one');
    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
