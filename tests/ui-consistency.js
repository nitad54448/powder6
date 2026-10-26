(async function(){
  'use strict';
  const iframe=document.getElementById('app'),out=document.getElementById('results'),results=[];
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  function check(ok,msg){if(!ok)throw Error(msg);}
  function record(name){results.push({name,pass:true});out.textContent=JSON.stringify(results,null,2);}
  try{
    const w=iframe.contentWindow,deadline=Date.now()+20000;
    while(!w.RV?.state?.S.sgReady || !w.RV.state.S.tables){if(Date.now()>deadline)throw Error('Startup timed out');await wait(40);}
    const RV=w.RV,St=RV.state,S=St.S,doc=w.document,q=s=>doc.querySelector(s),all=s=>Array.from(doc.querySelectorAll(s)),errors=[];
    w.addEventListener('error',e=>errors.push(e.message));
    const frame=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
    function key(el,value){el.focus();el.dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));}
    St.addPhase(St.makePhase({name:'Reference phase',sg:St.resolveSG(1),cell:{a:5,b:5,c:5,alpha:90,beta:90,gamma:90},atoms:[]}));
    const datasets=St.insertDatasets(['Reference standard','Sample at 300 K'].map(name=>St.makeDataset({name,tth:[10,20,30],y:[10,40,20]})),{estimate:false,selectAll:true});
    check(RV.project.hasUnsavedChanges(),'New data must be unsaved');
    RV.project.markSaved();
    check(!RV.project.hasUnsavedChanges(),'Saved project must be clean');
    const originalName=datasets[0].name;
    RV.history.take('Rename for dirty-state check');St.rename(datasets[0].id,'Unsaved name');
    check(RV.project.hasUnsavedChanges(),'Rename must mark the project dirty');
    RV.cmd.undo();
    check(!RV.project.hasUnsavedChanges(),'Undo to saved content must clear the warning');
    check(St.byId(datasets[0].id).name===originalName,'Undo failed');
    // Undo replaces dataset objects; later checks should use the live instances.
    datasets.splice(0,datasets.length,...S.datasets);
    record('Unsaved changes distinguish saved content, edits and undo');
    RV.app.showTab('datasets');await frame();
    check(!q('[data-acc="dataset-batch"]') && !q('#dataset-table'),'Duplicate batch section remains');
    q('[data-edit-dataset]').click();await frame();
    q('#dlg [data-key="name"]').value='Renamed standard';
    q('#dlg [data-key="color"]').value='#16746d';
    q('#dlg [data-key="automatic"]').checked=false;
    q('#dlg .primary').click();await frame();
    check(datasets[0].name==='Renamed standard' && datasets[0].color==='#16746d','Dataset appearance edit failed');
    record('Dataset list owns name and colour editing without a duplicate batch section');
    check(all('#dataset-accordions > details').length===2,'Selected datasets must each have a heading');
    const shell=q('[data-dataset-accordion]');shell.querySelector('summary').click();await frame();
    check(RV.workspace.dataset().id===+shell.dataset.datasetAccordion,'Accordion did not activate its dataset');
    check(q('#dataset-detail').getAttribute('aria-labelledby')==='dataset-editor-name','Dataset editor has no visible accessible heading');
    check(q('#dataset-tabs').hidden && !q('#dataset-values h1'),'Repeated dataset headings returned');
    record('Selected dataset accordions activate the correct editor without duplicate titles');
    // A question mark explains what a block opens, so it is part of the open block: closed, the heading is just a title.
    const limits=q('#dataset-limits-group'),helpIcon=limits && limits.querySelector('summary .acc-help');
    check(helpIcon,'An accordion title lost its question-mark icon');
    limits.open=false;await frame();
    check(w.getComputedStyle(helpIcon).display==='none','A closed accordion still shows its question-mark icon');
    limits.open=true;await frame();
    check(w.getComputedStyle(helpIcon).display!=='none','An open accordion hides its question-mark icon');
    limits.open=false;await frame();
    record('the question mark of a block title appears with the block');
    // Datasets → one Save CIF for each phase that has atoms, from the values of the dataset being edited
    check(!q('[data-phase-cif]'),'An atomless phase offers a Save CIF button: a cell and a group are not a structure');
    const cell=St.cellOf(S.phases[0],S.datasets[0].p);
    St.addAtomTo(S.phases[0],{label:'O1',type:'O',x:0,y:0,z:0,occ:1,B:.5},cell);St.phaseChanged(S.phases[0]);RV.bus.emit('phases');await frame();
    const phaseCif=all('[data-phase-cif]');
    check(phaseCif.length===1 && phaseCif[0].getAttribute('data-phase-cif')===S.phases[0].key,'The phase group has no single Save CIF button: '+phaseCif.length);
    const originalDownload=RV.ui.download;let cifFile=null;
    RV.ui.download=(name,text)=>{cifFile={name,text};};
    try{phaseCif[0].click();}finally{RV.ui.download=originalDownload;}
    await frame();
    check(cifFile && /^structure_Reference_phase_.*\.cif$/.test(cifFile.name),'No CIF was written: '+(cifFile && cifFile.name));
    check(/_cell_length_a\s+5(?:\.0+)?\b/.test(cifFile.text) && /_space_group_IT_number\s+1\b/.test(cifFile.text),'The phase CIF lacks the cell or the space group');
    check(/_atom_site_label[\s\S]*\bO1\b/.test(cifFile.text),'The phase CIF lacks its atom');
    check(!/data_d2_/.test(cifFile.text),'The phase CIF carries another dataset');
    record('each phase with atoms saves its own structure as a CIF from Datasets');
    check(!q('[data-fitmode-visibility]').hidden,'Batch mode is hidden for two selected datasets');
    q('[aria-label="Batch fit mode"] [data-fitmode="global"]').click();await frame();
    check(RV.app.fitMode()==='global' && all('[data-fitmode="global"]').every(b=>b.getAttribute('aria-pressed')==='true'),'Batch global mode is not synchronized');
    const originalFit=RV.cmd.fit;let fitMode=null;RV.cmd.fit=()=>{fitMode=RV.app.fitMode();};
    q('[aria-label="Calculation actions"] [data-workflow="fit"]').click();RV.cmd.fit=originalFit;check(fitMode==='global','Batch fit bypassed the selected mode');
    St.selectIds([datasets[0].id]);await frame();check(q('[data-fitmode-visibility]').hidden,'Batch mode should hide for one selected dataset');
    St.selectAll();q('[aria-label="Batch fit mode"] [data-fitmode="single"]').click();await frame();
    record('Batch fit mode synchronizes with Method, controls fitting, and hides for one dataset');
    const previousFocus=q('#swap-panels');previousFocus.focus();St.setBusy(true,'Keyboard check');await frame();
    check(doc.activeElement===q('#work'),'Busy preparation must focus the workspace while Stop is unavailable');
    for(const shiftKey of [false,true]){
      const event=new w.KeyboardEvent('keydown',{key:'Tab',shiftKey,bubbles:true,cancelable:true});
      doc.body.dispatchEvent(event);check(!event.defaultPrevented,'Busy guard trapped '+(shiftKey?'Shift+Tab':'Tab'));
    }
    q('#tab-method').focus();q('#tab-method').click();RV.bus.emit('busy',true);
    check(doc.activeElement===q('#tab-method') && RV.app.commandTab()==='method','Busy updates stole navigation focus');
    q('#theme-toggle').click();check(S.settings.theme==='system','Busy guard allowed an editing action');
    St.setBusy(false);previousFocus.focus();St.setBusy(true,'Focus restoration');St.setBusy(false);
    check(doc.activeElement===previousFocus,'Completion did not restore the control that started the calculation');
    const originalRunning=RV.solve.running;RV.solve.running=()=>S.busy;
    previousFocus.focus();St.setBusy(true,'Stoppable calculation');
    check(doc.activeElement===q('#busy-cancel'),'A stoppable calculation must focus Stop');
    St.setBusy(false);RV.solve.running=originalRunning;
    check(doc.activeElement===previousFocus,'Disabling Stop on completion lost the original focus');
    RV.app.showTab('datasets');await frame();
    check(q('#ds-resolution').textContent==='Profile','Dataset calibration button must be named Profile');
    record('Busy calculations allow Tab, Shift+Tab and panel navigation, guard editing, and restore focus');
    for(const theme of ['light','dark']){
      doc.documentElement.dataset.theme=theme;RV.theme.refresh();await frame();
      const surface=w.getComputedStyle(q('.dataset-toolbar')).backgroundColor;
      for(const selector of ['.phase-bar','.solve-sticky','.solve-sticky .calculation-tabs','.result-runbar','.structure-result-tabs']) {
        check(w.getComputedStyle(q(selector)).backgroundColor===surface,theme+' inconsistent action/header surface: '+selector);
      }
      const style=w.getComputedStyle(q('[data-remove-dataset]')),rect=q('[data-remove-dataset]').getBoundingClientRect();
      check(parseFloat(style.minHeight)>=24 && parseFloat(style.minWidth)>=24,'Remove button target is too small');
      const cs=w.getComputedStyle(doc.documentElement),rgb=s=>{const h=s.trim().replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);};
      const lum=s=>rgb(s).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
      const ratio=(a,b)=>{a=lum(cs.getPropertyValue(a));b=lum(cs.getPropertyValue(b));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
      for(const ink of ['--ink','--ink-2','--ink-3'])for(const bg of ['--panel','--paper'])check(ratio(ink,bg)>=4.5,theme+' text contrast '+ink+'/'+bg);
      for(const prefix of ['--series-','--phase-'])for(let i=1;i<=(prefix==='--series-'?12:8);i++)check(ratio(prefix+i,'--paper')>=4.5,theme+' dataset/phase text contrast '+prefix+i);
      check(ratio('--control-border','--panel')>=3 && ratio('--control-border','--control-bg')>=3,theme+' control boundary contrast');
      const btn=q('#ds-resolution');key(btn,'Tab');check(w.getComputedStyle(btn).outlineStyle!=='none','Focus outline was suppressed');
      record(theme+' theme: text contrast, control boundaries, icon target sizes and focus outline');
    }
    RV.app.showTab('history');await frame();
    key(q('[data-history-method="rietveld"]'),'ArrowRight');
    check(q('[data-history-method="lebail"]').getAttribute('aria-selected')==='true','History arrow navigation failed');
    check(q('#fit-history-list').getAttribute('aria-labelledby')==='history-tab-lebail','History panel label is stale');
    key(q('[data-history-method="lebail"]'),'End');check(doc.activeElement.dataset.historyMethod==='wppf','History End key failed');
    RV.layout.structureResult('sgt');await frame();
    all('[data-structure-result]').forEach(b=>{const panel=doc.getElementById(b.getAttribute('aria-controls'));check(panel?.getAttribute('aria-labelledby')===b.id && panel.getAttribute('role')==='tabpanel','Structure tab/panel relationship missing');});
    record('History keyboard navigation and Structure tab/panel relationships');
    const dialog=RV.ui.confirm('Check accessible name','OK',false,'Interface check');await frame();
    check(q('#dlg').getAttribute('aria-labelledby')==='dialog-title' && q('#dialog-title').textContent==='Interface check','Dialog has no accessible title');
    q('#dlg .btns button').click();await dialog;record('Dialogs expose their visible title to assistive technology');
    RV.app.showTab('datasets');
    for(const width of [1280,768,390]){iframe.style.width=width+'px';await frame();check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,'Page overflows at '+width+'px');}
    iframe.style.width='1280px';doc.documentElement.dataset.theme='light';RV.theme.refresh();await frame();
    check(!errors.length,'Browser errors: '+errors.join('; '));record('Desktop, tablet and narrow layouts fit the viewport without browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e.stack||e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
