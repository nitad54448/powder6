(async function(){
  'use strict';
  const out=document.getElementById('results'),w=document.getElementById('app').contentWindow,results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const record=(name,extra)=>{results.push({name,pass:true,...extra});out.textContent=JSON.stringify(results,null,2);};
  try{
    const deadline=Date.now()+20000;
    while(!w.RV?.state.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,K=w.SGConvert,errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    w.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    const P1=St.resolveSG(1),norm=(cell,g)=>w.normaliseCell(cell,g.system,g.uniqueAxis);
    const cub=a=>({a,b:a,c:a,alpha:90,beta:90,gamma:90});
    const cases=[
      [225,cub(5.64),[{label:'Na',type:'Na',x:0,y:0,z:0},{label:'Cl',type:'Cl',x:.5,y:.5,z:.5}]],
      [227,cub(5.43),[{label:'Si',type:'Si',x:0,y:0,z:0}]],
      [62,{a:5.44,b:7.64,c:5.38,alpha:90,beta:90,gamma:90},[{label:'Ca',type:'Ca',x:.05,y:.25,z:.99},{label:'Ti',type:'Ti',x:0,y:0,z:.5},{label:'O1',type:'O',x:.48,y:.25,z:.08},{label:'O2',type:'O',x:.29,y:.04,z:.71}]],
      [166,{a:4.38,b:4.38,c:30.5,alpha:90,beta:90,gamma:120},[{label:'Bi',type:'Bi',x:0,y:0,z:.4},{label:'Te1',type:'Te',x:0,y:0,z:0},{label:'Te2',type:'Te',x:0,y:0,z:.21}]],
      [186,{a:3.25,b:3.25,c:5.21,alpha:90,beta:90,gamma:120},[{label:'Zn',type:'Zn',x:1/3,y:2/3,z:0},{label:'O',type:'O',x:1/3,y:2/3,z:.382}]],
      [15,{a:9.7,b:8.8,c:5.3,alpha:90,beta:107,gamma:90},[{label:'Fe',type:'Fe',x:0,y:.2,z:.25},{label:'O',type:'O',x:.31,y:.12,z:.05}]]
    ];
    // Start from the actual button before the WASM module has been loaded.
    const cold=cases[2],coldAtoms=K.convertStructure(cold[2],St.resolveSG(62).ops,P1.ops,cold[1],K.IDENTITY,[0,0,0]).atoms;
    const coldPhase=St.makePhase({name:'Cold-start Pnma',sg:P1,cell:cold[1],atoms:coldAtoms});St.addPhase(coldPhase);RV.app.showTab('structure');
    const coldButton=w.document.querySelector('#sv-addsym'),testButton=w.document.querySelector('[data-sv="sgt"]');
    check(w.getComputedStyle(coldButton).backgroundColor===w.getComputedStyle(testButton).backgroundColor,'ADDSYM button does not use the Test button’s blue styling');
    coldButton.click();
    const coldDeadline=Date.now()+5000;
    while(!w.document.querySelector('[data-symmetry-report]')?.textContent.includes('higher than P1')){if(Date.now()>coldDeadline)throw Error('First ADDSYM click did not load the engine and find Pnma');await wait(20);}
    w.document.querySelector('#dlg .btns button').click();St.removePhase(coldPhase.key);
    record('Blue ADDSYM button loads the local engine on its first click and finds Pnma');
    // The dialog uses a worker; load the independent main-thread API for the
    // direct scientific checks below.
    await K.loadWasm();
    for(const [number,cell,sites] of cases){
      // Diamond uses origin choice 1 here, so finding origin choice 2 must
      // return a working shift as well as the right group number.
      const sg=St.resolveSG(number,number===227?w.SG_ENGINE.listSettings(227)[0].hall:undefined);
      const full=K.convertStructure(sites,sg.ops,P1.ops,cell,K.IDENTITY,[0,0,0]).atoms;
      const t=performance.now(),r=K.findSymmetryWasm(full,P1.ops,cell,[],{tol:.05,lenTol:.01,angTol:1,normalise:norm});
      check(r.group.number===number,'Moyo group '+number+': '+r.group.number);
      const converted=K.convertStructure(full,P1.ops,r.group.ops,cell,r.P,r.p,{tol:.05,cell:norm(r.cell,r.group)});
      check(!converted.violations.length,'Moyo conversion '+number+': '+converted.violations.join('; '));
      check(converted.atoms.length===sites.length,'Wrong orbit count for '+number);
      check(converted.maxShift<1e-5,'Exact atoms moved for '+number);
      record('Local Moyo finds and converts group '+number,{ms:performance.now()-t});
    }
    const nacl=cases[0],fullNaCl=K.convertStructure(nacl[2],St.resolveSG(225).ops,P1.ops,nacl[1],K.IDENTITY,[0,0,0]).atoms;
    let rejected=false;
    try{K.findSymmetryWasm(fullNaCl,P1.ops,{...nacl[1],c:5.67},[],{tol:.2,lenTol:.001,angTol:1,normalise:norm});}catch(e){rejected=/cell tolerance/.test(e.message);}
    check(rejected,'Angle tolerance overrode the stricter length tolerance');
    const displaced=fullNaCl.map(a=>({...a}));displaced.find(a=>a.type==='Cl').z+=.01;
    const approximate=K.findSymmetryWasm(displaced,P1.ops,nacl[1],[],{tol:.2,normalise:norm});
    check(approximate.ops.some(o=>o.dev>.01),'Approximate symmetry reports zero atomic mismatch');
    record('Symmetry respects independent cell tolerances and reports actual atomic mismatch');
    const pnma=cases[2],pnmaFull=K.convertStructure(pnma[2],St.resolveSG(62).ops,P1.ops,pnma[1],K.IDENTITY,[0,0,0]).atoms;
    const phase=St.makePhase({name:'Pnma in P1',sg:P1,cell:pnma[1],atoms:pnmaFull});St.addPhase(phase);
    RV.app.showTab('structure');
    check(!w.document.querySelector('#pane-phases [data-act="find-symmetry"]'),'ADDSYM still lives in the Phases toolbar');
    check(w.document.querySelector('[data-acc="sgt-test"]') && w.document.querySelector('[data-acc="sgt-addsym"]'),'Space group is missing Test or ADDSYM');
    w.document.querySelector('#sv-addsym').click();
    const reportDeadline=Date.now()+5000;
    while(!w.document.querySelector('#dlg').open || !w.document.querySelector('#dlg h2')?.textContent.includes(phase.name) || !w.document.querySelector('[data-symmetry-report]')?.textContent.includes('Pnma')){if(Date.now()>reportDeadline)throw Error('Pnma missing from symmetry dialog: '+w.document.querySelector('#dlg').textContent);await wait(20);}
    check(w.document.querySelector('[data-symmetry-report]').textContent.includes('higher than P1'),'Pnma was not recognised as higher symmetry');
    // Press Enter before the 300 ms preview debounce runs: the submitted
    // tolerance, rather than the previous preview's tolerance, must be used.
    const tolerance=w.document.querySelector('#dlg [data-key="tol"]');tolerance.value='.03';
    tolerance.dispatchEvent(new w.Event('input',{bubbles:true}));
    tolerance.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    // Enter submits Convert, which converts at once with the result at the submitted tolerance
    const convertDeadline=Date.now()+5000;
    while(phase.sg.number!==62){if(Date.now()>convertDeadline)throw Error('Conversion did not happen: '+w.document.querySelector('#status-msg').textContent+' | '+w.document.querySelector('#dlg').textContent);await wait(20);}
    check(!w.document.querySelector('#dlg').open,'The dialog stayed open after converting');
    check(phase.sg.number===62 && phase.atoms.length===4,'Pnma conversion failed');
    record('Find higher symmetry dialog identifies Pnma and converts the phase');
    const empty=St.makePhase({name:'Cell only',sg:P1,cell:pnma[1],atoms:[]});St.addPhase(empty);RV.app.showTab('structure');
    const phaseChoice=w.document.querySelector('#sv-sym-phase');
    phaseChoice.value=empty.key;phaseChoice.dispatchEvent(new w.Event('change',{bubbles:true}));
    check(w.document.querySelector('#sv-addsym').disabled,'ADDSYM accepts a phase without atoms');
    phaseChoice.value=phase.key;phaseChoice.dispatchEvent(new w.Event('change',{bubbles:true}));
    check(!w.document.querySelector('#sv-addsym').disabled && !RV.solve.state.ints,'ADDSYM incorrectly requires a WPPF fit');
    const unchanged=JSON.stringify(phase.v);w.document.querySelector('#sv-addsym').click();
    const unchangedDeadline=Date.now()+5000;
    while(!w.document.querySelector('[data-symmetry-report]')?.textContent.includes('No symmetry beyond Pnma')){if(Date.now()>unchangedDeadline)throw Error('Already-symmetric phase is not reported correctly');await wait(20);}
    w.document.querySelector('#dlg .btns .primary').click();
    check(w.document.querySelector('#dlg').open && !w.document.querySelector('[data-convert-preview]') && JSON.stringify(phase.v)===unchanged,'ADDSYM offered an invalid conversion when no higher symmetry exists');
    w.document.querySelector('#dlg .btns button').click();
    record('ADDSYM selects any atomic phase independently of the powder-intensity Test');
    St.removePhase(empty.key);
    // The same dataset IDs are deliberately reused across project boundaries.
    const d=St.makeDataset({name:'Project wavelength',tth:Array.from({length:401},(_,i)=>10+i*.2),y:Array(401).fill(100),inst:{lambda1:.71073,lambda2:0,ratio:0,radiation:'neutron',pol:'none',bkgN:3}});
    S.datasets.push(d);St.selectIds([d.id]);
    St.setInstrument([d],{lambda1:.71073,lambda2:0,ratio:0,radiation:'neutron',pol:'none'});
    St.store('fitmode','global');St.setSetting('maxIter',17);
    RV.solve.state.opts.formula='Ca Ti O3';RV.solve.state.opts.wy.rhoMin=3.2;
    const saved=await RV.project.pack();
    St.setInstrument([d],{lambda1:1.788965,lambda2:1.79285,ratio:.5,radiation:'xray',pol:'tube'});
    St.setSetting('maxIter',99);St.store('fitmode','single');
    RV.solve.state.opts.formula='STALE';RV.solve.state.opts.wy.rhoMin=99;
    RV.solve.state.extractions[d.id]={I:{lambda:1.788965},stats:d.stats};
    RV.ui.confirm=async()=>true;
    const bytes=new w.Uint8Array(saved);
    await RV.cmd.readFiles([{name:'regression.project',arrayBuffer:async()=>bytes.buffer}]);
    await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    const restored=S.datasets[0];
    check(restored.inst.lambda1===.71073 && restored.inst.lambda2===0 && restored.inst.ratio===0,'Old wavelength/doublet survived project load');
    check(St.problemFor([restored]).datasets[0].lambda1===.71073,'Fit uses old wavelength');
    check(S.settings.inst.lambda1===.71073,'New dataset defaults use old wavelength');
    check(S.settings.maxIter===17 && St.load('fitmode')==='global','Numerical settings did not restore');
    check(RV.solve.state.opts.formula==='Ca Ti O3' && RV.solve.state.opts.wy.rhoMin===3.2,'Structure search settings did not restore');
    check(!Object.values(RV.solve.state.extractions).some(e=>e.I.lambda===1.788965),'Old extraction cache survived project load');
    RV.app.showTab('datasets');await wait(100);
    const datasetHelp=w.document.querySelector('#dataset-info-help');datasetHelp.dispatchEvent(new w.Event('pointerover',{bubbles:true}));await wait(50);
    check(w.document.querySelector('#help-pop').textContent.includes('0.71073'),'Dataset inspector tooltip shows old wavelength');
    record('Opening a project replaces instrument, fit/search options, defaults and extraction caches');
    const legacy=JSON.parse(St.projectJSON([]));delete legacy.solutionState;delete legacy.fitmode;
    await RV.cmd.readFiles([{name:'legacy.json',arrayBuffer:async()=>new w.TextEncoder().encode(JSON.stringify(legacy)).buffer}]);
    check(RV.solve.state.opts.formula==='' && St.load('fitmode')==='single','Legacy project inherited the previous search/fit options');
    record('Older projects use clean defaults for missing fields');
    check(!errors.length,errors.join('\n'));
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:e.stack});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
