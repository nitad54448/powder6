/* Exact Rietveld atomic constraints, GSAS-II rules. Dependent parameters are
 * eliminated analytically; no restraint penalties or pseudo-observations.
 *
 *   hold       {kind:'hold',  component, atoms:[A, ...]}
 *              each listed parameter is not refined, whatever its refine flag.
 *   equiv      {kind:'equiv', component, atoms:[A, B, ...], mult:[1, mB, ...]}
 *              B = mB · A, ...  A (the first atom) is the independent parameter: only its refine flag
 *              counts; the dependents follow it, refined or not.
 *   sum        {kind:'sum',   component, atoms:[A, B, ...], mult:[mA, mB, ...], total:c}
 *              mA · A + mB · B + ... = c  (constraint equation). The last refined term becomes the dependent
 *              one; terms that are not refined are constants. With no term refined the equation only aligns
 *              the starting values.
 *
 * One parameter may appear in one relationship only (GSAS-II: a parameter is dependent in at most one
 * constraint, and a held parameter in none). Coordinates fixed or dependent by site symmetry cannot be used.
 * Projects saved with the older {kind:'equal'} groups are read as equivalences with multipliers 1.
 */
var AtomicConstraints = (function () {
  'use strict';
  var COMPONENTS = ['x', 'y', 'z', 'occ', 'B'];
  function clone(v){return JSON.parse(JSON.stringify(v || []));}
  function num(v,d){var x=Number(v);return Number.isFinite(x)?x:d;}

  // the current form of one relationship (older projects: kind 'equal', no multipliers)
  function normalize(c) {
    if(!c || typeof c!=='object')return c;
    var out={kind:c.kind,component:c.component,atoms:Array.isArray(c.atoms)?c.atoms.slice():[]};
    if(out.kind==='equal')out.kind='equiv';
    if(out.kind==='equiv'||out.kind==='sum'){
      var m=Array.isArray(c.mult)?c.mult:[];out.mult=out.atoms.map(function(_,i){return num(m[i],1);});
      if(out.kind==='equiv')out.mult[0]=1;
    }
    if(out.kind==='sum')out.total=Number(c.total);
    return out;
  }
  function normalizeAll(list){return (list || []).map(normalize);}

  function fmtMult(m){return String(+Number(m).toPrecision(6));}
  // "B.x = 0.5 × A.x", "A.occ + B.occ = 1", "hold A.B"
  function text(c) {
    c=normalize(c);var p=function(a){return a+'.'+c.component;};
    if(c.kind==='hold')return c.atoms.map(p).join(', ')+' not refined';
    if(c.kind==='equiv')return c.atoms.slice(1).map(function(a,i){var m=c.mult[i+1];return p(a)+' = '+(m===1?'':m===-1?'−':fmtMult(m)+' × ')+p(c.atoms[0]);}).join('; ');
    if(c.kind==='sum')return c.atoms.map(function(a,i){var m=c.mult[i],s=m<0?' − ':' + ',am=Math.abs(m);return (i===0?(m<0?'−':''):s)+(am===1?'':fmtMult(am)+' × ')+p(a);}).join('')+' = '+fmtMult(c.total);
    return '?';
  }
  function label(kind){return {hold:'Hold',equiv:'Equivalence',sum:'Constraint equation'}[kind] || kind;}

  // the definitions of a phase, checked; throws with a readable message
  function definitions(ph) {
    var used={}, atoms=ph.atoms || [], out=[];
    (ph.constraints || []).forEach(function(c0){
      var c=normalize(c0);
      if(!c || ['hold','equiv','sum'].indexOf(c.kind)<0)throw new Error('Unknown atomic constraint type in '+ph.key+'.');
      var comp=c.component, need=c.kind==='hold'?1:2;
      if(COMPONENTS.indexOf(comp)<0)throw new Error('Constraints apply to x, y, z, occupancy or B.');
      if(c.atoms.length<need)throw new Error(label(c.kind)+' needs at least '+need+(need===1?' atom.':' atoms.'));
      if(new Set(c.atoms).size!==c.atoms.length)throw new Error('An atom appears twice in one relationship.');
      if(c.mult && c.mult.some(function(m,i){return !Number.isFinite(m) || (m===0 && !(c.kind==='equiv' && i===0));}))throw new Error('Multipliers must be finite and non-zero.');
      if(c.kind==='sum' && !Number.isFinite(c.total))throw new Error('The constraint equation needs a numerical total.');
      var names=c.atoms.map(function(lbl){
        var at=atoms.find(function(a){return a.label===lbl;});if(!at)throw new Error('Constraint references missing atom '+lbl+'.');
        if('xyz'.indexOf(comp)>=0 && (!at.site || at.site.free.indexOf('xyz'.indexOf(comp))<0))throw new Error(lbl+'.'+comp+' is fixed or dependent by site symmetry; only independent coordinates can be constrained.');
        var name=ph.key+'.'+lbl+'.'+comp;
        if(used[name])throw new Error(lbl+'.'+comp+' is already in another relationship. GSAS-II: a parameter is held, or dependent, in one relationship only.');
        used[name]=true;return name;
      });
      out.push({kind:c.kind,component:comp,names:names,mult:c.mult || null,total:c.total});
    });return out;
  }
  function limits(problem,name,value){var lim=(problem.limits && problem.limits[name] || RVCore.defaultLimits(name,value)).slice();if(/\.occ$/.test(name)){lim[0]=Math.max(0,lim[0]);lim[1]=Math.min(1,lim[1]);}return lim;}

  /* problem: {phases (method, key, atoms, constraints), datasets [{phases}], values [per dataset], vars?, limits?}
     prefer: the name the user just edited (no vars): it stays as typed and the others follow it. */
  function prepare(problem, prefer) {
    var vars=(problem.vars || []).slice(), values=problem.values.map(function(v){return Object.assign({},v);}), slots=values.map(function(){return {};});
    var datasets=problem.datasets, removed={}, held={}, raw=[], constrained=[], checks=[], warnings=[], hasFlags=Array.isArray(problem.vars) && !prefer;
    vars.forEach(function(v,j){var ds=v.d>=0?[v.d]:v.ds && v.ds.length?v.ds:values.map(function(_,d){return d;});ds.forEach(function(d){slots[d][v.name]=j;});});
    function scopeOf(d,n){var j=slots[d][n];if(j==null)return null;var vr=vars[j];return vr.d>=0?'local:'+d:'shared:'+(vr.ds && vr.ds.length?vr.ds:values.map(function(_,i){return i;})).slice().sort().join(',');}
    function warn(s){if(warnings.indexOf(s)<0)warnings.push(s);}
    problem.phases.forEach(function(ph){
      if(ph.method!=='rietveld')return;
      definitions(ph).forEach(function(c){
        values.forEach(function(v,d){
          if(datasets[d] && datasets[d].phases && datasets[d].phases.indexOf(ph.key)<0)return;
          c.names.forEach(function(n){if(!Number.isFinite(v[n]))throw new Error('No value for constrained parameter '+n+'.');if(constrained.indexOf(n)<0)constrained.push(n);checks.push({d:d,name:n,limits:limits(problem,n,v[n])});});
          var ticked=c.names.filter(function(n){return slots[d][n]!=null;});
          if(c.kind==='hold'){ticked.forEach(function(n){removed[slots[d][n]]=true;held[slots[d][n]]=true;});return;}
          if(c.kind==='equiv'){
            var master=c.names[0];
            if(!hasFlags && prefer && prefer!==master && c.names.indexOf(prefer)>0){var k=c.names.indexOf(prefer);v[master]=v[prefer]/c.mult[k];}
            if(hasFlags && slots[d][master]==null && ticked.length)warn(ticked.map(function(n){return n.split('.').slice(1).join('.');}).join(', ')+' follow '+master.split('.').slice(1).join('.')+' (equivalence): tick the independent parameter to refine the group.');
            c.names.slice(1).forEach(function(n,i){
              if(slots[d][n]!=null){removed[slots[d][n]]=true;if(slots[d][master]==null)held[slots[d][n]]=true;}
              raw.push({d:d,name:n,offset:0,sources:[[master,c.mult[i+1]]]});
            });
            return;
          }
          // constraint equation
          if(hasFlags && !ticked.length)return;
          var scopes=[];ticked.forEach(function(n){var s=scopeOf(d,n);if(scopes.indexOf(s)<0)scopes.push(s);});
          if(scopes.length>1)throw new Error('Constraint sharing conflict: use the same global/local sharing for '+c.names.map(function(n){return n.split('.').slice(1).join('.');}).join(', ')+'.');
          var dep=hasFlags ? ticked[ticked.length-1] : c.names.slice().reverse().find(function(n){return n!==prefer;}) || c.names[c.names.length-1];
          var kd=c.names.indexOf(dep), md=c.mult[kd];
          raw.push({d:d,name:dep,offset:c.total/md,sources:c.names.filter(function(n){return n!==dep;}).map(function(n){return [n,-c.mult[c.names.indexOf(n)]/md];})});
          if(slots[d][dep]!=null)removed[slots[d][dep]]=true;
        });
      });
    });
    var targetKeys=new Set(),sourceKeys=new Set();
    (problem.parameterLinks || []).forEach(function(link){
      var target=link.target,source=link.source,factor=Number(link.factor),offset=Number(link.offset || 0);
      if(!target || !source || !Number.isFinite(factor) || factor===0 || !Number.isFinite(offset))throw new Error('A parameter link needs a source, target and finite nonzero multiplier.');
      var tk=target.datasetId+':'+target.name,sk=source.datasetId+':'+source.name;
      if(tk===sk || targetKeys.has(tk))throw new Error('A linked parameter must have one distinct source.');
      targetKeys.add(tk);sourceKeys.add(sk);
      var d=datasets.findIndex(function(ds){return ds.id===target.datasetId;}),sd=datasets.findIndex(function(ds){return ds.id===source.datasetId;});
      if(d<0)return;
      if(!Number.isFinite(values[d][target.name]))throw new Error('Missing linked target '+target.name+'.');
      if(raw.some(function(r){return r.d===d && r.name===target.name;}))throw new Error('The linked target is already dependent in an atomic constraint.');
      var value=sd>=0?values[sd][source.name]:problem.linkValues && problem.linkValues[source.datasetId] && problem.linkValues[source.datasetId][source.name];
      if(!Number.isFinite(value))throw new Error('Missing linked source '+source.name+'.');
      var j=slots[d][target.name];if(j!=null)removed[j]=true;
      checks.push({d:d,name:target.name,limits:limits(problem,target.name,values[d][target.name])});
      if(!constrained.includes(target.name))constrained.push(target.name);
      raw.push({d:d,name:target.name,offset:offset+(sd<0?factor*value:0),sources:sd<0?[]:[[source.name,factor,sd]]});
    });
    targetKeys.forEach(function(k){if(sourceKeys.has(k))throw new Error('Parameter link chains are ambiguous. Link each dependent directly to its independent source.');});
    var free=[], index={}, varLimits=[];
    vars.forEach(function(v,j){if(!removed[j]){index[j]=free.length;free.push(v);var first=v.d>=0?v.d:v.ds && v.ds.length?v.ds[0]:0;varLimits.push(limits(problem,v.name,values[first][v.name]).slice());}});
    var links=[],rawOf={};raw.forEach(function(r){rawOf[r.d+':'+r.name]=r;});
    /* a source in terms of the free variables: refined, a constant, or itself dependent (the independent atom of an
       equivalence that is a link target, a linked term of an equation...): then its own definition, followed through */
    function expand(sd,name,mult,acc,depth){
      var j=slots[sd][name],r=rawOf[sd+':'+name];
      if(j!=null && !removed[j]){var hit=acc.terms.find(function(t){return t[0]===index[j];});if(hit)hit[1]+=mult;else acc.terms.push([index[j],mult]);return;}
      if(r){if(depth>32)throw new Error('Circular constraint dependencies around '+name+'.');acc.offset+=mult*r.offset;r.sources.forEach(function(t){expand(t[2]==null?r.d:t[2],t[0],mult*t[1],acc,depth+1);});return;}
      acc.offset+=mult*values[sd][name];
    }
    raw.forEach(function(r){var acc={offset:r.offset,terms:[]};
      r.sources.forEach(function(t){expand(t[2]==null?r.d:t[2],t[0],t[1],acc,1);});
      var offset=acc.offset,terms=acc.terms.filter(function(t){return t[1]!==0;});
      // a dependent of fixed parameters is a constant: set it once
      if(!terms.length){values[r.d][r.name]=offset;return;}
      links.push({d:r.d,name:r.name,offset:offset,terms:terms,limits:limits(problem,r.name,values[r.d][r.name]).slice()});
    });
    // a globally shared dependent must have the same equation in every holder
    vars.forEach(function(v,j){if(!removed[j] || held[j] || v.d>=0)return;var ds=v.ds && v.ds.length?v.ds:values.map(function(_,d){return d;}),signature=null;
      ds.forEach(function(d){var l=links.find(function(l){return l.d===d && l.name===v.name;});var sig=l?JSON.stringify([l.offset,l.terms]):'const:'+values[d][v.name];if(signature!==null && sig!==signature)throw new Error('Constraint sharing conflict for '+v.name+': use the same global/local sharing for all members of this relationship.');signature=sig;});
    });
    links.forEach(function(l){if(l.terms.length===1){var t=l.terms[0],lo=(l.limits[0]-l.offset)/t[1],hi=(l.limits[1]-l.offset)/t[1],lim=varLimits[t[0]];lim[0]=Math.max(lim[0],Math.min(lo,hi));lim[1]=Math.min(lim[1],Math.max(lo,hi));if(lim[0]>lim[1])throw new Error('Incompatible constraint bounds for '+l.name+'.');}});
    function apply(vals,x){links.forEach(function(l){var v=l.offset;l.terms.forEach(function(t){v+=t[1]*x[t[0]];});vals[l.d][l.name]=v;});return vals;}
    function valid(vals){return checks.every(function(l){var v=vals[l.d][l.name],e=1e-10*(1+Math.abs(v));return Number.isFinite(v)&&v>=l.limits[0]-e&&v<=l.limits[1]+e;});}
    var start=free.map(function(v){return values[v.d>=0?v.d:v.ds && v.ds.length?v.ds[0]:0][v.name];});apply(values,start);
    return {vars:free,values:values,links:links,limits:varLimits,names:constrained,warnings:warnings,apply:apply,valid:valid};
  }
  function values(phases, vals, datasets, prefer){return prepare({phases:phases,values:vals,datasets:datasets},prefer).values;}

  /* What each constrained parameter of a phase does in one dataset with its refine flags fit ({name: bool}):
     {name: {role: 'held'|'independent'|'dependent'|'term', text}} for the Parameters panel. */
  function sumInfo(ph,c,problem,values) {
    var names=c.atoms.map(function(a){return ph.key+'.'+a+'.'+c.component;}),lo=0,hi=0,free=0;
    names.forEach(function(n,i){var lim=limits(problem || {},n,(values || ph.v || {})[n]),m=c.mult[i];if(lim[1]>lim[0])free++;lo+=m>0?m*lim[0]:m*lim[1];hi+=m>0?m*lim[1]:m*lim[0];});
    var tol=1e-10*Math.max(1,Math.abs(c.total));
    return {names:names,noFreedom: free<2 || Number.isFinite(lo) && Math.abs(c.total-lo)<=tol || Number.isFinite(hi) && Math.abs(c.total-hi)<=tol};
  }
  function roles(ph, fit) {
    var out={};fit=fit || {};
    normalizeAll(ph.constraints).forEach(function(c){
      var names=c.atoms.map(function(a){return ph.key+'.'+a+'.'+c.component;}), t=text(c);
      if(c.kind==='hold'){names.forEach(function(n){out[n]={role:'held',ignore:true,text:'Held (GSAS-II hold): not refined'};});return;}
      if(c.kind==='equiv'){out[names[0]]={role:'independent',text:'Independent parameter of: '+t};
        names.slice(1).forEach(function(n,i){var m=c.mult[i+1];out[n]={role:'dependent',ignore:true,editable:true,follows:{name:names[0]},text:'= '+(m===1?'':fmtMult(m)+' × ')+c.atoms[0]+'.'+c.component+' (equivalence); its refine flag is ignored'};});return;}
      var ticked=names.filter(function(n){return !!fit[n];}), dep=ticked.length?ticked[ticked.length-1]:null;
      names.forEach(function(n){out[n]=n===dep?{role:'dependent',text:'Dependent term of '+t+' (computed from the others)'}:{role:'term',text:(fit[n]?'Refined':'Fixed')+' term of '+t};out[n].sum=c;out[n].group=names;});
    });
    return out;
  }

  /* the relationships without the atom label: equivalences re-referenced, groups too small dropped. A constraint
     equation is dropped whole (its total no longer means the same without a term); its text goes to dropped. */
  function withoutAtom(list, lbl, dropped) {
    var out=[];
    normalizeAll(list).forEach(function(c){
      var i=c.atoms.indexOf(lbl);if(i<0){out.push(c);return;}
      if(c.kind==='sum'){if(dropped)dropped.push(text(c));return;}
      if(c.kind==='equiv' && i===0 && c.atoms.length>2){var m1=c.mult[1];c.atoms.shift();c.mult.shift();c.mult=c.mult.map(function(m,k){return k===0?1:m/m1;});out.push(c);return;}
      c.atoms.splice(i,1);if(c.mult)c.mult.splice(i,1);
      if(c.atoms.length>=(c.kind==='hold'?1:2))out.push(c);
    });
    return out;
  }
  /* The relationships of ph that still hold after its atoms changed (a site, the space group, a label):
     terms on atoms that no longer exist, or on coordinates now fixed by site symmetry, are removed.
     Returns {constraints, dropped: [text of what was removed]}. */
  function prune(ph) {
    var list=normalizeAll(ph.constraints), dropped=[], guard=0;
    for(;;){
      var bad=null;
      for(var k=0;k<list.length && !bad;k++){
        var c=list[k];
        for(var i=0;i<c.atoms.length;i++){
          var at=(ph.atoms || []).find(function(a){return a.label===c.atoms[i];});
          if(!at || ('xyz'.indexOf(c.component)>=0 && (!at.site || at.site.free.indexOf('xyz'.indexOf(c.component))<0))){bad={k:k,label:c.atoms[i],before:text(c)};break;}
        }
      }
      if(!bad || ++guard>200)break;
      var c0=list[bad.k], rest=list.filter(function(_,i){return i!==bad.k;}), kept=withoutAtom([c0],bad.label);
      dropped.push(c0.kind==='sum'?bad.before+' dropped: without '+bad.label+'.'+c0.component+' its total no longer applies; re-enter it for the remaining atoms if wanted':bad.label+'.'+c0.component+' removed from: '+bad.before+(kept.length?'':' (relationship dropped)'));
      list=rest.slice(0,bad.k).concat(kept,rest.slice(bad.k));
    }
    return {constraints:list,dropped:dropped};
  }
  return {definitions:definitions,prepare:prepare,values:values,clone:clone,normalize:normalize,normalizeAll:normalizeAll,text:text,label:label,
          roles:roles,sumInfo:sumInfo,withoutAtom:withoutAtom,prune:prune,limits:limits,COMPONENTS:COMPONENTS};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AtomicConstraints;
