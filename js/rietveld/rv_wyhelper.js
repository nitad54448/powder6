/* The Helper of the Wyckoff search distance constraints (Commands -> Structure -> Wyckoff search): the same dialog as the
 * Rietveld restraint Helper (js/rietveld/rv_restraints.js), on the ELEMENTS of the formula unit instead of atom labels.
 * Geometry writes a coordination shell, a distance window or a minimum contact; Molecule reads a molecule (PDB, XYZ,
 * Z-matrix) and writes the bonds of each element pair; Suggest writes minimum contacts from the covalent radii. Add
 * collects rules in one box; Copy puts them on the clipboard. Nothing changes the constraints box until the user pastes.
 * The button is disabled while there is no formula unit that can be read.
 *   RV.wyHelper = { init, open(), able(button) }
 */
RV.wyHelper = (function(){
  'use strict';
  var S=RV.state.S,ui=RV.ui,esc=ui.esc,MR=MoleculeRules,WL=WY_LIMITS;
  var SHAPES=Object.keys(WL.geometries).map(function(k){var g=WL.geometries[k];return {key:k,word:g.words[0],count:g.count};});
  var form={kind:'shell',a:'',b:'',shape:'tetrahedron',count:'4',atleast:false,distance:'1.6',tol:'0.1',contact:'2.4'};
  var mol={paste:'',btol:'0.10',skiph:false,source:'',name:''};

  function capEl(s){s=String(s || '');return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();}
  function elements(){var c=RV.solve.parseFormula(RV.solve.state.opts.formula);return c?c.map(function(x){return capEl(x.el);}):[];}
  function why(){return S.busy?'Calculation running.':!elements().length?'Give the formula unit first: the Helper writes constraints on its elements.':'';}
  function able(btn){ui.able(btn || document.getElementById('sv-wy-helper'),why());}
  function num(v){var x=ui.parseNum(v);return Number.isFinite(x)?x:NaN;}
  function f2(x){return (+x.toFixed(3)).toString();}

  // ---------------------------------------------------------------- the three generators
  function geometryRule(els){
    var a=capEl(form.a || els[0]),b=capEl(form.b || els[els.length>1?1:0]);
    if(els.indexOf(a)<0 || els.indexOf(b)<0)throw new Error('Choose two elements of the formula unit.');
    if(form.kind==='contact'){var c=num(form.contact);if(!(c>0))throw new Error('Give the shortest contact as a positive distance.');return a+' '+b+' - '+f2(c)+'/';}
    var d=num(form.distance),t=num(form.tol);
    if(!(d>0) || !(t>=0) || t>=d)throw new Error('Give a positive distance and a smaller, nonnegative window.');
    var range=f2(d-t)+'/'+f2(d+t);
    if(form.kind==='nearest')return a+' '+b+' - '+range;
    var shape=SHAPES.filter(function(s){return s.word===form.shape;})[0],n=shape?shape.count:parseInt(form.count,10);
    if(!(n>=1) || n>WL.maxCoordSlots)throw new Error('Give a coordination number from 1 to '+WL.maxCoordSlots+'.');
    return a+' '+b+' '+n+(form.atleast && !shape?'+':'')+' '+range+(shape?' '+shape.word:'');
  }
  /* the bonds of a molecule by element pair: for every element A of the formula with B neighbours, "A B N lo/hi" when every
     A has the same number N of B, "A B - lo/hi" (the nearest B) when every A has at least one; skipped otherwise */
  function moleculeRules(text,name,els){
    var m=MR.read(text,{name:name}),atoms=m.atoms.filter(function(a){return !(mol.skiph && a.el==='H');}),tol=num(mol.btol);
    if(!(tol>=0))throw new Error('Give the bond window as a nonnegative number.');
    var nb=atoms.map(function(){return [];});
    for(var i=0;i<atoms.length;i++)for(var j=i+1;j<atoms.length;j++){
      var p=atoms[i].xyz,q=atoms[j].xyz,d=Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
      if(d>0.4 && d<1.2*(MR.radius(atoms[i].el)+MR.radius(atoms[j].el))){nb[i].push({k:j,d:d});nb[j].push({k:i,d:d});}
    }
    var lines=[],notes=[],outside={};
    atoms.forEach(function(a){if(els.indexOf(a.el)<0)outside[a.el]=true;});
    els.forEach(function(A){
      var centres=atoms.map(function(a,i){return i;}).filter(function(i){return atoms[i].el===A;});if(!centres.length)return;
      els.forEach(function(B){
        var per=centres.map(function(i){return nb[i].filter(function(n){return atoms[n.k].el===B;}).map(function(n){return n.d;});}),all=[].concat.apply([],per);
        if(!all.length)return;
        var lo=Math.max(0.3,Math.min.apply(null,all)-tol),hi=Math.max.apply(null,all)+tol,counts=per.map(function(x){return x.length;});
        if(counts.every(function(n){return n===counts[0];}))lines.push(A+' '+B+' '+counts[0]+' '+f2(lo)+'/'+f2(hi));
        else if(counts.every(function(n){return n>0;}))lines.push(A+' '+B+' - '+f2(lo)+'/'+f2(hi));
        else notes.push('not every '+A+' of the molecule has a '+B+' neighbour, so '+A+'–'+B+' is left out');
      });
    });
    var out=Object.keys(outside);if(out.length)notes.push(out.join(', ')+' '+(out.length===1?'is':'are')+' not in the formula unit and left out');
    return {text:lines.join('\n'),note:m.format+': '+m.atoms.length+' atoms, '+lines.length+' rule'+(lines.length===1?'':'s')+(notes.length?'; '+notes.join('; '):'')+'.'};
  }
  // the shortest contact of every pair of elements of the formula: factor × the sum of their covalent radii
  function suggestRules(els,factor,like){
    var lines=[];
    els.forEach(function(A,i){els.forEach(function(B,j){if(j<i || (i===j && !like))return;lines.push(A+' '+B+' - '+f2(factor*(MR.radius(A)+MR.radius(B)))+'/');});});
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- collecting
  // as the restraints: a nearest-distance rule is about the pair, a counted rule about the B around A
  function key(w){return w.count==null?JSON.stringify(['-'].concat([w.a,w.b].sort())):JSON.stringify(['n',w.a,w.b]);}
  function check(text){var v=RV.solve.validateConstraints(text,RV.solve.state.opts.formula);return v;}
  function merge(current,addition){
    var seen={},lines=[],added=0,skipped=0,conflicts=0;
    function take(line,count){
      var v=check(line);if(v.errors.length)throw new Error(v.errors[0].replace(/^line 1: /,'')+' ('+line.trim()+')');
      v.windows.forEach(function(w){var k=key(w);if(seen[k]){if(count){skipped++;if(['dmin','dmax','count','countMode','geometry'].some(function(f){return seen[k][f]!==w[f];}))conflicts++;}return;}seen[k]=w;lines.push(line.trim());if(count)added++;});
    }
    String(current || '').split(/\r?\n/).forEach(function(l){if(l.trim() && !/^\s*#/.test(l))take(l,false);});
    String(addition || '').split(/\r?\n/).forEach(function(l){if(l.trim() && !/^\s*#/.test(l))take(l,true);});
    return {text:lines.join('\n'),added:added,skipped:skipped,conflicts:conflicts};
  }

  // ---------------------------------------------------------------- the dialog
  function options(list,value,label){return list.map(function(x){var v=label?x[0]:x;return '<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(label?x[1]:x)+'</option>';}).join('');}
  function geometryHTML(els){
    var a=form.a && els.indexOf(form.a)>=0?form.a:els[0],b=form.b && els.indexOf(form.b)>=0?form.b:els[els.length>1?1:0];form.a=a;form.b=b;
    var shell=form.kind==='shell',shape=SHAPES.filter(function(s){return s.word===form.shape;})[0];
    function field(k,label){return '<label>'+label+' <input class="num" data-wh="'+k+'" value="'+esc(form[k])+'" inputmode="decimal"></label>';}
    var proposal;try{proposal='<textarea class="code-area" rows="2" readonly aria-label="Proposed constraint">'+esc(geometryRule(els))+'</textarea>';}catch(e){proposal='<p class="hint">'+esc(e.message)+'</p>';}
    return '<div class="rs-set"><label>Rule <select data-wh="kind">'+options([['shell','Coordination shell'],['nearest','Nearest distance'],['contact','Shortest contact']],form.kind,true)+'</select></label>'+
      '<label>Central element <select data-wh="a">'+options(els,a)+'</select></label><label>Neighbour element <select data-wh="b">'+options(els,b)+'</select></label></div>'+
      (shell?'<div class="rs-set"><label>Shape <select data-wh="shape">'+options([['','none (count only)']].concat(SHAPES.map(function(s){return [s.word,s.word+' ('+s.count+')'];})),form.shape,true)+'</select></label>'+
        (shape?'':field('count','Neighbours')+'<label><input type="checkbox" data-wh="atleast"'+(form.atleast?' checked':'')+'> or more</label>')+'</div>':'')+
      '<div class="rs-set">'+(form.kind==='contact'?field('contact','No closer than (&#197;)'):field('distance','Distance (&#197;)')+field('tol','Window &plusmn; (&#197;)'))+'</div>'+
      '<p class="hint">'+(shell?'Each central atom has this number of neighbours in the window'+(shape?', at the angles of the shape (their weight is the Shape weight of the search).':'.'):form.kind==='nearest'?'The nearest neighbour of each central atom lies in the window.':'No neighbour atom closer than this to a central atom.')+' Elements come from the formula unit.</p>'+
      '<div data-wh-built>'+proposal+'</div><p class="buttons"><button type="button" class="primary" data-wh-add="geometry">Add</button></p>';
  }
  function html(els){
    var tabs=[['geometry','Geometry'],['molecule','Molecule'],['suggest','Suggest']];
    return '<p class="hint">Constraints on the elements of '+esc(RV.solve.state.opts.formula)+' ('+esc(els.join(', '))+').</p>'+
      '<nav class="tabs" role="tablist" aria-label="Constraint helper">'+tabs.map(function(t){return '<button type="button" role="tab" id="wh-tab-'+t[0]+'" data-wh-tab="'+t[0]+'" aria-controls="wh-panel-'+t[0]+'" aria-selected="'+(t[0]==='geometry')+'" tabindex="'+(t[0]==='geometry'?'0':'-1')+'">'+t[1]+'</button>';}).join('')+'</nav>'+
      '<section role="tabpanel" class="rs-helper-panel" id="wh-panel-geometry" aria-labelledby="wh-tab-geometry" data-wh-panel="geometry"><div class="rs-guide-body" data-wh-geometry>'+geometryHTML(els)+'</div></section>'+
      '<section role="tabpanel" class="rs-helper-panel" id="wh-panel-molecule" aria-labelledby="wh-tab-molecule" data-wh-panel="molecule" hidden><div class="rs-guide-body">'+
        '<p class="hint">Read a molecule (PDB, MOL/SDF, XYZ or Z-matrix) and write the bonds between its elements: "A B N" when every A has N neighbours B, the nearest B otherwise. Only the elements of the formula unit are used.</p>'+
        '<div class="rs-set"><label>File <input type="file" data-wh-file accept=".pdb,.ent,.mol,.sdf,.xyz,.txt,.zmat"></label></div>'+
        '<label class="rs-rules">…or paste it here<textarea class="code-area" data-wh-paste rows="4" spellcheck="false" placeholder="S&#10;O1 1 1.47&#10;O2 1 1.47 2 109.47">'+esc(mol.paste)+'</textarea></label>'+
        '<div class="rs-set"><label>Bond window ± (Å) <input class="num" data-wh-btol value="'+esc(mol.btol)+'" inputmode="decimal"></label><label><input type="checkbox" data-wh-skiph'+(mol.skiph?' checked':'')+'> skip hydrogens</label></div>'+
        '<div data-wh-made></div><p class="buttons"><button type="button" data-wh-add="molecule">Add</button></p></div></section>'+
      '<section role="tabpanel" class="rs-helper-panel" id="wh-panel-suggest" aria-labelledby="wh-tab-suggest" data-wh-panel="suggest" hidden><div class="rs-guide-body">'+
        '<p class="hint">Writes a shortest contact for every pair of elements of the formula unit: the factor times the sum of their covalent radii. A floor keeps atoms apart without adding a rule to the kernel budget.</p>'+
        '<div class="rs-set"><label title="shortest contact = Factor × (covalent radius of A + covalent radius of B)">Factor <input class="num" data-wh-factor value="0.8" inputmode="decimal" title="shortest contact = Factor × (covalent radius of A + covalent radius of B)"></label><label><input type="checkbox" data-wh-like checked> like pairs (O O)</label></div>'+
        '<div data-wh-suggested></div><p class="buttons"><button type="button" data-wh-add="suggest">Add</button></p></div></section>'+
      '<label class="rs-rules rs-collected">Collected constraints<textarea class="code-area" data-wh-collected rows="6" spellcheck="false"></textarea></label>'+
      '<p class="hint">Add collects constraints here only. Copy them, then paste into Distance constraints if wanted. For a duplicate or conflicting rule the first is kept.</p>'+
      '<p class="why rs-err" data-wh-error role="status"></p>';
  }
  function say(body,msg,warn){var e=body.querySelector('[data-wh-error]');if(e){e.textContent=msg || '';e.classList.toggle('warn',!!warn);}}
  function selectTab(body,k){
    body.querySelectorAll('[data-wh-tab]').forEach(function(t){var on=t.dataset.whTab===k;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
    body.querySelectorAll('[data-wh-panel]').forEach(function(p){p.hidden=p.dataset.whPanel!==k;});
  }
  function collect(body,text){
    var box=body.querySelector('[data-wh-collected]');
    try{var r=merge(box.value,text);box.value=r.text;var v=check(r.text);
      say(body,r.added+' constraint'+(r.added===1?'':'s')+' collected.'+(r.skipped?' '+r.skipped+' duplicates skipped'+(r.conflicts?' ('+r.conflicts+' conflicts)':'')+'; first rules kept.':'')+(v.errors.length?' '+v.errors[0]:v.warnings.length?' '+v.warnings[0]:''),!!(r.skipped || v.errors.length || v.warnings.length));
    }catch(e){say(body,e.message);}
  }
  function made(body,els){
    var text=mol.paste.trim()?mol.paste:mol.source,host=body.querySelector('[data-wh-made]');
    if(!text){say(body,'Read or paste a molecule first.');return null;}
    try{var r=moleculeRules(text,mol.paste.trim()?'':mol.name,els);}catch(e){host.innerHTML='';say(body,e.message);return null;}
    host.innerHTML='<p class="hint">'+esc(r.note)+'</p><textarea class="code-area" rows="4" readonly aria-label="Molecule constraints">'+esc(r.text)+'</textarea>';
    if(!r.text){say(body,'The molecule gives no bond between elements of the formula unit.');return null;}
    return r.text;
  }
  async function copy(body){
    var box=body.querySelector('[data-wh-collected]');
    try{var r=merge('',box.value);box.value=r.text;if(!r.text){say(body,'Add constraints before copying.');return;}
      try{if(!navigator.clipboard || !navigator.clipboard.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(r.text);}
      catch(e){box.focus();box.select();if(!document.execCommand('copy'))throw new Error('Clipboard unavailable. Select and copy the collected constraints manually.');}
      say(body,'Constraints copied. Paste into Distance constraints to use them.');
    }catch(e){say(body,e.message);}
  }
  async function open(){
    if(why())return;var els=elements();
    await ui.modal({title:'Constraint helper - Wyckoff search',wide:true,body:'<div class="wh-editor" data-wh-host>'+html(els)+'</div>',
      buttons:[{label:'Close',value:null},{label:'Copy',primary:true,close:false,onClick:function(body){copy(body);return false;}}],
      onOpen:function(body){
        body.addEventListener('keydown',function(e){var tab=e.target.closest('[data-wh-tab]');if(!tab || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key))return;e.preventDefault();var tabs=Array.from(body.querySelectorAll('[data-wh-tab]')),i=tabs.indexOf(tab),next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];selectTab(body,next.dataset.whTab);next.focus();});
        body.addEventListener('click',function(e){
          var t=e.target,tab=t.closest('[data-wh-tab]');if(tab){selectTab(body,tab.dataset.whTab);return;}
          var add=t.closest('[data-wh-add]');if(!add)return;var k=add.dataset.whAdd,text=null;
          if(k==='geometry'){try{text=geometryRule(els);}catch(x){say(body,x.message);return;}}
          else if(k==='molecule')text=made(body,els);
          else{var f=num(body.querySelector('[data-wh-factor]').value);if(!(f>0)){say(body,'Give the factor as a positive number.');return;}text=suggestRules(els,f,body.querySelector('[data-wh-like]').checked);body.querySelector('[data-wh-suggested]').innerHTML='<textarea class="code-area" rows="4" readonly aria-label="Suggested constraints">'+esc(text)+'</textarea>';}
          if(text)collect(body,text);
        });
        body.addEventListener('change',async function(e){
          var t=e.target,k=t.getAttribute('data-wh');
          if(k){form[k]=t.type==='checkbox'?t.checked:t.value;if(k==='shape' && t.value){var s=SHAPES.filter(function(x){return x.word===t.value;})[0];if(s)form.count=String(s.count);}body.querySelector('[data-wh-geometry]').innerHTML=geometryHTML(els);return;}
          if(t.hasAttribute('data-wh-paste'))mol.paste=t.value;
          if(t.hasAttribute('data-wh-btol'))mol.btol=t.value;
          if(t.hasAttribute('data-wh-skiph'))mol.skiph=t.checked;
          if(t.hasAttribute('data-wh-file') && t.files && t.files[0]){try{mol.source=await t.files[0].text();mol.name=t.files[0].name;mol.paste='';body.querySelector('[data-wh-paste]').value='';made(body,els);}catch(x){say(body,'The file cannot be read.');}}
        });
      }});
  }
  function init(){RV.bus.on('busy',function(){able();});}
  return {init:init,open:open,able:able,merge:merge,geometryRule:geometryRule,moleculeRules:moleculeRules,suggestRules:suggestRules};
})();
