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
    set('#sv-wy-particles','256');set('#sv-wy-iterations','100');set('#sv-wy-restarts','1');
    // ten rules: beyond the eight the kernel used to hold
    set('#sv-wy-constraints',['Pb O - /4.5','Pb O - /4.6','Pb O - /4.7','Pb O - /4.8','O O - /4.0','O O - /4.1'].join('\n'));
    await frame();
    check(!/kernel holds/.test(q('#sv-wy-cstat').textContent),'Ten rules were refused: '+q('#sv-wy-cstat').textContent);
    const Orig=w.Worker,progress=[];
    w.Worker=function(url,opts){const real=new Orig(url,opts);if(String(url).includes('wyckoff_worker'))real.addEventListener('message',e=>{if(e.data && e.data.type==='wy-progress')progress.push(e.data);});return real;};
    const before=RV.ui.logEntries().length;
    q('#sv-wy-run').click();await wait(100);w.Worker=Orig;
    check(RV.solve.state.wyRun,'The Wyckoff search did not start: '+q('#status-msg').textContent);
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

    // a shaped shell: the kernel is compiled with neighbour vectors and charges the angles
    set('#sv-wy-constraints','Pb O 6 1.9/2.9 oct');set('#sv-wy-iterations','60');await frame();
    check(!/not a shape|needs exactly/.test(q('#sv-wy-cstat').textContent),'The octahedron line was refused: '+q('#sv-wy-cstat').textContent);
    set('#sv-wy-constraints','Pb O 4 1.9/2.9 oc');await frame();
    check(/needs exactly 6 neighbours/.test(q('#sv-wy-cstat').textContent),'A wrong count for the shape was not reported: '+q('#sv-wy-cstat').textContent);
    set('#sv-wy-constraints','Pb O 6 1.9/2.9 oct');set('#sv-wy-shapeWeight','2');await frame();
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
    // a counted rule turns the polyhedron moves on; the ten bare rules of the first run did not
    check(/Polyhedron moves: 30 %/.test(log2) && !/Polyhedron moves/.test(log),'Polyhedron moves are not on for a counted shell only: '+(log2.match(/Polyhedron[^\n]*/) || ['none'])[0]);
    record('a counted shell turns the polyhedron moves on');

    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
