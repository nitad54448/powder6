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
    w.addEventListener('error',e=>errors.push(e.message));w.addEventListener('unhandledrejection',e=>errors.push('unhandled: '+(e.reason && e.reason.message || e.reason)));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    const status=()=>q('#status-msg').textContent;
    St.setCalculation('rietveld');
    const ph=St.makePhase({name:'NaCl',sg:St.resolveSG(225),cell:{a:5.64},atoms:[{label:'Na1',type:'Na',x:0,y:0,z:0},{label:'Cl1',type:'Cl',x:.5,y:.5,z:.5}]});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'pattern',tth:Array.from({length:301},(_,i)=>20+i*.2),y:Array(301).fill(100),inst:{bkgN:1,lambda2:0,ratio:0}})],{estimate:false,selectAll:true})[0];
    ds.p[ph.key+'.scale']=.002;ds.p[ph.key+'.a']=5.7;

    // 1. the button, left of Browse
    q('#tab-phases').click();await frame();
    const conv=q('[data-act="sg-convert"]'),browse=q('[data-act="sg-browse"]');
    check(conv && browse && conv.nextElementSibling===browse && conv.textContent==='Convert…','Convert… is not just left of Browse…');
    // 2. the dialog: subgroup preview, convert, undo
    conv.click();await frame();
    const dlg=q('#dlg'),field=k=>dlg.querySelector('[data-key="'+k+'"]'),preview=()=>dlg.querySelector('[data-convert-preview]').textContent;
    check(dlg.open && /Fm-3m/.test(dlg.textContent),'Dialog did not open');
    field('target').value='P 4/m m m';field('target').dispatchEvent(new w.Event('input',{bubbles:true}));await wait(350);
    check(/A subgroup/.test(preview()) && /2 → 6 sites/.test(preview()) && /Na1 → 3 sites/.test(preview()) && /a′, b′, c′ = a,b,c/.test(preview()),'Subgroup preview: '+preview().slice(0,300));
    field('mode').value='manual';field('mode').dispatchEvent(new w.Event('change',{bubbles:true}));await frame();
    check(field('basis').value==='a,b,c' && field('shift').value==='0,0,0' && !field('basis').closest('[hidden]'),'Enter it was not prefilled with the transformation found');
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert').click();await frame();
    check(!dlg.open && ph.sg.number===123 && ph.atoms.length===6 && /converted from Fm-3m \(225\) to P4\/mmm \(123\)/.test(status()),'Conversion not applied: '+status());
    check(Math.abs(ds.p[ph.key+'.a']-5.7)<1e-9 && Math.abs(ds.p[ph.key+'.c']-5.7)<1e-9 && q('#ph-sg').value.replace(/\s/g,'')==='P4/mmm','Dataset cell or the editor not updated');
    RV.cmd.undo();await frame();
    check(St.phaseByKey(ph.key).sg.number===225 && St.phaseByKey(ph.key).atoms.length===2,'Ctrl+Z did not restore Fm-3m');
    record('Convert… sits left of Browse…, previews a subgroup, converts the phase and its dataset, and Ctrl+Z undoes it');

    // 3. a supergroup the structure lacks: preview says so, Convert keeps the dialog open
    q('[data-act="sg-convert"]').click();await frame();
    field('target').value='P 4/m m m';field('target').dispatchEvent(new w.Event('input',{bubbles:true}));await wait(350);
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert').click();await frame();
    let p2=St.phaseByKey(ph.key);check(p2.sg.number===123 && p2.atoms.length===6,'Second conversion failed');
    q('[data-act="sg-convert"]').click();await frame();
    field('target').value='Fm-3m';field('target').dispatchEvent(new w.Event('input',{bubbles:true}));await wait(350);
    check(/A supergroup/.test(preview()) && !/Not converted/.test(preview()),'Supergroup with the symmetry should be allowed: '+preview().slice(0,300));
    const moved=p2.atoms.find(x=>x.site.mult===2 && /^Cl/.test(x.label));p2.v[p2.key+'.'+moved.label+'.z']=.47;field('target').dispatchEvent(new w.Event('input',{bubbles:true}));await wait(350);
    check(/Not converted: the structure does not have this symmetry/.test(preview()),'Missing symmetry not reported: '+preview().slice(0,400));
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert').click();await frame();
    check(dlg.open && /does not have the symmetry/.test(status()) && St.phaseByKey(ph.key).sg.number===123,'Refused conversion closed or applied');
    field('target').value='Q 99 z';field('target').dispatchEvent(new w.Event('input',{bubbles:true}));await wait(350);
    check(/not recognised/.test(preview()),'Unknown group not reported');
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Cancel').click();await frame();
    check(!dlg.open && St.phaseByKey(ph.key).sg.number===123,'Cancel changed the phase');
    record('a supergroup the structure lacks, or an unknown group, is explained in the preview and refused');

    // 4. project files: saved as .project; .archive, .powder6 and a renamed zip open; a zip without project.json does not
    let written=null;
    w.showSaveFilePicker=async o=>({name:o.suggestedName,createWritable:async()=>{const parts=[];return {write:async b=>parts.push(b),close:async()=>{written=new Blob(parts);}};}});
    RV.ui.prompt=async()=>({compact:false,density:false});let confirms=0;RV.ui.confirm=async msg=>{confirms++;return /replaces/.test(msg);};
    await RV.cmd.saveProject();
    check(/Saved project as powder6_\d+\.project /.test(status()) && written,'Not saved as .project: '+status());
    const bytes=new Uint8Array(await written.arrayBuffer());
    for(const name of ['saved.archive','old.powder6','renamed.zip','plain.project']){
      St.setPhaseSG(St.phaseByKey(ph.key),St.resolveSG(221));
      await RV.cmd.readFiles([new w.File([w.Uint8Array.from(bytes)],name)]);await frame();
      check(/Opened a project/.test(status()) && S.phases[0].sg.number===123,name+' did not open as a project: '+status());
    }
    check(confirms===4,'Opening over existing work must ask first');
    const other=new w.JSZip();other.file('data.xml','<x/>');const zipBytes=await other.generateAsync({type:'uint8array'});
    await RV.cmd.readFiles([new w.File([zipBytes],'pattern.zip')]);await frame();
    check(!/Opened a project/.test(status()),'A zip without project.json was taken for a project');
    check(q('#pane-about').textContent.includes('.project'),'About does not name the extension');
    record('projects are saved as .project; .archive, .powder6 and any zip holding project.json open, other zips do not',{status:status().slice(0,80)});

    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
