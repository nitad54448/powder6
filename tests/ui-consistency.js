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
    RV.app.showTab('datasets');await frame();
    check(all('#dataset-accordions > details').length===2,'Selected datasets must each have a heading');
    const shell=q('[data-dataset-accordion]');shell.querySelector('summary').click();await frame();
    check(RV.workspace.dataset().id===+shell.dataset.datasetAccordion,'Accordion did not activate its dataset');
    check(q('#dataset-detail').getAttribute('aria-labelledby')==='dataset-editor-name','Dataset editor has no visible accessible heading');
    check(q('#dataset-tabs').hidden && !q('#dataset-values h1'),'Repeated dataset headings returned');
    record('Selected dataset accordions activate the correct editor without duplicate titles');
    check(!q('[data-fitmode-visibility]').hidden,'Batch mode is hidden for two selected datasets');
    q('[aria-label="Batch fit mode"] [data-fitmode="global"]').click();await frame();
    check(RV.app.fitMode()==='global' && all('[data-fitmode="global"]').every(b=>b.getAttribute('aria-pressed')==='true'),'Batch global mode is not synchronized');
    const originalFit=RV.cmd.fit;let fitMode=null;RV.cmd.fit=()=>{fitMode=RV.app.fitMode();};
    q('[data-acc="dataset-batch"] [data-workflow="fit"]').click();RV.cmd.fit=originalFit;check(fitMode==='global','Batch fit bypassed the selected mode');
    St.selectIds([datasets[0].id]);await frame();check(q('[data-fitmode-visibility]').hidden,'Batch mode should hide for one selected dataset');
    St.selectAll();q('[aria-label="Batch fit mode"] [data-fitmode="single"]').click();await frame();
    record('Batch fit mode synchronizes with Method, controls fitting, and hides for one dataset');
    for(const theme of ['light','dark']){
      doc.documentElement.dataset.theme=theme;RV.theme.refresh();await frame();
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
