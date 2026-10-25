(async function(){
  'use strict';
  const out=document.getElementById('results'),w=document.getElementById('app').contentWindow,results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const q=s=>w.document.querySelector(s);
  const until=async(test,message)=>{const end=Date.now()+15000;while(!test()){if(Date.now()>end)throw Error(message+' | '+(q('#dlg')&&q('#dlg').textContent));await wait(20);}};
  const publish=(ok,extra)=>{window.browserTestResult={ok,results};out.textContent=JSON.stringify(results,null,2)+(extra||'');};
  const record=name=>{results.push({name,pass:true});publish(true);};
  try{
    await until(()=>w.RV&&w.RV.state.S.sgReady&&w.RV.state.S.tables,'Startup timed out');
    const RV=w.RV,St=RV.state;
    St.setCalculation('rietveld');
    const ph=St.makePhase({name:'NaCl',sg:St.resolveSG(225),cell:{a:5.64,b:5.64,c:5.64,alpha:90,beta:90,gamma:90},atoms:[{label:'Na',type:'Na',x:0,y:0,z:0,B:1,occ:1},{label:'Cl',type:'Cl',x:.5,y:.5,z:.5,B:1,occ:1}]});
    St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'d',tth:Array.from({length:101},(_,i)=>15+i*.4),y:Array(101).fill(100),inst:{bkgN:1,lambda2:0,ratio:0}})],{estimate:false,selectAll:true})[0];
    RV.app.showTab('structure');
    const sel=q('#sv-sym-phase');if(sel){sel.value=ph.key;sel.dispatchEvent(new w.Event('change',{bubbles:true}));}
    q('#sv-subgroups').click();
    await until(()=>q('#dlg').open&&q('#dlg').textContent.includes('Maximal subgroups of'),'The subgroups were not listed');
    const text=q('#dlg').textContent;
    ['I4/mmm','R-3m','F432','F-43m','Fm-3','Pm-3m'].forEach(s=>check(text.includes(s),s+' missing from '+text.slice(0,600)));
    record('Fm-3m lists its maximal t and k subgroups, I4/mmm among them');
    const radios=Array.from(w.document.querySelectorAll('#dlg [data-sub-pick]')),row=radios.find(r=>r.getAttribute('aria-label').startsWith('I4/mmm'));
    check(row,'No I4/mmm row');
    row.checked=true;row.dispatchEvent(new w.Event('change',{bubbles:true}));
    Array.from(w.document.querySelectorAll('#dlg .btns button')).find(b=>b.textContent==='Convert…').click();
    await until(()=>q('#dlg').open&&q('#dlg [data-convert-preview]')&&/I4\/mmm/.test(q('#dlg [data-convert-preview]').textContent)&&q('#dlg [data-convert-preview]').textContent.includes('subgroup'),'Convert… did not open with I4/mmm');
    q('#dlg .btns .primary').click();
    await until(()=>St.phaseByKey(ph.key).sg.number===139,'The phase was not converted to I4/mmm');
    const now=St.phaseByKey(ph.key);
    check(now.atoms.length===2,'NaCl should have two sites in I4/mmm: '+now.atoms.length);
    const c=St.cellOf(now,now.v);
    check(Math.abs(c.a-5.64/Math.SQRT2)<1e-3&&Math.abs(c.c-5.64)<1e-3,'Cell '+JSON.stringify(c));
    record('Converting Fm-3m to I4/mmm from the subgroup list keeps both atoms in the tetragonal I cell');
    publish(true);
  }catch(e){results.push({name:'failed',pass:false,error:String(e&&e.message||e)});publish(false);}
})();
