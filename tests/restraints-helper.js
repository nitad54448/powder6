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
    check(!q('#dataset-restraints .rs-builder') && !q('#dataset-restraints .rs-guide'),'helpers are absent from the inline editor');
    check(!q('#dataset-restraints [data-rs-on]'),'no Apply checkbox');
    check(q('#dataset-restraints .ac-phase h3 .sw-inline'),'phase heading has its colour swatch');
    check(!q('#dataset-restraints .rs-rule-help') && q('#dataset-restraints [aria-label="Restraint rules and tolerances"]').title.includes('angle=3'),'rule explanation is an inline tooltip');
    check(q('[data-constraints-help]').title.includes('Equivalence') && !q('#dataset-atomic-constraints .ac-help'),'constraint rules appear only in the inline help icon');
    check(q('#dataset-restraints [data-rs-text]').value===ph.restraints.text,'textbox shows active restraints');
    check(q('#dataset-restraints').firstElementChild.classList.contains('hint') && q('#dataset-restraints').firstElementChild.nextElementSibling.classList.contains('ac-phase') && q('#dataset-restraints').querySelectorAll('[aria-label="Restraint rules and tolerances"]').length===1,'restraint description and help appear once before the phase headings');
    check(q('#dataset-copy').previousElementSibling.id==='dataset-links-group' && !q('#dataset-copy').nextElementSibling,'Copy accordion is last below Links');
    var second=St.insertDatasets([St.makeDataset({name:'Other',tth:[10,20,30],y:[1,2,1]})],{estimate:false,select:false})[0];RV.bus.emit('datasets');await frame();
    check(!q('#dataset-copy').hidden && q('#dataset-copy .clone-bar'),'Copy controls are in their accordion');
    var copied='';Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async function(text){copied=text;}}});
    q('#dataset-restraints [data-rs-helper]').click();await frame();
    check(q('#dlg').open && q('#dlg [role="tablist"]').textContent==='GeometryMoleculeSuggest','Helper has three tabs');
    var original=ph.restraints.text;
    change('#dlg [data-rs-build="kind"]','tetrahedron');
    var add=q('#dlg [data-rs-build-add]');change('#dlg [data-rs-build="distance"]','2');
    check(add===q('#dlg [data-rs-build-add]'),'numeric editing preserves the Add button');
    for(var i=1;i<=4;i++)q('#dlg [data-rs-neighbour="O'+i+'"]').click();
    q('#dlg [data-rs-build-add]').click();await frame();
    var collected=function(){return q('#dlg [data-rs-collected]');};
    check(collected().value.split('\n').length===10 && ph.restraints.text===original,'Geometry Add collects rules without changing the dataset');
    var draft=collected().value;q('#dlg [data-rs-build-add]').click();await frame();
    check(collected().value===draft && q('#dlg [data-rs-error]').textContent.includes('duplicates skipped'),'repeated Add prunes duplicates');
    change('#dlg [data-rs-build="distance"]','1.8');q('#dlg [data-rs-build-add]').click();await frame();
    check(collected().value===draft && q('#dlg [data-rs-error]').textContent.includes('conflicts'),'conflicting rules preserve the first windows');
    q('#dlg [data-rs-tab="molecule"]').click();
    check(q('#dlg [data-rs-panel="geometry"]').hidden && !q('#dlg [data-rs-panel="molecule"]').hidden,'tab selection changes visible panel');
    q('#dlg [data-rs-paste]').value='Si\nO1 1 1.62\nO2 1 1.62 2 109.47';q('#dlg [data-rs-molecule-add]').click();await frame();
    check(collected().value===draft && ph.restraints.text===original,'Molecule Add merges into the same collection only');
    q('#dlg [data-rs-tab="suggest"]').click();q('#dlg [data-rs-suggestion-add]').click();await frame();
    // the counted rules around each neighbour (O1 Si 1 ...) are new rules; the nearest-distance pairs already collected are kept once
    check(q('#dlg [data-rs-suggested] textarea') && collected().value.indexOf(draft)===0 && ph.restraints.text===original,'Suggest Add merges into the same collection only');
    draft=collected().value;
    q('#dlg .btns .primary').click();await frame();
    check(copied===draft && ph.restraints.text===original,'Copy writes the collection to the clipboard without applying it');
    var closeBtn=q('#dlg .btns button');check(closeBtn.textContent==='Close','the Helper has Close, not Cancel');closeBtn.click();await frame();check(!q('#dlg').open && ph.restraints.text===original,'Close leaves dataset restraints unchanged');
    var input=q('#dataset-restraints [data-rs-text]');input.value=copied;input.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    check(ph.restraints.text===copied,'pasting copied rules applies them in the main editor');
    input=q('#dataset-restraints [data-rs-text]');input.value=copied+'\n'+copied;input.dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    check(ph.restraints.text===copied && q('#dataset-restraints [data-rs-error]').textContent.includes('Duplicate restraint'),'pasting the rules twice is rejected in the main editor');
    RV.history.undo();await frame();check(S.phases[0].restraints.text===original,'Undo restores rules from before the paste');
    q('#dataset-restraints [data-rs-helper]').click();await frame();check(q('#dlg [data-rs-collected]').value==='','reopening Helper starts a fresh collection');
    q('#dlg .btns .primary').click();await frame();check(q('#dlg [data-rs-error]').textContent.includes('Add rules'),'empty Copy is rejected');q('#dlg .btns button').click();await frame();
    check(errors.length===0,'no browser errors: '+errors.join('; '));
    window.browserTestResult={ok:true,results:results};
  }catch(e){window.browserTestResult={ok:false,results:results,error:e.stack};}
  out.textContent=JSON.stringify(window.browserTestResult,null,2);
})();