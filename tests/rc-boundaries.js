(async function(){
  'use strict';
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(ok,message)=>{if(!ok)throw Error(message);},record=name=>{results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);};
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV?.state?.S.sgReady || !w.RV.state.S.tables || !w.RV.absorption.status().loaded){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,errors=[],frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    w.addEventListener('error',e=>errors.push(e.message));w.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    await RV.cmd.defaultPresetsReady();
    const ph=St.makePhase({name:'Original structure',sg:St.resolveSG(221),cell:{a:5},atoms:[{label:'Si1',type:'Si',x:0,y:0,z:0}]});St.addPhase(ph);
    St.insertDatasets([St.makeDataset({name:'Original pattern',tth:[10,20,30],y:[1,2,1]})],{estimate:false});
    const baseline=RV.absorption.coefficient('Si',8000).value,doc=JSON.parse(St.projectJSON([]));doc.phases[0].name='Replacement structure';
    const custom={label:'Previous project table',energyUnit:'eV',elements:{Si:{unit:'cm2/g',mu:[[1000,99],[20000,99]]}}};RV.absorption.restoreUser(custom);
    RV.fourier.state.result={phaseKey:ph.key,phaseName:'Old map',dsId:S.datasets[0].id};
    const confirm=RV.ui.confirm;RV.ui.confirm=async()=>true;
    try{await RV.cmd.openProject(doc);}finally{RV.ui.confirm=confirm;}
    await frame();check(S.phases[0].key===ph.key && S.phases[0].name==='Replacement structure','Replacement project did not retain its valid identity');
    check(RV.fourier.state.result===null,'Old Fourier result survived a reused phase key');
    check(RV.absorption.exportUser()===null && RV.absorption.coefficient('Si',8000).value===baseline,'Custom absorption survived a project with no custom table');
    record('Opening a project clears old Fourier maps and restores default absorption even when phase keys are reused');
    const snapshot=()=>{const value=JSON.parse(St.projectJSON([]));delete value.saved;return JSON.stringify(value);},before=snapshot(),duplicate=JSON.parse(before);duplicate.phases.push(JSON.parse(JSON.stringify(duplicate.phases[0])));
    let rejected=false;try{await RV.cmd.openProject(duplicate);}catch(e){rejected=/duplicate phase key/i.test(e.message);}
    check(rejected && snapshot()===before,'Ambiguous phase keys were accepted or changed the project before rejection');
    S.nextPhase=1;const next=St.makePhase({name:'Fresh phase',sg:St.resolveSG(221),cell:{a:6}});check(next.key!==ph.key,'Allocator reused an occupied key');St.addPhase(next);
    let duplicateAdd=false;try{St.addPhase(next);}catch(e){duplicateAdd=/duplicate phase key/i.test(e.message);}
    check(duplicateAdd && new Set(S.phases.map(p=>p.key)).size===S.phases.length,'Runtime phase insertion allows duplicate keys');
    record('Phase allocation avoids collisions and duplicate insertion/project keys are rejected before mutation');
    let finishRead;const pending=RV.cmd.readFiles([{name:'Delayed.xy',arrayBuffer:()=>new Promise(r=>{finishRead=r;})}]);
    while(!finishRead)await wait(0);const count=S.datasets.length,selection=Array.from(S.sel).join(',');St.setBusy(true,'Import boundary test');
    finishRead(new w.TextEncoder().encode('10 1\n20 2\n30 1\n').buffer);await pending;
    check(S.busy && S.datasets.length===count && Array.from(S.sel).join(',')===selection,'A pending import changed a running calculation');St.setBusy(false);
    record('An import that finishes during a calculation leaves datasets and selection unchanged');
    check(!errors.length,errors.join('; '));record('RC boundary checks complete without browser errors');window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:e.stack||String(e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
