(async function(){
  'use strict';
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function check(ok,msg){if(!ok)throw Error(msg);}
  function record(name){results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);}
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV?.state?.S.tables || !w.RV.state.S.sgReady){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,q=s=>w.document.querySelector(s),errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    St.setSetting('noBackground',true);St.setSetting('yscale','sqrt');RV.app.showTab('method');RV.app.showTab('about');
    const row='   142.5    17.0   135.8    15.9   128.3    15.6   142.6    16.3   130.9    15.7';
    const text='Instrument parameter      bl04.prm\nBANK 1   15803    3161 CONST     0.300     0.300  0.0 0.0 ESD\n'+Array(3160).fill(row).join('\n')+'\n'+row.slice(0,48);
    await RV.cmd.readFiles([new w.File([text],'sample.gsa',{type:'text/plain'})]);await frame();
    const ds=S.datasets[0],plot=RV.plots._plots.pat,obs=()=>plot.series.find(s=>s.kind==='obs');
    check(S.phases.length===0 && ds?.tth.length===15803,'GSAS pattern did not load without a phase');
    check(Math.abs(ds.tth[0]-.003)<1e-9 && Math.abs(ds.tth.at(-1)-47.409)<1e-9 && ds.sig[0]===17,'GSAS angles or errors were lost');
    check(RV.app.resultTab()==='pattern' && q('#pat-host').getBoundingClientRect().width>0,'Import did not open Plots');
    check(obs()?.y.length===15803 && Array.from(obs().y).every(Number.isFinite) && obs().y[0]===142.5,'Observed values disappeared without a phase');
    check(Number.isFinite(plot.view?.x0) && Number.isFinite(plot.view?.y1),'Plot has invalid bounds');record('Packed GSAS ESD pattern imports and plots 15803 points without a phase');
    check(S.settings.noBackground && !RV.plots.backgroundSubtracted(),'Unavailable subtraction was applied or the preference was cleared');
    check(q('#plot-note').textContent.includes('Showing observed intensities') && !plot.o.ylabel.includes('background') && plot.o.ysqrt,'Fallback label or intensity scale is wrong');record('Remembered subtraction falls back to observed intensities with accurate axes and a note');
    St.setSetting('noBackground',false);await frame();check(obs().y[0]===142.5 && q('#plot-note').textContent.includes('Observed intensities'),'Normal observed plot requires a phase or lost its calculation diagnostic');
    check(RV.cmd.why('fit').includes('No phase'),'Phase requirement was removed from fitting');record('Observed-only viewing works while fitting still requires a phase');
    const udf=await (await fetch('../test_files/sfmo_x3_299.udf')).text();
    await RV.cmd.readFiles([new w.File([udf],'sfmo_x3_299.udf',{type:'text/plain'})]);
    const imported=S.datasets.find(d=>d.name==='sfmo_x3_299');check(imported,'UDF fixture did not import');St.selectIds([imported.id]);await frame();
    const udfObs=plot.series.find(s=>s.kind==='obs' && s.ds.id===imported.id);
    check(S.phases.length===0 && udfObs?.y.length===9574 && udfObs.y[0]===239 && Math.abs(udfObs.x[0]-20.00718)<1e-9,'UDF RawScan was not plotted as counts against angle');
    check(imported.inst.lambda1===1.54060 && imported.inst.lambda2===1.54443 && imported.inst.ratio===.5,'UDF wavelength metadata was not retained');record('Supplied Philips UDF RawScan plots 9574 measured intensities without a phase');
    check(!errors.length,errors.join('; '));window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:String(e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
