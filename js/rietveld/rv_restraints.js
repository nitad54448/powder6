/* Phase-level soft geometric restraints for Rietveld calculations (js/atom_restraints.js), in the distance-rule language
 * of the Wyckoff search. The editor is inline in Datasets and in the Phases "Restraints…" dialog: the rules, their weight and
 * widths, the current geometry against them, a guide that writes rules from a molecule file (PDB, XYZ, Z-matrix)
 * and a suggestion from the structure as it is. The Helper collects rules for copying without changing datasets;
 * editing the main rules textbox validates and applies them with Undo.
 *   RV.restraints = { init, edit(), summary(ph), apply(ph, patch) }
 */
RV.restraints = (function(){
  'use strict';
  var St=RV.state,S=St.S,ui=RV.ui,esc=ui.esc,AR=AtomRestraints,MR=MoleculeRules;
  var builders={};
  var guide={};   // per phase: the molecule read last {mol, text}
  var RULES_HELP='One rule per line: A B N dmin/dmax (N atoms B around each atom A), A B - dmin/dmax (the nearest B), a shape at the end of a counted rule restrains its angles (tet, oct, sq, tri, lin). A and B are atom labels. Add angle=3 after a shape for an angular window of plus or minus 3 degrees.';

  function ctx(){return {cellOf:RVCore.cellOf,sitePosition:RVCore.sitePosition};}
  function def(ph){return St.phaseDefs().find(function(p){return p.key===ph.key;});}
  // the values the geometry is read from: the first selected dataset that holds the phase (Rietveld), else the starting model
  function source(ph){
    var inspected=RV.workspace && RV.workspace.dataset(),d=S.calculation==='rietveld'?[inspected,St.first()].concat(St.selected(),S.datasets).filter(function(x){return x && St.hasPhase(x,ph);})[0]:null;
    return d?{name:d.name,v:d.p}:{name:'starting model',v:ph.v};
  }
  function summary(ph){
    var r=AR.normalize(ph.restraints);if(!AR.hasRules(r))return '';
    var n=AR.parse(r.text).windows.length;return n+(n===1?' rule':' rules');
  }
  function apply(ph,patch){
    var next=AR.normalize(Object.assign({},ph.restraints,patch));
    var checked=AR.check(ph.atoms,next);if(checked.errors.length)throw new Error(checked.errors[0]);
    RV.history.take('restraints of '+ph.name);
    ph.restraints=next;S.version++;RV.bus.emit('phases');refreshAll();
  }

  // ---------------------------------------------------------------- the geometry against the rules
  function geometry(ph,r){
    if(!AR.hasRules(r))return '<p class="hint">No rules yet.</p>';
    var chk=AR.check(ph.atoms,r);if(chk.errors.length)return '';
    var src=source(ph),rows;try{rows=AR.rows(def(ph),r,src.v,ctx());}catch(e){return '<p class="why">'+esc(e.message)+'</p>';}
    var chi=0,off=0;rows.forEach(function(x){var q=x.dev/x.sigma;chi+=q*q;if(x.dev!==0)off++;});
    var shown=rows.filter(function(x){return x.dev!==0;}).slice(0,60),head='<p class="hint">Geometry of the '+esc(src.name)+': '+rows.length+' restrained values, '+off+' outside their window; Σ(deviation/σ)² = '+(chi*r.weight).toFixed(1)+' (weight '+r.weight+').</p>';
    if(!shown.length)return head;
    return head+'<div class="table-wrap"><table class="grid compact rs-geom"><thead><tr><th>Restrained value</th><th>Now</th><th>Wanted</th><th>Off by</th></tr></thead><tbody>'+shown.map(function(x){
      var u=x.kind==='ang'?'°':' Å',want=x.kind==='ang'?x.lo.toFixed(1)+(x.hi!==x.lo?'–'+x.hi.toFixed(1):'')+u:x.lo!=null&&x.hi!=null?x.lo.toFixed(2)+'–'+x.hi.toFixed(2)+u:x.lo!=null?'≥ '+x.lo.toFixed(2)+u:'≤ '+x.hi.toFixed(2)+u;
      return '<tr><td>'+esc(x.text)+'</td><td class="n">'+x.val.toFixed(x.kind==='ang'?1:3)+u+'</td><td class="n">'+want+'</td><td class="n">'+(x.dev>0?'+':'')+x.dev.toFixed(x.kind==='ang'?1:3)+'</td></tr>';}).join('')+'</tbody></table></div>'+(off>shown.length?'<p class="hint">…and '+(off-shown.length)+' more.</p>':'');
  }
  function status(ph,text){
    var r=Object.assign({},AR.normalize(ph.restraints),{text:text}),chk=AR.check(ph.atoms,r);
    return {errors:chk.errors,warnings:chk.warnings,count:chk.rules.length};
  }

  // ---------------------------------------------------------------- the editor
  function builderOf(ph){
    var b=builders[ph.key] || (builders[ph.key]={kind:'bond',mode:'distinct',center:ph.atoms[0].label,neighbours:[],distance:'1.5',distanceTol:'0.03',angle:'109.47',angleTol:'3',secondDistance:'1.5'});
    var labels=ph.atoms.map(function(a){return a.label;});if(labels.indexOf(b.center)<0)b.center=labels[0];b.neighbours=b.neighbours.filter(function(n){return n!==b.center && labels.indexOf(n)>=0;});return b;
  }
  function builderHTML(ph){
    var b=builderOf(ph),dis=S.busy?' disabled':'',angular=b.kind!=='bond',symmetry=b.mode==='symmetry' && b.kind!=='bond' && b.kind!=='angle';
    function field(key,label){return '<label>'+label+' <input class="num" data-rs-build="'+key+'" value="'+esc(b[key])+'" inputmode="decimal"'+dis+'></label>';}
    var proposal;try{proposal=proposalHTML(MR.geometryRules(b));}catch(e){proposal='<p class="hint">'+esc(e.message)+'</p>';}
    return '<div class="rs-set"><label>Geometry <select data-rs-build="kind"'+dis+'>'+[['bond','Bond'],['angle','Angle'],['tetrahedron','Tetrahedron'],['octahedron','Octahedron'],['square','Square planar'],['triangle','Triangle'],['linear','Linear']].map(function(o){return '<option value="'+o[0]+'"'+(b.kind===o[0]?' selected':'')+'>'+o[1]+'</option>';}).join('')+'</select></label>'+
      '<label>Central atom <select data-rs-build="center"'+dis+'>'+ph.atoms.map(function(a){return '<option'+(b.center===a.label?' selected':'')+'>'+esc(a.label)+'</option>';}).join('')+'</select></label>'+(b.kind!=='bond' && b.kind!=='angle'?'<label>Neighbours <select data-rs-build="mode"'+dis+'><option value="distinct"'+(!symmetry?' selected':'')+'>Distinct atom labels</option><option value="symmetry"'+(symmetry?' selected':'')+'>Symmetry copies of one site</option></select></label>':'')+'</div>'+
      '<div class="rs-neighbours" role="group" aria-label="Neighbour atoms">'+ph.atoms.filter(function(a){return a.label!==b.center;}).map(function(a){var order=b.neighbours.indexOf(a.label);return '<label><input type="checkbox" data-rs-neighbour="'+esc(a.label)+'"'+(order>=0?' checked':'')+dis+'> '+esc(a.label)+(order>=0?' (#'+(order+1)+')':'')+'</label>';}).join('')+'</div>'+
      '<p class="hint rs-shape-help">'+(symmetry?'Select one neighbour label: its symmetry copies form the coordination shell.':'Choose neighbours in order. Square and octahedron use opposite pairs #1/#2, #3/#4, and #5/#6. Each neighbour must be a distinct atom label; use counted rules below for symmetry copies of one site.')+'</p>'+
      '<div class="rs-set">'+field('distance',b.kind==='angle'?'First bond (&#197;)':'Bond distance (&#197;)')+field('distanceTol','Distance window &plusmn; (&#197;)')+(b.kind==='angle'?field('secondDistance','Second bond (&#197;)')+field('angle','Angle (&deg;)'):'')+(angular?field('angleTol','Angle window &plusmn; (&deg;)'):'')+'</div>'+
      '<p class="hint">'+(angular && !symmetry?'Angles become 1-3 distance windows calculated at the target bond lengths. With nonzero bond windows their angular tolerance is approximate. ':'')+'The proposed rules below are added to the restraints textbox when you click Add.</p>'+
      '<div data-rs-built>'+proposal+'</div><p class="buttons"><button type="button" class="primary" data-rs-build-add'+dis+'>Add</button></p>';
  }
  function proposalHTML(made){
    return '<label class="rs-rules">Proposed restraints<textarea class="code-area" rows="5" readonly aria-label="Proposed restraints">'+esc(made.text)+'</textarea></label><p class="hint">'+made.bonds+' bonds and '+made.angles+' angle rules.</p>';
  }
  function renderDatasets(host,ds){
    if(!host)return;var list=S.phases.filter(function(ph){return ds && St.hasPhase(ds,ph) && ph.atoms.length>=2;}),signature=list.map(function(ph){return ph.key+':'+ph.name+':'+ph.method+':'+RV.plots.phaseVar(S.phases.indexOf(ph))+':'+ph.atoms.map(function(a){return a.label;}).join(',');}).join('|');
    if(host.dataset.signature===signature){host.querySelectorAll('[data-rs-geom]').forEach(function(node){var editor=node.closest('.rs-editor'),ph=St.phaseByKey(editor.dataset.rsPhase);if(ph)node.innerHTML=geometry(ph,AR.normalize(ph.restraints));});return;}
    host.dataset.signature=signature;
    host.innerHTML=introHTML()+(list.length?list.map(function(ph){return '<section class="ac-phase"><h3><i class="sw-inline" style="background:'+RV.plots.phaseVar(S.phases.indexOf(ph))+'"></i>'+esc(ph.name)+' <span class="sub">'+esc(RVCore.METHOD_LABELS[ph.method])+(ph.method==='rietveld'?'':', restraints unused')+'</span></h3><div data-rs-dataset="'+esc(ph.key)+'"></div></section>';}).join(''):'<p class="hint">The dataset needs a phase with at least two atoms. Restraints apply in Rietveld fits.</p>');
    list.forEach(function(ph){mount(host.querySelector('[data-rs-dataset="'+ph.key+'"]'),ph);});
  }
  function introHTML(){return '<p class="hint">Restraints guide bond distances and geometry during Rietveld refinement. <button type="button" class="mini" title="'+esc(ruleHelp())+'" aria-label="Restraint rules and tolerances">?</button></p>';}
  function html(ph){
    var r=AR.normalize(ph.restraints),dis=S.busy?' disabled':'';
    if(ph.atoms.length<2)return '<p class="hint">Restraints relate atoms: the phase needs at least two.</p>';
    return '<div class="rs-main">'+
      '<div class="rs-rules" title="'+esc(RULES_HELP)+'"><span>Restraints</span><div class="text-action"><textarea class="code-area" data-rs-text rows="8" spellcheck="false" aria-label="Restraints" placeholder="Fe1 C1 6 1.6/2.2 oct&#10;Si1 O1 4 1.58/1.66 tet&#10;O1 O1 - 2.4/"'+dis+'>'+esc(r.text)+'</textarea><button type="button" data-rs-helper'+dis+'>Helper</button></div></div>'+
      '<div class="rs-set">'+
        '<label>Weight <input class="num" data-rs-weight value="'+esc(String(r.weight))+'" inputmode="decimal"'+dis+'></label>'+
        '<label>σ distance (Å) <input class="num" data-rs-sigmaD value="'+esc(String(r.sigmaD))+'" inputmode="decimal"'+dis+'></label>'+
        '<label>σ angle (°) <input class="num" data-rs-sigmaA value="'+esc(String(r.sigmaA))+'" inputmode="decimal"'+dis+'></label></div>'+
      '<p class="why rs-err" data-rs-error role="status"></p><div data-rs-geom>'+geometry(ph,r)+'</div></div>';
  }
  function helperHTML(ph){var dis=S.busy?' disabled':'',g=guide[ph.key]||{};return '<nav class="tabs" role="tablist" aria-label="Restraint helper">'+[['geometry','Geometry'],['molecule','Molecule'],['suggest','Suggest']].map(function(t){return '<button type="button" role="tab" id="rs-tab-'+t[0]+'" data-rs-tab="'+t[0]+'" aria-controls="rs-panel-'+t[0]+'" aria-selected="'+(t[0]==='geometry')+'" tabindex="'+(t[0]==='geometry'?'0':'-1')+'">'+t[1]+'</button>';}).join('')+'</nav><section role="tabpanel" class="rs-helper-panel" id="rs-panel-geometry" aria-labelledby="rs-tab-geometry" data-rs-panel="geometry"><div class="rs-guide-body" data-rs-builder>'+builderHTML(ph)+'</div></section>'+
      '<section role="tabpanel" class="rs-helper-panel" id="rs-panel-molecule" aria-labelledby="rs-tab-molecule" data-rs-panel="molecule" hidden><div class="rs-guide-body">'+
        '<p class="hint">Read a molecule (PDB, XYZ or Z-matrix) and write a rule for every bond and every angle (the 1-3 distance). The atoms of the file must be the atoms of this phase, by name or in the same order. A molecule on a special position needs only the atoms in the asymmetric unit: the rules of atoms the phase does not have are left out.</p>'+
        '<div class="rs-set"><label>File <input type="file" data-rs-file accept=".pdb,.ent,.xyz,.txt,.zmat,.gjf,.mol"'+dis+'></label>'+
          '<label>Atoms of the file are the atoms of the phase <select data-rs-map><option value="name"'+(g.map!=='order'?' selected':'')+'>by name</option><option value="order"'+(g.map==='order'?' selected':'')+'>by order</option></select></label></div>'+
        '<label class="rs-rules">…or paste it here<textarea class="code-area" data-rs-paste rows="4" spellcheck="false" placeholder="C1&#10;C2 1 1.40&#10;C3 2 1.40 1 120">'+esc(g.paste||'')+'</textarea></label>'+
        '<div class="rs-set"><label>Bond window ± (Å) <input class="num" data-rs-btol value="'+esc(g.btol||'0.03')+'" inputmode="decimal"></label>'+
          '<label>Angle window ± (Å) <input class="num" data-rs-atol value="'+esc(g.atol||'0.06')+'" inputmode="decimal"></label>'+
          '<label><input type="checkbox" data-rs-angles'+(g.angles===false?'':' checked')+'> angles</label>'+
          '<label><input type="checkbox" data-rs-skiph'+(g.skiph?' checked':'')+'> skip hydrogens</label>'+
          '</div>'+
        '<div data-rs-made>'+(g.text?madeHtml(g):'')+'</div><p class="buttons"><button type="button" data-rs-molecule-add'+dis+'>Add</button></p></div></section>'+
      '<section role="tabpanel" class="rs-helper-panel" id="rs-panel-suggest" aria-labelledby="rs-tab-suggest" data-rs-panel="suggest" hidden><div class="rs-guide-body">'+
        '<p class="hint">Writes one counted rule per atom and neighbour label from the contacts shorter than 1.2 × the sum of the covalent radii, with the shortest and longest of them widened by the window. Edit the result: it only freezes the geometry the model has now.</p>'+
        '<div class="rs-set"><label>Window ± (Å) <input class="num" data-rs-stol value="0.10" inputmode="decimal"></label></div>'+
        '<div data-rs-suggested></div><p class="buttons"><button type="button" data-rs-suggestion-add'+dis+'>Add</button></p></div></section><label class="rs-rules rs-collected">Collected rules<textarea class="code-area" data-rs-collected rows="8" spellcheck="false"></textarea></label><p class="hint">Add collects rules here only. Copy them, then paste into the dataset restraints textbox if wanted. For duplicate or conflicting pairs the first rule is kept.</p>';
  }
  function ruleHelp(){var html='<details class="ac-help rs-rule-help"><summary>Restraint rules and tolerances</summary><div class="rs-guide-body">'+
    '<p class="hint">Rules apply automatically whenever this box contains a rule. Clear the box to remove the restraints. Changes are validated when you leave the textbox and can be undone. They apply to Rietveld fits of this phase in every dataset that holds it; Le Bail, WPPF and Wyckoff searches do not use this box.</p>'+
    '<p class="hint">Use atom labels, one rule per line; blank lines and lines starting with # are ignored. Labels are case-sensitive; a unique case-insensitive match is also accepted. Distances are in &#197; and angles in degrees. Every symmetry image and neighbouring cell is considered.</p>'+
    '<ul class="hint"><li><code>A B - 1.50/1.60</code>: nearest B to A, within the distance window.</li><li><code>A B - 1.55/1.55</code>: an exact distance target.</li><li><code>A B - 2.4/</code>: lower bound only; <code>A B - /3.0</code>: upper bound only. A may equal B to restrain contacts between symmetry copies of one site.</li><li><code>A B 4 1.50/1.60</code>: the four nearest B neighbours must be within the window, and the fifth is pushed outside its upper bound. <code>4+</code> requires at least four, without excluding a fifth.</li><li><code>A B 4 1.50/1.60 tet</code>: tetrahedral angles in this shell. Shapes and required counts: lin (2, 180&#176;), tri (3, 120&#176;), tet (4, 109.47&#176;), sq (4, 90/180&#176;), oct (6, 90/180&#176;). A shape requires its count and an upper distance.</li><li><code>A B 4 1.50/1.60 tet angle=3</code>: each shell angle has a flat window of &plusmn;3&#176; around its ideal angle. Without angle=, the ideal angle is a point target. This suffix is specific to Rietveld restraints.</li></ul>'+
    '<p class="hint">Nearest-distance rules (<code>A B - …</code>) allow one rule per atom-label pair: A&#8211;B and B&#8211;A are the same pair. Counted and geometry rules are about the B around A, one per ordered pair: <code>Fe1 O1 6 … oct</code> and <code>O1 Fe1 2 …</code> are two different rules. Rules naming an atom that is deleted are removed (see the Log); a renamed atom is renamed in the rules. Helper collects rules independently: the first rule for a pair is kept and duplicate or conflicting additions are skipped. Copy the collection and paste it into this box to apply it. Edit the original rule to change a tolerance or geometry. Invalid or missing labels prevent applying the edit and stop refinement of invalid saved rules.</p>'+
    '<p class="hint">Windows and sigma have different roles: inside a window there is no penalty; outside it the contribution to chi-squared is weight &times; ((value minus nearest bound) / sigma)&sup2;. Sigma distance and sigma angle set the strength beyond the window, rather than its width. Defaults: weight 1, sigma distance 0.02 &#197;, sigma angle 3&#176;. These soft restraints can deform; they are not an exact rigid body. Restraints contribute to refinement and uncertainties; pattern R factors remain based on the pattern. Global fits count a phase once across its datasets. Parallel tempering with restraints runs on the CPU.</p>'+
    '<p class="hint">Helper offers geometry presets, molecule import (PDB, XYZ, Z-matrix), and suggestions from current contacts. Distinct-label angles use 1-3 distance windows at the target bond lengths, so the angular window is approximate when bond lengths vary. Square and octahedral neighbour selections use opposite pairs #1/#2, #3/#4, #5/#6. Symmetry-copy mode generates counted shell rules with per-rule angular windows. Review collected rules before copying and pasting them; all saved rules follow the phase into projects and reports.</p></div></details>';var box=document.createElement('div');box.innerHTML=html.replace(/<\/(?:p|li)>/g,'$& ');return box.textContent.replace('Restraint rules and tolerances','').trim();}
  async function openHelper(ph,returnToEditor){
    if(S.busy)return;var key=ph.key;
    await ui.modal({title:'Restraint helper - '+ph.name,wide:true,body:'<div class="rs-editor" data-rs-phase="'+esc(key)+'" data-rs-helper-only>'+helperHTML(ph)+'<p class="why rs-err" data-rs-error role="status"></p></div>',buttons:[{label:'Close',value:null},{label:'Copy',primary:true,close:false,onClick:function(body){copyCollected(body.querySelector('[data-rs-helper-only]'),ph);return false;}}],onOpen:function(body){body.addEventListener('keydown',function(e){var tab=e.target.closest('[data-rs-tab]');if(!tab || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key))return;e.preventDefault();var tabs=Array.from(body.querySelectorAll('[data-rs-tab]')),i=tabs.indexOf(tab),next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];selectTab(body,next.dataset.rsTab);next.focus();});}});
    if(returnToEditor && St.phaseByKey(key))edit(St.phaseByKey(key));
  }
  function madeHtml(g){
    return '<p class="hint">'+esc(g.note||'')+'</p><textarea class="code-area" data-rs-madetext rows="6" spellcheck="false">'+esc(g.text||'')+'</textarea>';
  }
  function mount(host,ph){if(!host)return;host.classList.add('rs-editor');host.setAttribute('data-rs-phase',ph.key);host.innerHTML=html(ph);liveCheck(host,ph);}
  function refreshAll(){document.querySelectorAll('.rs-editor[data-rs-phase]').forEach(function(host){
    var ph=St.phaseByKey(host.getAttribute('data-rs-phase'));if(!ph)return;if(host.hasAttribute('data-rs-helper-only')){host.querySelectorAll('button,input,select,textarea').forEach(function(el){el.disabled=!!S.busy;});return;}
    var open=Array.prototype.map.call(host.querySelectorAll('details'),function(d){return d.open;}),focus=document.activeElement&&host.contains(document.activeElement)?document.activeElement.getAttribute('data-rs-text')!=null?'text':null:null;
    host.innerHTML=html(ph);host.querySelectorAll('details').forEach(function(d,i){d.open=!!open[i];});liveCheck(host,ph);
    if(focus==='text'){var t=host.querySelector('[data-rs-text]');if(t)t.focus();}
  });}
  function say(host,msg,warn){host.querySelectorAll('[data-rs-error]').forEach(function(e){e.textContent=msg||'';e.classList.toggle('warn',!!warn);});}
  function liveCheck(host,ph){
    var t=host.querySelector('[data-rs-text]');if(!t)return null;
    var st=status(ph,t.value);
    say(host,st.errors.length?st.errors.slice(0,3).join('; ')+(st.errors.length>3?'; …':''):st.warnings.length?st.warnings[0]:'',!st.errors.length);
    return st;
  }
  function commit(host,ph,patch){
    if(S.busy){ui.toast('A fit is running. Wait for it to finish or press Stop.','warn');return false;}
    if(patch.text!=null){var st=status(ph,patch.text);if(st.errors.length){say(host,st.errors[0]);return false;}}
    try{apply(ph,patch);}catch(e){refreshAll();say(host,e.message);return false;}
    return true;
  }
  function appendRules(host,ph,text){
    try{var box=host.querySelector('[data-rs-collected]'),base=AR.merge(ph.atoms,'',box.value),result=AR.merge(ph.atoms,base.text,text);result.skipped+=base.skipped;result.conflicts+=base.conflicts;box.value=result.text;
      say(host,result.added+' rules collected.'+(result.skipped?' '+result.skipped+' duplicates skipped'+(result.conflicts?' ('+result.conflicts+' conflicts)':'')+'; first rules kept.':''),!!result.skipped);
    }catch(e){say(host,e.message);}
  }
  function selectTab(host,key){
    host.querySelectorAll('[data-rs-tab]').forEach(function(t){var on=t.dataset.rsTab===key;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
    host.querySelectorAll('[data-rs-panel]').forEach(function(p){p.hidden=p.dataset.rsPanel!==key;});
  }
  async function copyCollected(host,ph){
    try{var box=host.querySelector('[data-rs-collected]'),result=AR.merge(ph.atoms,'',box.value);box.value=result.text;
      if(!result.added){say(host,'Add rules before copying.');return;}
      try{if(!navigator.clipboard || !navigator.clipboard.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(result.text);}
      catch(e){box.focus();box.select();if(!document.execCommand('copy'))throw new Error('Clipboard unavailable. Select and copy the collected rules manually.');}
      say(host,'Rules copied. Paste into the dataset restraints textbox to apply them.'+(result.skipped?' Duplicate or conflicting rules were pruned; first rules kept.':''));
    }catch(e){say(host,e.message);}
  }
  function phaseOf(e){var host=e.target.closest('.rs-editor');return host?{host:host,ph:St.phaseByKey(host.getAttribute('data-rs-phase'))}:null;}
  function positive(host,t,key){var v=ui.parseNum(t.value);if(!(v>0)){say(host,'Give a positive number.');t.value=String(AR.normalize(St.phaseByKey(host.getAttribute('data-rs-phase')).restraints)[key]);return null;}return v;}

  // ---------------------------------------------------------------- the guide
  function guideOf(host,ph){
    var g=guide[ph.key]||(guide[ph.key]={}),q=function(s){return host.querySelector(s);};
    g.paste=q('[data-rs-paste]').value;g.map=q('[data-rs-map]').value;g.btol=q('[data-rs-btol]').value;g.atol=q('[data-rs-atol]').value;g.angles=q('[data-rs-angles]').checked;g.skiph=q('[data-rs-skiph]').checked;
    return g;
  }
  function make(host,ph,text,fname){
    var g=guideOf(host,ph),mol;
    try{mol=MR.read(text,{name:fname});}catch(e){g.text='';g.note='';say(host,e.message);host.querySelector('[data-rs-made]').innerHTML='';return;}
    var labels=ph.atoms.map(function(a){return a.label;}),atoms=mol.atoms;
    if(g.map==='order'){
      if(atoms.length!==labels.length){say(host,'By order needs as many atoms in the file ('+atoms.length+') as in the phase ('+labels.length+').');return;}
      atoms=atoms.map(function(a,i){return {name:labels[i],el:a.el,xyz:a.xyz};});
    }
    var only=new Set(labels),have=atoms.filter(function(a){return only.has(a.name);}).length;
    if(!have){say(host,'None of the '+atoms.length+' atoms of the file ('+atoms.slice(0,4).map(function(a){return a.name;}).join(', ')+'…) is an atom label of the phase ('+labels.slice(0,4).join(', ')+'…). Use “by order”, or rename the atoms.');return;}
    var res=MR.rules(atoms,{bondTol:ui.parseNum(g.btol),angleTol:ui.parseNum(g.atol),angles:g.angles,skipH:g.skiph,only:only});
    g.text=res.text;g.note=mol.format+': '+atoms.length+' atoms, '+have+' of them in the phase. '+res.bonds+' bond'+(res.bonds===1?'':'s')+(g.angles?' and '+res.angles+' angle rules':'')+(res.skipped?'; '+res.skipped+' rules left out for atoms the phase does not have':'')+'.';
    g.molSource=text;g.molName=fname;say(host,'');host.querySelector('[data-rs-made]').innerHTML=madeHtml(g);return true;
  }
  function suggest(host,ph){
    var d=def(ph),src=source(ph),tol=ui.parseNum(host.querySelector('[data-rs-stol]').value);host.querySelector('[data-rs-suggested]').innerHTML='';if(!(tol>=0)){say(host,'Give the window as a number.');return;}
    var el={};d.atoms.forEach(function(a){el[a.label]=a.element;});
    var cont=AR.contacts(d,src.v,ctx(),function(a,b){return 1.2*(MR.radius(el[a])+MR.radius(el[b]));}),lines=[];
    d.atoms.forEach(function(a){
      var by={};cont[a.label].forEach(function(n){if(n.d>0.4 && n.d<1.2*(MR.radius(el[a.label])+MR.radius(el[n.b])))(by[n.b]=by[n.b]||[]).push(n.d);});
      Object.keys(by).forEach(function(b){var ds=by[b];lines.push(a.label+' '+b+' '+ds.length+' '+Math.max(0.3,ds[0]-tol).toFixed(2)+'/'+(ds[ds.length-1]+tol).toFixed(2));});
    });
    var box=host.querySelector('[data-rs-suggested]');
    if(!lines.length){box.innerHTML='<p class="hint">No contacts shorter than 1.2 × the covalent radii in the '+esc(src.name)+'.</p>';return;}
    var proposed={text:AR.merge(ph.atoms,'',lines.join('\n')).text};proposed.note='From the '+src.name+': '+AR.parse(proposed.text).windows.length+' rules.';box.innerHTML=madeHtml(proposed);
  }

  // ---------------------------------------------------------------- events
  function onClick(e){
    var p=phaseOf(e);if(!p||!p.ph)return;var host=p.host,ph=p.ph,t=e.target;
    if(t.closest('[data-rs-helper]')){openHelper(ph,!!t.closest('#dlg'));return;}
    var tab=t.closest('[data-rs-tab]');if(tab){selectTab(host,tab.dataset.rsTab);return;}
    if(t.closest('[data-rs-build-add]')){
      if(S.busy)return;
      try{var made=MR.geometryRules(builderOf(ph));appendRules(host,ph,made.text);
      }catch(err){say(host,err.message);}return;
    }
    if(t.closest('[data-rs-molecule-add]') || t.closest('[data-rs-suggestion-add]')){
      if(S.busy)return;
      if(t.closest('[data-rs-molecule-add]')){var g=guideOf(host,ph),input=g.paste.trim()?g.paste:g.molSource;if(!input){say(host,'Read or paste a molecule first.');return;}if(!make(host,ph,input,g.paste.trim()?'':g.molName))return;}else suggest(host,ph);
      var panel=t.closest('[data-rs-panel]'),made=panel.querySelector('[data-rs-madetext]');
      if(!made){say(host,'Generate a proposal in this tab first.');return;}appendRules(host,ph,made.value);
    }
  }
  async function onChange(e){
    var p=phaseOf(e);if(!p||!p.ph)return;var host=p.host,ph=p.ph,t=e.target,v;
    if(t.hasAttribute('data-rs-build') || t.hasAttribute('data-rs-neighbour')){
      if(S.busy)return;var b=builderOf(ph),key=t.getAttribute('data-rs-build');
      if(key)b[key]=t.value;else {var label=t.getAttribute('data-rs-neighbour');b.neighbours=b.neighbours.filter(function(n){return n!==label;});if(t.checked)b.neighbours.push(label);}
      if(key && ['kind','center','mode'].indexOf(key)<0){
        var proposal;try{proposal=proposalHTML(MR.geometryRules(b));}catch(err){proposal='<p class="hint">'+esc(err.message)+'</p>';}
        host.querySelector('[data-rs-built]').innerHTML=proposal;
      }else host.querySelector('[data-rs-builder]').innerHTML=builderHTML(ph);return;
    }
    if(t.hasAttribute('data-rs-text')){commit(host,ph,{text:t.value});return;}
    if(t.hasAttribute('data-rs-weight')){if((v=positive(host,t,'weight')))commit(host,ph,{weight:v});return;}
    if(t.hasAttribute('data-rs-sigmaD')){if((v=positive(host,t,'sigmaD')))commit(host,ph,{sigmaD:v});return;}
    if(t.hasAttribute('data-rs-sigmaA')){if((v=positive(host,t,'sigmaA')))commit(host,ph,{sigmaA:v});return;}
    if(t.hasAttribute('data-rs-file')&&t.files&&t.files[0]){var f=t.files[0],text;try{text=await f.text();}catch(x){say(host,'The file cannot be read.');return;}make(host,ph,text,f.name);return;}
    if(t.hasAttribute('data-rs-paste')||t.hasAttribute('data-rs-map')||t.hasAttribute('data-rs-btol')||t.hasAttribute('data-rs-atol')||t.hasAttribute('data-rs-angles')||t.hasAttribute('data-rs-skiph'))guideOf(host,ph);
  }
  function onInput(e){var p=phaseOf(e);if(p&&p.ph&&e.target.hasAttribute('data-rs-text'))liveCheck(p.host,p.ph);}

  async function edit(phase){
    if(S.busy)return;var ph=phase && phase.key?phase:St.currentPhase();if(!ph||ph.atoms.length<2){ui.toast('Select a phase with at least two atoms.','warn');return;}
    await ui.modal({title:'Restraints · '+ph.name,wide:true,body:introHTML()+'<div data-rs-host></div>',buttons:[{label:'Close',primary:true,value:null}],onOpen:function(b){mount(b.querySelector('[data-rs-host]'),ph);}});
  }
  function init(){
    document.querySelectorAll('[data-restraints]').forEach(function(b){b.addEventListener('click',edit);});
    document.addEventListener('click',function(e){if(e.target.closest('[data-restraints-edit]'))edit();});
    document.addEventListener('click',onClick);document.addEventListener('change',onChange);document.addEventListener('input',onInput);
    RV.bus.on('busy',refreshAll);RV.bus.on('phases',refreshAll);
  }
  return {init:init,edit:edit,summary:summary,apply:apply,mount:mount,refreshAll:refreshAll,renderDatasets:renderDatasets};
})();
