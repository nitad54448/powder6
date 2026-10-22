/* Portable compressed projects: one little-endian binary copy of each observation
   column, JSON model/checkpoint metadata, and optional CF density arrays. */
RV.project = (function(){
  'use strict';
  var St=RV.state,S=St.S,columns=['tth','y','sig','weights'];
  function binary(array){var buffer=new ArrayBuffer(array.length*8),view=new DataView(buffer);for(var i=0;i<array.length;i++)view.setFloat64(i*8,array[i],true);return new Uint8Array(buffer);}
  function values(array){if(array.byteLength%8)throw new Error('Invalid observation column size.');var view=new DataView(array.buffer,array.byteOffset,array.byteLength),out=new Float64Array(array.length/8);for(var i=0;i<out.length;i++)out[i]=view.getFloat64(i*8,true);return out;}
  async function pack(opts){opts=opts || {};if(typeof JSZip==='undefined')throw new Error('Project compression library is unavailable.');var doc=JSON.parse(St.projectJSON(RV.ui.logEntries?RV.ui.logEntries():[],{metadataOnly:true})),pool=RV.fitHistory.observations(),zip=new JSZip(),index=[];
    if(opts.compact && doc.fitHistory){doc.fitHistory.records=doc.fitHistory.records.filter(function(r){return r.pinned || r.id===(RV.fitHistory.latest(r.method)||{}).id;});var used=new Set(doc.fitHistory.records.map(function(r){return r.model;}));Object.keys(doc.fitHistory.models).forEach(function(k){if(!used.has(k))delete doc.fitHistory.models[k];});}
    var needed=new Set(doc.datasets.map(function(d){return d.dataKey;}));if(doc.fitHistory)doc.fitHistory.records.forEach(function(r){r.datasets.concat(r.dependencies || []).forEach(function(d){needed.add(d.dataKey);});});
    var ordinal=0;for(var key of needed){var raw=pool[key];if(!raw)throw new Error('Missing observations '+key);var row={key:key,columns:{}};for(var c of columns){if(!raw[c])continue;var path='observations/'+ordinal+'/'+c+'.f64';row.columns[c]={path:path,length:raw[c].length};zip.file(path,binary(raw[c]));}index.push(row);ordinal++;}
    doc.observations=index;if(doc.fitHistory)doc.fitHistory.observations=[];
    doc.solutionState=RV.solve && RV.solve.archive?RV.solve.archive(!!opts.density):null;
    zip.file('project.json',JSON.stringify(doc));
    return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}},function(p){if(opts.progress)opts.progress(p.percent);});
  }
  async function unpack(buffer){if(typeof JSZip==='undefined')throw new Error('Project compression library is unavailable.');var zip=await JSZip.loadAsync(buffer),entry=zip.file('project.json');if(!entry)throw new Error('This archive is not a Powder 6 project.');var doc=JSON.parse(await entry.async('string'));if(doc.format!=='powder6-project' || doc.version!==3)throw new Error('Unsupported project format.');var pool={},rows=doc.observations;if(!Array.isArray(rows))throw new Error('Missing project observations.');
    for(var row of rows){if(!row || typeof row.key!=='string' || pool[row.key])throw new Error('Invalid observation identifier.');var raw={key:row.key};for(var c of columns){var field=row.columns[c];if(!field){raw[c]=null;continue;}var file=zip.file(field.path);if(!file)throw new Error('Missing observation column '+field.path);var array=values(await file.async('uint8array'));if(array.length!==field.length)throw new Error('Observation column length mismatch.');raw[c]=array;}if(!raw.tth||!raw.y||raw.tth.length!==raw.y.length)throw new Error('Invalid powder observations.');pool[row.key]=raw;}
    doc.datasets.forEach(function(d){var raw=pool[d.dataKey];if(!raw)throw new Error('Missing observations for '+d.name);columns.forEach(function(c){d[c]=raw[c] || null;});});
    if(doc.fitHistory)doc.fitHistory.observations=Object.values(pool).map(function(raw){var o={key:raw.key};columns.forEach(function(c){o[c]=raw[c] || null;});return o;});
    return doc;
  }
  async function save(){if(S.busy)return;RV.fitHistory.observations();var storage=RV.fitHistory.usage(),choice=await RV.ui.prompt('Save project',[{key:'compact',label:'Compact history',type:'checkbox',value:false,hint:'Keep the latest fit of each method and all records marked Keep. Otherwise save every retained record.'},{key:'density',label:'Include CF density maps',type:'checkbox',value:false,hint:'Atomic candidates and source information are always saved; density grids can be large.'}],'Prepare file','Observations: '+(storage.observations/1000000).toFixed(2)+' MB, stored once. Calculation history: '+(storage.history/1000000).toFixed(2)+' MB before compression.');if(!choice)return;St.setBusy(true,'Compressing project…');try{var output=await pack({compact:choice.compact,density:choice.density,progress:function(p){RV.ui.progress(p,100,'Saving '+p.toFixed(0)+'%');}});RV.ui.download('powder6_'+RV.ui.fileStamp()+'.powder6',output,'application/zip');RV.ui.toast('Saved project: '+(output.byteLength/1000000).toFixed(2)+' MB compressed.','ok');}finally{St.setBusy(false);RV.ui.progress(0,0);}}
  return {pack:pack,unpack:unpack,save:save,binary:binary,values:values};
})();
