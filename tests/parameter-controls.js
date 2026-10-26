(async function(){
  'use strict';
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(ok,message)=>{if(!ok)throw Error(message);},record=name=>{results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);};
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV?.state?.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timed out');await wait(30);}
    const RV=w.RV,St=RV.state,S=St.S,q=s=>w.document.querySelector(s),errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    function change(el,value){el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
    St.setCalculation('rietveld');St.store('fitmode','single');
    const ph=St.makePhase({name:'Atoms',sg:St.resolveSG(1),cell:{a:5,b:6,c:7},atoms:[{label:'Si1',type:'Si',x:.1,y:.2,z:.3},{label:'O1',type:'O',x:.4,y:.5,z:.6}]});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'One',tth:[10,20,30],y:[10,20,10]})],{estimate:false,selectAll:true})[0];
    RV.app.showTab('datasets');await frame();
    const parameters=q('#dataset-limits-group'),links=q('#dataset-links-group');parameters.open=true;
    check(parameters.querySelector('.acc-t').textContent==='Parameters' && parameters.nextElementSibling===links,'Parameters title or order is wrong');
    check(!q('#limits [data-shared]') && q('#fit-sharing').hidden && links.hidden && !q('[data-first-link]').hidden,'Single-dataset controls expose unused sharing or an empty Links block');
    record('Parameters precedes Links; a single dataset hides Shared and empty Links');
    q('[data-first-link] [data-add-link]').click();await frame();
    change(q('#dlg [data-key="sourceName"]'),ph.key+'.Si1.B');change(q('#dlg [data-key="targetName"]'),ph.key+'.O1.B');
    change(q('#dlg [data-key="factor"]'),'1.5');change(q('#dlg [data-key="offset"]'),'.1');q('#dlg .btns .primary').click();await frame();
    check(S.parameterLinks.length===1 && !links.hidden && q('[data-first-link]').hidden && q('#dataset-links [data-remove-link]'),'First link did not reveal Links for a single-dataset relationship');
    record('The first link can be added from Parameters and reveals Links without requiring multiple datasets');
    const second=St.insertDatasets([St.makeDataset({name:'Two',tth:[10,20,30],y:[10,20,10]})],{estimate:false,selectAll:true})[0];
    St.selectAll();RV.workspace.inspectDataset(ds.id);await frame();
    check(!q('#limits [data-shared]') && q('#fit-sharing').hidden,'Individual fits expose Shared with multiple datasets');
    St.store('fitmode','global');RV.bus.emit('fitmode');await frame();
    check(q('#limits tr[data-name="'+ph.key+'.a"] [data-shared]') && !q('#fit-sharing').hidden,'Global sharing controls did not appear');
    check(!q('#limits tr[data-name="bkg0"] [data-shared]') && !q('#limits tr[data-name="'+ph.key+'.O1.B"] [data-shared]'),'Local backgrounds or dependent link targets expose a Shared checkbox');
    const extra=St.makePhase({name:'Only in One',sg:St.resolveSG(1),cell:{a:8,b:9,c:10}});St.addPhase(extra);St.setPhaseIn([second],extra,false);await frame();
    check(!q('#limits tr[data-name="'+extra.key+'.a"] [data-shared]'),'A phase held by only one selected dataset exposes Shared');
    record('Shared appears only in global fits for independent parameters held by multiple selected datasets');
    St.setShared(ph.key+'.a',false);St.store('fitmode','single');RV.bus.emit('fitmode');await frame();
    check(!q('#limits [data-shared]') && q('#fit-sharing').hidden && !/shared/i.test(q('#lim-reset').textContent),'Individual mode retained irrelevant sharing controls');
    q('#lim-reset').click();await frame();check(S.shared[ph.key+'.a']===false,'Resetting visible limits changed hidden sharing flags');
    St.store('fitmode','global');RV.bus.emit('fitmode');await frame();
    check(!q('#limits tr[data-name="'+ph.key+'.a"] [data-shared]').checked,'Returning to global mode lost the sharing preference');
    St.selectIds([ds.id]);await frame();
    check(!q('#limits [data-shared]') && q('#fit-sharing').hidden && !links.hidden,'A one-dataset selection retained sharing or hid an existing link');
    links.open=true;q('#dataset-links [data-remove-link]').click();await frame();
    check(!S.parameterLinks.length && links.hidden && !q('[data-first-link]').hidden,'Removing the last link did not hide Links and restore the first-link action');
    record('Mode and selection changes preserve settings; removing the last link hides Links again');
    check(!errors.length,errors.join('; '));window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',error:e.stack||String(e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
