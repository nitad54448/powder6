/*  The Pattern tab: observed points, calculated pattern, background (with the anchors of a spline background), the
 *  contribution of each phase and its row of reflection ticks, the excluded regions, and below them the difference
 *  curve, for the selected datasets (thinned out evenly to "datasets drawn at most", as in Yappari). Phase curves and reflection positions are drawn for every plotted dataset. Only drawn while the tab is open; otherwise
 *  marked out of date. Ctrl+click and Ctrl+Shift+drag edit the anchors and the regions of the first selected dataset
 *  (RV.cmd.markAt, RV.cmd.regionAt). Right-drag moves any visible background anchor.
 */
RV.plots = (function () {
  'use strict';
  var S = RV.state.S, P = {}, dirty = true, raf = 0, needAuto = true, shown = false;
  var anchorFocus = null, anchorDrag = null;
  function $(s) { return document.querySelector(s); }
  var esc = RV.ui.esc;
  // dataset colours from --series-k, phase colours from --phase-k (powder6.css)
  function color(ds) { var p = RV.theme.get().series; return p[(ds.id - 1) % p.length]; }
  function colorVar(ds) { return RV.theme.seriesVar(ds.id - 1); }
  function phaseColor(i) { if (S.phases[i] && /^#[0-9a-f]{6}$/i.test(S.phases[i].color || '')) return S.phases[i].color; var p = RV.theme.get().phases; return p[i % p.length]; }
  function phaseVar(i) { return S.phases[i] && S.phases[i].color ? phaseColor(i) : RV.theme.phaseVar(i); }
  function phaseIndex(key) { for (var i = 0; i < S.phases.length; i++) if (S.phases[i].key === key) return i; return 0; }
  function fmtI(v) { if (!Number.isFinite(v)) return '—'; var a = Math.abs(v); return a >= 1e6 || (a < 1e-2 && a > 0) ? v.toExponential(3) : String(+v.toPrecision(6)); }
  function dOf(ds, tth) { return ds.inst.lambda1 / (2 * Math.sin(tth * Math.PI / 360)); }

  function plotted() {
    var sel = RV.state.selected(), n = sel.length, m = Math.max(1, S.settings.maxPlots | 0);
    if(S.settings.plotMode==='focus')return RV.state.first()?[RV.state.first()]:[];
    if(S.settings.plotMode==='overview')return sel;
    if (n <= m) return sel;
    var out = [];
    for (var i = 0; i < m; i++) out.push(sel[Math.round(i * (n - 1) / (m - 1 || 1))]);
    return out;
  }
  function legendIndices(n) { var a=[]; for(var i=0;i<Math.min(n,8);i++)a.push(n<=8 ? i : Math.round(i*(n-1)/7)); return a; }
  function backgroundAt(ds,t) {
    var c=RV.state.calcFor(ds); if(!c || !c.tth.length || t<c.tth[0] || t>c.tth[c.tth.length-1])return NaN;
    var i=lowerBound(c.tth,t); if(i===0)return c.bkg[0]; if(i>=c.tth.length)return c.bkg[c.bkg.length-1];
    var f=(t-c.tth[i-1])/(c.tth[i]-c.tth[i-1]); return c.bkg[i-1]+f*(c.bkg[i]-c.bkg[i-1]);
  }
  function pick(a, idx) { var o = new Float64Array(idx.length); for (var i = 0; i < idx.length; i++) o[i] = a[idx[i]]; return o; }
  function indexIn(arr, t) { var j = lowerBound(arr, t); return j < arr.length && arr[j] === t ? j : -1; }

  // ---------------------------------------------------------------- tooltips
  function tipObs(s, i) {
    var ds = s.ds, k = s.idx[i], t = ds.tth[k], yo = ds.y[k], c = RV.state.calcFor(ds);
    var sub = S.settings.noBackground && c ? '<br>Displayed I − background = '+fmtI(yo-backgroundAt(ds,t)) : '';
    var h = '<b>' + esc(ds.name) + '</b>' + (s.out ? ' <i>outside the fitted range</i>' : '') +
            '<br>2θ = ' + t.toFixed(4) + '°, d = ' + dOf(ds, t).toFixed(5) + ' Å<br>I obs = ' + fmtI(yo);
    var j = c && !s.out ? indexIn(c.tth, t) : -1;
    if (j >= 0) h += ', calc = ' + fmtI(c.ycalc[j]) + '<br><span class="muted">background ' + fmtI(c.bkg[j]) + ', obs − calc ' + fmtI(yo - c.ycalc[j]) + '</span>';
    return h+sub;
  }
  function tipDiff(s, i) {
    var c = s.calc, t = c.tth[i];
    return '<b>' + esc(s.ds.name) + '</b><br>2θ = ' + t.toFixed(4) + '°<br>obs − calc = ' + fmtI(c.yobs[i] - c.ycalc[i]) +
           (c.yobs[i] > 0 ? ' <span class="muted">(' + ((c.yobs[i] - c.ycalc[i]) / Math.sqrt(c.yobs[i])).toFixed(2) + ' σ)</span>' : '');
  }
  function tipTick(s, i) {
    var r = s.refl[i], m = s.phase.method, h = '<b>' + esc(s.phase.name) + '</b> (' + r.h + ' ' + r.k + ' ' + r.l + ')' + (s.ds && plotted().length > 1 ? ' <span class="muted">in ' + esc(s.ds.name) + '</span>' : '') +
           '<br>2θ = ' + r.tth.toFixed(4) + '°, d = ' + r.d.toFixed(5) + ' Å<br>m = ' + r.m;
    if (m === 'rietveld') return h + ', |F|² = ' + fmtI(r.F2) + (Number.isFinite(r.Icalc) && r.Icalc > 0 ? '<br>I calc = ' + fmtI(r.Icalc) + (Number.isFinite(r.Iobs) ? ', I obs = ' + fmtI(r.Iobs) : '') : '');
    return h + '<br>I = ' + fmtI(m === 'lebail' ? r.Iext : r.Icalc) + (r.sigma > 0 ? ' ± ' + fmtI(r.sigma) : '') + ' <span class="muted">(' + RV.state.methodLabel(m) + ')</span>' +
           (r.group >= 0 ? '<br><span class="muted">exactly overlapped by another reflection: only their sum is determined</span>' : '') +
           (r.bound ? '<br><span class="muted">held at zero by the non-negativity of WPPF</span>' : '');
  }
  function tipAnchor(s, i) {
    var x = s.x[i];
    return '<b>' + esc(s.ds.name) + '</b>, background anchor ' + (s.idxs[i] + 1) + '<br>2θ = ' + x.toFixed(4) + '°, background ' + fmtI(s.y[i]) +
           '<br>' + (s.ds.fit['bga'+s.idxs[i]] ? 'Refinable' : 'Fixed during refinement') + '<br><span class="muted">Right-drag to move; Ctrl+click to remove</span>';
  }
  function tooltip(s, i) { return s.kind === 'tick' ? tipTick(s, i) : s.kind === 'diff' ? tipDiff(s, i) : s.kind === 'anchor' ? tipAnchor(s, i) : tipObs(s, i); }

  // ---------------------------------------------------------------- series
  // for each phase, the first dataset of the list that holds it and has a calculated pattern (null: none)
  function phaseSources(list) {
    return S.phases.map(function (ph) {
      return list.filter(function (ds) { return RV.state.hasPhase(ds, ph) && RV.state.calcFor(ds); })[0] || null;
    });
  }
  function build(list) {
    var T = RV.theme.get(), st = S.settings, main = [], diff = [], one = list.length === 1, named = legendIndices(list.length);
    if(st.plotMode==='overview' && list.length>1){
      list.forEach(function(ds,n){var x=[],y=[],step=Math.max(1,Math.ceil(ds.tth.length/700)),lo=Infinity,hi=-Infinity;for(var i=0;i<ds.y.length;i++){lo=Math.min(lo,ds.y[i]);hi=Math.max(hi,ds.y[i]);}for(var i=0;i<ds.tth.length;i+=step){var top=i;for(var j=i+1;j<Math.min(ds.y.length,i+step);j++)if(ds.y[j]>ds.y[top])top=j;x.push(ds.tth[top]);y.push(n+.8*(ds.y[top]-lo)/Math.max(1,hi-lo));}main.push({name:ds.name,group:'ds'+ds.id,x:x,y:y,color:color(ds),mode:'lines',width:1,legend:named.includes(n),ds:ds});});
      return {main:main,diff:diff};
    }
    // the excluded regions of the first dataset drawn (where the anchors and regions are edited), as shaded bands
    var ex = list.length ? (list[0].inst.excl || []) : [];
    if (ex.length) {
      var xs = new Float64Array(ex.length * 2);
      ex.forEach(function (r, k) { xs[2 * k] = r[0]; xs[2 * k + 1] = r[1]; });
      main.push({ name: 'Excluded', group: 'excl', x: xs, y: new Float64Array(xs.length), color: T.excluded, mode: 'shade', noAuto: true });
      diff.push({ name: 'Excluded', group: 'excl', x: xs, y: new Float64Array(xs.length), color: T.excluded, mode: 'shade', noAuto: true });
    }
    var src = phaseSources(list);
    list.forEach(function (ds, n) {
      var col = color(ds), c = RV.state.calcFor(ds), lo = ds.inst.tthMin, hi = ds.inst.tthMax, inI = [], outI = [];
      var preview = anchorDrag && anchorDrag.dsId === ds.id, background = c && c.bkg;
      if (preview && c) {
        var anchors = ds.inst.bkgX.map(function(x,k){return {x:k===anchorDrag.index?anchorDrag.x:x,y:k===anchorDrag.index?anchorDrag.y:ds.p['bga'+k]};}).sort(function(a,b){return a.x-b.x;});
        if (anchors.every(function(a,k){return !k || a.x>anchors[k-1].x;})) background = RVCore.splineValues(c.tth,anchors.map(function(a){return a.x;}),anchors.map(function(a){return a.y;}));
      }
      for (var k = 0; k < ds.tth.length; k++) (ds.tth[k] >= lo && ds.tth[k] <= hi ? inI : outI).push(k);
      main.push({ name: ds.name, group: 'ds' + ds.id, x: pick(ds.tth, inI), y: Float64Array.from(inI,function(k){return st.noBackground ? c ? ds.y[k]-backgroundAt(ds,ds.tth[k]) : NaN : ds.y[k];}), color: col, mode: 'markers', size: 2.6,
                  hover: true, legend: named.indexOf(n)>=0, ds: ds, idx: inI, kind: 'obs' });
      if (outI.length) main.push({ name: ds.name, group: 'ds' + ds.id, x: pick(ds.tth, outI), y: Float64Array.from(outI,function(k){return st.noBackground ? c ? ds.y[k]-backgroundAt(ds,ds.tth[k]) : NaN : ds.y[k];}), color: col, mode: 'markers',
                                   size: 2.6, hollow: true, alpha: 0.5, noAuto: true, hover: true, ds: ds, idx: outI, kind: 'obs', out: true });
      if (!c) return;
      main.push({ name: 'Calculated', group: 'calc', x: c.tth, y: st.noBackground ? Float64Array.from(c.ycalc,function(y,k){return y-c.bkg[k];}) : preview ? Float64Array.from(c.ycalc,function(y,k){return y-c.bkg[k]+background[k];}) : c.ycalc, color: one ? T.calc : col, mode: 'lines', width: 1.5, legend: n === 0 });
      if (st.showBkg && !st.noBackground) main.push({ name: 'Background', group: 'bkg', x: c.tth, y: background, color: one ? T.bkg : col, mode: 'lines', width: 1.1, dash: [6, 4], legend: n === 0 });
      if (st.showAnchors && !st.noBackground && ds.inst.bkgType === 'spline' && ds.inst.bkgX.length) {
        [true,false].forEach(function(fit){
          var ax=[],ay=[],ai=[];
          ds.inst.bkgX.forEach(function(x,k){var v=ds.p['bga'+k];if(!!ds.fit['bga'+k]!==fit || !Number.isFinite(v))return;if(preview && k===anchorDrag.index){x=anchorDrag.x;v=anchorDrag.y;}ax.push(x);ay.push(v);ai.push(k);});
          main.push({name:fit?'Refinable anchors':'Fixed anchors',group:'bkg',x:Float64Array.from(ax),y:Float64Array.from(ay),idxs:ai,color:fit?T.anchorRefinable:T.anchorFixed,mode:'markers',size:6.5,
                     hollow:!fit,lineWidth:1.5,hover:true,noAuto:true,ds:ds,kind:'anchor'});
        });
      }
      var active=preview?anchorDrag:anchorFocus;
      if(active && active.dsId===ds.id && active.index<ds.inst.bkgX.length){
        var ax=preview?active.x:ds.inst.bkgX[active.index],ay=preview?active.y:ds.p['bga'+active.index];
        main.push({name:'Active background anchor',group:'anchor-edit',x:[ax],y:[0],color:T.anchorActive,mode:'vline',noAuto:true,width:1.5});
        if(!st.noBackground)main.push({name:'Active background anchor',group:'anchor-edit',x:[ax],y:[ay],color:T.anchorActive,mode:'markers',noAuto:true,size:9,hollow:true,lineWidth:2});
      }
      S.phases.forEach(function (ph, pi) {
        var part = c.phases[pi];
        if (!part || !RV.state.hasPhase(ds,ph)) return;
        var pc = phaseColor(pi), g = 'ph:' + ph.key;
        if (st.showPhases && S.phases.length) {
          var yy = new Float64Array(c.tth.length);
          for (var q = 0; q < yy.length; q++) yy[q] = (st.noBackground ? 0 : background[q]) + part.y[q];
          main.push({ name: ph.name, group: g, x: c.tth, y: yy, color: pc, mode: 'lines', width: 1.1, dash: [4, 3], legend: src[pi] === ds });
        }
        if (st.showTicks) {
          var refl = part.refl.filter(function (r) { return Number.isFinite(r.tth) && r.tth >= ds.tth[0] && r.tth <= ds.tth[ds.tth.length - 1]; });
          main.push({ name: ph.name, group: g, x: Float64Array.from(refl, function (r) { return r.tth; }), y: new Float64Array(refl.length), refl: refl,
                      phase: ph, ds: ds, color: pc, mode: 'ticks', row: pi, hover: true, legend: src[pi] === ds, kind: 'tick' });
        }
      });
      var dy = new Float64Array(c.tth.length);
      for (var j = 0; j < dy.length; j++) dy[j] = c.yobs[j] - c.ycalc[j] - (preview ? background[j]-c.bkg[j] : 0);
      diff.push({ name: ds.name, group: 'ds' + ds.id, x: c.tth, y: dy, color: one ? T.diff : col, mode: 'lines', width: 1, hover: true, ds: ds, calc: c, kind: 'diff' });
    });
    return { main: main, diff: diff };
  }

  function bandPx() { return S.settings.showTicks && S.phases.length ? S.phases.length * 9 + 7 : 0; }
  function yOpts() {
    if(S.settings.plotMode==='overview' && S.sel.size>1)return {ylog:false,ysqrt:false,ylabel:'Dataset index + normalized intensity'};
    var m = S.settings.yscale; if(S.settings.noBackground && m!=='lin')m='lin';
    return { ylog: m === 'log', ysqrt: m === 'sqrt', ylabel: S.settings.noBackground ? 'Intensity − background /counts' : m === 'sqrt' ? 'Intensity /counts (√ scale)' : m === 'log' ? 'Intensity /counts (log scale)' : 'Intensity /counts' };
  }

  function render() {
    if (!dirty || !shown) return;
    dirty = false;
    var list = plotted(), s = build(list), note = $('#plot-note');
    var anchors=$('#show-anchors'),anchorLabel=anchors.closest('label');
    var anchorWhy=!list.some(function(ds){return ds.inst.bkgType==='spline' && ds.inst.bkgX.length;})?'Anchors are used only by spline backgrounds in the plotted datasets.':
      S.settings.noBackground?'Anchors are hidden while background subtraction is enabled.':
      S.settings.plotMode==='overview' && list.length>1?'Choose Overlay or Inspect one dataset to display spline anchors.':'';
    RV.ui.able(anchors,anchorWhy);anchorLabel.classList.toggle('disabled',!!anchorWhy);anchorLabel.title=anchorWhy || 'Show spline background anchors independently of the background curve.';
    var empty = S.datasets.length ? 'Select one or more datasets' : 'No data yet. Use File, drop files on this window, or type demo in the command line below.';
    P.pat.o.empty = empty;
    P.pat.o.legendMax = 10 + S.phases.length;
    Object.assign(P.pat.o, yOpts(), { band: bandPx() });
    if (needAuto) { needAuto = false; [P.pat, P.diff].forEach(function (p) { p.auto = true; p.hidden.clear(); }); }
    P.pat.resize();
    P.pat.setSeries(s.main, true);
    P.diff.setSeries(s.diff, true);
    if (!P.pat.auto && P.pat.view) P.diff.setXView(P.pat.view.x0, P.pat.view.x1);
    if (note) {
      var bad = list.filter(function (ds) { return !ds.calc && ds.calcErr; })[0], nsel = S.sel.size;
      note.textContent = bad ? bad.name + ': ' + bad.calcErr : nsel > list.length ? 'Showing ' + list.length + ' of ' + nsel + ' fit datasets · use Overview to see the full selection' :
        list.length > 1 && S.settings.showTicks && S.phases.length ? ticksNote(list) : '';
    }
  }
  // where the ticks come from: "Reflection ticks of A", or "Reflection ticks: P1 in A, P2 in B" when the phases differ
  function ticksNote(list) { return 'Each phase row contains reflection positions from all ' + list.length + ' plotted datasets; hover a tick to identify its dataset.'; }
  function refresh(auto) {
    if (auto) needAuto = true;
    dirty = true;
    if (raf || !shown) return;
    raf = requestAnimationFrame(function () { raf = 0; render(); });
  }
  function show(on) {
    shown = on !== false;
    if (shown && dirty && !raf) raf = requestAnimationFrame(function () { raf = 0; P.pat.resize(); P.diff.resize(); render(); });
  }
  function linkX(a, b) {
    a.o.onView = function (v) { b.setXView(v.x0, v.x1); };
    b.o.onView = function (v) { a.setXView(v.x0, v.x1); };
  }
  function autoscale() { [P.pat, P.diff].forEach(function (p) { p.hidden.clear(); p.autoscale(true); }); }
  function exportPNG() {
    var cvs = [P.pat.canvas, P.diff.canvas], w = Math.max(cvs[0].width, cvs[1].width), h = cvs[0].height + cvs[1].height;
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var ctx = out.getContext('2d');
    ctx.drawImage(cvs[0], 0, 0); ctx.drawImage(cvs[1], 0, cvs[0].height);
    var a = document.createElement('a');
    a.href = out.toDataURL('image/png'); a.download = 'rietveld_pattern_' + RV.ui.fileStamp() + '.png';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function redrawAll() { if (P.pat) { P.pat.draw(); P.diff.draw(); } }

  function anchorAt(px,py,ds) {
    if(!P.pat || !P.pat.view || S.busy)return null;
    var best=null,distance=100;
    P.pat.visibleSeries().forEach(function(s){if(s.kind!=='anchor' || ds && s.ds!==ds)return;s.x.forEach(function(x,i){var point=P.pat._xy(s,i);if(!point)return;var d=Math.pow(point[0]-px,2)+Math.pow(point[1]-py,2);if(d<distance){distance=d;best={dsId:s.ds.id,index:s.idxs[i],x:x,y:s.y[i]};}});});
    return best;
  }
  function focusAnchor(info) {
    var ds=info && info.dsId!=null?RV.state.byId(info.dsId):RV.state.first(),match=info && /^bga(\d+)$/.exec(info.name || '');
    anchorFocus=ds && match?{dsId:ds.id,index:+match[1]}:null;
    refresh(false);
  }
  function startAnchor(px,py) {
    var hit=anchorAt(px,py);if(!hit)return null;
    var input=document.activeElement;if(input && input.matches('#param-list .pv'))input.blur();
    anchorDrag=Object.assign({},hit);refresh(false);return hit;
  }
  function dragAnchor(hit,x,y) {
    var ds=RV.state.byId(hit.dsId);if(!ds || S.busy)return;
    anchorDrag={dsId:hit.dsId,index:hit.index,x:Math.max(ds.tth[0],Math.min(ds.tth[ds.tth.length-1],x)),y:y};refresh(false);
  }
  function endAnchor(hit,x,y,moved) {
    var ds=RV.state.byId(hit.dsId),preview=anchorDrag;anchorDrag=null;
    if(moved && ds && preview)preview={x:Math.max(ds.tth[0],Math.min(ds.tth[ds.tth.length-1],x)),y:y};
    if(moved && ds && !S.busy && preview && (preview.x!==ds.inst.bkgX[hit.index] || preview.y!==ds.p['bga'+hit.index])){
      if(ds.inst.bkgX.some(function(a,k){return k!==hit.index && Math.abs(a-preview.x)<=1e-6;}))RV.ui.toast('Keep background anchors at distinct angles.','info');
      else{RV.history.take('moving background anchor of '+ds.name);RV.state.moveBackgroundAnchor(ds,hit.index,preview.x,preview.y);}
    }
    refresh(false);
  }

  function init() {
    P.pat = new RV.Plot2D($('#pat-host'), { ylabel: 'Intensity /counts', tooltip: tooltip, legendMax: 10 + S.phases.length, empty: '', band: 0,
                                             onMark: function (x, y, px, py) { RV.cmd.markAt(x, y, px, py); }, onRegion: function (x0, x1) { RV.cmd.regionAt(x0, x1); },
                                             onAnchorStart:startAnchor,onAnchorDrag:dragAnchor,onAnchorEnd:endAnchor });
    P.diff = new RV.Plot2D($('#diff-host'), { xlabel: '2θ /°', ylabel: 'obs − calc', legend: false, tooltip: tooltip });
    linkX(P.pat, P.diff);
    RV.bus.on('phaseStyle', function () { refresh(false); });
    RV.bus.on('paramFocus',focusAnchor);
    ['selection','calculation'].forEach(function(ev){RV.bus.on(ev,function(){anchorFocus=null;anchorDrag=null;if(P.pat && P.pat.drag && P.pat.drag.mode==='anchor')P.pat.drag=null;});});
    RV.bus.on('busy',function(busy){if(busy){anchorDrag=null;anchorFocus=null;if(P.pat)P.pat.drag=null;refresh(false);}});
    ['selection', 'datasets', 'phases'].forEach(function (ev) { RV.bus.on(ev, function () { refresh(true); }); });
    ['params', 'stats', 'data', 'theme', 'tables'].forEach(function (ev) { RV.bus.on(ev, function () { refresh(false); }); });
    RV.bus.on('settings', function (k) { refresh(k === 'yscale' || k === 'maxPlots' || k === '*'); });
    document.querySelectorAll('[data-plot-action]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-plot-action');
        if (a === 'auto') autoscale();
        if (a === 'png') exportPNG();
      });
    });
  }

  // the pixel of a 2theta on the pattern plot (NaN before it is drawn)
  function pxOf(x) { return P.pat && P.pat.view ? P.pat.px(x) : NaN; }
  return { init: init, refresh: refresh, show: show, autoscale: autoscale, exportPNG: exportPNG, redrawAll: redrawAll, plotted: plotted, build: build, legendIndices:legendIndices, backgroundAt:backgroundAt, pxOf: pxOf, anchorAt:anchorAt,
           color: color, colorVar: colorVar, phaseColor: phaseColor, phaseVar: phaseVar, phaseIndex: phaseIndex, _plots: P };
})();
