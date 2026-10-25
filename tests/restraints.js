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
    const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true}));
    St.setCalculation('rietveld');
    const ph=St.makePhase({name:'Water box',sg:St.resolveSG(1),cell:{a:12,b:12,c:12,alpha:90,beta:90,gamma:90},atoms:[
      {label:'O',type:'O',x:.1,y:.1,z:.1,B:1,occ:1},{label:'H1',type:'H',x:.18,y:.1,z:.1,B:1,occ:1},{label:'H2',type:'H',x:.08,y:.18,z:.12,B:1,occ:1}]});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'Pattern',tth:Array.from({length:400},(_,i)=>10+i*.2),y:Array(400).fill(100),inst:{bkgN:1,lambda2:0,ratio:0}})])[0];
    ds.p[ph.key+'.scale']=.5;ds.p.bkg0=10;ds.y=w.RVCore.evaluate(St.problemFor([ds]),0).ycalc;
    Object.keys(ds.fit).forEach(k=>ds.fit[k]=k===ph.key+'.H1.x');
    q('#tab-phases').click();await frame();

    // 1. the dialog: rules are checked as they are typed and applied on change, with Undo
    RV.restraints.edit();await frame();
    const dlg=q('#dlg'),t=()=>dlg.querySelector('[data-rs-text]');
    check(dlg.open && t(),'The Restraints dialog did not open');
    t().value='O H1 - 0.93/0.99\nO H9 - 1/2';fire(t(),'input');
    check(/"H9" is not an atom label/.test(dlg.querySelector('[data-rs-error]').textContent),'Unknown label not reported: '+dlg.querySelector('[data-rs-error]').textContent);
    fire(t(),'change');check(!ph.restraints || !ph.restraints.text,'An invalid rule was stored');
    t().value='O H1 - 0.93/0.99\nO H2 - 0.93/0.99';fire(t(),'input');fire(t(),'change');await frame();
    check(ph.restraints && /O H2/.test(ph.restraints.text) && ph.restraints.on,'The rules were not stored');
    check(/outside their window/.test(dlg.querySelector('[data-rs-geom]').textContent) && /O–H2/.test(dlg.querySelector('[data-rs-geom]').textContent),'No geometry table: '+dlg.querySelector('[data-rs-geom]').textContent);
    const wt=dlg.querySelector('[data-rs-weight]');wt.value='5';fire(wt,'change');check(ph.restraints.weight===5,'Weight not stored');
    record('the dialog validates labels as typed, stores valid rules and shows the geometry against them');

    // 2. the guide: a Z-matrix of the phase atoms becomes bond and angle rules
    dlg.querySelector('[data-rs-helper]').click();await frame();
    dlg.querySelector('[data-rs-tab="molecule"]').click();
    dlg.querySelector('[data-rs-paste]').value='O\nH1 1 0.96\nH2 1 0.96 2 104.5\n';
    dlg.querySelector('[data-rs-molecule-add]').click();await frame();
    const made=dlg.querySelector('[data-rs-madetext]');
    check(made && /O H1 - 0\.930\/0\.990/.test(made.value) && /H1 H2 - 1\.458\/1\.578/.test(made.value),'Guide rules wrong: '+(made&&made.value));
    const collected=dlg.querySelector('[data-rs-collected]').value;check(/H1 H2/.test(collected) && !/H1 H2/.test(ph.restraints.text),'Helper modified dataset rules before pasting');
    dlg.querySelector('[data-rs-tab="suggest"]').click();
    dlg.querySelector('[data-rs-stol]').value='0.1';dlg.querySelector('[data-rs-suggestion-add]').click();await frame();
    check(/O H1 1 /.test(dlg.querySelector('[data-rs-suggested]').textContent+dlg.querySelector('[data-rs-suggested] textarea').value),'Suggest wrote nothing');
    record('the molecule guide writes bond and angle rules from a Z-matrix; Suggest reads the structure');
    dlg.querySelector('.btns button').click();await frame();
    t().value=collected;fire(t(),'change');await frame();check(/H1 H2/.test(ph.restraints.text),'Pasted helper rules were not applied');
    dlg.querySelector('.btns .primary').click();await frame();

    // 3. Undo restores the previous rules; a Rietveld fit with the restraints pulls the geometry
    RV.history.undo();await frame();
    check(/H1 H2/.test(S.phases[0].restraints.text)===false,'Undo kept the replaced rules: '+S.phases[0].restraints.text);
    const ph2=S.phases[0],ds2=S.datasets[0];
    ph2.restraints={on:true,text:'O H1 - 0.93/0.99\nO H2 - 0.93/0.99\nH1 H2 - 1.5/1.6',weight:1000,sigmaD:0.02,sigmaA:3};
    ds2.fit[ph.key+'.H1.x']=true;ds2.fit[ph.key+'.H2.y']=true;
    check(RV.cmd.why('fit')==='','Fit blocked: '+RV.cmd.why('fit'));
    await RV.cmd.fit();await frame();
    const x=ds2.p[ph.key+'.H1.x']*12-ds2.p[ph.key+'.O.x']*12;
    check(ds2.stats && ds2.stats.ok,'The restrained fit failed: '+JSON.stringify(ds2.stats));
    check(Math.abs(x-0.96)<0.08,'The O–H1 distance was not restrained: '+x);
    record('a Rietveld fit with restraints pulls the distance into its window',{OH:x});

    // 4. a missing atom is reported by the fit, not silently ignored
    ph2.restraints={on:true,text:'O Zz - 1/2',weight:1,sigmaD:0.02,sigmaA:3};
    await RV.cmd.fit();await frame();
    check(ds2.stats && ds2.stats.ok===false && /not an atom label/.test(ds2.stats.msg),'A bad rule should stop the fit: '+JSON.stringify(ds2.stats&&ds2.stats.msg));
    record('a rule that names a missing atom stops the fit with a message');

    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
