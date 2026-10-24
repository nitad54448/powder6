/* Portable compressed projects: one little-endian binary copy of each observation
   column, JSON model/checkpoint metadata, and optional CF density arrays. */
RV.project = (function(){
  'use strict';
  var St=RV.state,S=St.S,columns=['tth','y','sig','weights'];
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
  async function pack(opts){opts=opts || {};if(typeof JSZip==='undefined')throw new Error('Project compression library is unavailable.');var doc=JSON.parse(St.projectJSON(RV.ui.logEntries?RV.ui.logEntries():[],{metadataOnly:true})),pool=RV.fitHistory.observations(),zip=new JSZip(),index=[];
    if(opts.compact && doc.fitHistory){doc.fitHistory.records=doc.fitHistory.records.filter(function(r){return r.pinned || r.id===(RV.fitHistory.latest(r.method)||{}).id;});var used=new Set(doc.fitHistory.records.map(function(r){return r.model;}));Object.keys(doc.fitHistory.models).forEach(function(k){if(!used.has(k))delete doc.fitHistory.models[k];});}
    var needed=new Set(doc.datasets.map(function(d){return d.dataKey;}));if(doc.fitHistory)doc.fitHistory.records.forEach(function(r){r.datasets.concat(r.dependencies || []).forEach(function(d){needed.add(d.dataKey);});});
    var ordinal=0;for(var key of needed){var raw=pool[key];if(!raw)throw new Error('Missing observations '+key);var row={key:key,columns:{}};for(var c of columns){if(!raw[c])continue;var path='observations/'+ordinal+'/'+c+'.f64';row.columns[c]={path:path,length:raw[c].length};zip.file(path,binary(raw[c]));}index.push(row);ordinal++;}
    doc.observations=index;if(doc.fitHistory)doc.fitHistory.observations=[];
    doc.solutionState=RV.solve && RV.solve.archive?RV.solve.archive(!!opts.density,new Set(doc.fitHistory?doc.fitHistory.records.map(function(r){return r.id;}):[])):null;
    zip.file('project.json',JSON.stringify(doc));
    return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}},function(p){if(opts.progress)opts.progress(p.percent);});
  }
  // Limits on what an archive may claim, so a damaged or hostile file fails with a message instead of exhausting memory.
  var LIMITS={json:256e6,column:8e8,rows:100000,files:2000000};
  function declaredSize(entry){var d=entry && entry._data;return d && Number.isFinite(d.uncompressedSize)?d.uncompressedSize:null;}
  function plain(x){return !!x && typeof x==='object' && !Array.isArray(x);}
  async function unpack(buffer){if(typeof JSZip==='undefined')throw new Error('Project compression library is unavailable.');var zip=await JSZip.loadAsync(buffer),entry=zip.file('project.json');if(!entry)throw new Error('This archive is not a Powder 6 project.');
    var size=declaredSize(entry);if(size!==null && size>LIMITS.json)throw new Error('project.json is too large to be a Powder 6 project.');
    var doc;try{doc=JSON.parse(await entry.async('string'));}catch(e){throw new Error('project.json is not valid JSON.');}
    if(!plain(doc) || doc.format!=='powder6-project' || doc.version!==3)throw new Error('Unsupported project format.');
    var pool=Object.create(null),rows=doc.observations;if(!Array.isArray(rows))throw new Error('Missing project observations.');if(rows.length>LIMITS.rows)throw new Error('Too many observation sets.');if(!Array.isArray(doc.datasets))throw new Error('Missing project datasets.');
    for(var row of rows){if(!plain(row) || typeof row.key!=='string' || row.key in pool || !plain(row.columns))throw new Error('Invalid observation identifier.');var raw={key:row.key};for(var c of columns){var field=row.columns[c];if(!field){raw[c]=null;continue;}
        if(!plain(field) || typeof field.path!=='string' || !Number.isSafeInteger(field.length) || field.length<0 || field.length*8>LIMITS.column)throw new Error('Invalid observation column.');
        var file=zip.file(field.path);if(!file)throw new Error('Missing observation column '+field.path);var declared=declaredSize(file);if(declared!==null && declared!==field.length*8)throw new Error('Observation column length mismatch.');
        var array=values(await file.async('uint8array'));if(array.length!==field.length)throw new Error('Observation column length mismatch.');raw[c]=array;}
      if(!raw.tth || !raw.y || raw.tth.length!==raw.y.length)throw new Error('Invalid powder observations.');pool[row.key]=raw;}
    doc.datasets.forEach(function(d){var raw=plain(d) && typeof d.dataKey==='string'?pool[d.dataKey]:null;if(!raw)throw new Error('Missing observations for '+(plain(d) && d.name || 'a dataset'));columns.forEach(function(c){d[c]=raw[c] || null;});});
    if(doc.fitHistory)doc.fitHistory.observations=Object.values(pool).map(function(raw){var o={key:raw.key};columns.forEach(function(c){o[c]=raw[c] || null;});return o;});
    return doc;
  }
  /* Ask what to keep, then WHERE (Save As, while the click still counts), then compress and write. Every way out
     says what happened: refused while busy, cancelled, saved (name and size), or failed and why. */
  async function save(){
    var ui=RV.ui;
    if(S.busy){ui.toast('A calculation is running: wait for it to finish, or press Stop, then save the project again.','warn');return;}
    if(!S.datasets.length && !S.phases.length){ui.toast('Nothing to save yet: read a pattern or make a phase first.','info');return;}
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
      var output=await pack({compact:choice.compact,density:choice.density,progress:function(p){ui.progress(p,100,'Saving '+p.toFixed(0)+'%');}});
      await ui.writeSaveTarget(target,output,'application/zip');
      var size=(output.byteLength/1000000).toFixed(2)+' MB';
      ui.toast(target.download?'Saved project '+target.name+' ('+size+') to your browser’s download folder. If it is not there, look for a blocked-download notice next to the address bar.':'Saved project as '+target.name+' ('+size+').','ok');
    }catch(x){
      ui.toast('The project could not be saved: '+(x && x.message || x)+'.'+(target.handle?' The file '+target.name+' may have been left empty; save again.':' Nothing was downloaded.'),'err');
    }finally{St.setBusy(false);ui.progress(0,0);}
  }
  return {pack:pack,unpack:unpack,save:save,binary:binary,values:values,EXTENSIONS:EXTENSIONS,isProjectName:isProjectName,isProjectArchive:isProjectArchive};
})();
