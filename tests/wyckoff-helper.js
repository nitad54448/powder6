(async function(){
  'use strict';
  var iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  try{
    var w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV || !w.RV.state.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timeout');await new Promise(function(r){setTimeout(r,30);});}
    var RV=w.RV,doc=w.document,errors=[];
    w.addEventListener('error',function(e){errors.push(e.message);});
    var frame=function(){return new Promise(function(r){w.requestAnimationFrame(function(){w.requestAnimationFrame(r);});});};
    function check(ok,name){if(!ok)throw Error(name);results.push({name:name,pass:true});out.textContent=JSON.stringify(results);}
    var q=function(s){return doc.querySelector(s);};
    function change(selector,value){var el=q(selector);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
    function formula(v){var fi=q('#sv-formula-wy');fi.value=v;fi.dispatchEvent(new w.Event('input',{bubbles:true}));fi.dispatchEvent(new w.Event('change',{bubbles:true}));}
    var copied='';Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async function(text){copied=text;}}});
    var St=RV.state;St.setCalculation('rietveld');
    var ph=St.makePhase({name:'Barite',sg:St.resolveSG(1),cell:{a:8.9,b:5.5,c:7.2},atoms:[{label:'Ba1',type:'Ba',x:.18,y:.25,z:.16}]});St.addPhase(ph);
    St.insertDatasets([St.makeDataset({name:'Pattern',tth:Array.from({length:201},function(_,i){return 10+i*.2;}),y:Array(201).fill(100)})],{estimate:false,selectAll:true});
    St.setCalculation('wppf');
    q('#tab-structure').click();await frame();
    var btn=q('#sv-wy-helper');check(btn,'Helper button next to Distance constraints');
    formula('');await frame();check(btn.disabled && /formula/i.test(btn.title),'no formula: Helper greyed out with a reason');
    formula('Ba(SO4');await frame();check(btn.disabled,'an unreadable formula keeps the Helper disabled');
    formula('BaSO4');await frame();check(!btn.disabled,'a formula enables the Helper');
    var box=q('#sv-wy-constraints');box.value='Ba O - 2.6/';box.dispatchEvent(new w.Event('input',{bubbles:true}));var original=RV.solve.state.opts.wy.constraints;
    btn.click();await frame();
    check(q('#dlg').open && q('#dlg [data-wh-tab="geometry"]') && q('#dlg [data-wh-panel="molecule"]').hidden,'dialog opens on the Geometry tab');
    var els=Array.from(q('#dlg [data-wh="a"]').options).map(function(o){return o.value;});check(els.join()==='Ba,S,O','element choices are the formula elements: '+els);
    change('#dlg [data-wh="a"]','S');change('#dlg [data-wh="b"]','O');change('#dlg [data-wh="distance"]','1.47');change('#dlg [data-wh="tol"]','0.05');await frame();
    var col=function(){return q('#dlg [data-wh-collected]').value;};
    q('#dlg [data-wh-add="geometry"]').click();await frame();
    check(col()==='S O 4 1.42/1.52 tetrahedron','Geometry Add collects a tetrahedral shell: '+col());
    q('#dlg [data-wh-add="geometry"]').click();await frame();check(col()==='S O 4 1.42/1.52 tetrahedron' && /duplicates skipped/.test(q('#dlg [data-wh-error]').textContent),'a repeated Add is skipped');
    change('#dlg [data-wh="kind"]','contact');change('#dlg [data-wh="a"]','O');change('#dlg [data-wh="b"]','O');change('#dlg [data-wh="contact"]','2.3');q('#dlg [data-wh-add="geometry"]').click();await frame();
    check(col().split('\n')[1]==='O O - 2.3/','shortest contact rule');
    q('#dlg [data-wh-tab="molecule"]').click();check(!q('#dlg [data-wh-panel="molecule"]').hidden,'tab switch');
    change('#dlg [data-wh-paste]','S\nO1 1 1.47\nO2 1 1.47 2 109.47\nO3 1 1.47 2 109.47 3 120\nO4 1 1.47 2 109.47 3 -120');
    q('#dlg [data-wh-add="molecule"]').click();await frame();
    check(/^O S 1 1\.37\/1\.57$/m.test(col()) && col().split('\n').filter(function(l){return /^S O /.test(l);}).length===1,'Molecule Add writes the O around S and keeps the first S O shell: '+col());
    check(/Factor ×/.test(q('#dlg [data-wh-factor]').title) && /Factor ×/.test(q('#dlg [data-wh-factor]').closest('label').title),'Factor label and value explain the shortest contact');q('#dlg [data-wh-tab="suggest"]').click();q('#dlg [data-wh-add="suggest"]').click();await frame();
    check(/^Ba S - [\d.]+\/$/m.test(col()) && col().split('\n').filter(function(l){return /^O O /.test(l);}).length===1,'Suggest adds shortest contacts without repeating O O');
    var draft=col();q('#dlg .btns .primary').click();await frame();await frame();
    check(copied===draft && RV.solve.state.opts.wy.constraints===original,'Copy writes the collection to the clipboard only');
    var closeBtn=q('#dlg .btns button');check(closeBtn.textContent==='Close','the Helper has Close, not Cancel');closeBtn.click();await frame();check(!q('#dlg').open && RV.solve.state.opts.wy.constraints===original,'Close leaves the constraints unchanged');
    check(!errors.length,'no browser errors: '+errors.join('; '));
    window.browserTestResult={ok:true,results:results};
  }catch(e){window.browserTestResult={ok:false,results:results,error:String(e.stack || e)};}
  out.textContent=JSON.stringify(window.browserTestResult,null,2);
})();
