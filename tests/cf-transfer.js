(async function(){
  'use strict';
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function check(ok,message){if(!ok)throw Error(message);}
  function record(name){results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);}
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV || !w.RV.state || !w.RV.state.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,q=s=>w.document.querySelector(s),errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    function change(el,value){if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
    St.setCalculation('wppf');
    const ph=St.makePhase({name:'Source',sg:St.resolveSG(1),cell:{a:5,b:5,c:5},atoms:[{label:'Si1',type:'Si',x:.1,y:.2,z:.3}]});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'Pattern',tth:Array.from({length:100},(_,i)=>10+i*.5),y:Array(100).fill(100),inst:{bkgN:1,lambda2:0,ratio:0}})],{estimate:false,selectAll:true})[0];
    const I={phaseKey:ph.key,phaseName:ph.name,dsId:ds.id,dsName:ds.name,sg:ph.sg,cell:St.cellOf(ph,ds.p),ops:ph.ops,wyckoff:ph.wyckoff,stamp:new Date().toISOString(),lambda:ds.inst.lambda1,radiation:'xray',det:[]};
    // A stronger excluded peak must not consume the formula's atom assignment.
    RV.solve.state.cf={I,stamp:I.stamp,formula:'Na',nameFromFormula:false,
      sites:[{rank:1,x:.1,y:.2,z:.3,height:100,relative:.5,mult:1,wyck:'1a',element:'Na',use:true},
        {rank:2,x:.4,y:.5,z:.6,height:200,relative:1,mult:1,wyck:'1a',element:'Na',use:false}],
      best:{bestR:.12,bestIter:9,gridSize:8,backend:'cpu',symLambda:0,weakFraction:.15,rHistory:[.7,.2]},
      structure:null,o:{peakMerge:.9},n:2,trials:1,trialsDone:1,bestTrial:1,seconds:1,note:'Test intensities'};
    RV.solve.state.opts.formula='Si';RV.solve.state.opts.z='1';
    RV.fitHistory.solution('cf',RV.solve.state.cf);
    const run=RV.fitHistory.list('wppf','cf').slice(-1)[0],saved=JSON.stringify(run),model=()=>JSON.stringify({phases:S.phases.map(RV.fitHistory.phaseDoc),datasets:S.datasets.map(d=>({id:d.id,p:d.p,phases:d.phases}))});
    q('#tab-structure').click();RV.layout.structureResult('cf',run.id);await frame();
    const before=model();check(q('#sv-cf-assign').type==='checkbox' && !q('[data-sv="cf-assign"]'),'CF naming remains an action button');
    change(q('#sv-cf-assign'),true);await frame();
    check(model()===before && q('[data-cfel="0"]').value==='Na' && JSON.stringify(RV.fitHistory.find(run.id))===saved,'Naming checkbox changed the model, site names or saved run before transfer');
    record('CF naming is a deferred checkbox and preserves the model and archived sites');
    async function copy(name){
      q('[data-sv="cf-export"]').click();await frame();check(q('#dlg').open,'Copy dialog did not open');
      change(q('#dlg [data-key="target"]'),'new');change(q('#dlg [data-key="name"]'),name);change(q('#dlg [data-key="targets"]'),'dataset:'+ds.id);change(q('#dlg [data-key="riet"]'),false);
      q('#dlg .primary').click();await frame();await frame();return S.phases.find(p=>p.name===name);
    }
    let added=await copy('Formula named');
    check(added && added.atoms.length===1 && added.atoms[0].type==='Si','Formula naming failed, or an excluded site was copied');
    check(JSON.stringify(RV.fitHistory.find(run.id))===saved,'Formula transfer mutated the saved CF result');
    record('formula transfer uses the current formula and selected sites while preserving the archived run');
    RV.history.undo();await frame();RV.app.showTab('structure');RV.layout.structureResult('cf',run.id);await frame();
    change(q('#sv-cf-assign'),true);change(q('[data-cfel="0"]'),'Cl');await frame();
    check(!q('#sv-cf-assign').checked,'Manual element edit did not turn off automatic formula naming');
    added=await copy('Manual names');
    check(added && added.atoms.length===1 && added.atoms[0].type==='Cl','Unchecked formula naming overwrote the edited element');
    record('manual element edits disable formula naming and transfer their edited types');
    RV.history.undo();await frame();RV.app.showTab('structure');RV.layout.structureResult('cf',run.id);await frame();
    const beforeCancel=model();change(q('#sv-cf-assign'),true);q('[data-sv="cf-export"]').click();await frame();q('#dlg .btns button').click();await frame();
    check(model()===beforeCancel && JSON.stringify(RV.fitHistory.find(run.id))===saved,'Cancelling formula transfer changed the model or saved result');
    record('cancelling atom transfer leaves the model and saved result unchanged');
    change(q('#sv-formula-cf'),'???');q('[data-sv="cf-export"]').click();await frame();
    check(!q('#dlg').open && model()===beforeCancel,'An invalid current formula was used for atom transfer');
    change(q('#sv-formula-cf'),'Si');record('formula naming validates the current command formula before transfer');
    change(q('[data-cfuse="0"]'),false);q('[data-sv="cf-export"]').click();await frame();
    check(!q('#dlg').open && model()===beforeCancel,'Formula naming silently selected an excluded site');
    record('formula naming cannot transfer when all sites are excluded');
    check(!errors.length,'Browser errors: '+errors.join('; '));record('CF transfer has no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:e.stack || String(e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
