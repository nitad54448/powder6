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
    St.setCalculation('rietveld');
    const phases=[4.2,5.3].map((a,i)=>St.makePhase({name:'Phase '+i,sg:St.resolveSG(1),cell:{a,b:a*1.1,c:a*1.2,alpha:90,beta:90,gamma:90},atoms:[{label:'Si1',type:'Si',x:.13,y:.21,z:.32}]}));phases.forEach(St.addPhase);
    const ds=St.insertDatasets([St.makeDataset({name:'Two phases',tth:Array.from({length:401},(_,i)=>10+i*.2),y:Array(401).fill(100),inst:{bkgN:1,lambda2:0,ratio:0}})],{estimate:false,selectAll:true})[0];
    phases.forEach(ph=>ds.p[ph.key+'.scale']=.002);ds.p.bkg0=10;ds.y=w.RVCore.evaluate(St.problemFor([ds]),0).ycalc;
    St.setCalculation('wppf');Object.keys(ds.fit).forEach(n=>ds.fit[n]=false);await RV.cmd.fit();
    let calls=0;const extract=RV.cmd.extract;RV.cmd.extract=async function(...args){calls++;return extract.apply(this,args);};
    RV.app.showTab('structure');
    async function ready(ph){const end=Date.now()+20000;while(S.busy || RV.solve.state.ints?.phaseKey!==ph.key || !q('#sv-extract-note')?.textContent.includes('available')){if(Date.now()>end)throw Error('Preparation timed out: '+q('#sv-extract-note')?.textContent+' '+JSON.stringify({calls,busy:S.busy,phase:RV.solve.state.phaseKey,ints:RV.solve.state.ints?.phaseKey,stats:ds.stats,logs:RV.ui.logEntries().slice(-3)}));await wait(40);}}
    const first=St.phaseByKey(RV.solve.state.phaseKey),other=phases.find(p=>p!==first);
    await ready(first);check(calls===1,'Initial source not prepared once');check(!q('#sv-extract,[data-sv="extract"]'),'Manual extraction button remains');record('Multiphase WPPF source is prepared automatically without a button');
    q('[data-svph="'+other.key+'"]').click();await ready(other);check(calls===2,'Second phase was not prepared');
    q('[data-svph="'+first.key+'"]').click();await ready(first);check(calls===2,'Switching back recalculated a cached source');record('Phase switching prepares new sources and reuses cached sources');
    RV.cmd.extract=async()=>{calls++;throw Error('Controlled preparation failure');};
    ds.stats=Object.assign({},ds.stats);RV.solve.state.ints=null;RV.solve.render();await wait(500);const failedCalls=calls;await wait(500);
    check(failedCalls===3 && calls===failedCalls,'Failed preparation retried continuously');check(q('#sv-extract-note').textContent.includes('did not complete'),'Failure status is missing');record('Preparation failure shows a status without a retry loop');
    RV.cmd.extract=extract;check(!errors.length,errors.join('; '));window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:String(e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
