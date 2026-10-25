/* Dataset-owned parameter editors, calculation setup and the persistent FIT inspector. */
RV.workspace=(function(){
  'use strict';
  var St=RV.state,S=St.S,ui=RV.ui,esc=ui.esc,queued=0,datasetId=null;
  function $(q){return document.querySelector(q);}
  function move(node,parent){if(node && parent)parent.appendChild(node);}
  function dataset(){return St.byId(datasetId) || St.first() || S.datasets[0] || null;}
  function inspectDataset(id){var d=St.byId(id);if(!d)return;datasetId=d.id;if(S.sel.has(d.id))St.setFocus(d.id);RV.bus.emit('datasetFocus',d.id);}
  function scopeOptions(){return [['selection','Selected datasets ('+S.sel.size+')'],['all','All datasets ('+S.datasets.length+')']];}
  function targetField(label){var d=dataset();return {key:'targets',label:label || 'Apply to datasets',type:'select',value:RV.app && RV.app.commandTab()==='datasets' && d?'dataset:'+d.id:'selection',options:scopeOptions().concat(S.datasets.map(function(d){return ['dataset:'+d.id,d.name];})),hint:'The target count is shown before applying. Each dataset retains its own observations and background.'};}
  function targets(value){if(value==='all')return S.datasets.slice();if(/^dataset:/.test(value))return [St.byId(+value.slice(8))].filter(Boolean);return St.selected();}
  function scopesHTML(){return '<label class="scope-label">Fit / plot datasets <select data-dataset-scope aria-label="Datasets to fit and plot">'+scopeOptions().map(function(o){return '<option value="'+o[0]+'">'+esc(o[1])+'</option>';}).join('')+'</select></label><button type="button" class="mini" data-dataset-action="delete"'+(S.busy || !S.sel.size?' disabled':'')+'>Delete selected…</button>';}
  // The View / Inspect line only means something with two or more selected datasets (with one, overlay, overview and
  // inspect are the same picture), and only on the Plots tab.
  function syncPlotSelection(){var bar=$('#plot-selection');if(bar)bar.hidden=!(RV.layout && RV.layout.resultTab()==='pattern') || St.selected().length<2;}
  function focusSelect(){syncPlotSelection();var list=St.selected(),first=St.first(),options=list.map(function(d){return '<option value="'+d.id+'"'+(first && first.id===d.id?' selected':'')+'>'+esc(d.name)+'</option>';}).join('');$('#inspect-dataset').innerHTML=options;$('#plot-mode').value=S.settings.plotMode;$('#plot-selection-note').textContent=list.length+' dataset(s) selected for fit and plots'+(first?' · inspecting '+first.name:'');}
  function renderScopes(){document.querySelectorAll('.dataset-scope').forEach(function(h){h.innerHTML=scopesHTML();h.hidden=S.datasets.length<9;});}
  function editAnchorX(el){
    var d=dataset(),k=+el.dataset.anchorX,x=ui.parseNum(el.value),message='';
    if(!d || d.inst.bkgType!=='spline' || k>=d.inst.bkgX.length)return;
    if(!Number.isFinite(x))message='Enter a number for the anchor X coordinate.';
    else if(x<d.tth[0] || x>d.tth[d.tth.length-1])message='Keep anchor X between '+RV.panels.fmtVal(d.tth[0])+' and '+RV.panels.fmtVal(d.tth[d.tth.length-1])+'°.';
    else if(d.inst.bkgX.some(function(a,i){return i!==k && Math.abs(a-x)<=1e-6;}))message='Keep background anchors at distinct angles.';
    if(message){el.classList.add('invalid');el.setAttribute('aria-invalid','true');ui.toast(message,'warn');return;}
    el.classList.remove('invalid');el.removeAttribute('aria-invalid');
    if(x===d.inst.bkgX[k])return;
    RV.history.take('moving background anchor of '+d.name);
    St.moveBackgroundAnchor(d,k,x,d.p['bga'+k]);
  }
  function datasetEditor(){
    var host=$('#dataset-values'),d=dataset(),nav=$('#dataset-tabs'),detail=$('#dataset-detail');
    var editor=$('#dataset-editor'),accordions=$('#dataset-accordions');
    if(!accordions){accordions=document.createElement('div');accordions.id='dataset-accordions';editor.before(accordions);accordions.appendChild(editor);}
    accordions.querySelectorAll('[data-dataset-accordion]').forEach(function(el){el.remove();});
    var shown=St.selected();if(d && !shown.some(function(item){return item.id===d.id;}))shown=shown.concat([d]);
    var activeSeen=false;shown.forEach(function(item){
      if(d && item.id===d.id){activeSeen=true;return;}
      var shell=document.createElement('details');shell.className='acc dataset-accordion dataset-card';shell.dataset.datasetAccordion=item.id;
      var summary=document.createElement('summary'),name=document.createElement('span');name.className='acc-t';name.textContent=item.name;name.style.color=RV.plots.colorVar(item);summary.appendChild(name);shell.appendChild(summary);
      summary.addEventListener('click',function(e){e.preventDefault();inspectDataset(item.id);editor.open=true;render();if(e.detail===0)editor.querySelector('summary').focus();});if(activeSeen)accordions.appendChild(shell);else accordions.insertBefore(shell,editor);
    });
    var tabs=S.datasets.map(function(item){var on=d && item.id===d.id;return '<button type="button" role="tab" id="dataset-tab-'+item.id+'" data-dataset-tab="'+item.id+'" aria-controls="dataset-detail" aria-selected="'+!!on+'" tabindex="'+(on?'0':'-1')+'" style="--dataset-color:'+RV.plots.colorVar(item)+'" title="'+esc(item.name)+(S.sel.has(item.id)?' · Included in fit and plots':' · Not selected for fit or plots')+'"><i class="sw" aria-hidden="true"></i><span>'+esc(item.name)+'</span></button>';}).join('');
    if(nav.innerHTML!==tabs)nav.innerHTML=tabs;
    detail.hidden=!d;if(!d){host.innerHTML='';return;}
    detail.setAttribute('aria-labelledby','dataset-editor-name');
    $('#dataset-editor-name').textContent=d.name;
    $('#dataset-editor-name').style.color=RV.plots.colorVar(d);
    host.innerHTML='<p class="hint">'+esc(RVCore.METHOD_LABELS[S.calculation])+' · Values and refine/fixed controls apply only to this dataset. Choose a dataset in the Datasets list to inspect its values.</p><p>'+d.tth.length+' observations · '+(d.sig?'Imported Y uncertainties':'No imported Y uncertainties')+' · '+(d.weights?'Imported point weights':'Calculated point weights')+'</p>';
  }
  function phaseEditor(){var body=$('#phase-body'),p=St.currentPhase();if(!body || !p || !$('#phase-select'))return;var extra=$('#phase-workspace');if(!extra){extra=document.createElement('section');extra.id='phase-workspace';extra.className='pblock phase-workspace';body.appendChild(extra);}var held=St.holdersOf(p);extra.innerHTML='<h2>Used in datasets</h2><p class="phase-members">'+held.map(function(d){return '<button class="mini" data-phase-dataset="'+d.id+'">'+esc(d.name)+'</button>';}).join('')+'</p><button data-phase-assign>Assign datasets…</button><p class="hint">Edit each dataset’s cell, atoms, sample broadening, preferred orientation and refinement flags in its Datasets tab. This view edits the shared phase definition and starting model.</p>'+(p.provenance?'<p class="hint">Structure source: '+esc(p.provenance.label || p.provenance.kind || 'imported solution')+' · '+esc(p.provenance.dataset || '')+'</p>':'');
  }
  function emptyStates(){
    var noDatasets=!S.datasets.length,noPhases=!S.phases.length;
    $('#datasets-empty').hidden=!noDatasets;
    $('#dataset-content').hidden=noDatasets;
    $('#phase-selection').hidden=noPhases;
    // a search box is for a long list: from nine datasets on
    var find=$('#dataset-search');if(find){var many=S.datasets.length>8;if(!many && find.value){find.value='';$('#ds-list').querySelectorAll('.ds').forEach(function(row){row.hidden=false;});}find.hidden=!many;}
    $('#method-setup').hidden=noPhases || noDatasets;
  }
  function render(){queued=0;emptyStates();focusSelect();var tab=RV.app && RV.app.commandTab();if(tab==='datasets'){datasetEditor();RV.panels.renderLimits();var host=$('#dataset-atomic-constraints');if(host && RV.constraints)RV.constraints.renderSolve(host,true);if(RV.restraints)RV.restraints.renderDatasets($('#dataset-restraints'),dataset());linkEditor();}if(tab==='phases')phaseEditor();if(RV.layout)RV.layout.syncRunPicker();}
  function schedule(){if(!queued)queued=requestAnimationFrame(render);}
  function inspectStep(dir){var list=St.selected(),i=list.indexOf(St.first());if(list.length)St.setFocus(list[(i+dir+list.length)%list.length].id);}
  function linkText(l){return (St.byId(l.target.datasetId)||{}).name+' · '+l.target.name+' = '+l.factor+' × '+(St.byId(l.source.datasetId)||{}).name+' · '+l.source.name+' + '+St.toDisplay(l.target.name,l.offset || 0);}
  function linkEditor(){var host=$('#dataset-links');if(!host)return;host.innerHTML='<p class="hint">A dependent parameter follows one independent source exactly. Links can connect different phases or datasets for this method.</p>'+S.parameterLinks.map(function(l){return '<p>'+esc(linkText(l))+' <button class="mini" data-remove-link="'+esc(l.id)+'">Remove</button></p>';}).join('')+'<button data-add-link>Add parameter link…</button>';}
  function phaseControls(){var host=$('#method-phase-controls');if(!host)return;host.innerHTML='<fieldset><legend>Phase contributions included in this method</legend>'+S.phases.map(function(p){var n=St.selected().filter(function(d){return St.hasPhase(d,p);}).length;return '<label class="chk"><input type="checkbox" data-method-phase="'+p.key+'"'+(!S.disabledPhases.includes(p.key)?' checked':'')+(n && !S.busy?'':' disabled')+'> '+esc(p.name)+' <small>in '+n+' selected dataset(s)</small></label>';}).join('')+'</fieldset>';}
  async function addLink(){var datasets=S.datasets;if(!datasets.length)return;var first=St.first() || datasets[0],fields=[{key:'sourceDs',label:'Source dataset',type:'select',value:String(first.id),options:datasets.map(function(d){return [String(d.id),d.name];})},{key:'sourceName',label:'Independent parameter',type:'select',value:'',options:[]},{key:'targetDs',label:'Target dataset',type:'select',value:String(first.id),options:datasets.map(function(d){return [String(d.id),d.name];})},{key:'targetName',label:'Dependent parameter',type:'select',value:'',options:[]},{key:'factor',label:'Multiplier',type:'number',value:1},{key:'offset',label:'Offset (target display units)',type:'number',value:0}];var v=await ui.prompt('Link parameters',fields,'Add link','Target = multiplier × source + offset. Source and target may belong to different phases or datasets. A source outside the fit is held at its current value.',{onOpen:function(body){function update(prefix){var d=St.byId(+body.querySelector('[data-key="'+prefix+'Ds"]').value),input=body.querySelector('[data-key="'+prefix+'Name"]');input.innerHTML=St.namesFor(d).filter(St.isVariable).map(function(n){return '<option value="'+esc(n)+'">'+esc(n)+(St.isSizeParam(n)?' (nm)':'')+'</option>';}).join('');}update('source');update('target');body.addEventListener('change',function(e){if(e.target.dataset.key==='sourceDs')update('source');if(e.target.dataset.key==='targetDs')update('target');});}});if(!v)return;var link={id:'link-'+Date.now().toString(36),source:{datasetId:+v.sourceDs,name:v.sourceName},target:{datasetId:+v.targetDs,name:v.targetName},factor:v.factor*St.fromDisplay(v.targetName,1)/St.fromDisplay(v.sourceName,1),offset:St.fromDisplay(v.targetName,v.offset)};var links=S.parameterLinks.concat([link]),job=St.problemFor(S.datasets);job.parameterLinks=links;try{var plan=AtomicConstraints.prepare(job);if(!plan.valid(plan.values))throw new Error('Linked values exceed parameter limits.');RV.history.take('parameter link');S.parameterLinks=links;S.datasets.forEach(function(d,i){d.p=plan.values[i];d.stats=null;d.esd={};d.ints=null;St.syncSites(d);St.invalidate(d);});RV.bus.emit('params',{});RV.bus.emit('shared',{});}catch(e){ui.toast(e.message,'warn');}}
  function init(){
    var phaseHost=document.createElement('section');phaseHost.id='method-phase-controls';phaseHost.className='phase-controls';$('#method-refine-controls').prepend(phaseHost);
    var limits=$('#dataset-limits-host').closest('details');limits.querySelector('summary').textContent='Parameter links and sharing';$('#dataset-links-group').appendChild(limits);
    document.addEventListener('change',function(e){var el=e.target;if(el.id==='inspect-dataset'){St.setFocus(+el.value);return;}if(el.id==='plot-mode'){St.setSetting('plotMode',el.value);return;}if(S.busy)return;if(el.hasAttribute('data-anchor-x')){editAnchorX(el);return;}if(el.matches('[data-dataset-scope]') && el.value!=='selection')St.selectIds(targets(el.value).map(function(d){return d.id;}));});
    document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-anchor-remove')){RV.cmd.removeAnchor(dataset(),+b.dataset.anchorRemove);return;}if(b.hasAttribute('data-zone-remove')){var zr=b.closest('[data-zone]').dataset.zone.split(':');RV.cmd.removeZone(dataset(),zr[0],+zr[1]);return;}if(b.id==='ds-excl'){RV.cmd.addZone();return;}if(b.hasAttribute('data-dataset-tab')){inspectDataset(+b.dataset.datasetTab);return;}if(b.dataset.inspectStep){inspectStep(+b.dataset.inspectStep);return;}if(S.busy)return;if(b.hasAttribute('data-workspace-undo'))RV.cmd.undo();else if(b.hasAttribute('data-edit-method'))RV.app.showTab('datasets');else if(b.dataset.openPhase){St.selectPhase(b.dataset.openPhase);RV.app.showTab('phases');}else if(b.dataset.phaseDataset){inspectDataset(+b.dataset.phaseDataset);RV.app.showTab('datasets');}else if(b.hasAttribute('data-phase-assign'))RV.cmd.phaseMap();else if(b.dataset.openSolution){RV.app.showTab('structure');RV.layout.structureResult(b.dataset.openSolution);var host=$('[data-acc="wppf-'+(b.dataset.openSolution==='cf'?'cf':'wy')+'"]');if(host){for(var node=host;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;host.scrollIntoView({block:'start'});}}});
    document.addEventListener('change',function(e){var el=e.target,row=el.closest && el.closest('[data-zone]');if(!row || !el.matches('[data-zone-lo],[data-zone-hi],[data-zone-apply]'))return;var d=dataset(),zr=row.dataset.zone.split(':'),k=+zr[1];if(!d)return;if(el.matches('[data-zone-apply]')){RV.cmd.applyZone(d,zr[0],k,el.checked);return;}var lo=ui.parseNum(row.querySelector('[data-zone-lo]').value),hi=ui.parseNum(row.querySelector('[data-zone-hi]').value),ok=RV.cmd.editZone(d,zr[0],k,lo,hi);el.classList.toggle('invalid',!ok);if(ok)el.removeAttribute('aria-invalid');else el.setAttribute('aria-invalid','true');});
    document.addEventListener('focusin',function(e){if(e.target.matches('[data-anchor-x]'))RV.bus.emit('paramFocus',{name:'bga'+e.target.dataset.anchorX,dsId:dataset().id});});document.addEventListener('focusout',function(e){if(e.target.matches('[data-anchor-x]'))RV.bus.emit('paramFocus',null);});
    $('#dataset-search').addEventListener('input',function(){var needle=this.value.toLowerCase();$('#ds-list').querySelectorAll('.ds').forEach(function(row){row.hidden=!row.textContent.toLowerCase().includes(needle);});});
    document.addEventListener('click',function(e){if(e.target.closest('#pane-phases [data-atomic-constraints]')){e.preventDefault();e.stopImmediatePropagation();RV.app.showTab('datasets');$('#dataset-constraints-host').closest('details').open=true;$('#dataset-atomic-constraints').scrollIntoView({block:'start'});}},true);
    $('#dataset-tabs').addEventListener('keydown',function(e){if(!/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key))return;var d=dataset(),i=S.datasets.indexOf(d),n=S.datasets.length;if(!n)return;e.preventDefault();var j=e.key==='Home'?0:e.key==='End'?n-1:(i+(e.key==='ArrowRight'?1:-1)+n)%n;inspectDataset(S.datasets[j].id);datasetEditor();$('#dataset-tab-'+S.datasets[j].id).focus();});
    RV.bus.on('selection',function(){var d=St.first();if(d)datasetId=d.id;RV.bus.emit('datasetFocus');});
    ['selection','datasets'].forEach(function(ev){RV.bus.on(ev,renderScopes);});
    ['selection','datasets','datasetFocus','phases','params','data','calculation','shared','fitmode','settings','fitHistory','busy','tab','phaseSel'].forEach(function(ev){RV.bus.on(ev,schedule);});
    renderScopes();render();RV.fitHistory.init();
    document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b || S.busy)return;if(b.hasAttribute('data-add-link'))addLink();else if(b.dataset.removeLink){RV.history.take('remove parameter link');S.parameterLinks=S.parameterLinks.filter(function(l){return l.id!==b.dataset.removeLink;});RV.bus.emit('params',{});}});
    document.addEventListener('change',function(e){if(S.busy || !e.target.dataset.methodPhase)return;RV.history.take('method phase contributions');var key=e.target.dataset.methodPhase;S.disabledPhases=S.disabledPhases.filter(function(k){return k!==key;});if(!e.target.checked)S.disabledPhases.push(key);S.version++;S.datasets.forEach(function(d){d.stats=null;d.esd={};d.ints=null;St.invalidate(d);});RV.bus.emit('params',{});RV.bus.emit('data');});
    ['params','calculation','datasets','phases','selection','busy'].forEach(function(ev){RV.bus.on(ev,phaseControls);});phaseControls();
    ['params','calculation','datasets','phases','tab'].forEach(function(ev){RV.bus.on(ev,function(){if(RV.app && RV.app.commandTab()==='datasets')linkEditor();});});linkEditor();
  }
  return {init:init,render:render,targetField:targetField,targets:targets,inspectStep:inspectStep,dataset:dataset,inspectDataset:inspectDataset};
})();
