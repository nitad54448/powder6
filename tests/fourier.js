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
    // data from NaCl (Na and Cl), then a model that has only Na
    St.setCalculation('rietveld');
    const ph=St.makePhase({name:'NaCl',sg:St.resolveSG(225),cell:{a:5.64},atoms:[{label:'Na1',type:'Na',x:0,y:0,z:0,B:0.8,occ:1},{label:'Cl1',type:'Cl',x:.5,y:0,z:0,B:0.8,occ:1}]});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'NaCl pattern',tth:Array.from({length:1200},(_,i)=>15+i*.06),y:Array(1200).fill(100),inst:{bkgN:1,lambda2:0,ratio:0}})])[0];
    ds.p[ph.key+'.scale']=.0004;ds.p.bkg0=10;ds.y=w.RVCore.evaluate(St.problemFor([ds]),0).ycalc;
    St.removeAtom(ph,'Cl1');
    St.setCalculation('wppf');Object.keys(ds.fit).forEach(n=>ds.fit[n]=false);St.setSetting('maxIter',10);
    ds.fit[ph.key+'.a']=false;
    check(ph.method==='wppf' || (RV.cmd.setMethod(ph,'wppf'),true),'x');
    await RV.cmd.fit();await frame();
    q('#tab-structure').click();await frame();
    const sv=RV.solve.state;
    check(sv.ints && !sv.ints.stale,'No WPPF intensities after the fit');
    check(q('#sv-fo-status') && q('[data-fo="run"]'),'The Fourier map block is missing from Structure');
    check(!q('[data-fo="run"]').disabled,'Compute the map is disabled although the atoms and the WPPF intensities are there');
    record('the Fourier map block is part of Commands → Structure');

    // difference map: a peak where the missing Cl is
    RV.fourier.state.opts.type='diff';RV.fourier.run();await frame();
    const R=RV.fourier.state.result;
    check(R,'No map: '+q('#sv-fo-status').textContent);
    const top=R.res.peaks[0];
    const near=[[.5,0,0],[0,.5,0],[0,0,.5],[.5,.5,.5]].some(c=>Math.hypot(...[top.x,top.y,top.z].map((v,i)=>{const d=v-c[i];return (d-Math.round(d))*5.64;}))<0.3);
    check(top.sign===1 && top.sigmas>3 && near,'The strongest difference peak is not at the missing Cl: '+JSON.stringify(top));
    check(RV.layout.structureKind()==='fo' && !q('#structure-result-fo').hidden,'The result did not switch to Fourier map');
    check(q('#sv-fo-peaks table') && q('[data-fo-add]'),'No peak table with Add atom');
    record('a difference map of a Na-only model has its strongest peak on the Cl site',{sigma:top.sigmas,d:top.distance});

    // the viewer
    q('#tab-structure-results').click && q('#tab-structure-results').click();await frame();await wait(200);
    check(/Fourier|Difference/.test(q('#sv-fo-note').textContent) || /Map display/.test(q('#sv-fo-note').textContent),'The viewer wrote no note: '+q('#sv-fo-note').textContent);
    record('the map is shown in Results → Structure',{note:q('#sv-fo-note').textContent.slice(0,120)});

    // observed map and a coarser resolution
    RV.fourier.state.opts.type='obs';RV.fourier.state.opts.dmin='1.2';RV.fourier.run();await frame();
    check(RV.fourier.state.result.res.dmin>=1.2 && RV.fourier.state.result.res.peaks.length>=1,'Observed map failed');
    record('observed map at a chosen resolution');

    // no atoms: refused with a reason, and the button says so before it is pressed
    const empty=St.makePhase({name:'Empty',sg:St.resolveSG(225),cell:{a:5}});St.addPhase(empty);sv.phaseKey=empty.key;RV.fourier.run();await frame();
    check(/no atoms|Choose a phase|not ready/.test(q('#sv-fo-status').textContent),'An empty phase was not refused: '+q('#sv-fo-status').textContent);
    check(q('[data-fo="run"]').disabled && /no atoms/.test(q('[data-fo="run"]').title),'Compute the map is enabled for a phase without atoms');
    record('a phase without atoms is refused with a message, and the button is disabled with the same reason');
    // a phase with atoms but no intensities (a dataset that was not fitted by WPPF) keeps it disabled
    sv.phaseKey=ph.key;sv.dsId=null;RV.fourier.sync();
    check(q('[data-fo="run"]').disabled,'Compute the map is enabled without a chosen dataset');
    sv.dsId=ds.id;RV.fourier.sync();await frame();
    record('the button follows the phase, the dataset and the intensities');

    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
