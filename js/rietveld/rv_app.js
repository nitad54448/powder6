/*  Powder 6: start-up and the frame of the page: the tabs, the side panel and its grip, the theme, the command line,
 *  keys, drag and drop; the space groups (sg/all.json, js/sg_engine.js), the scattering factors (scatters/) and the
 *  default peak shapes (Voigt_default.json, TCH_default.json, Split_default.json next to the page, as in powder5).
 */
(function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui, curTab = 'pattern';
  function $(s) { return document.querySelector(s); }
  function tabButtons() { return Array.prototype.slice.call(document.querySelectorAll('.top [data-tab]')); }

  function showTab(tab) {
    if (tab === 'results') tab = 'solve';
    if (!document.getElementById('pane-' + tab)) tab = 'pattern';
    curTab = tab;
    tabButtons().forEach(function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.stage > .pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + tab); });
    $('#ptools').hidden = tab !== 'pattern';
    RV.plots.show(tab === 'pattern');
    St.store('tab', tab);
    if (tab === 'solve') syncCalculation();
    RV.bus.emit('tab', tab);
  }
  function fitMode() { return S.sel.size >= 2 && St.load('fitmode') === 'global' ? 'global' : 'single'; }
  function showSide(name) {
    if (!document.querySelector('[data-side="' + name + '"]')) name = 'datasets';
    document.querySelectorAll('[data-side]').forEach(function (b) {
      var on = b.getAttribute('data-side') === name;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.side-panel').forEach(function (p) { p.classList.toggle('on', p.id === 'sp-' + name); });
    St.store('side', name);
  }
  RV.app = { showTab: showTab, tab: function () { return curTab; }, fitMode: fitMode, showSide: showSide, calculation: calculation };

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
    function open(key) { document.querySelectorAll('details.acc[data-acc="' + key + '"]').forEach(function (d) { d.open = true; }); var s = load(); s[key] = true; St.store('acc', s); }
    document.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d || !d.matches || !d.matches('details.acc[data-acc]')) return;
      var s = load(), k = d.getAttribute('data-acc');
      if (s[k] === d.open) return;
      s[k] = d.open; St.store('acc', s);
      document.querySelectorAll('details.acc[data-acc="' + k + '"]').forEach(function (o) { if (o !== d && o.open !== d.open) o.open = d.open; });
      if (d.open) RV.bus.emit('acc', k);
    }, true);
    return { attr: attr, isOpen: isOpen, restore: restore, isShown: isShown, open: open };
  })();

  function syncCalculation() {
    var m = S.calculation || 'lebail', labels = RVCore.METHOD_LABELS;
    document.querySelectorAll('[data-calculation]').forEach(function (b) {
      var on = b.dataset.calculation === m;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.disabled = !!S.busy;
    });
    $('#calculation-title').textContent = labels[m] + ' calculation';
    $('#calculation-description').textContent = {
      lebail: 'Fit cells and profiles without an atomic model; reflection intensities are partitioned from the pattern.',
      wppf: 'Refine integrated intensities by least squares, then check the space group, run charge flipping or search Wyckoff sites.',
      rietveld: 'Fit atomic models and phase scales. Weight fractions are normalized among the Rietveld phases; include every crystalline phase for quantitative analysis.'
    }[m];
    document.querySelectorAll('.calc-layout').forEach(function (el) { el.hidden = el.getAttribute('data-layout') !== m; });
    var issue = St.calculationIssue();
    $('#calculation-summary').textContent = issue ? '⚠ ' + issue : '';
    $('#calculation-summary').classList.toggle('warn', !!issue);
    document.querySelector('[data-workflow="scales"]').hidden = m !== 'rietveld';
    document.querySelector('[data-workflow="orientation"]').hidden = m !== 'rietveld';
    var list = St.selected(), held = S.phases.filter(function (ph) { return list.some(function (d) { return St.hasPhase(d, ph); }); });
    $('#calculation-target').textContent = '1 · Select datasets on the right. 2 · Set assignments in Datasets. 3 · Tick parameters below or in Parameters. 4 · Fit and inspect results. ' + (St.calculationIssue() || 'Prerequisites ready.');
    var source=St.selected()[0], note=$('#starting-model-note');
    if(note)note.textContent=source ? 'Phase starting values: '+source.name+' (topmost selected dataset). Reorder datasets to change the source. Instrument, background, geometry, assignments and fit flags remain specific to each dataset. Phases absent from this source keep their own values.' : 'Select datasets. The topmost selected dataset supplies phase starting values; reorder the dataset list to change it.';
    if (RV.results) RV.results.render();
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
    if (St.setCalculation(m)) { syncCalculation(); RV.bus.emit('tab', 'solve'); }
  }
  function initCalculations() {
    document.querySelectorAll('[data-calculation]').forEach(function (b) { b.addEventListener('click', function () { calculation(b.dataset.calculation); }); });
    document.querySelector('.calculation-tabs').addEventListener('keydown', function (e) {
      if (!/^Arrow(Left|Right)$/.test(e.key)) return;
      var tabs = Array.from(this.querySelectorAll('button')), i = tabs.indexOf(document.activeElement);
      if (i < 0 || S.busy) return;
      e.preventDefault(); var b = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      b.focus(); calculation(b.dataset.calculation);
    });
    document.querySelectorAll('[data-workflow]').forEach(function (b) { b.addEventListener('click', function () {
      switch (b.dataset.workflow) {
        case 'assign': showTab('datasets'); break;
        case 'parameters': showSide('params'); break;
        case 'refinement-settings': showTab('settings'); $('#set_algorithm').focus(); break;
        case 'orientation': RV.cmd.orientation(); break;
        case 'fit': RV.cmd.fit(); break;
        case 'patterns': showTab('pattern'); break;
        case 'scales':
          if (S.busy || !S.sel.size) return;
          RV.history.take('refine phase scales only');
          St.selected().forEach(function (d) { Object.keys(d.fit).forEach(function (n) { d.fit[n] = RVCore.classify(n).kind === 'scale' && St.isVariable(n); }); });
          RV.bus.emit('params', {}); RV.cmd.fit(); break;
      }
    }); });
    $('#ds-resolution').addEventListener('click',function(){RV.cmd.resolution();});
    $('#ds-phases').addEventListener('click', function () { RV.cmd.phaseMap(); });
    ['calculation', 'selection', 'phases', 'datasets', 'stats', 'params', 'busy', 'fitmode'].forEach(function (ev) { RV.bus.on(ev, function () { if (curTab === 'solve') syncCalculation(); }); });
  }

  function initBusyGuard() {
    function update(b) {
      document.body.classList.toggle('busy',!!b);
      $('#busy-guard').hidden=!b;
      $('#busy-label').textContent=S.busyLabel || 'Calculation running…';
      $('#work').inert=!!b;document.querySelector('.top').inert=!!b;
      $('#cmdline').disabled=!!b;
      document.body.setAttribute('aria-busy',String(!!b));
      if(b && document.activeElement && document.activeElement!==document.body)document.activeElement.blur();
    }
    $('#busy-cancel').addEventListener('click',function(){RV.cmd.stop();});
    function guard(e) {
      if(!S.busy)return;
      var stop=e.target && e.target.closest && e.target.closest('#busy-cancel');
      if(stop)return;
      if(e.type==='keydown' && e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();RV.cmd.stop();return;}
      e.preventDefault();e.stopImmediatePropagation();
    }
    // Inert handles keyboard focus; the capture guard also covers dialogs,
    // drag/drop, plot gestures and browsers without full inert support.
    ['click','dblclick','pointerdown','pointermove','pointerup','keydown','beforeinput','change','input','drop','dragstart','wheel'].forEach(function(ev){document.addEventListener(ev,guard,{capture:true,passive:false});});
    RV.bus.on('busy',update);update(S.busy);
  }

  // ---------------------------------------------------------------- side panel width (drag its left edge, as in Yappari)
  function initGrip() {
    var grip = $('#side-grip'), work = $('#work'), cs = getComputedStyle(work), v = function (n) { return parseFloat(cs.getPropertyValue(n)); };
    var DEF = v('--side-w') || 0, MIN = v('--side-min') || 0, MAX = (v('--side-max') || 100) / 100, side = grip.parentElement;
    function set(w, save) {
      w = Math.round(Math.max(MIN, Math.min(w, window.innerWidth * MAX)));
      work.style.setProperty('--side-w', w + 'px');
      if (save) St.store('sidew', w);
    }
    var w0 = St.load('sidew');
    if (w0) set(w0, false);
    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
      function mv(ev) { set(window.innerWidth - ev.clientX, false); }
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
      set(side.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 50 : 10), true);
    });
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
    document.querySelectorAll('[data-yscale]').forEach(function (b) { var k=b.getAttribute('data-yscale');b.setAttribute('aria-pressed',String(k === (S.settings.noBackground ? 'lin' : S.settings.yscale)));b.disabled=!!S.settings.noBackground && k!=='lin'; });
    $('#no-background').checked = !!S.settings.noBackground; $('#show-bkg').checked = !!S.settings.showBkg; $('#show-phases').checked = !!S.settings.showPhases; $('#show-ticks').checked = !!S.settings.showTicks;
  }

  // ---------------------------------------------------------------- databases
  async function loadDatabases() {
    S.sgLoading = true;
    var notes = [];
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
      $('#sg-list').innerHTML = SG_ENGINE.list().map(function (sym) { return '<option value="' + ui.esc(sym) + '">'; }).join('');
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
    var got = await RV.cmd.loadDefaultPresets();
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
    initCalculations();
    initBusyGuard();
    RV.acc.restore(document.getElementById('calculation-body'));

    var tabs = tabButtons();
    tabs.forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
    $('.top .tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var list = tabs.filter(function (b) { return b.closest('.tabs'); }), i = list.indexOf(document.activeElement);
      if (i < 0) return;
      var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      list[j].focus(); showTab(list[j].getAttribute('data-tab'));
    });
    var sideTabs = Array.prototype.slice.call(document.querySelectorAll('[data-side]'));
    sideTabs.forEach(function (b) { b.addEventListener('click', function () { showSide(b.getAttribute('data-side')); }); });
    $('.side-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = sideTabs.indexOf(document.activeElement);
      if (i < 0) return;
      var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + sideTabs.length) % sideTabs.length;
      sideTabs[j].focus(); showSide(sideTabs[j].getAttribute('data-side'));
    });
    $('#btn-fit').addEventListener('click', function () { showTab('solve'); });
    $('#btn-report').addEventListener('click', function () { RV.pdf.report(); });
    $('#cmd-help').addEventListener('click', function () { RV.cmd.showHelp(); });
    initGrip();

    document.querySelectorAll('[data-yscale]').forEach(function (b) { b.addEventListener('click', function () { St.setSetting('yscale', b.getAttribute('data-yscale')); }); });
    [['#show-bkg', 'showBkg'], ['#show-phases', 'showPhases'], ['#show-ticks', 'showTicks'], ['#no-background','noBackground']].forEach(function (p) {
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
      if (e.key === 'F9') { e.preventDefault(); showTab('solve'); RV.cmd.fit(); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); RV.cmd.saveProject(); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && !$('#dlg').open) { e.preventDefault(); RV.cmd.undo(); }
    });
    window.addEventListener('beforeunload', function (e) { if (S.datasets.length || S.phases.length) { e.preventDefault(); e.returnValue = ''; } });

    $('#theme-toggle').addEventListener('click', function () { St.setSetting('theme', isDark() ? 'light' : 'dark'); });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (S.settings.theme !== 'dark' && S.settings.theme !== 'light') applyTheme(); });
    RV.bus.on('settings', function (k) {
      if (k === '*' || k === 'theme') applyTheme();
      if (k === '*' || /^(yscale|showBkg|showPhases|showTicks|noBackground)$/.test(k)) { syncToolbar(); RV.plots.refresh(k === 'yscale' || k === 'noBackground' || k === '*'); }
    });
    if(RV.absorption)RV.absorption.init();
    if(RV.constraints)RV.constraints.init();
    initSolveHeader();
    applyTheme(); syncToolbar();

    $('#about-version').textContent = 'version ' + RV.version.replace(/\s*\(([^)]+)\)$/, ', $1');
    showSide(St.load('side') || 'datasets');
    showTab(St.load('tab') || 'pattern');
    RV.bus.emit('datasets'); RV.bus.emit('selection'); RV.bus.emit('settings', '*');
    ui.toast('Loading the space groups and the scattering factors…', 'info');
    loadDatabases().then(function (notes) {
      if (notes.length >= 2) ui.toast('Ready: ' + notes.join(', ') + '. ' + (RV.pool.usingWorkers() ? (RV.pool.size() > 1 ? 'Fits run in up to ' + RV.pool.size() + ' parallel workers.' : 'Fits run in a worker.') : 'Web Workers are unavailable: fits run in this window.'), 'ok');
    });
  }

  init();
})();
