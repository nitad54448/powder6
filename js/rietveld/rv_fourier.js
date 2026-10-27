/* Fourier maps in the Structure tab (js/fourier_map.js), next to the space-group test, charge flipping and the Wyckoff
 * search: the same phase and dataset (WPPF intensities, chosen at the top of Structure), the atoms of the model for
 * the phases of F. The form is a block of Commands → Structure; the map and its peaks are a result of
 * Results → Structure ("Fourier map"). A map is recomputed on demand and is not kept in projects.
 *   RV.fourier = { html(block), render(), show(), state }
 */
RV.fourier = (function(){
  'use strict';
  var St=RV.state,S=St.S,ui=RV.ui,esc=ui.esc,FM=FourierMap;
  var TYPES=[['diff','Difference  Fo − Fc  (what the model lacks)'],['obs','Observed  Fo  (all the atoms)'],['2fofc','2 Fo − Fc'],['calc','Calculated  Fc  (the model itself)']];
  var saved=St.load('fourier')||{};
  var FO={opts:{type:saved.type||'diff',dmin:saved.dmin||'',fine:saved.fine!==false,from:saved.from||'dataset',level:saved.level>0?saved.level:3,minSigma:saved.minSigma>0?saved.minSigma:4,negative:false,cell:saved.cell!==false,atoms:saved.atoms!==false},result:null};
  function $(q){return document.querySelector(q);}
  function SV(){return RV.solve.state;}
  function saveOpts(){var o=FO.opts;St.store('fourier',{type:o.type,dmin:o.dmin,fine:o.fine,from:o.from,level:o.level,minSigma:o.minSigma,cell:o.cell,atoms:o.atoms});}
  var HELP={block:'A Fourier map from the WPPF intensities of the phase and dataset chosen above, with the phases of the atoms of the model: a difference map shows where the model lacks electron density (or scattering length) and where it has too much, the observed map the atoms the data support. A powder line holds several reflections, so each overlap group is shared among them in proportion to the calculated intensities; the map is only as good as that sharing and the model. It works for one phase, with one dataset or the one you choose in Structure.',
    type:'The phases always come from the model.',dmin:'Blank: the smallest d of the extracted reflections.',fine:'Twice as many points per axis: smoother maps and better peak positions, a little slower.',from:'Which values of the atoms give the phases of F.',minSigma:'Peaks weaker than this, in standard deviations of the map, are not listed. Peaks of 3σ or less are usually noise in a powder map.'};
  function row(key,label,control,help){return '<label for="f_'+key+'" title="'+esc(help)+'">'+esc(label)+'</label><div>'+control+'</div>';}
  function typeLabel(t){return (TYPES.filter(function(x){return x[0]===t;})[0]||[t,t])[1].split('  ')[0].trim();}

  // ---------------------------------------------------------------- the form (Commands → Structure)
  function html(block){
    var o=FO.opts;
    var form='<div class="form-grid sv-form">'+
        row('fo-type','Map','<select id="f_fo-type" data-key="fo-type" title="'+esc(HELP.type)+'">'+TYPES.map(function(t){return '<option value="'+t[0]+'"'+(t[0]===o.type?' selected':'')+'>'+esc(t[1])+'</option>';}).join('')+'</select>',HELP.type)+
        row('fo-dmin','Resolution d (Å)','<input id="f_fo-dmin" data-key="fo-dmin" class="num" value="'+esc(o.dmin)+'" placeholder="Auto" inputmode="decimal" autocomplete="off" title="'+esc(HELP.dmin)+'">',HELP.dmin)+
        row('fo-minsigma','Peaks above (σ)','<input id="f_fo-minsigma" data-key="fo-minsigma" class="num" value="'+esc(String(o.minSigma))+'" inputmode="decimal" autocomplete="off" title="'+esc(HELP.minSigma)+'">',HELP.minSigma)+
        row('fo-fine','Finer grid','<input type="checkbox" id="f_fo-fine" data-key="fo-fine"'+(o.fine?' checked':'')+' title="'+esc(HELP.fine)+'">',HELP.fine)+
        row('fo-from','Atoms from','<select id="f_fo-from" data-key="fo-from" title="'+esc(HELP.from)+'"><option value="dataset"'+(o.from==='dataset'?' selected':'')+'>the dataset (its current values)</option><option value="model"'+(o.from==='model'?' selected':'')+'>the starting model of the phase</option></select>',HELP.from)+
      '</div>'+
      '<p class="buttons sv-actions"><button type="button" class="primary" data-fo="run">Compute the map</button></p><p class="hint" id="sv-fo-status" role="status"></p>';
    var map=block('fo-map','Map',
      '<p class="hint" id="sv-fo-none">Compute a Fourier map to see it here.</p>'+
      '<section class="cf-density" id="sv-fo-density" hidden>'+
        '<div class="buttons"><label>Isosurface / σ <input class="num" id="sv-fo-level" data-key="fo-level" type="number" min="0.2" max="20" step="0.2" value="'+esc(String(o.level))+'" aria-label="Isosurface in sigma"></label>'+
          '<label class="chk" id="sv-fo-neg-l"><input type="checkbox" data-key="fo-negative"> Holes (negative)</label>'+
          '<label class="chk"><input type="checkbox" data-key="fo-cell"'+(o.cell?' checked':'')+'> Unit cell</label>'+
          '<label class="chk"><input type="checkbox" data-key="fo-atoms"'+(o.atoms?' checked':'')+'> Atoms</label>'+
          '<button type="button" data-fo="reset" hidden>Reset view</button><button type="button" data-fo="png">Save PNG</button><button type="button" data-fo="save">Save map</button></div>'+
        '<canvas id="sv-fo-canvas" class="density-canvas" aria-label="Fourier map isosurface. Drag to rotate and wheel to zoom."></canvas><p class="hint" id="sv-fo-note"></p></section>',true,null,'sub');
    var peaks=block('fo-peaks','Peaks','<div id="sv-fo-peaks"><p class="hint">No map yet.</p></div>',true,'id="sv-fo-peaks-n"','sub');
    // the help of the block belongs in the question mark at the right of its title, like the blocks above it
    return block('wppf-fo','Fourier map',form+map+peaks,false,'id="sv-fo-sum"',null,{text:HELP.block,label:'About Fourier maps'});
  }

  // ---------------------------------------------------------------- the calculation
  function atomsOf(ph,v){
    return ph.atoms.map(function(at){
      var pre=ph.key+'.'+at.label+'.',u=['x','y','z'].map(function(c){return v[pre+c];}),f=St.scatterer(at.type);
      if(u.some(function(x){return !Number.isFinite(x);}))throw new Error('No coordinates for '+at.label+'.');
      return {label:at.label,type:at.type,pos:RVCore.sitePosition(at.site,u),occ:Number.isFinite(v[pre+'occ'])?v[pre+'occ']:1,B:Number.isFinite(v[pre+'B'])?v[pre+'B']:0.5,ff:{xray:f.xray,neutron:f.neutron}};
    });
  }
  function status(msg,bad){var e=$('#sv-fo-status');if(e){e.textContent=msg||'';e.classList.toggle('sv-warn',!!bad);}}
  // Why the map cannot be computed now, or '' when it can: the two halves of its input are the atoms of the
  // phase (they give the phases of F) and its WPPF intensities. The button says which is missing instead of
  // being pressed into an error the form already knew about.
  function blocker(){
    var sv=SV(),ph=St.phaseByKey(sv.phaseKey),ds=St.byId(sv.dsId),I=sv.ints;
    if(!ph||!ds)return 'Choose a phase and a dataset above.';
    if(!ph.atoms.length)return ph.name+' has no atoms: a Fourier map takes its phases from the model. Add atoms, or solve the structure first.';
    if(!I||I.stale||I.phaseKey!==ph.key||I.dsId!==ds.id)return 'No WPPF intensities for '+ph.name+' in '+ds.name+': fit it by WPPF first (they are prepared automatically).';
    return '';
  }
  function sync(){var b=$('[data-fo="run"]');if(b)ui.able(b,blocker());}
  function run(){
    if(S.busy){sync();return;}
    var why=blocker();
    if(why){status(why,true);sync();return;}
    var sv=SV(),ph=St.phaseByKey(sv.phaseKey),ds=St.byId(sv.dsId),I=sv.ints;
    var o=FO.opts,v=o.from==='dataset'&&St.hasPhase(ds,ph)&&ph.atoms.every(function(a){return Number.isFinite(ds.p[ph.key+'.'+a.label+'.x']);})?ds.p:ph.v,res;
    var inRange=I.refl.filter(function(r){return r.inRange&&Number.isFinite(r.area);});
    var dmin=ui.parseNum(o.dmin);if(!(dmin>0))dmin=Math.max(0.5,Math.min.apply(null,inRange.map(function(r){return r.d;}).filter(function(d){return d>0;})));
    try{
      res=FM.build({cell:I.cell,ops:I.ops,atoms:atomsOf(ph,v),radiation:I.radiation||'xray',formFactor:RVCore.formFactor,refl:I.refl,type:o.type,dmin:dmin,oversample:o.fine?2:1,minSigma:o.minSigma});
    }catch(e){status(e.message,true);return;}
    FO.result={res:res,phaseKey:ph.key,phaseName:ph.name,dsName:ds.name,dsId:ds.id,type:o.type,radiation:I.radiation||'xray',cell:I.cell,ops:I.ops,atoms:atomsOf(ph,v),from:v===ds.p?ds.name:'starting model',neg:null};
    status('Map computed: '+res.N+'³ points, '+res.nRefl+' reflections to '+res.dmin.toFixed(2)+' Å ('+res.nObs+' with observed intensity).'+(res.notes.length?' '+res.notes.join(' '):''));
    render();
    if(RV.layout&&RV.layout.structureKind()!=='fo')RV.layout.structureResult('fo');else show();
  }

  // ---------------------------------------------------------------- the results
  function unit(R){return R.radiation==='neutron'?'fm/Å³':'e/Å³';}
  function peaksHTML(R){
    var res=R.res;
    if(!res.peaks.length)return '<p class="hint">No peak above '+R.res.minSigma+' σ in the '+esc(typeLabel(R.type))+' map.'+(R.type==='diff'?' The model accounts for the data at this resolution.':'')+'</p>';
    var rows=res.peaks.map(function(p,i){
      return '<tr><td>'+(p.sign>0?'+':'−')+'</td><td class="n">'+[p.x,p.y,p.z].map(function(x){return x.toFixed(4);}).join('</td><td class="n">')+'</td><td class="n">'+Math.abs(p.sigmas).toFixed(1)+'</td><td class="n">'+p.height.toFixed(2)+'</td><td>'+esc(p.atom||'')+'</td><td class="n">'+p.distance.toFixed(2)+'</td><td class="n">'+p.copies+'</td><td>'+(p.sign>0?'<button type="button" class="mini" data-fo-add="'+i+'">Add atom…</button>':'')+'</td></tr>';
    }).join('');
    return '<p class="buttons"><button type="button" data-fo="peaks">Save peaks</button></p><div class="table-wrap"><table class="grid compact"><thead><tr><th></th><th>x</th><th>y</th><th>z</th><th>σ</th><th>Height ('+unit(R)+')</th><th>Nearest atom</th><th>d (Å)</th><th>Copies</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<p class="hint">Peaks of the '+esc(typeLabel(R.type))+' map above '+R.res.minSigma+' σ, one per set of symmetry-equivalent positions (Copies: how many were found). Heights are approximate: the observed amplitudes are put on the scale of Fc by one factor. A positive peak of a difference map far from every atom (≳ 1 Å) is a candidate atom: Add atom… puts it into the phase with the scatterer you name, on its special position if it is on one. Negative peaks mark atoms that are too heavy, misplaced or have too large an occupancy.</p>';
  }
  function render(){
    var R=FO.result,none=$('#sv-fo-none'),host=$('#sv-fo-density'),peaks=$('#sv-fo-peaks'),sum=$('#sv-fo-sum'),n=$('#sv-fo-peaks-n');
    if(!none&&!peaks)return;
    sync();
    if(!R){if(none)none.hidden=false;if(host)host.hidden=true;if(peaks)peaks.innerHTML='<p class="hint">No map yet.</p>';if(sum)sum.textContent='';if(n)n.textContent='';return;}
    if(none)none.hidden=true;if(host)host.hidden=false;
    if(peaks)peaks.innerHTML=peaksHTML(R);
    if(sum)sum.textContent=typeLabel(R.type)+', '+R.res.peaks.length+(R.res.peaks.length===1?' peak':' peaks');
    if(n)n.textContent=R.res.peaks.length?R.res.peaks.length+' above '+R.res.minSigma+' σ':'';
    var neg=$('#sv-fo-neg-l');if(neg)neg.hidden=R.type!=='diff';
    show();
  }
  function mapOf(R){
    if(!FO.opts.negative||R.type!=='diff')return R.res.map;
    if(!R.neg){R.neg=new Float32Array(R.res.map.length);for(var i=0;i<R.neg.length;i++)R.neg[i]=-R.res.map[i];}
    return R.neg;
  }
  function sites(R){
    var out=[];
    R.atoms.forEach(function(a,j){FM.orbit(R.ops,a.pos).forEach(function(p){out.push({rank:j+1,x:p[0],y:p[1],z:p[2],relative:1});});});
    return out;
  }
  // draws the map when it is on screen (Results → Structure → Fourier map, block open)
  function show(){
    var R=FO.result,canvas=$('#sv-fo-canvas');
    if(!R||!canvas||!RV.app||RV.app.resultTab()!=='structure-results'||RV.layout.structureKind()!=='fo'||!(RV.acc&&RV.acc.isShown(canvas)))return;
    var note=$('#sv-fo-note');
    if(typeof Density3D==='undefined'){if(note)note.textContent='The density viewer (js/density3d.js) is missing.';return;}
    try{
      if(!Density3D.init(canvas))throw new Error('The density canvas is unavailable.');
      var info=Density3D.show({map:mapOf(R),gridSize:R.res.N,cell:R.cell,sigmaLevel:FO.opts.level,stride:1,showCell:FO.opts.cell,showSites:FO.opts.atoms,sites:sites(R)});
      if(note)note.textContent=R.phaseName+' in '+R.dsName+' · '+typeLabel(R.type)+(FO.opts.negative&&R.type==='diff'?' (negative)':'')+' · atoms from '+R.from+' · '+R.res.N+'³ points · '+(info?info.triangles+' triangles':'')+' · σ = '+R.res.sigma.toFixed(3)+' '+unit(R)+'. Drag to rotate, wheel to zoom.';
    }catch(e){if(note)note.textContent='Map display: '+e.message;}
  }
  function saveMap(){
    var R=FO.result;if(!R)return;
    ui.download('fourier_'+R.type+'_'+ui.fileStamp()+'.json',JSON.stringify({format:'powder6-density',version:1,kind:'fourier-'+R.type,phase:R.phaseName,dataset:R.dsName,gridSize:R.res.N,cell:R.cell,axisOrder:'x-fastest: x + N*(y + N*z)',unit:unit(R),sigma:R.res.sigma,map:Array.from(R.res.map)},null,2),'application/json');
  }
  // the peak list as CSV: sign, fractional x y z, height in sigma and in e/A^3 (fm/A^3), nearest atom, its distance, copies
  function savePeaks(){
    var R=FO.result;if(!R||!R.res.peaks.length)return;
    var rows=[['sign','x','y','z','sigma','height ('+unit(R)+')','nearest atom','distance (A)','copies']].concat(R.res.peaks.map(function(p){return [p.sign>0?'+':'-',p.x.toFixed(5),p.y.toFixed(5),p.z.toFixed(5),Math.abs(p.sigmas).toFixed(2),p.height.toFixed(4),p.atom||'',p.distance.toFixed(3),p.copies];}));
    ui.download('fourier_peaks_'+R.type+'_'+ui.fileStamp()+'.csv',rows.map(function(r){return r.map(function(c){c=String(c);return /[",\r\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c;}).join(',');}).join('\r\n')+'\r\n','text/csv');
  }
  async function addAtom(i){
    var R=FO.result,p=R&&R.res.peaks[i],ph=R&&St.phaseByKey(R.phaseKey);
    if(!p||!ph||S.busy)return;
    var used=new Set(ph.atoms.map(function(a){return a.label;})),k=ph.atoms.length+1;while(used.has('X'+k))k++;
    var v=await ui.prompt('Add the peak to '+ph.name,[
      {key:'label',label:'Label',type:'text',value:'X'+k},{key:'type',label:'Scatterer',type:'text',value:'O',list:'scat-list',hint:'Element or ion of the scattering table: the peak cannot say which.'},
      {key:'x',label:'x',type:'number',value:+p.x.toFixed(4)},{key:'y',label:'y',type:'number',value:+p.y.toFixed(4)},{key:'z',label:'z',type:'number',value:+p.z.toFixed(4)},
      {key:'occ',label:'Occupancy',type:'number',value:1},{key:'B',label:'B /Å²',type:'number',value:0.5}],'Add atom',
      'Peak of '+p.sigmas.toFixed(1)+' σ, '+p.distance.toFixed(2)+' Å from '+(p.atom||'the nearest atom')+'. The site is worked out from the position; refine its occupancy and B afterwards.');
    if(!v)return;
    var ds=St.byId(R.dsId),src=ds&&St.hasPhase(ds,ph)?ds.p:ph.v;
    RV.history.take('adding a Fourier peak to '+ph.name);
    var label=St.addAtomTo(ph,{label:v.label,type:v.type.trim()||'O',x:v.x,y:v.y,z:v.z,occ:v.occ,B:v.B},St.cellOf(ph,src));
    St.phaseChanged(ph);
    var at=ph.atoms.filter(function(a){return a.label===label;})[0];
    ui.toast('Atom '+label+' added to '+ph.name+' on '+at.site.wyck+' ('+at.site.expr+'). Compute the map again to see what is left.','ok');
  }

  // ---------------------------------------------------------------- events
  function onClick(e){
    var b=e.target.closest('[data-fo]'),a=e.target.closest('[data-fo-add]');
    if(a){addAtom(+a.getAttribute('data-fo-add'));return;}
    if(!b)return;
    switch(b.getAttribute('data-fo')){
      case 'run':run();break;
      case 'reset':if(typeof Density3D!=='undefined')Density3D.resetView();break;
      case 'png':{var cv=$('#sv-fo-canvas');if(cv){var l=document.createElement('a');l.href=cv.toDataURL('image/png');l.download='fourier_'+ui.fileStamp()+'.png';l.click();}break;}
      case 'save':saveMap();break;
      case 'peaks':savePeaks();break;
    }
  }
  function onChange(e){
    var t=e.target,k=t.getAttribute&&t.getAttribute('data-key');if(!k||k.indexOf('fo-')!==0)return;
    var o=FO.opts;
    switch(k){
      case 'fo-type':o.type=t.value;break;
      case 'fo-dmin':o.dmin=t.value.trim();break;
      case 'fo-minsigma':{var m=ui.parseNum(t.value);if(m>0)o.minSigma=m;else t.value=String(o.minSigma);break;}
      case 'fo-fine':o.fine=t.checked;break;
      case 'fo-from':o.from=t.value;break;
      case 'fo-level':{var v=ui.parseNum(t.value);if(v>0)o.level=v;else t.value=String(o.level);show();break;}
      case 'fo-negative':o.negative=t.checked;show();return;
      case 'fo-cell':o.cell=t.checked;show();break;
      case 'fo-atoms':o.atoms=t.checked;show();break;
    }
    saveOpts();
  }
  function reset(){FO.result=null;FO.opts.negative=false;render();var note=$('#sv-fo-status');if(note)note.textContent='';}
  function init(){
    document.addEventListener('click',onClick);document.addEventListener('change',onChange);
    RV.bus.on('tab',function(){if(RV.app.resultTab()==='structure-results'&&RV.layout.structureKind()==='fo')show();});
    RV.bus.on('theme',function(){if(typeof Density3D!=='undefined'&&FO.result&&RV.layout.structureKind()==='fo')Density3D.applyTheme();});
    RV.bus.on('project',reset);
    RV.bus.on('phases',function(){if(FO.result&&!St.phaseByKey(FO.result.phaseKey)){FO.result=null;render();}});
    // the button says what is missing: the atoms of the phase, or its WPPF intensities. Both change with the
    // data (an atom added, a fit, another phase or dataset chosen), so the state follows those events.
    ['phases','params','stats','datasets','selection','tables'].forEach(function(ev){RV.bus.on(ev,function(){sync();});});
  }
  return {init:init,reset:reset,html:html,render:render,show:show,state:FO,run:run,sync:sync};
})();
