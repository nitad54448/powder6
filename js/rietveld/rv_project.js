/* Portable compressed projects: one little-endian binary copy of each observation
   column and of the WPPF precision block, JSON model/checkpoint metadata, and optional CF density arrays. */
RV.project = (function(){
  'use strict';
  var St=RV.state,S=St.S,columns=['tth','y','sig','weights'];
  // Compare saved content, not UI events: rendering and undo can emit the same
  // events as edits. Observation data is immutable and identified by dataKey.
  var savedSnapshot=null;
  /* The document as the saved state: everything project.json carries, except the fields that describe this session
     rather than the project, plus a fingerprint of the solution state. RV.solve.archiveFingerprint() answers "did the
     archived extracts, tests and structures change?" without building them: cloning the archive here cost a second
     copy of every reflection table and of the precision block on every save and every leave-page check. */
  function snapshot(){
    var doc=JSON.parse(St.projectJSON([],{metadataOnly:true}));
    delete doc.saved;
    delete doc.selection;delete doc.focus;delete doc.phaseSelection;
    if(RV.solve && RV.solve.archiveFingerprint)doc.solutionState=RV.solve.archiveFingerprint();
    else if(RV.solve && RV.solve.archive)doc.solutionState=RV.solve.archive(false);
    return JSON.stringify(doc);
  }
  function markSaved(value){savedSnapshot=value===undefined?snapshot():value;}
  function hasUnsavedChanges(){
    if(savedSnapshot===null)return !!(S.datasets.length || S.phases.length);
    return snapshot()!==savedSnapshot;
  }
  // saved as the first; all of them are opened (.powder6 is what versions before 2.8 wrote)
  var EXTENSIONS=['.project','.archive','.powder6'];
  function isProjectName(name){return EXTENSIONS.some(function(e){return String(name || '').toLowerCase().slice(-e.length)===e;});}
  // a zip holding project.json, whatever the file is called (a pattern format may be a zip too: it has no project.json)
  async function isProjectArchive(buffer){
    var b=new Uint8Array(buffer,0,Math.min(4,buffer.byteLength));
    if(b.length<4 || b[0]!==0x50 || b[1]!==0x4b || b[2]!==0x03 || b[3]!==0x04 || typeof JSZip==='undefined')return false;
    try{return !!(await JSZip.loadAsync(buffer)).file('project.json');}catch(e){return false;}
  }
  function binary(array){var buffer=new ArrayBuffer(array.length*8),view=new DataView(buffer);for(var i=0;i<array.length;i++)view.setFloat64(i*8,array[i],true);return new Uint8Array(buffer);}
  function values(array){if(array.byteLength%8)throw new Error('Invalid observation column size.');var view=new DataView(array.buffer,array.byteOffset,array.byteLength),out=new Float64Array(array.length/8);for(var i=0;i<out.length;i++)out[i]=view.getFloat64(i*8,true);return out;}
  // the precision block of the WPPF intensities (RV.sgtest.inputFrom): a flat matrix of doubles and the reflection
  // index it belongs to, stored as their own little-endian entries
  var PRECISION_Q='solution/precision.Q.f64',PRECISION_INDEX='solution/precision.index.i32';
  function ints32(array){var out=new Int32Array(array.length);for(var i=0;i<array.length;i++)out[i]=array[i];return new Uint8Array(out.buffer);}
  function int32s(bytes){if(bytes.byteLength%4)throw new Error('Invalid precision index size.');return new Int32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);}
  async function pack(opts){opts=opts || {};if(typeof JSZip==='undefined')throw new Error('Project compression library is unavailable.');var doc=JSON.parse(St.projectJSON(RV.ui.logEntries?RV.ui.logEntries():[],{metadataOnly:true})),pool=RV.fitHistory.observations(),zip=new JSZip(),index=[];
    if(opts.compact && doc.fitHistory){doc.fitHistory.records=doc.fitHistory.records.filter(function(r){return r.pinned || r.id===(RV.fitHistory.latest(r.method)||{}).id;});var used=new Set(doc.fitHistory.records.map(function(r){return r.model;}));Object.keys(doc.fitHistory.models).forEach(function(k){if(!used.has(k))delete doc.fitHistory.models[k];});}
    var needed=new Set(doc.datasets.map(function(d){return d.dataKey;}));if(doc.fitHistory)doc.fitHistory.records.forEach(function(r){r.datasets.concat(r.dependencies || []).forEach(function(d){needed.add(d.dataKey);});});
    var ordinal=0;for(var key of needed){var raw=pool[key];if(!raw)throw new Error('Missing observations '+key);var row={key:key,columns:{}};for(var c of columns){if(!raw[c])continue;var path='observations/'+ordinal+'/'+c+'.f64';row.columns[c]={path:path,length:raw[c].length};zip.file(path,binary(raw[c]));}index.push(row);ordinal++;}
    doc.observations=index;if(doc.fitHistory)doc.fitHistory.observations=[];
    doc.solutionState=RV.solve && RV.solve.archive?RV.solve.archive(!!opts.density,new Set(doc.fitHistory?doc.fitHistory.records.map(function(r){return r.id;}):[])):null;
    // The WPPF precision block is a square matrix of doubles: 8 bytes a value in its own entry, against ~19 bytes of
    // text in project.json. It is the largest thing a solved structure puts in a project.
    var pre=doc.solutionState && doc.solutionState.ints && doc.solutionState.ints.pre;
    if(pre && Array.isArray(pre.Q) && Array.isArray(pre.index)){
      zip.file(PRECISION_Q,binary(pre.Q));zip.file(PRECISION_INDEX,ints32(pre.index));
      pre.Q={path:PRECISION_Q,length:pre.Q.length};pre.index={path:PRECISION_INDEX,length:pre.index.length};
    }
    zip.file('project.json',JSON.stringify(doc));
    return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}},function(p){if(opts.progress)opts.progress(p.percent);});
  }
  // Limits on what an archive may claim, so a damaged or hostile file fails with a message instead of exhausting memory.
  var LIMITS={json:256e6,column:8e8,rows:100000,files:100000,archive:512e6,decoded:1e9};
  // Advisory only: JSZip's per-entry header record. A missing one returns null, and the caller then relies on
  // the decoded length (project.json) or on the field length it validated itself (observation columns).
  function declaredSize(entry){var d=entry && entry._data;return d && Number.isFinite(d.uncompressedSize)?d.uncompressedSize:null;}
  function plain(x){return !!x && typeof x==='object' && !Array.isArray(x);}
  async function unpack(buffer){if(typeof JSZip==='undefined')throw new Error('Project compression library is unavailable.');
    if(buffer.byteLength>LIMITS.archive)throw new Error('Project archive is too large.');
    var zip=await JSZip.loadAsync(buffer),entries=Object.values(zip.files);
    if(entries.length>LIMITS.files)throw new Error('Too many files in project archive.');
    var total=0;
    entries.forEach(function(file){if(file.dir)return;var n=declaredSize(file);if(!Number.isSafeInteger(n) || n<0)throw new Error('Invalid archive entry size.');total+=n;if(total>LIMITS.archive)throw new Error('Project archive uncompressed size exceeds the limit.');});
    var entry=zip.file('project.json');if(!entry)throw new Error('This archive is not a Powder 6 project.');
    // A declared size is only a cheap early exit: it comes from JSZip's private header record, which is not
    // guaranteed to be there. The decoded length is the authoritative check, so the limit still holds when
    // the header cannot be read.
    var size=declaredSize(entry);if(size!==null && size>LIMITS.json)throw new Error('project.json is too large to be a Powder 6 project.');
    var json;try{json=await entry.async('string');}catch(e){throw new Error('project.json could not be read.');}
    if(json.length>LIMITS.json)throw new Error('project.json is too large to be a Powder 6 project.');
    var doc;try{doc=JSON.parse(json);}catch(e){throw new Error('project.json is not valid JSON.');}
    // 4 stores the precision block as its own entry; 3 kept it in project.json, which reads back the same way.
    if(!plain(doc) || doc.format!=='powder6-project' || !(doc.version===3 || doc.version===4))throw new Error('Unsupported project format.');
    var pool=Object.create(null),rows=doc.observations;if(!Array.isArray(rows))throw new Error('Missing project observations.');if(rows.length>LIMITS.rows)throw new Error('Too many observation sets.');if(!Array.isArray(doc.datasets))throw new Error('Missing project datasets.');
    // Validate every reference before decoding any column. Count repeated paths
    // too: each reference allocates another output and a temporary byte array.
    var decoded=(size || 0)*4,keys=new Set();
    for(var row of rows){if(!plain(row) || typeof row.key!=='string' || keys.has(row.key) || !plain(row.columns))throw new Error('Invalid observation identifier.');keys.add(row.key);for(var c of columns){var field=row.columns[c];if(!field)continue;
        if(!plain(field) || typeof field.path!=='string' || !Number.isSafeInteger(field.length) || field.length<0 || field.length*8>LIMITS.column)throw new Error('Invalid observation column.');
        var file=zip.file(field.path);if(!file)throw new Error('Missing observation column '+field.path);var declared=declaredSize(file);if(declared!==null && declared!==field.length*8)throw new Error('Observation column length mismatch.');
        decoded+=field.length*16;if(decoded>LIMITS.decoded)throw new Error('Project decoded observations exceed the memory limit.');
      }}
    // Validate precision entries and their peak allocations before decoding any binary columns.
    var pre=doc.solutionState && plain(doc.solutionState.ints) && doc.solutionState.ints.pre;
    if(plain(pre) && plain(pre.Q) && typeof pre.Q.path==='string'){
      var qf=zip.file(pre.Q.path),xf=plain(pre.index) && typeof pre.index.path==='string'?zip.file(pre.index.path):null;
      if(!qf || !xf)throw new Error('Missing the WPPF precision block.');
      if(!Number.isSafeInteger(pre.Q.length) || pre.Q.length<0 || pre.Q.length*8>LIMITS.column || !Number.isSafeInteger(pre.index.length) || pre.index.length<0 || pre.index.length*4>LIMITS.column)throw new Error('Invalid WPPF precision block.');
      if(declaredSize(qf)!==pre.Q.length*8)throw new Error('WPPF precision block length mismatch.');
      if(declaredSize(xf)!==pre.index.length*4)throw new Error('WPPF precision index length mismatch.');
      // Inflated bytes, typed output and boxed-array conversion (conservative allowance).
      decoded+=pre.Q.length*32+pre.index.length*24;
      if(decoded>LIMITS.decoded)throw new Error('Project decoded precision block exceeds the memory limit.');
    }
    for(var row of rows){var raw={key:row.key};for(var c of columns){var field=row.columns[c];if(!field){raw[c]=null;continue;}var file=zip.file(field.path);
        var array=values(await file.async('uint8array'));if(array.length!==field.length)throw new Error('Observation column length mismatch.');raw[c]=array;}
      if(!raw.tth || !raw.y || raw.tth.length!==raw.y.length)throw new Error('Invalid powder observations.');
      if(raw.sig && raw.sig.length!==raw.tth.length)throw new Error('Observation uncertainty length mismatch.');
      if(raw.weights && raw.weights.length!==raw.tth.length)throw new Error('Observation weights length mismatch.');
      pool[row.key]=raw;}
    doc.datasets.forEach(function(d){var raw=plain(d) && typeof d.dataKey==='string'?pool[d.dataKey]:null;if(!raw)throw new Error('Missing observations for '+(plain(d) && d.name || 'a dataset'));columns.forEach(function(c){d[c]=raw[c] || null;});});
    if(doc.fitHistory)doc.fitHistory.observations=Object.values(pool).map(function(raw){var o={key:raw.key};columns.forEach(function(c){o[c]=raw[c] || null;});return o;});
    // The validated precision block, restored as the arrays RV.sgtest reads.
    if(qf && xf){
      var q=values(await qf.async('uint8array'));if(q.length!==pre.Q.length)throw new Error('WPPF precision block length mismatch.');
      var xi=int32s(await xf.async('uint8array'));if(xi.length!==pre.index.length)throw new Error('WPPF precision index length mismatch.');
      pre.Q=Array.from(q);pre.index=Array.from(xi);
    }
    return doc;
  }
  /* Ask what to keep, then WHERE (Save As, while the click still counts), then compress and write. Every way out
     says what happened: refused while busy, cancelled, saved (name and size), or failed and why. */
  async function save(){
    var ui=RV.ui;
    if(S.busy){ui.toast('A calculation is running: wait for it to finish, or press Stop, then save the project again.','warn');return;}
    if(!S.datasets.length && !S.phases.length){ui.toast('Nothing to save yet: read a pattern or make a phase first.','info');return;}
    // The preset files started at load are part of the document. Waiting for them here is what keeps a save made in
    // the first moments of a session from being compared against a document they had not reached: without it the
    // project looked modified the moment it was written (beforeunload warned with nothing edited).
    if(RV.cmd && RV.cmd.defaultPresetsReady)await RV.cmd.defaultPresetsReady();
    RV.fitHistory.observations();var storage=RV.fitHistory.usage(),hasPicker=typeof window.showSaveFilePicker==='function' && window.isSecureContext!==false;
    var choice=await ui.prompt('Save project',[{key:'compact',label:'Compact history',type:'checkbox',value:false,hint:'Keep the latest fit of each method and all records marked Keep. Otherwise save every retained record.'},{key:'density',label:'Include CF density maps',type:'checkbox',value:false,hint:'Atomic candidates and source information are always saved; density grids can be large.'}],
      hasPicker?'Choose file…':'Save',
      'Observations: '+(storage.observations/1000000).toFixed(2)+' MB, stored once. Calculation history: '+(storage.history/1000000).toFixed(2)+' MB before compression. '+
      (hasPicker?'Next, choose the file name and folder.':'The file goes to your browser’s download folder (to choose it each time, enable “Ask where to save each file” in the browser’s download settings).'));
    if(!choice)return;
    var target;
    try{target=await ui.chooseSaveTarget('powder6_'+ui.fileStamp()+EXTENSIONS[0],'application/zip',{title:'Save project',description:'Powder 6 project',pickerId:'powder6-project',askName:false});}
    catch(x){ui.toast('The project was not saved: the browser refused the file ('+(x && x.message || x)+').','err');return;}
    if(!target){ui.toast('Project not saved (cancelled).','info');return;}
    if(S.busy){ui.toast('A calculation started meanwhile: the project was not saved. Save again when it ends.','warn');return;}
    St.setBusy(true,'Compressing project…');
    try{
      var savingSnapshot=snapshot();
      var output=await pack({compact:choice.compact,density:choice.density,progress:function(p){ui.progress(p,100,'Saving '+p.toFixed(0)+'%');}});
      await ui.writeSaveTarget(target,output,'application/zip');
      markSaved(savingSnapshot);
      var size=(output.byteLength/1000000).toFixed(2)+' MB';
      ui.toast(target.download?'Saved project '+target.name+' ('+size+') to your browser’s download folder. If it is not there, look for a blocked-download notice next to the address bar.':'Saved project as '+target.name+' ('+size+').','ok');
    }catch(x){
      ui.toast('The project could not be saved: '+(x && x.message || x)+'.'+(target.handle?' The file '+target.name+' may have been left empty; save again.':' Nothing was downloaded.'),'err');
    }finally{St.setBusy(false);ui.progress(0,0);}
  }
  return {pack:pack,unpack:unpack,save:save,markSaved:markSaved,hasUnsavedChanges:hasUnsavedChanges,binary:binary,values:values,EXTENSIONS:EXTENSIONS,isProjectName:isProjectName,isProjectArchive:isProjectArchive};
})();
