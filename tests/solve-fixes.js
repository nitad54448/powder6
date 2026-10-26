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
    const ds=St.insertDatasets([St.makeDataset({name:'Controlled pattern',tth:Array.from({length:501},(_,i)=>10+i*.2),y:Array(501).fill(100),inst:{bkgN:1,lambda2:0,ratio:0,resolutionType:'simple_pvoigt'}})],{estimate:false,selectAll:true})[0];
    ds.p[ph.key+'.scale']=.002;ds.p.bkg0=10;ds.p.zero=.12;ds.y=w.RVCore.evaluate(St.problemFor([ds]),0).ycalc;
    St.setCalculation('wppf');Object.keys(ds.fit).forEach(n=>ds.fit[n]=n==='bkg0');St.setSetting('maxIter',5);
    await RV.cmd.fit();

    // 1. the zoom survives a new space group and a refit; a new selection rescales
    q('#tab-pattern').click();await frame();
    const pat=RV.plots._plots.pat;pat.view={x0:40,x1:45,y0:0,y1:500};pat.auto=false;pat.draw();
    RV.history.take('test space group');St.setPhaseSG(ph,St.resolveSG(2));await frame();await frame();
    check(pat.view.x0===40 && pat.view.x1===45 && pat.view.y1===500,'The space-group change reset the zoom: '+JSON.stringify(pat.view));
    await RV.cmd.fit();await frame();await frame();
    check(pat.view.x0===40 && pat.view.x1===45,'The refit reset the zoom: '+JSON.stringify(pat.view));
    St.setCalculation('lebail');await frame();await frame();St.setCalculation('wppf');await frame();await frame();
    check(pat.view.x0===40 && pat.view.x1===45,'Switching the method reset the zoom');
    St.setSetting('yscale','sqrt');await frame();await frame();
    check(pat.auto && pat.view.x0<15,'A new intensity scale did not rescale');St.setSetting('yscale','lin');await frame();
    record('plot zoom survives a space-group change, a refit and a method switch; a new intensity scale rescales');

    // 2. Method lists what will be fitted; WPPF with nothing ticked fits the intensities
    q('#tab-method').click();await frame();
    let target=q('#fit-target');
    check(target.querySelector('.fit-list') && /Background/.test(target.textContent) && /Chebyshev 0/.test(target.textContent) && /intensities/.test(target.textContent) && /every reflection \(WPPF\)/.test(target.textContent),'Fit list missing or incomplete: '+target.textContent);
    Object.keys(ds.fit).forEach(n=>ds.fit[n]=false);RV.bus.emit('params',{});await frame();
    check(RV.cmd.why('fit')==='' && !q('#btn-fit').disabled,'WPPF with nothing ticked is still blocked: '+RV.cmd.why('fit'));
    check(/No parameter ticked/.test(target.textContent) && /every reflection \(WPPF\)/.test(target.textContent) && !/Tick at least/.test(target.textContent),'Fit list with nothing ticked: '+target.textContent);
    await RV.cmd.fit();await frame();
    check(ds.stats && ds.stats.ok && /WPPF intensities refined/.test(ds.stats.msg) && ds.stats.nInt>0,'WPPF intensities-only fit failed: '+JSON.stringify(ds.stats && ds.stats.msg));
    ds.fit[ph.key+'.a']=true;ds.fit.bkg0=true;RV.bus.emit('params',{});await frame();
    check(/Synthetic Si · cell: a/.test(target.textContent) && /2 parameters ticked/.test(target.textContent),'Cell not listed: '+target.textContent);
    St.setCalculation('rietveld');Object.keys(ds.fit).forEach(n=>ds.fit[n]=false);RV.bus.emit('params',{});await frame();
    check(/Tick at least one parameter/.test(RV.cmd.why('fit')),'Rietveld with nothing ticked must still be refused');
    St.setCalculation('wppf');await RV.cmd.fit();await frame();
    check(RV.solve.state.ints,'An intensities-only WPPF fit did not extract intensities');
    record('Method lists every parameter group to be fitted; WPPF with nothing ticked refines the intensities',{list:target.querySelector('.fit-list') && target.querySelector('.fit-list').textContent.slice(0,120)});

    // 3. CF: an element needing fewer atoms than its peak's site holds is moved onto a nearby special position, or reported
    const p1=St.resolveSG(2),cell={a:5,b:6,c:7,alpha:90,beta:90,gamma:90};
    const site=(rank,x,y,z,h)=>({rank,x,y,z,raw:[x,y,z],height:h,relative:h/10,mult:2,wyck:'2i',element:'',use:false});
    const R={I:{ops:p1.ops,wyckoff:p1.wyckoff,cell,radiation:'xray'},sites:[site(1,.03,.02,.01,10),site(2,.3,.25,.2,5)]};
    let note=RV.solve.assignCf(R,'FeO2',1);
    const fe=R.sites[0];
    check(fe.element==='Fe' && fe.use && fe.mult===1 && /^1/.test(fe.wyck) && Math.abs(fe.x)<1e-9 && fe.snapped>0.15 && fe.snapped<0.3,'Fe was not moved onto the inversion centre: '+JSON.stringify(fe));
    check(R.sites[1].element==='O' && R.sites[1].use && !R.unplaced.length && /moved onto special positions: Fe to 1/.test(note),'O not placed or note wrong: '+note);
    R.sites=[site(1,.2,.2,.2,10),site(2,.3,.25,.2,5)];note=RV.solve.assignCf(R,'FeO2',1);
    check(R.unplaced.length===1 && /^Fe/.test(R.unplaced[0]) && /NOT PLACED: Fe/.test(note) && R.sites[0].element==='O','A far peak must not be moved and Fe must be reported: '+note);
    note=RV.solve.assignCf(R,'FeO2',1);check(R.sites[0].mult===2 && R.unplaced.length===1,'Re-assigning is not repeatable');
    record('CF moves a heavy-atom peak onto a nearby special position, and names elements it cannot place',{note});

    // 4. Wyckoff Stop: the best structure is refined, with a warning to wait
    const Orig=w.Worker;let fake=null;
    w.Worker=function(url){if(!String(url).includes('wyckoff_worker'))return new Orig(url);fake={sent:[],terminate(){},postMessage(job){this.sent.push(job.type);if(job.type==='wyckoff-search')setTimeout(()=>fake.onmessage({data:{type:'wy-progress',wave:1,waves:1,restart:1,restarts:1,generation:5,generations:10,best:.8,cc:.81,z:2,zIndex:1,zCount:1,assignment:'Si 2i',bestSites:[{element:'Si',wyckoff:'2i',multiplicity:2,x:.1,y:.2,z:.3}]}}),20);}};return fake;};
    q('#tab-structure').click();await frame();
    const fi=q('#sv-formula-wy');fi.value='Si';fi.dispatchEvent(new w.Event('input',{bubbles:true}));fi.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    // The hints are tooltips: the formula help on the input (Wyckoff search) or in the question mark of the title
    // (charge flipping, which carries the Z and density hint as well); neither row has a question mark of its own.
    const shared=k=>q('#sv-formula-'+k).getAttribute('data-formula-help'),
      dens=k=>k==='cf'?(q('[data-acc="wppf-cf"] > summary .acc-help').getAttribute('data-help')||''):q('#sv-formula-wy').title;
    check(/only to name its peaks/.test(shared('cf')) && /places these atoms and no others/.test(shared('wy')) && shared('cf')!==shared('wy'),'Formula hints are not specific: '+shared('cf')+' | '+shared('wy'));
    check(/from the highest peak/.test(dens('cf')) && /Wyckoff search tries Z/.test(dens('wy')),'Z hints are not specific: '+dens('cf')+' | '+dens('wy'));
    // The formula row carries the density hint only: the formula help of charge flipping is the question-mark icon at
    // the right end of its title, and using it must not open or close the block it explains.
    check(!q('#sv-formula-cf').closest('.sv-row').querySelector('.help-q'),'The charge-flipping formula row still carries a question-mark button');
    const cfHead=q('[data-acc="wppf-cf"] > summary'),cfHelp=cfHead.querySelector('.acc-help');
    check(cfHelp && cfHead.lastElementChild===cfHelp && cfHelp.getAttribute('aria-label')==='About the formula unit and Z' && /only to name its peaks/.test(cfHelp.getAttribute('data-help')||''),'The Charge flipping title has no help icon with the formula help: '+(cfHelp && cfHelp.outerHTML));
    const cfOpen=q('[data-acc="wppf-cf"]').open;cfHelp.click();await frame();
    check(q('[data-acc="wppf-cf"]').open===cfOpen,'The help icon toggled its block');
    record('the formula help of charge flipping is a question mark at the right of its title, and it does not toggle the block');
    fi.value='';fi.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    check(/Optional here/.test(dens('cf')) && /Required/.test(dens('wy')),'Empty-formula hints: '+dens('cf')+' | '+dens('wy'));
    fi.value='Si';fi.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    q('#sv-wy-run').click();await wait(100);
    const stops=[...w.document.querySelectorAll('button')].filter(b=>/\bStop\b/.test(b.textContent) && b.offsetParent!==null);
    check(stops.length===1 && stops[0].id==='busy-cancel' && /Wyckoff search: /.test(q('#busy-detail').textContent) && !q('#busy-guard').hidden,'Running panel: '+stops.length+' Stop buttons, detail "'+q('#busy-detail').textContent+'"');check(RV.solve.state.wyRun,'Wyckoff run did not start: '+q('#status-msg').textContent+' | button: '+q('#sv-wy-run').disabled+' '+q('#sv-wy-run').title+' | ints '+!!RV.solve.state.ints);
    RV.solve.stop();await frame();
    const prog=()=>(q('#sv-wy-prog') || {}).textContent || '';
    check(fake.sent.includes('cancel-wyckoff') && /please wait/i.test(q('#status-msg').textContent) && /refining the best structure/.test(prog()) && /please wait/.test(q('#busy-label').textContent),'Stop did not ask the user to wait: '+q('#status-msg').textContent+' | '+prog()+' | '+q('#busy-label').textContent);
    fake.onmessage({data:{type:'wy-refining',z:2}});await frame();
    check(/Refining the best structure \(Z = 2\)/.test(prog()) && /Refining the best structure \(Z = 2\)… please wait/.test(q('#busy-label').textContent),'Refining progress not shown');
    fake.onmessage({data:{type:'wy-structure',results:{sites:[{element:'SI',wyckoff:'2i',multiplicity:2,x:.11,y:.2,z:.3}],refinement:{R:.07},z:2,stopped:true,solutions:[{z:2,assignment:'SI 2i',refinement:{R:.07},sites:[{element:'SI',wyckoff:'2i',multiplicity:2,x:.11,y:.2,z:.3}]}]}}});await frame();w.Worker=Orig;
    const wy=RV.solve.state.wy;check(wy && wy.sols[0].refinement.R===.07 && wy.stopped && !S.busy,'Refined stopped result not kept');
    record('Stopping the Wyckoff search refines the best structure and tells the user to wait');

    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
