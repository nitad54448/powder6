/*  Powder 6: namespace, event bus, theme and the small UI toolkit (dialogs, menus, status line and Log, files,
 *  progress). The look and the behaviour follow Yappari JS, as does the whole of Powder 6.
 *
 *  Events on RV.bus: 'datasets' (list changed), 'selection', 'params' (values or fit flags), 'phases' (phase list,
 *  a phase definition or its method), 'phaseSel', 'data' (points, range, instrument), 'stats' (fit results), 'busy',
 *  'settings', 'theme', 'tab', 'tables', 'shared'.
 */
var RV = window.RV || (window.RV = {});
RV.version = '2.45.0 (26 oct 2026)';

RV.bus = (function () {
  'use strict';
  var handlers = {};
  return {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit: function (ev, data) {
      (handlers[ev] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error('[' + ev + ']', e); } });
    }
  };
})();

/*  Theme: what the canvas draws (plots, dataset and phase colours) comes from the CSS variables of powder6.css,
 *  the one place that decides the appearance. get() is cached; refresh() after a theme switch. */
RV.theme = (function () {
  'use strict';
  var cache = {};
  function read(cs) {
    function str(n) { return (cs.getPropertyValue(n) || '').trim(); }
    function col(n) { return str(n) || 'gray'; }
    function num(n, d) { var v = parseFloat(str(n)); return isFinite(v) && v >= 0 ? v : d; }
    function list(prefix) { var out = []; for (var i = 1; i <= 64; i++) { var v = str(prefix + i); if (!v) break; out.push(v); } return out; }
    var t = {
      bg: col('--plot-bg'), grid: col('--plot-grid'), minor: col('--plot-minor'), axis: col('--plot-axis'),
      ink: col('--ink'), ink2: col('--ink-2'), blue: col('--blue'), panel: col('--panel'), rule: col('--rule'),
      font: str('--font-ui') || 'sans-serif', zoomFill: col('--plot-zoom-fill'), zoomLine: col('--plot-zoom-line'),
      fontSize: num('--plot-font-size', 11), titleSize: num('--plot-title-size', 12),
      marker: num('--plot-marker-size', 3.2), line: num('--plot-line-width', 1.5), area: num('--plot-area-opacity', 0.3),
      series: list('--series-'), phases: list('--phase-'),
      calc: col('--calc-line'), bkg: col('--bkg-line'), diff: col('--diff-line'), excluded: col('--excluded-fill'), anchorActive:col('--anchor-active'), anchorFixed:col('--anchor-fixed'), anchorRefinable:col('--anchor-refinable')
    };
    if (!t.series.length) t.series = [t.ink];
    if (!t.phases.length) t.phases = [t.ink2];
    t.ms = t.marker / 3.2; t.ls = t.line / 1.5;
    return t;
  }
  function get() { if (!cache.page) cache.page = read(getComputedStyle(document.documentElement)); return cache.page; }
  function refresh() { cache = {}; }
  function seriesVar(n) { return 'var(--series-' + (n % get().series.length + 1) + ')'; }
  function phaseVar(n) { return 'var(--phase-' + (n % get().phases.length + 1) + ')'; }
  return { get: get, refresh: refresh, seriesVar: seriesVar, phaseVar: phaseVar };
})();

RV.ui = (function () {
  'use strict';
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  // accepts 1,5 as well as 1.5
  function parseNum(s) {
    s = String(s == null ? '' : s).trim().replace(/\s+/g, '');
    if (/^[-+]?\d*,\d+([eE][-+]?\d+)?$/.test(s)) s = s.replace(',', '.');
    return s === '' ? NaN : Number(s);
  }
  function fmt(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a === 0) return '0';
    return a >= 1e-3 && a < 1e5 ? String(+v.toPrecision(digits || 6)) : v.toExponential((digits || 6) - 2).replace('e', 'E');
  }
  // a value and its standard uncertainty in the usual crystallographic form, 5.64021(3)
  function withEsd(v, e) {
    if (!isFinite(v)) return '—';
    if (!(e > 0) || !isFinite(e)) return fmt(v);
    var dec = Math.max(0, Math.min(8, 1 - Math.floor(Math.log10(e))));
    var u = Math.round(e * Math.pow(10, dec));
    if (u >= 20 && dec > 0) { dec--; u = Math.round(e * Math.pow(10, dec)); }
    return v.toFixed(dec) + '(' + u + ')';
  }

  // ---------------------------------------------------------------- modal
  // o: {title, body (html | Node), wide, buttons: [{label, value | fn(body), primary, danger, left, close:false, onClick(body)}]}
  var closeOpen = null;
  function modal(o) {
    var dlg = $('#dlg');
    if (closeOpen) closeOpen(null);
    if (dlg.open) dlg.close();
    dlg.innerHTML = '';
    dlg.className = o.size === 'xl' ? 'xl' : (o.wide ? 'wide' : '');
    var box = h('div', { class: 'dlg' });
    box.appendChild(h('h2', { id:'dialog-title', text: o.title || 'Powder 6' }));
    dlg.setAttribute('aria-labelledby','dialog-title');
    var body = h('div', { class: 'body' });
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    box.appendChild(body);
    var row = h('div', { class: 'btns' });
    box.appendChild(row);
    dlg.appendChild(box);
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; if (closeOpen === finish) closeOpen = null; dlg.close(); resolve(v); }
      closeOpen = finish;
      (o.buttons || [{ label: 'Close', value: null, primary: true }]).forEach(function (b) {
        var bt = h('button', { type: 'button', class: [b.primary ? 'primary' : '', b.danger ? 'danger' : '', b.left ? 'left' : ''].join(' ').trim(), text: b.label });
        bt.addEventListener('click', function () {
          if (b.onClick && b.onClick(body) === false) return;
          if (b.close === false) return;
          finish(typeof b.value === 'function' ? b.value(body) : (b.value === undefined ? null : b.value));
        });
        row.appendChild(bt);
      });
      dlg.oncancel = function (e) { e.preventDefault(); finish(null); };
      body.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
          var prim = row.querySelector('.primary');
          if (prim) { e.preventDefault(); prim.click(); }
        }
      });
      dlg.showModal();
      var first = body.querySelector('input:not([type=checkbox]), select') || row.querySelector('.primary, .danger');
      if (first) { first.focus(); if (first.select) first.select(); }
      if (o.onOpen) o.onOpen(body);
    });
  }

  // fields: [{key, label, type: number|text|select|checkbox, value, options [[v, label, class]], hint, when: 'key:v1,v2'}]
  function fieldHTML(f) {
    var id = 'f_' + f.key, v = f.value == null ? '' : f.value, ctl, w = f.when ? ' data-when="' + esc(f.when) + '"' : '';
    if (f.type === 'select') {
      ctl = '<select id="' + id + '" data-key="' + f.key + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[2] ? ' class="' + esc(o[2]) + '"' : '') + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if (f.type === 'checkbox') {
      ctl = '<input type="checkbox" id="' + id + '" data-key="' + f.key + '"' + (v ? ' checked' : '') + '>';
    } else {
      ctl = '<input id="' + id + '" data-key="' + f.key + '" value="' + esc(v) + '"' + (f.type === 'number' ? ' inputmode="decimal"' : '') +
            (f.list ? ' list="' + esc(f.list) + '"' : '') + ' autocomplete="off" spellcheck="false">';
    }
    var cls = f.type === 'checkbox' && f.hint ? ' class="check-hint"' : '';
    return '<label for="' + id + '"' + w + '>' + esc(f.label) + '</label><div' + w + cls + '>' + ctl + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
  }
  function collect(body, fields) {
    var out = {}, bad = false;
    fields.forEach(function (f) {
      var e = body.querySelector('[data-key="' + f.key + '"]');
      if (!e || e.closest('[hidden]')) return;
      if (f.type === 'checkbox') out[f.key] = e.checked;
      else if (f.type === 'number') {
        var v = parseNum(e.value);
        e.classList.toggle('invalid', !isFinite(v));
        if (!isFinite(v)) bad = true;
        out[f.key] = v;
      } else out[f.key] = e.value;
    });
    return bad ? null : out;
  }
  function showWhen(body) {
    body.querySelectorAll('[data-when]').forEach(function (el) {
      var w = el.getAttribute('data-when').split(':'), ctl = body.querySelector('[data-key="' + w[0] + '"]');
      el.hidden = !!ctl && w[1].split(',').indexOf(ctl.value) < 0;
    });
  }
  function prompt(title, fields, okLabel, intro, extra) {
    var result = null;
    return modal({
      title: title, wide: extra && extra.wide,
      body: (intro ? '<p class="intro">' + intro + '</p>' : '') + ((extra && extra.before) || '') + '<div class="form-grid">' + fields.map(fieldHTML).join('') + '</div>' + ((extra && extra.after) || ''),
      onOpen: function (body) { showWhen(body); body.addEventListener('change', function () { showWhen(body); }); if (extra && extra.onOpen) extra.onOpen(body); },
      buttons: [{ label: 'Cancel', value: null },
                { label: okLabel || 'OK', primary: true, onClick: function (body) { result = collect(body, fields); if (result && extra && extra.check) { var why = extra.check(result, body); if (why) { toast(why, 'warn'); return false; } } return !!result; },
                  value: function () { return result; } }]
    });
  }
  function confirm(msg, okLabel, danger, title) {
    return modal({
      title: title || 'Please confirm', body: '<p>' + esc(msg) + '</p>',
      buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: !danger, danger: !!danger }]
    }).then(function (v) { return v === true; });
  }

  // ---------------------------------------------------------------- status line and Log
  var entries = [], MAX_ENTRIES = 5000;
  function stamp(d) {
    d = d || new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }
  // snap: the restore point taken before the action this line reports (a "Restore before" button, RV.history)
  function log(msg, kind, snap, merge) {
    var list = $('#log-list');
    if (!list) return;
    var top = list.firstChild, now = new Date();
    if (merge && !snap && top && top.getAttribute('data-merge') === merge) {
      top.querySelector('time').textContent = now.toLocaleTimeString();
      top.querySelector('span').textContent = msg;
      var last = entries[entries.length - 1];
      if (last) { last.t = now.toISOString(); last.msg = String(msg); }
      return;
    }
    entries.push({ t: now.toISOString(), kind: kind || 'info', msg: String(msg) });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    var li = h('li', { class: kind || 'info' });
    if (merge) li.setAttribute('data-merge', merge);
    li.innerHTML = '<time>' + now.toLocaleTimeString() + '</time><span>' + esc(msg) + '</span>' +
      '';
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 500) list.removeChild(list.lastChild);
  }
  function logEntries() { return entries.map(function (e) { return { t: e.t, kind: e.kind, msg: e.msg }; }); }
  function logLoad(saved, title) {
    var list = $('#log-list');
    entries = (saved || []).map(function (e) { return { t: e.t, kind: e.kind, msg: e.msg }; });
    if (!list || !entries.length) return;
    entries.forEach(function (e) {
      var li = h('li', { class: e.kind + ' saved' });
      li.innerHTML = '<time>' + esc(stamp(new Date(e.t)).slice(0, 16)) + '</time><span>' + esc(e.msg) + '</span>';
      list.insertBefore(li, list.firstChild);
    });
    var head = h('li', { class: 'info saved-head' });
    head.innerHTML = '<time>' + new Date().toLocaleTimeString() + '</time><span>' + esc(title) + '</span>';
    list.insertBefore(head, list.firstChild);
  }
  function toast(msg, kind, merge) {
    var el = $('#status-msg');
    if (el) { el.textContent = msg; el.className = 'msg ' + (kind || 'info'); el.title = msg; }
    log(msg, kind, RV.history ? RV.history.takePending() : null, merge);
  }

  // ---------------------------------------------------------------- drop-down menus
  var openFor = null;
  function closeMenu() {
    var pop = $('#menu-pop');
    if (pop) { pop.hidden = true; pop.innerHTML = ''; }
    if (openFor) openFor.setAttribute('aria-expanded', 'false');
    openFor = null;
  }
  // items: [{label, act, off}] or {sep: true}; off: why the item cannot run now (greyed, reason as tooltip)
  function menu(anchor, items) {
    var pop = $('#menu-pop');
    if (openFor === anchor) { closeMenu(); return; }
    closeMenu();
    items.forEach(function (it) {
      if (it.sep) { pop.appendChild(h('hr')); return; }
      var b = h('button', { type: 'button', role: 'menuitem', text: it.label });
      if (it.off) { b.setAttribute('aria-disabled', 'true'); b.title = it.off; }
      b.addEventListener('click', function () { if (it.off) return; closeMenu(); it.act(); });
      pop.appendChild(b);
    });
    pop.hidden = false;
    var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth;
    pop.style.top = Math.round(r.bottom + 4) + 'px';
    pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - pw - 8, r.left))) + 'px';
    openFor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    var first = pop.querySelector('button:not([aria-disabled="true"])') || pop.querySelector('button');
    if (first) first.focus();
  }
  document.addEventListener('mousedown', function (e) {
    if (openFor && !e.target.closest('#menu-pop') && !openFor.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (!openFor) return;
    if (e.key === 'Escape') { var a = openFor; closeMenu(); a.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var bs = Array.prototype.slice.call($('#menu-pop').querySelectorAll('button'));
      var i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  });

  // a button that runs a command: enabled, or disabled with the reason as tooltip
  function able(el, reason) {
    if (!el) return;
    if (el.dataset.tip == null) el.dataset.tip = el.getAttribute('title') || '';
    el.disabled = !!reason;
    if (reason) el.title = reason; else if (el.dataset.tip) el.title = el.dataset.tip; else el.removeAttribute('title');
  }

  // ---------------------------------------------------------------- files
  function pickFiles(o) {
    o = o || {};
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = !!o.multiple; if (o.accept) inp.accept = o.accept;
      inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener('change', function () { var f = Array.prototype.slice.call(inp.files || []); inp.remove(); resolve(f); });
      inp.addEventListener('cancel', function () { inp.remove(); resolve([]); });
      inp.click();
    });
  }
  function readBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); });
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    // Released late: a large file can still be being handed to the download manager after a few seconds.
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
  }
  /* Where a file goes. Asked first, while the click that started the save still counts (the browser's Save As
     needs one), so that a long preparation can follow:
       { handle, name }          Save As: the user chose the name and the folder
       { name, download: true }  no Save As here: a download to the browser's folder
       null                      cancelled
     o: { title, description (of the file type), pickerId (the folder the browser remembers), askName (false: no
     filename prompt in the download case) } */
  async function chooseSaveTarget(name, mime, o) {
    o = o || {};
    var ext = (/\.[A-Za-z0-9]+$/.exec(name) || [''])[0].toLowerCase(), type = String(mime || 'application/octet-stream').split(';')[0].trim();
    if (typeof window.showSaveFilePicker === 'function' && window.isSecureContext !== false) {
      try {
        var accept = {}; if (ext) accept[type] = [ext];
        var handle = await window.showSaveFilePicker({
          id: String(o.pickerId || 'powder6-save').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'powder6-save', suggestedName: name,
          types: ext ? [{ description: o.description || (ext.slice(1).toUpperCase() + ' file'), accept: accept }] : undefined
        });
        return { handle: handle, name: handle.name };
      } catch (error) {
        if (error.name === 'AbortError') return null;
        // The picker refuses without a recent click or in some embedded pages: download instead.
        if (error.name !== 'SecurityError' && error.name !== 'NotAllowedError') throw error;
      }
    }
    if (o.askName === false) return { name: name, download: true };
    var choice = await prompt(o.title || 'Save file', [
      { key: 'filename', label: 'Filename', type: 'text', value: name }
    ], 'Download', 'Your browser controls the download folder. To choose the location, enable “Ask where to save each file” in its download settings.', {
      check: function (v) { return !v.filename.trim() || /[\\/:*?"<>|]/.test(v.filename) ? 'Enter a filename without folder separators or reserved characters.' : ''; }
    });
    if (!choice) return null;
    var filename = choice.filename.trim();
    if (ext && filename.toLowerCase().slice(-ext.length) !== ext) filename += ext;
    return { name: filename, download: true };
  }
  // data: a string, a typed array or a Blob
  async function writeSaveTarget(target, data, mime) {
    if (!target.handle) { download(target.name, data, mime); return target; }
    var writable;
    try {
      writable = await target.handle.createWritable();
      await writable.write(data instanceof Blob ? data : new Blob([data], { type: mime }));
      await writable.close();
      return target;
    } catch (error) {
      if (writable && typeof writable.abort === 'function') {
        try { await writable.abort(); } catch (abortError) { /* keep the original error */ }
      }
      throw error;
    }
  }
  async function saveTextFile(name, text, mime, o) {
    mime = mime || 'application/json';
    var target = await chooseSaveTarget(name, mime, o);
    if (!target) return null;
    await writeSaveTarget(target, text, mime);
    return { name: target.name, downloaded: !!target.download };
  }
  function fileStamp() { return stamp().replace(/[-: ]/g, '').slice(0, 12); }

  // ---------------------------------------------------------------- progress (total < 0: indeterminate)
  function progress(done, total, label) {
    var p = $('#fit-progress');
    if (!p) return;
    var bar = p.querySelector('i'), lab = p.querySelector('span');
    p.hidden = !total;
    p.classList.toggle('indet', total < 0);
    bar.style.width = total > 0 ? (100 * Math.min(1, done / total)).toFixed(1) + '%' : (total < 0 ? '' : '0');
    lab.textContent = label || (total > 0 ? done + ' / ' + total : (total < 0 ? 'working' : ''));
    if (total) busyProgress(total > 0 ? done / total : -1, label || (total > 0 ? done + ' / ' + total : ''));
  }
  // ---------------------------------------------------------------- the running panel (#busy-guard): progress and elapsed time
  var busyText = '', busyStart = 0, busyTimer = 0;
  function paintBusyDetail() {
    var d = $('#busy-detail');
    if (!d) return;
    var s = busyStart ? Math.floor((Date.now() - busyStart) / 1000) : 0, t = s >= 60 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : s + ' s';
    d.textContent = (busyText ? busyText + ' · ' : '') + t;
  }
  // frac < 0: no measure of progress (the bar sweeps)
  function busyProgress(frac, text) {
    var tr = $('#busy-track');
    if (!tr) return;
    tr.classList.toggle('indet', !(frac >= 0));
    tr.querySelector('i').style.width = frac >= 0 ? (100 * Math.min(1, frac)).toFixed(1) + '%' : '';
    busyText = text || '';
    paintBusyDetail();
  }
  function busyRun(on) {
    clearInterval(busyTimer); busyTimer = 0;
    if (on) { busyStart = Date.now(); busyProgress(-1, ''); busyTimer = setInterval(paintBusyDetail, 1000); }
    else { busyStart = 0; busyText = ''; }
  }

  // ---------------------------------------------------------------- help on buttons, labels and fields
  /* A popup instead of the native tooltip, which browsers cut short: the text of the button's title (paragraphs at blank
     lines), or its data-help-html (markup written by the app). It opens on hover or focus, stays while the pointer is on
     it (long help scrolls), and lives in the open dialog when the button is in one (a modal dialog is above the page). */
  var helpFor = null, helpTimer = 0;
  function helpPop(parent) {
    var pop = parent.querySelector(':scope > .help-pop');
    if (!pop) {
      pop = h('div', { class: 'help-pop', role: 'tooltip', id: parent === document.body ? 'help-pop' : 'help-pop-dlg', hidden: '' });
      pop.addEventListener('pointerenter', function () { clearTimeout(helpTimer); });
      pop.addEventListener('pointerleave', function () { hideHelp(150); });
      parent.appendChild(pop);
    }
    return pop;
  }
  function showHelp(btn) {
    clearTimeout(helpTimer);
    if (btn.hasAttribute('title')) { btn.setAttribute('data-help', btn.getAttribute('title')); btn.removeAttribute('title'); }
    var html = btn.getAttribute('data-help-html'), text = btn.getAttribute('data-help') || '';
    if (!html && !text) return;
    var pop = helpPop(btn.closest('dialog[open]') || document.body);
    if (helpFor && helpFor !== btn) {
      helpFor.removeAttribute('aria-describedby');
      document.querySelectorAll('.help-pop').forEach(function(other){if(other!==pop)other.hidden=true;});
    }
    pop.innerHTML = html || text.split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p.trim()) + '</p>'; }).join('');
    pop.setAttribute('role',pop.querySelector('button')?'group':'tooltip');
    pop.style.maxHeight = ''; pop.hidden = false; pop.scrollTop = 0; helpFor = btn; btn.setAttribute('aria-describedby', pop.id);
    // below the button, or above it when that side has more room; too long for either side, it scrolls
    var r = btn.getBoundingClientRect(), below = window.innerHeight - r.bottom - 14, above = r.top - 14, down = pop.offsetHeight <= below || below >= above;
    pop.style.maxHeight = Math.max(120, down ? below : above) + 'px';
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2))) + 'px';
    pop.style.top = Math.round(down ? r.bottom + 6 : Math.max(8, r.top - 6 - ph)) + 'px';
  }
  function hideHelp(delay) {
    clearTimeout(helpTimer);
    helpTimer = setTimeout(function () {
      document.querySelectorAll('.help-pop').forEach(function (p) { p.hidden = true; });
      if (helpFor) helpFor.removeAttribute('aria-describedby');
      helpFor = null;
    }, delay || 0);
  }
  document.addEventListener('pointerover', function (e) { var b = e.target.closest && e.target.closest('.help-q,[data-help],[data-help-html]'); if (b) showHelp(b); });
  document.addEventListener('pointerout', function (e) { var b = e.target.closest && e.target.closest('.help-q,[data-help],[data-help-html]'); if (b && b === helpFor && !b.contains(e.relatedTarget)) hideHelp(150); });
  document.addEventListener('focusin', function (e) { var b = e.target.closest && e.target.closest('.help-q,[data-help],[data-help-html]'); if (b) showHelp(b); else if (helpFor && !(e.target.closest && e.target.closest('.help-pop'))) hideHelp(0); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && helpFor) hideHelp(0); });
  window.addEventListener('scroll', function (e) { if (helpFor && !(e.target.closest && e.target.closest('.help-pop'))) hideHelp(0); }, true);

  return { modal: modal, prompt: prompt, confirm: confirm, fieldHTML: fieldHTML, collect: collect, toast: toast, log: log,
           logEntries: logEntries, logLoad: logLoad, menu: menu, closeMenu: closeMenu, able: able, pickFiles: pickFiles,
           readBuffer: readBuffer, download: download, saveTextFile: saveTextFile, chooseSaveTarget: chooseSaveTarget, writeSaveTarget: writeSaveTarget, fileStamp: fileStamp, stamp: stamp, progress: progress, busyProgress: busyProgress, busyRun: busyRun,
           esc: esc, h: h, parseNum: parseNum, fmt: fmt, withEsd: withEsd };
})();
