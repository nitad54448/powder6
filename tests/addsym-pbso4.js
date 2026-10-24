(async function(){
  'use strict';
  const out=document.getElementById('results'),w=document.getElementById('app').contentWindow,results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const record=name=>{results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);};
  const q=s=>w.document.querySelector(s),field=k=>q('#dlg [data-key="'+k+'"]');
  const until=async(test,message)=>{const end=Date.now()+8000;while(!test()){if(Date.now()>end)throw Error(message+' | '+q('#dlg')?.textContent);await wait(20);}};
  try{
    await until(()=>w.RV?.state.S.sgReady && w.RV.state.S.tables,'Startup timed out');
    const RV=w.RV,St=RV.state,S=St.S,K=w.SGConvert,errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    w.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    St.setCalculation('rietveld');
    const P1=St.resolveSG(1),pnma=St.resolveSG(62);
    // Approximate anglesite coordinates, BGMN manual (2005), PbSO4 example:
    // https://www.profex-xrd.org/wp-content/uploads/2017/05/BGMN_manual_2005.pdf
    // This fixture supplies known fitted values; it does not simulate a fit.
    const cell={a:8.47,b:5.39,c:6.95,alpha:90,beta:90,gamma:90};
    const sites=[
      {label:'Pb',type:'Pb',x:.188,y:.25,z:.168},
      {label:'S',type:'S',x:.063,y:.25,z:.684},
      {label:'O1',type:'O',x:.910,y:.25,z:.595},
      {label:'O2',type:'O',x:.185,y:.25,z:.540},
      {label:'O3',type:'O',x:.077,y:.025,z:.813}
    ];
    const full=K.convertStructure(sites,pnma.ops,P1.ops,cell,K.IDENTITY,[0,0,0]).atoms;
    check(full.length===24,'PbSO4 fixture does not have Z=4');
    const shift=[.173,.237,.119],fitted=full.map(a=>({...a,x:(a.x+shift[0])%1,y:(a.y+shift[1])%1,z:(a.z+shift[2])%1}));
    const starting=fitted.map((a,i)=>({...a,x:a.x+.075*Math.sin(13.7*(i+1)),y:a.y+.08*Math.cos(7.9*(i+1)),z:a.z+.065*Math.sin(4.3*(i+1))}));
    const originalCell={...cell,a:8.62,b:5.21,c:7.12,alpha:89,beta:92,gamma:88};
    const ph=St.makePhase({name:'Fitted PbSO4 in P1',sg:P1,cell:originalCell,atoms:starting});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'PbSO4 fitted model',tth:Array.from({length:101},(_,i)=>15+i*.4),y:Array(101).fill(100),inst:{bkgN:1,lambda2:0,ratio:0}})],{estimate:false,selectAll:true})[0];
    ['a','b','c','alpha','beta','gamma'].forEach(c=>ds.p[ph.key+'.'+c]=cell[c]);
    fitted.forEach((a,i)=>['x','y','z','occ','B'].forEach(c=>ds.p[ph.key+'.'+ph.atoms[i].label+'.'+c]=a[c]));
    const templateBefore=JSON.stringify(ph.v),fittedBefore={...ds.p};
    const detected=await K.symmetryJob(fitted,P1.ops,cell,[],{tol:.05}).promise;
    check(detected.length===1 && !detected[0].error && detected[0].dataset.number===62,'Public WASM failed to identify PbSO4: '+JSON.stringify(detected.map(r=>r.error || r.dataset?.number)));
    const r=detected[0].r,converted=K.convertStructure(fitted,P1.ops,r.group.ops,cell,r.P,r.p,{tol:.05,cell:r.standardCell});
    check(!converted.violations.length && converted.atoms.length===5 && converted.contentNew===24,'Public PbSO4 axes/origin did not convert 24 P1 atoms into five Pnma sites');
    record('Public WASM identifies PbSO4 as Pnma and converts its arbitrary P1 origin');

    RV.app.showTab('structure');q('#sv-addsym').click();
    await until(()=>q('#dlg').open && q('[data-symmetry-report]')?.textContent.includes('higher than P1'),'Fitted dataset was not searched by default');
    check(field('source').value===String(ds.id) && q('[data-symmetry-report]').textContent.includes('PbSO4 fitted model (Rietveld model)'),'Dialog selected the starting model');
    check(JSON.stringify(ph.v)===templateBefore,'Analysis changed the starting model');
    record('ADDSYM defaults to the fitted dataset rather than the distorted starting model');

    // A valid symmetry result must stay visible when applying it is blocked
    // by a separate metric tolerance.
    ds.p[ph.key+'.beta']=90.1;field('cellTol').value='.01';
    field('cellTol').dispatchEvent(new w.Event('change',{bubbles:true}));
    await until(()=>q('[data-symmetry-report]')?.textContent.includes('lattice exceeds the selected cell tolerance'),'Cell restriction hid the detected Pnma group');
    check(q('[data-symmetry-report]').textContent.includes('higher than P1'),'Detection was misreported as no higher symmetry');
    q('#dlg .btns .primary').click();
    check(q('#dlg').open && q('#status-msg').textContent.includes('larger cell tolerance'),'Conversion ignored its cell restriction');
    ds.p[ph.key+'.beta']=90;field('cellTol').value='1';
    field('cellTol').dispatchEvent(new w.Event('change',{bubbles:true}));
    await until(()=>q('[data-symmetry-report]')?.textContent.includes('higher than P1'),'Pnma search did not recover after restoring the cell');
    record('A detected higher group remains visible when its cell tolerance blocks conversion');

    field('source').value='start';field('source').dispatchEvent(new w.Event('change',{bubbles:true}));
    await until(()=>q('[data-symmetry-report]')?.textContent.includes('No symmetry beyond P1'),'Starting model is not reported independently');
    field('source').value=String(ds.id);field('source').dispatchEvent(new w.Event('change',{bubbles:true}));
    field('source').value='start';field('source').dispatchEvent(new w.Event('change',{bubbles:true}));
    await until(()=>q('[data-symmetry-report]')?.textContent.includes('No symmetry beyond P1'),'A cancelled dataset search replaced the starting-model result');
    check(!q('[data-symmetry-report]').textContent.includes('higher than P1'),'Stale worker results were displayed');
    q('#dlg .btns button').click();
    record('Changing atomic source searches it independently and cancels stale worker results');

    St.setCalculation('wppf');
    check(ds.calculations.rietveld,'Rietveld calculation was not saved');
    ['a','b','c','alpha','beta','gamma'].forEach((c,i)=>ds.p[ph.key+'.'+c]=[11.4,6.2,5.9,78,98,111][i]);
    ph.atoms.forEach((a,i)=>['x','y','z'].forEach((c,j)=>ds.p[ph.key+'.'+a.label+'.'+c]=(i*.173+j*.113)%1));
    const wppfBefore={...ds.p};
    RV.app.showTab('structure');q('#sv-addsym').click();
    await until(()=>q('[data-symmetry-report]')?.textContent.includes('higher than P1'),'WPPF search mixed the WPPF lattice with Rietveld atoms');
    check(q('[data-symmetry-report]').textContent.includes('Pnma (62)') && q('[data-symmetry-report]').textContent.includes('8.4700, 5.3900, 6.9500'),'The saved Rietveld cell was not used');
    check(JSON.stringify(ds.p)===JSON.stringify(wppfBefore),'ADDSYM mutated WPPF values');
    record('After switching to WPPF, ADDSYM takes both coordinates and cell from the saved Rietveld model');

    // Convert in the symmetry report converts at once, from the fitted model it reported on
    q('#dlg .btns .primary').click();
    await until(()=>!q('#dlg').open && ph.sg.number===62,'PbSO4 was not converted from the symmetry report');
    check(ph.atoms.length===5,'Fitted PbSO4 was not converted to Pnma');
    const contents={};ph.atoms.forEach(a=>contents[a.type]=(contents[a.type] || 0)+a.site.mult*ph.v[ph.key+'.'+a.label+'.occ']);
    check(contents.Pb===4 && contents.S===4 && contents.O===16,'Conversion changed PbSO4 stoichiometry: '+JSON.stringify(contents));
    ['a','b','c'].forEach(c=>check(Math.abs(ph.v[ph.key+'.'+c]-cell[c])<1e-7 && Math.abs(ds.calculations.rietveld.p[ph.key+'.'+c]-cell[c])<1e-7,'Conversion used the wrong '+c+' cell'));
    const bankAtoms=ph.atoms.map(a=>({label:a.label,type:a.type,...Object.fromEntries(['x','y','z','occ','B'].map(c=>[c,ds.calculations.rietveld.p[ph.key+'.'+a.label+'.'+c]]))}));
    const bankResult=await K.symmetryJob(bankAtoms,ph.ops,cell,[],{tol:.05}).promise;
    check(bankResult[0].dataset?.number===62,'Converted saved Rietveld atoms lost their symmetry');
    check(JSON.stringify(ph.v)!==templateBefore,'Converted phase did not adopt the selected fitted model');
    RV.cmd.undo();await wait(50);
    const restored=St.phaseByKey(ph.key),restoredDS=St.byId(ds.id);
    check(restored.sg.number===1 && restored.atoms.length===24 && JSON.stringify(restored.v)===templateBefore,'Undo did not restore the original P1 starting model');
    Object.keys(fittedBefore).forEach(n=>check(restoredDS.calculations.rietveld.p[n]===fittedBefore[n],'Undo lost saved Rietveld '+n));
    Object.keys(wppfBefore).forEach(n=>check(restoredDS.p[n]===wppfBefore[n],'Undo lost WPPF '+n));
    record('Conversion adopts the fitted PbSO4 model, preserves Pb4S4O16 and saved values, and can be undone');

    const pending=K.symmetryJob(fitted,P1.ops,cell,[],{tol:.05});pending.cancel();
    const cancelled=await pending.promise.then(()=>false,e=>e.name==='AbortError');
    check(cancelled,'Worker cancellation did not reject with AbortError');
    const invalid=await K.symmetryJob([fitted[0],{...fitted[0],label:'overlap'}],P1.ops,cell,[],{tol:.05}).promise;
    check(invalid[0].error && !invalid[0].r,'An invalid overlapping model did not report the public engine error');
    await wait(50);check(!errors.length,errors.join('\n'));
    record('Cancelled and invalid WASM searches return explicit outcomes without uncaught errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:e.stack});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
