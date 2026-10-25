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
    const status=()=>q('#status-msg').textContent;
    const warnsOnLeave=()=>{const event=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(event);return event.defaultPrevented;};
    let prompts=[];RV.ui.prompt=async(title,fields,ok,intro)=>{prompts.push({title,ok,intro});return {compact:false,density:false};};
    // a fake Save As: records what was written
    let picker=null,written=null;
    w.showSaveFilePicker=async opts=>{picker=opts;if(w.__pickerError){const e=new w.DOMException('refused',w.__pickerError);throw e;}
      return {name:opts.suggestedName,createWritable:async()=>{if(w.__writeError)throw new Error('disk full');const parts=[];return {write:async b=>parts.push(b),close:async()=>{written=new Blob(parts);},abort:async()=>{}};}};};
    // downloads: the anchor the page clicks
    let downloads=[];const click=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);else click.call(this);};

    await RV.cmd.saveProject();
    check(/Nothing to save yet/.test(status()) && !prompts.length,'Empty project: '+status());
    const ph=St.makePhase({name:'Synthetic Si',sg:St.resolveSG(1),cell:{a:4.2,b:4.6,c:5.1,alpha:83,beta:94,gamma:101},atoms:[{label:'Si1',type:'Si',x:.13,y:.21,z:.32}]});St.addPhase(ph);
    const ds=St.insertDatasets([St.makeDataset({name:'Controlled pattern',tth:Array.from({length:501},(_,i)=>10+i*.2),y:Array(501).fill(100),inst:{bkgN:1,lambda2:0,ratio:0,resolutionType:'simple_pvoigt'}})],{estimate:false,selectAll:true})[0];
    ds.p[ph.key+'.scale']=.002;ds.p.bkg0=10;ds.y=w.RVCore.evaluate(St.projectJSON?St.problemFor([ds]):null,0).ycalc;
    St.setBusy(true,'test');await RV.cmd.saveProject();St.setBusy(false);
    check(/calculation is running/.test(status()) && !prompts.length,'Busy: '+status());
    record('saving says why when there is nothing to save or a calculation is running');

    await RV.cmd.saveProject();
    const head=new Uint8Array(await written.slice(0,2).arrayBuffer());
    check(!RV.project.hasUnsavedChanges() && !warnsOnLeave(),'Successful save must clear the leave-page warning');
    check(prompts[0].ok==='Choose file…' && picker && /^powder6_\d+\.project$/.test(picker.suggestedName) && picker.id==='powder6-project' && written.size>1000 && head[0]===80 && head[1]===75,'Save As did not write a project: '+JSON.stringify({picker,size:written && written.size}));
    check(/Saved project as powder6_\d+\.project \(\d+\.\d+ MB\)/.test(status()) && !S.busy && !downloads.length,'Save As message: '+status());
    const back=await RV.project.unpack(w.Uint8Array.from(new Uint8Array(await written.arrayBuffer())));check(back.datasets.length===1 && back.phases.length===1,'The written file does not read back');
    record('Save As: the user picks the file first, the compressed project is written there and reads back',{kB:Math.round(written.size/1000)});

    St.rename(ds.id,'Changed after saving');
    check(RV.project.hasUnsavedChanges() && warnsOnLeave(),'An edit after saving must warn on leaving');
    w.__pickerError='AbortError';written=null;await RV.cmd.saveProject();
    check(RV.project.hasUnsavedChanges(),'Cancelled save must preserve unsaved changes');
    check(/not saved \(cancelled\)/.test(status()) && !written && !S.busy && !downloads.length,'Cancel: '+status());
    w.__pickerError='SecurityError';await RV.cmd.saveProject();w.__pickerError=null;
    check(downloads.length===1 && /^powder6_\d+\.project$/.test(downloads[0]) && /download folder/.test(status()),'Fallback download: '+status()+' '+downloads);
    const hadPicker=w.showSaveFilePicker;delete w.showSaveFilePicker;w.showSaveFilePicker=undefined;prompts=[];await RV.cmd.saveProject();w.showSaveFilePicker=hadPicker;
    check(prompts[0].ok==='Save' && /download folder/.test(prompts[0].intro) && downloads.length===2,'Browser without Save As: '+JSON.stringify(prompts[0]));
    record('cancel says so; without Save As (or when it is refused) the project downloads and the message names the file');

    St.rename(ds.id,'Another unsaved name');
    w.__writeError=true;await RV.cmd.saveProject();w.__writeError=false;
    check(RV.project.hasUnsavedChanges(),'Failed save must preserve unsaved changes');
    check(/could not be saved: disk full/.test(status()) && /may have been left empty/.test(status()) && !S.busy,'Write failure: '+status());
    const obs=RV.fitHistory.observations;RV.fitHistory.observations=()=>({});await RV.cmd.saveProject();RV.fitHistory.observations=obs;
    check(/could not be saved: Missing observations/.test(status()) && !S.busy,'Compression failure: '+status());
    record('a failure while compressing or writing is reported and editing is unlocked');

    check(!errors.length,'Browser errors: '+errors.join('; '));record('no browser errors');
    window.browserTestResult={ok:true,results};
  }catch(e){results.push({name:'failure',pass:false,error:String(e && e.stack || e)});out.textContent=JSON.stringify(results,null,2);window.browserTestResult={ok:false,results};}
})();
