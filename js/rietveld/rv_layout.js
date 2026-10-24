/* Independent command and result panels, inspired by Powder5's UI structure. */
RV.layout=(function(){
  'use strict';
  var St=RV.state,S=St.S,esc=RV.ui.esc,command='datasets',result='pattern',method='lebail',selected={},structure='sgt',structureRuns={};
  var commands=['datasets','phases','method','structure','settings'];
  function $(q){return document.querySelector(q);}
  function move(node,parent){if(node && parent)parent.appendChild(node);}
  function syncTabs(){
    $('#command-tabs').querySelectorAll('[data-tab]').forEach(function(b){var on=b.dataset.tab===command;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
    $('#command-body').querySelectorAll(':scope > .pane').forEach(function(p){p.classList.toggle('on',p.id==='pane-'+command);});
    $('#result-tabs').querySelectorAll('button').forEach(function(b){var on=b.dataset.resultMethod?result==='solve' && b.dataset.resultMethod===method:b.dataset.tab===result;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
    $('.results-panel').querySelectorAll(':scope > .pane').forEach(function(p){p.classList.toggle('on',p.id==='pane-'+result);});
    if(result==='about')$('#tab-pattern').tabIndex=0;
    $('#ptools').hidden=result!=='pattern';$('#plot-selection').hidden=result!=='pattern' || RV.state.selected().length<2;$('#btn-about').setAttribute('aria-expanded',String(result==='about'));
    $('#pane-solve').setAttribute('aria-labelledby','tab-result-'+method);
    syncResultLayouts();if(RV.plots)RV.plots.show(result==='pattern');
  }
  function syncResultLayouts(){document.querySelectorAll('.calc-layout').forEach(function(el){el.hidden=el.dataset.layout!==method;});}
  function showTab(name){
    if(name==='results')name='solve';
    if(commands.includes(name)){command=name;St.store('commandTab',name);}
    else if(['pattern','solve','structure-results','log','history','about'].includes(name)){result=name;St.store('resultTab',name);}
    else {command='datasets';name=command;}
    syncTabs();if(result==='solve')syncRunPicker();if(result==='structure-results'){syncStructure();if(RV.solve && RV.solve.state.opts)RV.solve.renderSelectedSolution(structure,structureRuns[structure]);}return name;
  }
  function showResult(m){if(!RVCore.METHODS.includes(m))return;method=m;St.store('resultMethod',m);RV.app.showTab('solve');if(RV.results)RV.results.render();}
  function records(m,kind){return RV.fitHistory.list(m,kind).slice().reverse();}
  function record(){var list=records(method,'fit'),id=selected[method];return list.find(function(r){return r.id===id;}) || list[0] || null;}
  function runLabel(r){return (r.pinned?'★ Kept · ':'')+new Date(r.time).toLocaleString()+' · '+r.datasets.map(function(d){return d.name;}).join(', ')+' · '+(r.global?'Global':'Individual')+' · '+r.id;}
  function syncRunPicker(){
    var picker=$('#result-run-select');if(!picker)return;var list=records(method,'fit'),r=record(),id=selected[method];
    if(id && !list.some(function(item){return item.id===id;}))delete selected[method];
    var html='<option value="latest">'+esc(list.length?'Latest · '+runLabel(list[0]):'No completed '+RVCore.METHOD_LABELS[method]+' run')+'</option>'+list.map(function(item){return '<option value="'+item.id+'">'+esc(runLabel(item))+'</option>';}).join('');
    if(picker.innerHTML!==html)picker.innerHTML=html;picker.value=selected[method] || 'latest';picker.disabled=!list.length;
    document.querySelectorAll('[data-run-action]').forEach(function(b){b.disabled=b.dataset.runAction==='restore'?S.busy || !r:b.dataset.runAction==='keep'?!r:false;if(b.dataset.runAction==='keep')b.textContent=r && r.pinned?'Unkeep':'Keep';});
    $('#last-result-state').textContent=r?'Viewing '+RVCore.METHOD_LABELS[r.method]+' · '+runLabel(r)+(RV.fitHistory.changed(r)?' · Working setup differs from this saved run.':''):'Complete a '+RVCore.METHOD_LABELS[method]+' fit from Commands to see its saved results.';
    var count=$('#fit-selection-count');if(count)count.textContent='('+S.sel.size+' / '+S.datasets.length+')';
  }
  function selectRun(id){if(id && id!=='latest' && !records(method,'fit').some(function(r){return r.id===id;}))return;selected[method]=id==='latest'?null:id;syncRunPicker();RV.results.render();}
  function swap(on){var work=$('#work');on=on==null?!work.classList.contains('panels-swapped'):!!on;work.classList.toggle('panels-swapped',on);$('#swap-panels').setAttribute('aria-pressed',String(on));St.store('panelsSwapped',on);RV.bus.emit('panelLayout');}
  function splitStructure(host){
    ['sgt','cf','wy'].forEach(function(k){$('#structure-result-'+k).innerHTML='';});
    move(host.querySelector('#sv-int'),$('#structure-result-sgt'));move(host.querySelector('#sv-sgt-out'),$('#structure-result-sgt'));
    move(host.querySelector('#sv-cf-sum'),$('#structure-result-cf'));move(host.querySelector('#sv-wy-sum'),$('#structure-result-wy'));
    move(host.querySelector('#sv-cf-out'),$('#structure-result-cf'));
    ['cf-density','cf-sites','cf-struct'].forEach(function(k){move(host.querySelector('[data-acc="'+k+'"]'),$('#structure-result-cf'));});
    ['wy-solution','wy-sites','wy-struct'].forEach(function(k){move(host.querySelector('[data-acc="'+k+'"]'),$('#structure-result-wy'));});
    host.querySelectorAll('[data-res-part]').forEach(function(p){var d=p.closest('details');if(d)d.remove();});
    syncStructure();
  }
  function syncStructure(){
    if(!$('#structure-run-select'))return;
    document.querySelectorAll('[data-structure-result]').forEach(function(b){var on=b.dataset.structureResult===structure;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
    ['sgt','cf','wy'].forEach(function(k){$('#structure-result-'+k).hidden=k!==structure;});
    $('#structure-runbar').hidden=structure==='sgt';
    var list=structure==='sgt'?[]:records('wppf',structure),picker=$('#structure-run-select');
    if(structureRuns[structure] && !list.some(function(r){return r.id===structureRuns[structure];}))delete structureRuns[structure];
    picker.innerHTML='<option value="latest">Latest solution</option>'+list.map(function(r){return '<option value="'+r.id+'">'+esc(runLabel(r))+'</option>';}).join('');
    picker.value=structureRuns[structure] || 'latest';
  }
  function structureResult(k,id){if(!['sgt','cf','wy'].includes(k))return;if(arguments.length>1)structureRuns[k]=id==='latest'?null:id;structure=k;RV.app.showTab('structure-results');syncStructure();if(RV.solve)RV.solve.renderSelectedSolution(k,structureRuns[k]);}
  function latestStructure(k){structureRuns[k]=null;syncStructure();}
  function structureRecord(){var list=structure==='sgt'?[]:records('wppf',structure);return list.find(function(r){return r.id===structureRuns[structure];}) || list[0] || null;}
  function init(){
    $('#result-tabs').addEventListener('click',function(e){var b=e.target.closest('[data-result-method]');if(b)showResult(b.dataset.resultMethod);});
    $('#result-run-select').addEventListener('change',function(){selectRun(this.value);});
    $('#pane-solve').addEventListener('click',function(e){var b=e.target.closest('[data-run-action]');if(!b)return;var r=record();try{if(b.dataset.runAction==='history'){if(r)RV.fitHistory.inspect(r.id);RV.app.showTab('history');return;}if(!r)return;if(b.dataset.runAction==='restore'){RV.fitHistory.restore(r.id);RV.app.calculation(r.method,true);}else if(b.dataset.runAction==='keep')RV.fitHistory.keep(r.id,!r.pinned);}catch(x){RV.ui.toast(x.message,'warn');}});
    $('#swap-panels').addEventListener('click',function(){swap();});
    document.querySelectorAll('[data-structure-result]').forEach(function(b){b.addEventListener('click',function(){structureResult(b.dataset.structureResult);});});
    $('#structure-run-select').addEventListener('change',function(){structureRuns[structure]=this.value==='latest'?null:this.value;RV.solve.renderSelectedSolution(structure,structureRuns[structure]);});
    RV.bus.on('fitHistory',function(){syncRunPicker();syncStructure();});
    ['selection','datasets','params','busy','calculation'].forEach(function(ev){RV.bus.on(ev,syncRunPicker);});
    swap(!!St.load('panelsSwapped'));
  }
  function restore(){method=St.load('resultMethod');if(!RVCore.METHODS.includes(method))method=S.calculation;RV.app.showTab(commands.includes(St.load('commandTab'))?St.load('commandTab'):'datasets');RV.app.showTab(['pattern','solve','structure-results','log','history','about'].includes(St.load('resultTab'))?St.load('resultTab'):'pattern');syncRunPicker();}
  return {init:init,restore:restore,showTab:showTab,showResult:showResult,commandTab:function(){return command;},resultTab:function(){return result;},resultMethod:function(){return method;},record:record,selectRun:selectRun,syncRunPicker:syncRunPicker,syncResultLayouts:syncResultLayouts,swap:swap,splitStructure:splitStructure,structureResult:structureResult,latestStructure:latestStructure,structureRecord:structureRecord,structureKind:function(){return structure;}};
})();
