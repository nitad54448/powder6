/*  Powder 6: start-up and the frame of the page: the tabs, the side panel and its grip, the theme, the command line,
 *  keys, drag and drop; the space groups (sg/all.json, js/sg_engine.js), the scattering factors (scatters/) and the
 *  default peak shapes (Voigt_default.json, TCH_default.json, Split_default.json next to the page, as in powder5).
 */
(function () {
  'use strict';
  // The modules share globals and load as ordered deferred scripts (index.html): a missing or misordered
  // file must say so instead of failing later on an undefined property.
  var REQUIRED = ['JSZip', 'RVCore', 'CFAdaptive', 'SGConvert','RV.bus', 'RV.ui', 'RV.state', 'RV.history', 'RV.plots', 'RV.phasesTab', 'RV.panels', 'RV.results',
                  'RV.cmd', 'RV.pool', 'RV.sgtest', 'RV.solve', 'RV.pdf', 'RV.datasets', 'RV.fitHistory', 'RV.project', 'RV.workspace', 'RV.layout', 'RV.restraints', 'RV.wyHelper', 'AtomRestraints', 'MoleculeRules', 'RV.fourier', 'FourierMap'];
  var missing = REQUIRED.filter(function (name) { return !name.split('.').reduce(function (o, k) { return o && o[k]; }, window); });
  if (missing.length) {
    var alertBox = document.createElement('p');
    alertBox.className = 'load-error'; alertBox.setAttribute('role', 'alert');
    alertBox.textContent = 'Powder 6 could not start: ' + missing.join(', ') + ' did not load. Check that all files next to index.html are present, open the page through a web server, and reload.';
    document.body.prepend(alertBox);
    throw new Error('Powder 6: missing modules ' + missing.join(', '));
  }
  var S = RV.state.S, St = RV.state, ui = RV.ui, curTab = 'pattern';
  function $(s) { return document.querySelector(s); }
  function tabButtons() { return Array.prototype.slice.call(document.querySelectorAll('.panel-tabs [data-tab]')); }

  function showTab(tab) {
    curTab = RV.layout.showTab(tab);
    St.store('tab',curTab);
    if(curTab==='method')syncCalculation();
    RV.bus.emit('tab',curTab);
  }
  function fitMode() { return S.sel.size >= 2 && St.load('fitmode') === 'global' ? 'global' : 'single'; }
  function showSide(name) {
    showTab(name==='info'?'method':name==='params'?'datasets':name);
    St.store('side', name);
  }
  RV.app = { showTab: showTab, tab: function () { return curTab; }, commandTab:function(){return RV.layout.commandTab();},resultTab:function(){return RV.layout.resultTab();},fitMode: fitMode, showSide: showSide, calculation: calculation };

  /* Accordion blocks (<details class="acc" data-acc="key">): their open state is remembered per key.
     RV.acc.attr(key, openByDefault) -> ' open' or '' for blocks built in script; RV.acc.restore(root) for the page's own;
     RV.acc.isShown(el): el is inside no closed block (a canvas worth drawing). Opening one emits 'acc' with its key. */
  RV.acc = (function () {
    var state = null;
    function load() { if (!state) { var s = St.load('acc'); state = s && typeof s === 'object' ? s : {}; } return state; }
    function isOpen(key, dflt) { var s = load(); return Object.prototype.hasOwnProperty.call(s, key) ? !!s[key] : !!dflt; }
    function attr(key, dflt) { return isOpen(key, dflt) ? ' open' : ''; }
    function restore(root) { (root || document).querySelectorAll('details.acc[data-acc]').forEach(function (d) { var k = d.getAttribute('data-acc'); d.open = isOpen(k, d.hasAttribute('open')); }); }
    function isShown(el) { return !!el && el.isConnected && !el.closest('details:not([open])') && !el.closest('[hidden]'); }
    // forget(keys): the remembered state of these blocks is dropped, so they start from their default (closed) in a new session
    function forget(keys) { var s = load(); keys.forEach(function (k) { delete s[k]; }); St.store('acc', s); }
    function open(key) { document.querySelectorAll('details.acc[data-acc="' + key + '"]').forEach(function (d) { d.open = true; }); var s = load(); s[key] = true; St.store('acc', s); }
    forget(['wppf-sgt', 'wppf-cf', 'wppf-wy']);
    document.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d || !d.matches || !d.matches('details.acc[data-acc]')) return;
      var s = load(), k = d.getAttribute('data-acc');
      if (s[k] === d.open) return;
      s[k] = d.open; St.store('acc', s);
      document.querySelectorAll('details.acc[data-acc="' + k + '"]').forEach(function (o) { if (o !== d && o.open !== d.open) o.open = d.open; });
      if (d.open) RV.bus.emit('acc', k);
    }, true);
    return { attr: attr, isOpen: isOpen, restore: restore, isShown: isShown, open: open, forget: forget };
  })();

  function syncCalculation() {
    var m = S.calculation || 'lebail';
    document.querySelectorAll('[data-calculation]').forEach(function (b) {
      var on = b.dataset.calculation === m;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.disabled = !!S.busy;
    });
    RV.layout.syncResultLayouts();
    var issue=RV.cmd.why('fit'),warning='';
    if(issue){
      warning=!S.phases.length?'Need a phase':!S.datasets.length?'Load a dataset':!S.sel.size?'Select a dataset':
        /No enabled phase/.test(issue)?'Need a phase in each selected dataset':
        /needs atoms/.test(issue)?'Rietveld needs an atomic model':
        /Missing scattering/.test(issue)?'Missing scattering factors':
        /Tick at least/.test(issue)?'Choose parameters to refine':
        S.busy?'Calculation running':issue;
    }
    $('#calculation-summary').textContent=warning?'⚠ '+warning:'';$('#calculation-summary').title=issue;$('#calculation-summary').hidden=!warning;
    $('#calculation-target').textContent='Set values and refinement flags in Datasets and FIT from any view.';
    if (RV.results && RV.layout.resultTab()==='solve') RV.results.render();
    updateSolveHeader();
  }
  function updateSolveHeader() {
    var head = $('#solve-sticky');
    if (!head) return;
    var height = head.getBoundingClientRect().height;
    if (height > 0) $('#pane-solve').style.setProperty('--solve-sticky-height',height+'px');
  }
  function initSolveHeader() {
    var head = $('#solve-sticky');
    if (head && typeof ResizeObserver !== 'undefined') new ResizeObserver(updateSolveHeader).observe(head);
    window.addEventListener('resize',updateSolveHeader);
  }
  function calculation(m, skipHistory) {
    if (S.busy) return;
    if (!skipHistory && m !== S.calculation) RV.history.take('switch calculation to ' + RVCore.METHOD_LABELS[m]);
    if (St.setCalculation(m)) { syncCalculation(); RV.bus.emit('tab',RV.layout.commandTab()); }
  }
  function initCalculations() {
    document.querySelectorAll('[data-calculation]').forEach(function (b) { b.addEventListener('click', function () { calculation(b.dataset.calculation); }); });
    $('#method-selector').addEventListener('keydown', function (e) {
      if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      var tabs = Array.from(this.querySelectorAll('button')), i = tabs.indexOf(document.activeElement);
      if (i < 0 || S.busy) return;
      e.preventDefault(); var b = tabs[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length];
      b.focus(); calculation(b.dataset.calculation);
    });
    document.querySelectorAll('[data-workflow]').forEach(function (b) { b.addEventListener('click', function () {
      switch (b.dataset.workflow) {
        case 'assign': showTab('datasets'); break;
        case 'parameters': showSide('params'); break;
        case 'refinement-settings': showTab('settings'); $('#set_algorithm').focus(); break;
        case 'fit': RV.cmd.fit(); break;
        case 'patterns': showTab('pattern'); break;
      }
    }); });
    $('#ds-resolution').addEventListener('click',function(){RV.cmd.resolution();});
    $('#ds-phases').addEventListener('click', function () { RV.cmd.phaseMap(); });
    ['calculation', 'selection', 'phases', 'datasets', 'stats', 'params', 'busy', 'fitmode'].forEach(function (ev) { RV.bus.on(ev,syncCalculation); });
  }

  function initBusyGuard() {
    var wasBusy=false,returnFocus=null,busyFocus=null;
    function update(b) {
      var starting=!!b && !wasBusy,restore=!b && wasBusy && document.activeElement===busyFocus;
      if(starting)returnFocus=document.activeElement;
      document.body.classList.toggle('busy',!!b);
      if(!!b!==wasBusy){wasBusy=!!b;ui.busyRun(wasBusy);}
      $('#busy-guard').hidden=!b;
      $('#busy-label').textContent=S.busyLabel || 'Calculation running…';
      // Navigation and plot inspection remain available during a fit. Mutating commands guard S.busy.
      $('#cmdline').disabled=!!b;
      document.body.setAttribute('aria-busy',String(!!b));
      if(starting){busyFocus=$('#busy-cancel').disabled?$('#work'):$('#busy-cancel');busyFocus.focus({preventScroll:true});}
      else if(!b){if(restore && returnFocus && returnFocus.isConnected && !returnFocus.disabled)returnFocus.focus({preventScroll:true});returnFocus=null;busyFocus=null;}
    }
    $('#busy-cancel').addEventListener('click',function(){RV.cmd.stop();});
    function guard(e) {
      if(!S.busy)return;
      if(e.type==='keydown' && e.key==='Tab')return;
      if(e.type==='keydown' && e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();RV.cmd.stop();return;}
      var stop=e.target && e.target.closest && e.target.closest('#busy-cancel');
      if(stop)return;
      var inspect=e.target && e.target.closest && e.target.closest('#pat-host,#diff-host,#plot-selection,#dataset-tabs,#result-run-select,#structure-run-select,[data-structure-result],#dataset-accordions > details > summary,#side-grip,#swap-panels,#btn-about,#pane-about,.panel-tabs');
      if(inspect)return;
      e.preventDefault();e.stopImmediatePropagation();
    }
    // Keep keyboard navigation available while guarding edits, dialogs and plot changes.
    ['click','dblclick','pointerdown','pointermove','pointerup','keydown','beforeinput','change','input','drop','dragstart','wheel'].forEach(function(ev){document.addEventListener(ev,guard,{capture:true,passive:false});});
    RV.bus.on('busy',update);update(S.busy);
  }

  // ---------------------------------------------------------------- side panel width (drag its left edge, as in Yappari)
  function initGrip() {
    var grip = $('#side-grip'), work = $('#work'), side=$('.command-panel');
    var DEF=Math.min(620,Math.round(work.clientWidth*.46));
    function set(w, save) {
      var max=Math.max(320,work.clientWidth-374),min=Math.min(320,max);w=Math.round(Math.max(min,Math.min(w,max)));
      work.style.setProperty('--side-w', w + 'px');
      grip.setAttribute('aria-valuenow',w);grip.setAttribute('aria-valuemin',min);grip.setAttribute('aria-valuemax',max);grip.setAttribute('aria-label','Resize command and results panels');
      if (save) St.store('commandWidth', w);
    }
    set(St.load('commandWidth') || DEF,false);
    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
      var startX=e.clientX,startWidth=side.getBoundingClientRect().width,direction=work.classList.contains('panels-swapped')?-1:1;
      function mv(ev) {set(startWidth+direction*(ev.clientX-startX),false);}
      function up() {
        grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        set(parseFloat(getComputedStyle(work).getPropertyValue('--side-w')), true);
      }
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    grip.addEventListener('dblclick', function () { if (DEF) set(DEF, true); });
    grip.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var direction=e.key==='ArrowRight'?1:-1;if(work.classList.contains('panels-swapped'))direction=-direction;
      set(side.getBoundingClientRect().width+direction*(e.shiftKey?50:10),true);
    });
    RV.bus.on('panelLayout',function(){RV.plots.redrawAll();});
  }

  // ---------------------------------------------------------------- theme
  function isDark() { var t = S.settings.theme; return t === 'dark' || (t !== 'light' && !!window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function applyTheme() {
    var m = isDark() ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', m);
    $('#theme-toggle').setAttribute('aria-checked', String(m === 'dark'));
    RV.theme.refresh(); RV.bus.emit('theme');
    RV.plots.redrawAll();
  }

  // ---------------------------------------------------------------- pattern toolbar
  function syncToolbar() {
    var subtract=RV.plots.backgroundSubtracted();
    document.querySelectorAll('[data-yscale]').forEach(function (b) { var k=b.getAttribute('data-yscale');b.setAttribute('aria-pressed',String(k === (subtract ? 'lin' : S.settings.yscale)));b.disabled=subtract && k!=='lin'; });
    $('#show-anchors').checked=!!S.settings.showAnchors;$('#no-background').checked = !!S.settings.noBackground; $('#show-bkg').checked = !!S.settings.showBkg; $('#show-phases').checked = !!S.settings.showPhases; $('#show-ticks').checked = !!S.settings.showTicks;
  }

  // ---------------------------------------------------------------- databases
  async function loadDatabases() {
    S.sgLoading = true;
    var notes = [];
    // Started first and awaited last: three small local files, whose values are part of every saved project. RV.project
    // waits on the same promise, so no save can be compared against a document they have not reached yet.
    var presets = RV.cmd.loadDefaultPresets();
    try {
      var resp = await fetch('sg/all.json');
      if (!resp.ok) throw new Error('sg/all.json: HTTP ' + resp.status);
      var all = await resp.json();
      if (all.space_groups) globalThis.SG_DATABASE = all;
      else if (Array.isArray(all)) { var sgs = {}; all.forEach(function (g) { sgs[g.number] = g; }); globalThis.SG_DATABASE = { space_groups: sgs }; }
      else globalThis.SG_DATABASE = { space_groups: all };
      await new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = 'js/sg_engine.js'; s.onload = res; s.onerror = function () { rej(new Error('js/sg_engine.js could not be loaded')); };
        document.head.appendChild(s);
      });
      S.sgReady = true;
      // every setting, written as the fields write it (Fm-3m, P121/n1), so the suggestions match what is typed
      $('#sg-list').innerHTML = St.allSettings().map(function (s) { return '<option value="' + ui.esc(s.symbol) + '" label="' + ui.esc(s.number + ' · ' + s.system + (s.setting && s.setting !== 'standard' ? ' · ' + s.setting : '')) + '">'; }).join('');
      notes.push(Object.keys(SG_DATABASE.space_groups).length + ' space groups');
    } catch (e) {
      ui.toast('The space groups are not loaded (' + ((e && e.message) || e) + '). Open index.html through a web server.', 'err');
    }
    S.sgLoading = false;
    RV.bus.emit('phases');
    try {
      var t = await loadScatteringTables('scatters');
      var bad = verifyScatteringTable(t.xray);
      if (bad.length) ui.log('Scattering table check, f(0) against Z: ' + bad.slice(0, 6).join('; ') + (bad.length > 6 ? ' …' : ''), 'warn');
      St.setTables(t);
      $('#scat-list').innerHTML = S.tables.labels.map(function (l) { return '<option value="' + ui.esc(l) + '">'; }).join('');
      notes.push('X-ray form factors ' + ((t.index && t.index.preferred) || '') + (t.neutron ? ' and neutron lengths' : ''));
    } catch (e) {
      ui.toast('The scattering factors are not loaded (' + ((e && e.message) || e) + '): Rietveld calculations are unavailable until they are.', 'err');
    }
    RV.bus.emit('tables');
    var got = await presets;
    if (got.length) notes.push('default peak shapes ' + got.join(', '));
    return notes;
  }

  function init() {
    St.restore();
    RV.history.init();
    RV.plots.init();
    RV.phasesTab.init();
    RV.panels.init();
    RV.results.init();
    RV.cmd.init();
    RV.solve.init();
    RV.datasets.init();
    RV.workspace.init();
    RV.layout.init();
    initCalculations();
    initBusyGuard();
    RV.acc.restore(document.getElementById('calculation-body'));

    var tabs = tabButtons();
    tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
    $('#btn-about').addEventListener('click', function () { showTab('about'); });
    document.querySelectorAll('.panel-tabs').forEach(function(nav){nav.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var list = Array.from(nav.querySelectorAll('button')), i = list.indexOf(document.activeElement);
      if (i < 0) return;
      var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      list[j].focus();if(list[j].dataset.resultMethod)RV.layout.showResult(list[j].dataset.resultMethod);else showTab(list[j].getAttribute('data-tab'));
    });});
    $('#btn-fit').addEventListener('click', function () { RV.cmd.fit(); });
    $('#btn-report').addEventListener('click', function () { RV.pdf.report(); });
    $('#cmd-help').addEventListener('click', function () { RV.cmd.showHelp(); });
    initGrip();

    document.querySelectorAll('[data-yscale]').forEach(function (b) { b.addEventListener('click', function () { St.setSetting('yscale', b.getAttribute('data-yscale')); }); });
    [['#show-anchors','showAnchors'],['#show-bkg', 'showBkg'], ['#show-phases', 'showPhases'], ['#show-ticks', 'showTicks'], ['#no-background','noBackground']].forEach(function (p) {
      $(p[0]).addEventListener('change', function (e) { St.setSetting(p[1], e.target.checked); });
    });
    RV.bus.on('busy', function (b) { document.body.classList.toggle('busy', !!b); });

    var hist = St.load('history'), cl = $('#cmdline');
    hist = Array.isArray(hist) ? hist.filter(function (v) { return typeof v === 'string'; }).slice(-50) : [];
    var hi = hist.length;
    cl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = cl.value.trim();
        if (!v) return;
        hist.push(v); if (hist.length > 50) hist.shift();
        St.store('history', hist); hi = hist.length; cl.value = '';
        RV.cmd.runCommand(v);
      } else if (e.key === 'ArrowUp') { if (hi > 0) { hi--; cl.value = hist[hi]; e.preventDefault(); } }
      else if (e.key === 'ArrowDown') { if (hi < hist.length) { hi++; cl.value = hist[hi] || ''; e.preventDefault(); } }
    });

    // files dropped on the window: patterns, structure CIFs, projects and peak-shape presets
    var depth = 0;
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
    window.addEventListener('dragenter', function (e) { if (hasFiles(e)) { depth++; document.body.classList.add('dropping'); } });
    window.addEventListener('dragleave', function (e) { if (hasFiles(e) && --depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0;
      document.body.classList.remove('dropping');
      RV.cmd.readFiles(Array.prototype.slice.call(e.dataTransfer.files));
    });

    document.addEventListener('keydown', function (e) {
      var typing = e.target.matches && e.target.matches('input, select, textarea');
      if ($('#sg-modal-overlay').classList.contains('open')) return;
      if (e.key === 'F9') { e.preventDefault(); RV.cmd.fit(); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); RV.cmd.saveProject(); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && !$('#dlg').open) { e.preventDefault(); RV.cmd.undo(); }
    });
    window.addEventListener('beforeunload', function (e) {
      var dirty=true;
      try{dirty=RV.project.hasUnsavedChanges();}catch(error){console.error('Checking unsaved project',error);}
      if(dirty){e.preventDefault();e.returnValue='';}
    });

    $('#theme-toggle').addEventListener('click', function () { St.setSetting('theme', isDark() ? 'light' : 'dark'); });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (S.settings.theme !== 'dark' && S.settings.theme !== 'light') applyTheme(); });
    RV.bus.on('settings', function (k) {
      if (k === '*' || k === 'theme') applyTheme();
      if (k === '*' || /^(yscale|showAnchors|showBkg|showPhases|showTicks|noBackground)$/.test(k)) { syncToolbar(); RV.plots.refresh(false); }
    });
    if(RV.absorption)RV.absorption.init();
    if(RV.constraints)RV.constraints.init();
    if(RV.restraints)RV.restraints.init();
    if(RV.wyHelper)RV.wyHelper.init();
    if(RV.fourier)RV.fourier.init();
    initSolveHeader();
    applyTheme(); syncToolbar();

    $('#about-version').textContent = 'version ' + RV.version.replace(/\s*\(([^)]+)\)$/, ', $1');
    RV.layout.restore();syncCalculation();
    RV.bus.emit('datasets'); RV.bus.emit('selection'); RV.bus.emit('settings', '*');
    ui.toast('Loading the space groups and the scattering factors…', 'info');
    loadDatabases().then(function (notes) {
      if (notes.length >= 2) ui.toast('Ready: ' + notes.join(', ') + '. ' + (RV.pool.usingWorkers() ? (RV.pool.size() > 1 ? 'Fits run in up to ' + RV.pool.size() + ' parallel workers.' : 'Fits run in a worker.') : 'Web Workers are unavailable: fits run in this window.'), 'ok');
    });
  }

  init();
})();
