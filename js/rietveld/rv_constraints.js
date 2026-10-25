/* Phase-level exact atomic relationships (GSAS-II rules), used only by Rietveld calculations.
 *
 * One editor, mounted in Commands and the Atomic constraints… dialog. Results lists saved relationships
 * read-only. Every change is validated
 * and applied at once (with Undo); all mounted editors follow.
 *   RV.constraints = { init, edit(), mount(host, ph), refreshAll(), apply(ph, rules), align(ph, map, rules), text(c) }
 */
RV.constraints = (function(){
  'use strict';
  var St=RV.state,S=St.S,ui=RV.ui,esc=ui.esc,AC=AtomicConstraints;
  var COMP_LABEL={x:'x',y:'y',z:'z',occ:'Occupancy',B:'B (Å²)'};
  // the add form of each phase: {kind, component, total, order: [labels in click order]}
  var forms={};
  function text(c){return AC.text(c);}
  function formOf(ph){var f=forms[ph.key];if(!f)f=forms[ph.key]={kind:'equiv',component:'x',total:'1',order:[]};f.order=f.order.filter(function(l){return ph.atoms.some(function(a){return a.label===l;});});return f;}
  function fmt(v){return String(+Number(v).toPrecision(6));}

  // ---------------------------------------------------------------- values that satisfy the relationships
  /* Constraint equations: the starting values projected onto  Σ mᵢ vᵢ = c  inside the parameter limits
     (vᵢ(λ) = clamp(vᵢ − λ mᵢ) and Σ mᵢ vᵢ(λ) falls monotonically with λ); equivalences: dependents from the
     independent parameter. Atoms then stay on their sites. */
  function align(ph,map,rules){
    var v=Object.assign({},map),lp={limits:S.limits};
    AC.normalizeAll(rules).filter(function(c){return c.kind==='sum';}).forEach(function(c){
      var names=c.atoms.map(function(a){return ph.key+'.'+a+'.'+c.component;});
      names.forEach(function(n){if(!Number.isFinite(v[n]))throw new Error('No value for '+n+'.');});
      var lim=names.map(function(n){return AC.limits(lp,n,v[n]);});
      function at(l){return names.map(function(n,i){return Math.max(lim[i][0],Math.min(lim[i][1],v[n]-l*c.mult[i]));});}
      function f(l){return at(l).reduce(function(s,x,i){return s+c.mult[i]*x;},0);}
      if(Math.abs(f(0)-c.total)<1e-10)return;
      var lo=-1,hi=1;for(var k=0;k<60 && f(lo)<c.total;k++)lo*=2;for(k=0;k<60 && f(hi)>c.total;k++)hi*=2;
      for(var it=0;it<200;it++){var mid=(lo+hi)/2;if(f(mid)>c.total)lo=mid;else hi=mid;}
      var x=at((lo+hi)/2);
      if(Math.abs(x.reduce(function(s,q,i){return s+c.mult[i]*q;},0)-c.total)>1e-8)throw new Error(text(c)+' cannot be met within the parameter limits.');
      names.forEach(function(n,i){v[n]=x[i];});
    });
    var def=St.phaseDefs().find(function(p){return p.key===ph.key;});def.constraints=rules;def.method='rietveld';
    var plan=AC.prepare({phases:[def],datasets:[{phases:[ph.key]}],values:[v],limits:S.limits});
    if(!plan.valid(plan.values))throw new Error('Starting values conflict with a constraint or the parameter limits (e.g. a dependent occupancy outside 0–1).');
    var out=plan.values[0];ph.atoms.forEach(function(at){var pre=ph.key+'.'+at.label+'.',pos=RVCore.sitePosition(at.site,[out[pre+'x'],out[pre+'y'],out[pre+'z']]);['x','y','z'].forEach(function(c,i){out[pre+c]=pos[i];});});return out;
  }
  function apply(ph,rules){
    rules=AC.normalizeAll(rules);
    AC.definitions(Object.assign({},ph,{constraints:rules}));
    var changes=[{obj:ph,key:'v',value:align(ph,ph.v,rules)}];
    S.datasets.forEach(function(d){if(!St.hasPhase(d,ph))return;
      if(S.calculation==='rietveld')changes.push({obj:d,key:'p',value:align(ph,d.p,rules)});
      var bank=d.calculations && d.calculations.rietveld;
      if(bank && bank.p)changes.push({obj:bank,key:'p',value:align(ph,bank.p,rules)});
    });
    RV.history.take('atomic constraints of '+ph.name);
    ph.constraints=AC.clone(rules);
    var fits=[ph.fit];S.datasets.forEach(function(d){if(!St.hasPhase(d,ph))return;if(S.calculation==='rietveld')fits.push(d.fit);var bank=d.calculations && d.calculations.rietveld;if(bank && bank.fit)fits.push(bank.fit);});
    rules.filter(function(c){return c.kind==='sum';}).forEach(function(c){var names=AC.sumInfo(ph,c,{limits:S.limits}).names;fits.forEach(function(fit){var on=names.some(function(n){return !!fit[n];});names.forEach(function(n){if(Object.prototype.hasOwnProperty.call(fit,n))fit[n]=on;});});});
    changes.forEach(function(o){o.obj[o.key]=o.value;});
    S.datasets.forEach(function(d){if(!St.hasPhase(d,ph))return;var bank=d.calculations && d.calculations.rietveld;if(bank){bank.stats=null;bank.esd={};bank.ints=null;}if(S.calculation==='rietveld'){d.stats=null;d.esd={};d.ints=null;St.invalidate(d);}});
    S.version++;RV.bus.emit('phases');RV.bus.emit('params',{});RV.bus.emit('stats');
    refreshAll();
  }

  // ---------------------------------------------------------------- the editor
  function usable(ph,at,comp){return 'xyz'.indexOf(comp)<0 || (at.site && at.site.free.indexOf('xyz'.indexOf(comp))>=0);}
  function relRow(c,i,ph){
    var p=function(a){return '<code>'+esc(a+'.'+c.component)+'</code>';}, num=function(attr,v,lab){return '<input class="num ac-m" '+attr+' value="'+esc(fmt(v))+'" inputmode="decimal" aria-label="'+esc(lab)+'">';}, body;
    if(c.kind==='hold')body=c.atoms.map(p).join(', ')+' <span class="sub">not refined</span>';
    else if(c.kind==='equiv')body=c.atoms.slice(1).map(function(a,k){return '<span class="ac-term">'+p(a)+' = '+num('data-ac-mult="'+i+':'+(k+1)+'"',c.mult[k+1],'Multiplier of '+a)+' × '+p(c.atoms[0])+'</span>';}).join('');
    else body='<span class="ac-term">'+c.atoms.map(function(a,k){return (k?' + ':'')+num('data-ac-mult="'+i+':'+k+'"',c.mult[k],'Multiplier of '+a)+' × '+p(a);}).join('')+' = '+num('data-ac-total="'+i+'"',c.total,'Total')+'</span>';
    return '<tr><td>'+esc(AC.label(c.kind))+'</td><td class="ac-rel">'+body+(c.kind==='sum' && AC.sumInfo(ph,c,{limits:S.limits}).noFreedom?'<p class="hint">These limits leave no freedom to refine.</p>':'')+'</td><td><button type="button" class="mini" data-ac-remove="'+i+'" title="Remove this relationship">Remove</button></td></tr>';
  }
  function html(ph){
    var rules=AC.normalizeAll(ph.constraints),f=formOf(ph),dis=S.busy?' disabled':'';
    if(ph.atoms.length<1)return '<p class="hint">No atoms: constraints relate atomic parameters.</p>';
    var list=rules.length?'<div class="table-wrap"><table class="grid compact ac-list"><thead><tr><th>Type</th><th>Relationship</th><th></th></tr></thead><tbody>'+rules.map(function(c,i){return relRow(c,i,ph);}).join('')+'</tbody></table></div>':'<p class="hint">No atomic constraints for '+esc(ph.name)+'.</p>';
    var site=f.kind==='site', isSum=f.kind==='sum';
    var chips=ph.atoms.map(function(a){
      var k=f.order.indexOf(a.label),ok=site || usable(ph,a,f.component);
      return '<label class="ac-chip'+(ok?'':' off')+'"'+(ok?'':' title="'+esc(a.label+'.'+f.component+' is fixed or dependent by site symmetry ('+a.site.expr+')')+'"')+'><input type="checkbox" data-ac-atom="'+esc(a.label)+'"'+(k>=0 && ok?' checked':'')+(ok?'':' disabled')+dis+'> '+
        esc(a.label)+' <small>'+esc(a.type)+'</small>'+(k>=0 && ok && f.kind==='equiv'?' <b class="ac-ord">'+(k===0?'independent':'#'+(k+1))+'</b>':'')+'</label>';
    }).join('');
    return list+
      '<div class="ac-add"><div class="ac-add-row">'+
        '<label>Type <select data-ac-kind'+dis+'>'+[['equiv','Equivalence  (B = m × A)'],['sum','Constraint equation  (Σ mᵢ Pᵢ = c)'],['hold','Hold  (not refined)'],['site','Mixed site  (equal x, y, z, B; occupancies sum to 1)']].map(function(o){return '<option value="'+o[0]+'"'+(o[0]===f.kind?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')+'</select></label>'+
        (site?'':'<label>Parameter <select data-ac-comp'+dis+'>'+AC.COMPONENTS.map(function(c){return '<option value="'+c+'"'+(c===f.component?' selected':'')+'>'+esc(COMP_LABEL[c])+'</option>';}).join('')+'</select></label>')+
        (isSum?'<label>Total c <input class="num" data-ac-newtotal value="'+esc(f.total)+'" inputmode="decimal"'+dis+'></label>':'')+
        '<button type="button" class="primary" data-ac-add'+dis+'>Add</button></div>'+
        '<div class="ac-chips" role="group" aria-label="Atoms">'+chips+'</div>'+
        '<p class="why ac-err" data-ac-error role="status"></p></div>';
  }
  function mount(host,ph){if(!host)return;host.classList.add('ac-editor');host.setAttribute('data-ac-phase',ph.key);host.innerHTML=html(ph);}
  function refreshAll(){document.querySelectorAll('.ac-editor[data-ac-phase]').forEach(function(host){var ph=St.phaseByKey(host.getAttribute('data-ac-phase'));if(ph)host.innerHTML=html(ph);});}
  function err(host,msg){host.querySelectorAll('[data-ac-error]').forEach(function(e){e.textContent=msg||'';});}
  function commit(host,ph,rules){
    if(S.busy){ui.toast('A fit is running. Wait for it to finish or press Stop.','warn');return false;}
    try{apply(ph,rules);return true;}catch(e){err(host,e.message);return false;}
  }
  function added(ph,f){
    var atoms=f.order.slice(), comp=f.component;
    if(f.kind==='site'){
      if(atoms.length<2)throw new Error('Select at least two atoms on the same site.');
      var sites=atoms.map(function(a){return ph.atoms.find(function(at){return at.label===a;}).site;});
      if(sites.some(function(s){return s.expr!==sites[0].expr || s.mult!==sites[0].mult;}))throw new Error('A mixed site needs atoms with the same site symmetry ('+sites[0].wyck+' '+sites[0].expr+').');
      var out=['x','y','z'].filter(function(c){return sites[0].free.indexOf('xyz'.indexOf(c))>=0;}).map(function(c){return {kind:'equiv',component:c,atoms:atoms.slice(),mult:atoms.map(function(){return 1;})};});
      out.push({kind:'equiv',component:'B',atoms:atoms.slice(),mult:atoms.map(function(){return 1;})},{kind:'sum',component:'occ',atoms:atoms.slice(),mult:atoms.map(function(){return 1;}),total:1});
      return out;
    }
    if(!atoms.length)throw new Error('Tick the atoms of the relationship.');
    var c={kind:f.kind,component:comp,atoms:atoms};
    if(f.kind!=='hold')c.mult=atoms.map(function(){return 1;});
    if(f.kind==='sum'){c.total=ui.parseNum(f.total);if(!Number.isFinite(c.total))throw new Error('Give the total c of the constraint equation.');}
    return [c];
  }
  function onClick(e){
    var host=e.target.closest('.ac-editor');if(!host)return;
    var ph=St.phaseByKey(host.getAttribute('data-ac-phase'));if(!ph)return;
    var rules=AC.normalizeAll(ph.constraints),b;
    if((b=e.target.closest('[data-ac-remove]'))){rules.splice(+b.getAttribute('data-ac-remove'),1);if(commit(host,ph,rules))ui.toast('Constraint removed from '+ph.name+'.','info');return;}
    if(e.target.closest('[data-ac-add]')){
      var f=formOf(ph);
      try{var add=added(ph,f);AC.definitions(Object.assign({},ph,{constraints:rules.concat(add)}));}catch(x){err(host,x.message);return;}
      f.order=[];
      if(commit(host,ph,rules.concat(add)))ui.toast(add.map(text).join('; ')+' ('+ph.name+').','ok');
    }
  }
  function onChange(e){
    var host=e.target.closest('.ac-editor');if(!host)return;
    var ph=St.phaseByKey(host.getAttribute('data-ac-phase'));if(!ph)return;
    var t=e.target,f=formOf(ph),rules=AC.normalizeAll(ph.constraints);
    if(t.hasAttribute('data-ac-kind')){f.kind=t.value;if(f.kind==='sum' && f.component==='x')f.component='occ';refreshAll();return;}
    if(t.hasAttribute('data-ac-comp')){f.component=t.value;refreshAll();return;}
    if(t.hasAttribute('data-ac-newtotal')){f.total=t.value;return;}
    if(t.hasAttribute('data-ac-atom')){var l=t.getAttribute('data-ac-atom');f.order=f.order.filter(function(x){return x!==l;});if(t.checked)f.order.push(l);refreshAll();return;}
    var v=ui.parseNum(t.value),m;
    if((m=t.getAttribute('data-ac-mult'))){var p=m.split(':').map(Number);if(!Number.isFinite(v)||v===0){err(host,'A multiplier is a non-zero number.');t.value=fmt(rules[p[0]].mult[p[1]]);return;}rules[p[0]].mult[p[1]]=v;commit(host,ph,rules);return;}
    if((m=t.getAttribute('data-ac-total'))!=null){if(!Number.isFinite(v)){err(host,'The total is a number.');t.value=fmt(rules[+m].total);return;}rules[+m].total=v;commit(host,ph,rules);}
  }

  // ---------------------------------------------------------------- the dialog (button "Atomic constraints…")
  async function edit(){
    if(S.busy)return;var ph=St.currentPhase();if(!ph || !ph.atoms.length){ui.toast('Select a phase with atoms.','warn');return;}
    await ui.modal({title:'Atomic constraints · '+ph.name,wide:true,body:'<p class="hint">GSAS-II relationships of '+esc(ph.name)+', applied by Rietveld in each dataset. Edit relationships in Commands; Results lists those saved with the selected run.</p><div data-ac-host></div>',
      buttons:[{label:'Close',primary:true,value:null}],onOpen:function(b){mount(b.querySelector('[data-ac-host]'),ph);}});
  }
  // Saved Rietveld relationships are read-only in Results.
  function renderSolve(host,editable){
    if(!host)return 0;
    var list=S.phases.filter(function(ph){return ph.atoms.length;});
    if(!list.length){host.innerHTML='<p class="hint">No phase with atoms.</p>';return 0;}
    host.innerHTML=list.map(function(ph,i){return '<section class="ac-phase"><h3><i class="sw-inline" style="background:'+RV.plots.phaseVar(S.phases.indexOf(ph))+'"></i>'+esc(ph.name)+' <span class="sub">'+esc(RVCore.METHOD_LABELS[ph.method])+(ph.method==='rietveld'?'':', constraints unused')+'</span></h3><div data-ac-solve="'+esc(ph.key)+'"></div></section>';}).join('');
    list.forEach(function(ph){var node=host.querySelector('[data-ac-solve="'+ph.key+'"]');if(editable)mount(node,ph);else {var rules=AC.normalizeAll(ph.constraints);node.innerHTML=rules.length?'<ul>'+rules.map(function(c){return '<li><code>'+esc(text(c))+'</code></li>';}).join('')+'</ul>':'<p class="hint">No atomic constraints in this run.</p>';}});
    return list.reduce(function(n,ph){return n+(ph.constraints||[]).length;},0);
  }
  function init(){
    var help=document.querySelector('[data-constraints-help]');if(help)help.title='Equivalence: the first atom ticked is the independent parameter; the others follow it, B = m × A, refined or not. Only the refine flag of the independent parameter counts. Constraint equation: Σ mᵢ Pᵢ = c; multipliers start at 1 and can be edited in the list. The refine checkboxes act on the whole equation: enabling or fixing any term enables or fixes them all. The last term is computed from the others, so an equation with N terms has N - 1 independent values. Hold: the parameter is not refined, whatever its refine flag. A parameter belongs to one relationship only; coordinates fixed by site symmetry cannot be constrained. Multipliers are not zero. Applying a change aligns the starting values of the phase and of its Rietveld calculations and clears their previous fits. Le Bail and WPPF ignore constraints. Relationships whose atoms leave, or whose coordinates become fixed by a new site or space group, are trimmed (see the Log).';
    document.addEventListener('click',onClick);document.addEventListener('change',onChange);
    RV.bus.on('busy',refreshAll);
  }
  return {init:init,edit:edit,apply:apply,text:text,align:align,mount:mount,refreshAll:refreshAll,renderSolve:renderSolve};
})();
