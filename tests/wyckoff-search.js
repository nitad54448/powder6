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
    // a PbO2 in P-1, Z = 2: hundreds of Wyckoff assignments, so the search must screen them
    St.setCalculation('rietveld');
    const ph=St.makePhase({name:'Synthetic PbO2',sg:St.resolveSG(2),cell:{a:4.9,b:5.6,c:6.1,alpha:88,beta:96,gamma:91},
      atoms:[{label:'Pb1',type:'Pb',x:.21,y:.27,z:.13,B:.6},{label:'O1',type:'O',x:.55,y:.12,z:.31,B:1},{label:'O2',type:'O',x:.08,y:.62,z:.37,B:1}]});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'PbO2 simulated',tth:Array.from({length:3001},(_,i)=>10+i*.02),y:Array(3001).fill(100),inst:{bkgN:1,lambda2:0,ratio:0,resolutionType:'simple_pvoigt'}})],{estimate:false,selectAll:true})[0];
    ds.p[ph.key+'.scale']=.002;ds.p.bkg0=10;ds.y=w.RVCore.evaluate(St.problemFor([ds]),0).ycalc;
    St.setCalculation('wppf');Object.keys(ds.fit).forEach(n=>ds.fit[n]=n==='bkg0');St.setSetting('maxIter',5);
    await RV.cmd.fit();
    check(RV.solve.state.ints,'WPPF did not extract intensities');
    record('WPPF intensities of a simulated P-1 PbO2 extracted',{n:RV.solve.state.ints.det.length});

    q('#tab-structure').click();await frame();
    const set=(sel,v)=>{const e=q(sel);e.value=v;e.dispatchEvent(new w.Event('input',{bubbles:true}));e.dispatchEvent(new w.Event('change',{bubbles:true}));};
    set('#sv-formula-wy','PbO2');set('#sv-z-wy','2');
    set('#sv-wy-particles','256');set('#sv-wy-iterations','10');set('#sv-wy-restarts','20');
    // ten rules: beyond the eight the kernel used to hold
    set('#sv-wy-constraints',['Pb O - /4.5','Pb O - /4.6','Pb O - /4.7','Pb O - /4.8','O O - /4.0','O O - /4.1'].join('\n'));
    await frame();
    check(!/kernel holds/.test(q('#sv-wy-cstat').textContent),'Ten rules were refused: '+q('#sv-wy-cstat').textContent);
    // fields without effect are disabled: a typed Z (no scan), no shape, no count
    check(q('#sv-wy-rhoMin').disabled && q('#sv-wy-rhoMax').disabled && q('#sv-wy-maxZ').disabled && /Z = 2 is given/.test(q('#sv-wy-maxZ').title),'Density window / Values of Z are enabled with a typed Z');
    check(q('#sv-wy-shapeWeight').disabled && q('#sv-wy-polyMoves').disabled && q('#sv-wy-polyMoves').value==='0' && /no distance rule has a count/.test(q('#sv-wy-polyMoves').title),'Shape weight / Polyhedron moves are enabled without a shape or a count, or the moves do not default to 0');
    set('#sv-z-wy','');await frame();check(!q('#sv-wy-rhoMin').disabled && !q('#sv-wy-maxZ').disabled,'Density window not enabled again for Z = Auto');set('#sv-z-wy','2');await frame();
    record('Fields without effect are disabled: density and Values of Z for a typed Z, Shape weight and Polyhedron moves without a shape or a count');
    for(const invalid of ['0','-1','2.5','invalid','Infinity']){
      set('#sv-wy-restarts',invalid);q('#sv-wy-run').click();
      check(!RV.solve.state.wyRun && !S.busy && /Restarts must be a positive whole number/.test(q('#status-msg').textContent),'Invalid restart count was silently accepted: '+invalid);
    }
    set('#sv-wy-restarts','20');
    record('Invalid restart counts are rejected before starting a worker');
    // the seed: a whole number from 0 to 2^32-1, or blank for a new one; anything else is refused before a worker starts
    for(const invalid of ['-1','2.5','abc','4294967296']){
      set('#sv-wy-seed',invalid);q('#sv-wy-run').click();await wait(50);
      check(!RV.solve.state.wyRun && !S.busy && /seed is a whole number/.test(q('#status-msg').textContent),'An invalid seed started a search: '+invalid+' — '+q('#status-msg').textContent);
    }
    set('#sv-wy-seed','');
    record('An invalid seed is refused before starting a worker');
    const Orig=w.Worker,progress=[];
    w.Worker=function(url,opts){const real=new Orig(url,opts);if(String(url).includes('wyckoff_worker'))real.addEventListener('message',e=>{if(e.data && e.data.type==='wy-progress')progress.push(e.data);});return real;};
    const before=RV.ui.logEntries().length;
    q('#sv-wy-run').click();await wait(100);w.Worker=Orig;
    check(RV.solve.state.wyRun,'The Wyckoff search did not start: '+q('#status-msg').textContent);
    check(w.document.activeElement===q('#busy-cancel'),'A running search must focus Stop');
    const end=Date.now()+200000;
    while(RV.solve.state.wyRun){if(Date.now()>end)throw Error('The Wyckoff search did not finish: '+((q('#sv-wy-prog')||{}).textContent || ''));await wait(250);}
    const shown=RV.ui.logEntries().slice(before).map(e=>e.msg).join('\n'),wy=RV.solve.state.wy;
    check(wy && !wy.error && wy.sols && wy.sols.length,'No Wyckoff result: '+(wy && wy.error)+'\n'+shown.slice(-1500));
    // the Log gets a summary; the whole search log is kept with the result (History → Search log)
    const log=(wy.log || []).join('\n');
    check(!/Screening \d+ assignments/.test(shown) && /lines of search log in History/.test(shown) && /^\s*Z = \d+: /m.test(shown),'The Log is not a summary: '+shown.slice(0,1500));
    check(/Screening \d+ assignments/.test(log) && /Screening done/.test(log),'The search did not screen: '+log.slice(0,1500));
    check(/left out as equivalent/.test(log),'Equivalent assignments were not removed');
    check(!/marker not found|exceed the kernel/.test(log),'Kernel capacity error: '+log);
    record('A long enumeration is screened, then searched in full; ten distance rules run',{assignment:wy.sols[0].assignment,R:wy.sols[0].refinement && wy.sols[0].refinement.R,
      screen:(log.match(/Screening \d+ assignments[^.]*\./) || [''])[0]});

    check(progress.some(p=>p.stage==='screen') && progress.some(p=>p.stage==='search'),'Progress did not report both stages');
    check(progress.some(p=>Array.isArray(p.bestSites) && p.bestSites.length && typeof p.assignment==='string' && Number.isFinite(p.cc)),'Progress lacks the live best structure');
    const fr=progress.map(p=>p.fraction);check(fr.every(Number.isFinite) && fr.every((f,i)=>i===0 || f>=fr[i-1]-1e-9) && fr[fr.length-1]>.8,'The progress fraction is not monotonic over the plan');
    record('Progress carries the stage, a monotonic fraction and the live best structure',{messages:progress.length});
    const full=progress.filter(p=>p.stage==='search'),waves=[...new Set(full.map(p=>p.wave))];
    check(wy.o.restarts===20 && full.every(p=>p.restarts===20),'The requested restart count changed before reaching the GPU');
    for(const wave of waves)check(full.some(p=>p.wave===wave && p.restart===20 && p.generation===p.generations-1),'A full-search wave did not complete restart 20');
    check(progress.filter(p=>p.stage==='screen').every(p=>p.restarts===1),'Screening must use one start');
    // the blank seed drew one; the search used it and the Log reports it, so the run can be repeated
    check(Number.isSafeInteger(wy.o.seed) && wy.o.seed>=0 && wy.o.seed<=4294967295,'The search did not record the seed it ran from: '+wy.o.seed);
    check(shown.includes('seed '+wy.o.seed+'.'),'The Log does not report the seed: '+shown.slice(0,400));
    check(wy.results.seed===wy.o.seed,'The search result reports a different seed than the job carried: '+wy.results.seed+' vs '+wy.o.seed);
    record('A blank seed draws one, the search runs from it and the Log and result report it',{seed:wy.o.seed});
    const cpuCheck=wy.results.wyckoffResult.cpuCheck;
    check(cpuCheck && Number.isFinite(cpuCheck.cpu) && Number.isFinite(cpuCheck.gpu) && cpuCheck.delta<=1e-3,'CPU and GPU Wyckoff fitness disagree: '+JSON.stringify(cpuCheck));
    check(wy.sols[0].refinement && Number.isFinite(wy.sols[0].refinement.R),'CPU coordinate refinement did not finish');
    record('Every full-search wave completes 20 requested starts; GPU fitness agrees with the CPU and coordinate refinement completes',{waves:waves.length,cpuCheck});

    // a shaped shell: the kernel is compiled with neighbour vectors and charges the angles
    set('#sv-wy-constraints','Pb O 6 1.9/2.9 oct');set('#sv-wy-iterations','60');set('#sv-wy-restarts','1');set('#sv-wy-seed','424242');await frame();
    check(!/not a shape|needs exactly/.test(q('#sv-wy-cstat').textContent),'The octahedron line was refused: '+q('#sv-wy-cstat').textContent);
    set('#sv-wy-constraints','Pb O 4 1.9/2.9 oc');await frame();
    check(/needs exactly 6 neighbours/.test(q('#sv-wy-cstat').textContent),'A wrong count for the shape was not reported: '+q('#sv-wy-cstat').textContent);
    set('#sv-wy-constraints','Pb O 6 1.9/2.9 oct');await frame();
    check(!q('#sv-wy-shapeWeight').disabled && !q('#sv-wy-polyMoves').disabled,'Shape weight / Polyhedron moves stay disabled with a shaped, counted rule');
    set('#sv-wy-shapeWeight','2');set('#sv-wy-polyMoves','30');await frame();
    const before2=RV.ui.logEntries().length;
    q('#sv-wy-run').click();await wait(100);
    check(RV.solve.state.wyRun,'The shaped search did not start: '+q('#status-msg').textContent);
    const end2=Date.now()+200000;
    while(RV.solve.state.wyRun){if(Date.now()>end2)throw Error('The shaped search did not finish');await wait(250);}
    const wy2=RV.solve.state.wy,log2=RV.ui.logEntries().slice(before2).map(e=>e.msg).join('\n')+'\n'+((wy2 && wy2.log) || []).join('\n');
    check(/octahedral shell/.test(log2),'The constraint log does not name the shape');
    check(/angle errors weighted 2 x/.test(log2),'The Shape weight did not reach the search');
    check(wy2 && !wy2.error && wy2.sols && wy2.sols.length && !/marker not found|WGSL|validation/i.test(log2),'The shaped search failed: '+(wy2 && wy2.error)+'\n'+log2.slice(-1200));
    record('a shaped coordination shell compiles and runs on the GPU',{assignment:wy2.sols[0].assignment});
    // the form's percentage reaches the search, for a counted shell; the first run (0 %, bare rules) had none
    check(/Polyhedron moves: 30 %/.test(log2) && !/Polyhedron moves/.test(log),'Polyhedron moves did not follow the form: '+(log2.match(/Polyhedron[^\n]*/) || ['none'])[0]);
    record('Polyhedron moves follow the form, for a counted shell only');
    // a typed seed is what the search runs from, so the run can be repeated exactly (a kept result carries it too)
    check(wy2.o.seed===424242 && wy2.results.seed===424242,'The typed seed did not reach the search: '+wy2.o.seed+' / '+(wy2.results && wy2.results.seed));
    check(log2.includes('seed 424242.'),'The Log does not report the typed seed');
    record('A typed seed reaches the worker and is reported, so a search repeats exactly');

    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
