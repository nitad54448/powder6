(async function(){
  'use strict';
  var iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  try{
    var w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV || !w.RV.state.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timeout');await new Promise(function(r){setTimeout(r,30);});}
    var RV=w.RV,St=RV.state,S=St.S,doc=w.document,errors=[];
    w.addEventListener('error',function(e){errors.push(e.message);});
    var frame=function(){return new Promise(function(r){w.requestAnimationFrame(function(){w.requestAnimationFrame(r);});});};
    function check(ok,name){if(!ok)throw Error(name);results.push({name:name,pass:true});out.textContent=JSON.stringify(results);}
    var q=function(s){return doc.querySelector(s);};
    function change(selector,value){var el=q(selector);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
    St.setCalculation('rietveld');
    var atoms=[{label:'Si',type:'Si',x:.5,y:.5,z:.5,occ:1,B:.5}];
    [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].forEach(function(v,i){var t=2/Math.sqrt(3)/20;atoms.push({label:'O'+(i+1),type:'O',x:.5+t*v[0],y:.5+t*v[1],z:.5+t*v[2],occ:1,B:.5});});
    var ph=St.makePhase({name:'Tetrahedron',sg:St.resolveSG(1),cell:{a:20,b:20,c:20},atoms:atoms});St.addPhase(ph);
    var ds=St.insertDatasets([St.makeDataset({name:'Pattern',tth:[10,20,30],y:[1,2,1]})],{estimate:false,selectAll:true})[0];
    ph.restraints.text='Si O1 - 1.90/2.10';
    RV.app.showTab('datasets');await frame();
    var constraints=q('#dataset-constraints-host').closest('details'),restraints=q('#dataset-restraints').closest('details');constraints.open=true;restraints.open=true;
    check(constraints.querySelector('summary').textContent==='Constraints','Constraints heading renamed');
    check(w.getComputedStyle(q('.ac-host'),'::before').content==='none','no duplicate inside Constraints title');
    check(constraints.nextElementSibling===restraints && restraints.nextElementSibling.id==='dataset-links-group','Restraints is between Constraints and Links');
    check(q('#dataset-restraints .rs-main').firstElementChild.querySelector('[data-rs-text]'),'active restraints textbox comes first');
    check(!q('#dataset-restraints .rs-builder').open,'geometry helper starts collapsed');
    check(q('#dataset-restraints [data-rs-text]').value===ph.restraints.text,'textbox shows active restraints');
    q('#dataset-restraints .rs-builder').open=true;
    change('#dataset-restraints [data-rs-build="kind"]','tetrahedron');
    var add=q('#dataset-restraints [data-rs-build-add]');change('#dataset-restraints [data-rs-build="distance"]','2');
    check(add===q('#dataset-restraints [data-rs-build-add]'),'editing a number preserves the Add button for the pending click');
    for(var i=1;i<=4;i++)q('#dataset-restraints [data-rs-neighbour="O'+i+'"]').click();
    await frame();
    check(q('#dataset-restraints [data-rs-built] textarea').value.split('\n').length===10,'helper automatically proposes four bonds and six angle distances');
    check(ph.restraints.text==='Si O1 - 1.90/2.10','proposals do not change active restraints');
    q('#dataset-restraints [data-rs-build-add]').click();await frame();
    check(ph.restraints.on && ph.restraints.text.split('\n').length===10 && q('#dataset-restraints [data-rs-text]').value===ph.restraints.text,'Add appends proposed rules to the active restraints textbox');
    var saved=ph.restraints.text;q('#dataset-restraints [data-rs-build-add]').click();await frame();
    check(ph.restraints.text===saved && q('#dataset-restraints [data-rs-error]').textContent.includes('duplicate rules skipped'),'repeated Add preserves the rules and reports duplicates');
    var input=q('#dataset-restraints [data-rs-text]');input.value=saved+'\nO1 Si - 1.8/2.2';input.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    check(ph.restraints.text===saved && q('#dataset-restraints [data-rs-error]').textContent.includes('Duplicate restraint'),'manual reversed duplicate is rejected');
    RV.history.undo();await frame();
    check(S.phases[0].restraints.text==='Si O1 - 1.90/2.10','Undo restores previous rules');
    q('#dataset-restraints [data-rs-neighbour="O4"]').click();q('#dataset-restraints [data-rs-build-add]').click();await frame();
    check(q('#dataset-restraints [data-rs-error]').textContent.includes('exactly 4') && S.phases[0].restraints.text==='Si O1 - 1.90/2.10','invalid Add leaves active restraints unchanged');
    change('#dataset-restraints [data-rs-build="mode"]','symmetry');
    q('#dataset-restraints [data-rs-neighbour="O1"]').click();q('#dataset-restraints [data-rs-neighbour="O2"]').click();
    change('#dataset-restraints [data-rs-build="angleTol"]','5');await frame();
    check(q('#dataset-restraints [data-rs-built] textarea').value.includes('tetrahedron angle=5'),'symmetry mode writes counted shell with its own angular window');
    q('#dataset-restraints [data-rs-build-add]').click();await frame();check(S.phases[0].restraints.text.includes('angle=5'),'per-rule angular tolerance is saved');
    S.busy=true;RV.bus.emit('busy',true);await frame();check(q('#dataset-restraints [data-rs-build-add]').disabled,'helper disabled during calculations');S.busy=false;RV.bus.emit('busy',false);await frame();
    check(errors.length===0,'no browser errors: '+errors.join('; '));
    window.browserTestResult={ok:true,results:results};
  }catch(e){window.browserTestResult={ok:false,results:results,error:e.stack};}
  out.textContent=JSON.stringify(window.browserTestResult,null,2);
})();