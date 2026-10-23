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
    const dl=[...q('#sg-list').options];check(dl.length===520 && dl.some(o=>o.value==='Fm-3m') && dl.some(o=>o.value==='P121/n1' && /14 · monoclinic/.test(o.label)),'The suggestion list must hold every setting as the fields write it');
    // the space-group row shares the columns of the name row: field under field, Convert… under the colour, Browse… under Edit
    const box=el=>el.getBoundingClientRect(),same=(a,b)=>Math.abs(a.left-b.left)<0.5 && Math.abs(a.width-b.width)<0.5;
    const rows=[[q('#phase-select'),q('#ph-sg')],[q('#ph-color'),conv],[q('#ph-rename'),browse]];
    check(rows.every(([a,b])=>same(box(a),box(b)) && box(b).top>box(a).bottom-1) && Math.abs(box(conv).top-box(browse).top)<0.5,'Phase controls are not aligned: '+JSON.stringify(rows.map(([a,b])=>[box(a).left,box(a).width,box(b).left,box(b).width])));
    // 2. the dialog: subgroup preview, convert, undo
    conv.click();await frame();
    const dlg=q('#dlg'),field=k=>dlg.querySelector('[data-key="'+k+'"]'),preview=()=>dlg.querySelector('[data-convert-preview]').textContent;
    const choose=t=>{field('find').value=t;field('find').dispatchEvent(new w.Event('input',{bubbles:true}));};
    const visible=()=>[...field('target').options].filter(o=>!o.hidden);
    check(dlg.open && /Fm-3m/.test(dlg.textContent) && field('target').tagName==='SELECT' && field('target').options.length===520 && /225 · Fm-3m · cubic/.test(field('target').selectedOptions[0].textContent),'Dialog did not open with every setting, the current one chosen');
    check(/is in Fm-3m \(225\)/.test(preview()) && dlg.querySelector('[data-convert-preview] .hint'),'Opening preview should be guidance, not a warning');
    choose('14');await wait(300);
    check(visible().length===9 && visible().every(o=>/^14 · /.test(o.textContent)) && /P121\/c1/.test(field('target').selectedOptions[0].textContent),'Find 14: '+visible().length+' '+field('target').selectedOptions[0].textContent);
    choose('P21/n');await wait(300);
    check(/P121\/n1/.test(field('target').selectedOptions[0].textContent),'Find P21/n selected '+field('target').selectedOptions[0].textContent);
    field('find').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await frame();
    check(dlg.open && St.phaseByKey(ph.key).sg.number===225,'Enter in Find started the conversion');
    choose('');await frame();check(visible().length===520,'Clearing Find did not restore the list');
    choose('P 4/m m m');await wait(350);
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
    choose('P 4/m m m');await wait(350);
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert').click();await frame();
    let p2=St.phaseByKey(ph.key);check(p2.sg.number===123 && p2.atoms.length===6,'Second conversion failed');
    q('[data-act="sg-convert"]').click();await frame();
    choose('Fm-3m');await wait(350);
    check(/A supergroup/.test(preview()) && !/Not converted/.test(preview()),'Supergroup with the symmetry should be allowed: '+preview().slice(0,300));
    const moved=p2.atoms.find(x=>x.site.mult===2 && /^Cl/.test(x.label));p2.v[p2.key+'.'+moved.label+'.z']=.47;field('find').dispatchEvent(new w.Event('input',{bubbles:true}));await wait(350);
    check(/Not converted: the structure does not have this symmetry/.test(preview()),'Missing symmetry not reported: '+preview().slice(0,400));
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert').click();await frame();
    check(dlg.open && /does not have the symmetry/.test(status()) && St.phaseByKey(ph.key).sg.number===123,'Refused conversion closed or applied');
    choose('Q 99 z');await wait(350);
    check(field('find').classList.contains('invalid'),'No match not shown');
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert').click();await frame();
    check(dlg.open && /No space group matches/.test(status()) && St.phaseByKey(ph.key).sg.number===123,'A Find without match was not refused: '+status());
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Cancel').click();await frame();
    check(!dlg.open && St.phaseByKey(ph.key).sg.number===123,'Cancel changed the phase');
    record('a supergroup the structure lacks, or an unknown group, is explained in the preview and refused');

    // 3b. Find higher symmetry: NaCl written in P1 is found to be Fm-3m, and Convert… carries it there
    const p1atoms=[[0,0,0],[0,.5,.5],[.5,0,.5],[.5,.5,0]].flatMap((x,i)=>[{label:'Na'+(i+1),type:'Na',x:x[0],y:x[1],z:x[2]},{label:'Cl'+(i+1),type:'Cl',x:(x[0]+.5)%1,y:x[1],z:x[2]}]);
    const flat=St.makePhase({name:'NaCl in P1',sg:St.resolveSG(1),cell:{a:5.64,b:5.64,c:5.64,alpha:90,beta:90,gamma:90},atoms:p1atoms});St.addPhase(flat);St.selectPhase(flat.key);await frame();
    RV.app.showTab('structure');await frame();
    const fs=q('#sv-addsym');check(fs && !fs.disabled,'Find higher symmetry… missing from Structure → Space group → ADDSYM');
    fs.click();await wait(900);
    const report=()=>dlg.querySelector('[data-symmetry-report]').textContent;
    check(dlg.open && /Fm-3m \(225\)/.test(report()) && /higher than P1/.test(report()) && /8 → 2/.test(report()) && /4 lattice points per cell/.test(report()) && /operations the structure has and P1 does not use/.test(report()) && /At other tolerances/.test(report()),'Symmetry report: '+report().slice(0,500));
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert…').click();await wait(400);
    check(dlg.open && /225 · Fm-3m/.test(field('target').selectedOptions[0].textContent) && field('mode').value==='manual' && /A supergroup|Another setting/.test(preview()),'Convert did not open with the group found: '+preview().slice(0,200));
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert').click();await frame();
    const done=St.phaseByKey(flat.key);check(!dlg.open && done.sg.number===225 && done.atoms.length===2 && done.atoms.every(x=>x.site.mult===4),'Not converted to Fm-3m: '+done.sg.number+' '+done.atoms.length);
    // nothing beyond Fm-3m: reported, and Convert… refused
    q('#sv-addsym').click();await wait(900);
    check(/no symmetry beyond Fm-3m/.test(report()),'Full symmetry not recognised: '+report().slice(0,300));
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Convert…').click();await frame();
    check(dlg.open && /nothing to convert to/.test(status()),'Convert… should be refused with nothing higher');
    [...dlg.querySelectorAll('.btns button')].find(b=>b.textContent==='Cancel').click();await frame();
    St.removePhase(flat.key);St.selectPhase(ph.key);RV.app.showTab('phases');await frame();
    record('Find higher symmetry reports Fm-3m for NaCl written in P1, hands it to Convert, and has nothing to add afterwards');

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
