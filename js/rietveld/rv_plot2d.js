/*  Plot2D -- the canvas plot of Yappari JS, for powder patterns.
 *  new RV.Plot2D(hostElement, opts)
 *  opts: ylog, ysqrt (square-root intensity axis), xlabel, ylabel, legend, legendMax, tooltip(series, i) -> html,
 *        band (pixels kept free at the bottom of the frame for reflection ticks), onView(view), empty (text).
 *  series: { name, group, x, y, color, mode 'markers'|'lines'|'ticks', size, width, dash, legend, hover, noAuto }
 *          'ticks': x only (reflection positions), drawn as short bars in row `row` of the bottom band.
 *  Mouse: drag = zoom box (a thin box zooms one axis), shift-drag or right-drag = pan, wheel = zoom,
 *         double-click = autoscale, click on a legend entry = hide or show that group.
 *         With opts.onMark / opts.onRegion (data coordinates): Ctrl (or Cmd) + click = onMark(x, y);
 *         Ctrl + Shift + drag = onRegion(x0, x1), Ctrl + Shift + click = onRegion(x, x).
 *         Right-drag on an anchor uses onAnchorStart/Drag/End; otherwise it pans.
 *  The view is stored in axis units (log10 or sqrt for those axes). Colours, fonts and sizes come from the CSS.
 */
RV.Plot2D = (function () {
  'use strict';
  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function sup(n) { return String(n).split('').map(function (c) { return SUP[c] || c; }).join(''); }
  function niceStep(span, target) {
    var raw = span / Math.max(target, 1), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  }
  var MAX_TICKS = 200, ROW = 9;
  function tickCount(first, last, step) {
    var n = Math.floor((last - first) / step + 1e-9) + 1;
    if (!(n > 0) || !isFinite(n) || first + step === first) return 0;
    return Math.min(n, MAX_TICKS);
  }
  function roundOff(a, b, log) { return b - a <= 1e-12 * Math.max(Math.abs(a), Math.abs(b), log ? 1 : 0); }
  function linTicks(v0, v1, target) {
    var step = niceStep(v1 - v0, target), t = [], s = Math.ceil(v0 / step) * step, n = tickCount(s, v1, step);
    for (var i = 0; i < n; i++) { var v = s + i * step; t.push(Math.abs(v) < step * 1e-9 ? 0 : v); }
    var big = Math.max(Math.abs(v0), Math.abs(v1)), e = big > 0 ? Math.floor(Math.log10(big)) : 0, exp = 0;
    if (e >= 5 || e <= -3) exp = e;
    var sc = Math.pow(10, exp), dec = Math.max(0, Math.min(8, -Math.floor(Math.log10(step / sc) + 1e-9)));
    return { ticks: t, labels: t.map(function (v) { return (v / sc).toFixed(dec); }), exp: exp, minor: [] };
  }
  function logTicks(v0, v1, target) {
    var d0 = Math.ceil(v0 - 1e-9), d1 = Math.floor(v1 + 1e-9), span = v1 - v0, t = [], labels = [], minor = [], i;
    var stride = Math.max(1, Math.ceil((d1 - d0 + 1) / Math.max(target, 2))), n = tickCount(d0, d1, stride);
    for (i = 0; i < n; i++) { var d = d0 + i * stride; t.push(d); labels.push('10' + sup(d)); }
    var m0 = Math.floor(v0), nm = span <= 8 ? tickCount(m0, Math.ceil(v1), 1) : 0;
    for (i = 0; i < nm; i++) for (var k = 2; k <= 9; k++) { var v = m0 + i + Math.log10(k); if (v > v0 && v < v1) minor.push(v); }
    if (t.length < 2 && span < 1.2) {
      var lt = linTicks(Math.pow(10, v0), Math.pow(10, v1), target), tt = [], ll = [];
      lt.ticks.forEach(function (vv, j) { if (vv > 0) { tt.push(Math.log10(vv)); ll.push(lt.labels[j]); } });
      return { ticks: tt, labels: ll, exp: lt.exp, minor: [] };
    }
    return { ticks: t, labels: labels, exp: 0, minor: minor };
  }
  // square-root axis: nice values of the data, placed at their square roots
  function sqrtTicks(v0, v1, target) {
    var a = v0 < 0 ? -v0 * v0 : v0 * v0, b = v1 < 0 ? -v1 * v1 : v1 * v1, lt = linTicks(a, b, target), t = [], l = [];
    lt.ticks.forEach(function (v, i) { t.push(v < 0 ? -Math.sqrt(-v) : Math.sqrt(v)); l.push(lt.labels[i]); });
    return { ticks: t, labels: l, exp: lt.exp, minor: [] };
  }

  function Plot2D(host, opts) {
    this.o = Object.assign({ ylog: false, ysqrt: false, xlabel: '', ylabel: '', legend: true, legendMax: 12, band: 0,
                             tooltip: null, onView: null, empty: '' }, opts || {});
    this.host = host; this.series = []; this.view = null; this.auto = true; this.hidden = new Set();
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.legendHits = []; this.drag = null;
    if (host) {
      this.canvas.className = 'plot-canvas';
      host.appendChild(this.canvas);
      this.tip = document.createElement('div'); this.tip.className = 'plot-tip'; this.tip.hidden = true;
      host.appendChild(this.tip);
      this._bind();
      var self = this;
      if (window.ResizeObserver) { this.ro = new ResizeObserver(function () { self.resize(); }); this.ro.observe(host); }
    }
    this.resize();
  }
  var P = Plot2D.prototype;

  P.resize = function () {
    var w = this.host ? this.host.clientWidth : this.o.width, h = this.host ? this.host.clientHeight : this.o.height;
    if (!w || !h) return;
    var T = RV.theme.get(), k = T.fontSize / 11, kt = T.titleSize / 12;
    var m = this.o.margin || { l: Math.round(52 * k + 18 * kt), r: Math.round(14 * k), t: Math.round(10 * k), b: Math.round(this.o.xlabel ? 24 * k + 16 * kt : 22 * k) };
    var dpr = this.host ? (window.devicePixelRatio || 1) : (this.o.scale || 1);
    this.W = w; this.H = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    if (this.host) { this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; }
    this.box = { x0: m.l, x1: w - m.r, y0: m.t, y1: h - m.b };
    if (this.view && this.auto) { this.autoscale(true); return; }
    this.draw();
  };
  P.setOptions = function (o) { Object.assign(this.o, o); this.resize(); };
  P.setSeries = function (list, keep) {
    this.series = list || [];
    if (!keep || this.auto || !this.view) this.autoscale(true); else this.draw();
  };
  P.tx = function (v) { return v; };
  P.ty = function (v) { return this.o.ylog ? (v > 0 ? Math.log10(v) : NaN) : this.o.ysqrt ? (v < 0 ? -Math.sqrt(-v) : Math.sqrt(v)) : v; };
  P.uy = function (a) { return this.o.ylog ? Math.pow(10, a) : this.o.ysqrt ? (a < 0 ? -a * a : a * a) : a; };
  P.px = function (a) { var b = this.box, v = this.view; return b.x0 + (a - v.x0) / (v.x1 - v.x0) * (b.x1 - b.x0); };
  P.py = function (a) { var b = this.box, v = this.view; return b.y1 - (a - v.y0) / (v.y1 - v.y0) * (b.y1 - b.y0); };
  P.ix = function (p) { var b = this.box, v = this.view; return v.x0 + (p - b.x0) / (b.x1 - b.x0) * (v.x1 - v.x0); };
  P.iy = function (p) { var b = this.box, v = this.view; return v.y0 + (b.y1 - p) / (b.y1 - b.y0) * (v.y1 - v.y0); };
  P.visibleSeries = function () { var hd = this.hidden; return this.series.filter(function (s) { return !hd.has(s.group); }); };

  // free pixels at the bottom of the frame for the tick rows, kept by extending the lower end of the y range
  P._band = function (y0, y1) {
    var band = this.o.band, ph = this.box ? this.box.y1 - this.box.y0 : 0;
    if (!(band > 0) || !(ph > band + 20)) return y0;
    return y0 - (y1 - y0) * band / (ph - band);
  };
  P.autoscale = function (silent) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, self = this;
    this.visibleSeries().forEach(function (s) {
      if (s.noAuto || s.mode === 'ticks') return;
      for (var i = 0; i < s.x.length; i++) {
        var a = s.x[i], b = self.ty(s.y[i]);
        if (!isFinite(a) || !isFinite(b)) continue;
        if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
      }
    });
    if (!isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    var pad = function (a, b, log, frac) {
      if (roundOff(a, b, log)) { var c = (a + b) / 2, d = log ? 0.5 : (Math.abs(c) * 0.1 || 1); return [c - d, c + d]; }
      var p = (b - a) * frac; return [a - p, b + p];
    };
    var X = [x0, x1], Yr = pad(y0, y1, this.o.ylog, 0.04);
    if (roundOff(x0, x1, false)) X = pad(x0, x1, false, 0);
    Yr[0] = this._band(Yr[0], Yr[1]);
    this.view = { x0: X[0], x1: X[1], y0: Yr[0], y1: Yr[1] };
    this.auto = true;
    this.draw();
    if (!silent && this.o.onView) this.o.onView(this.view);
  };
  P.setXView = function (x0, x1) {
    if (!this.view) return;
    this.view.x0 = x0; this.view.x1 = x1; this.auto = false;
    var self = this, y0 = Infinity, y1 = -Infinity;
    this.visibleSeries().forEach(function (s) {
      if (s.noAuto || s.mode === 'ticks') return;
      for (var i = 0; i < s.x.length; i++) {
        var a = s.x[i], bb = self.ty(s.y[i]);
        if (a >= x0 && a <= x1 && isFinite(bb)) { if (bb < y0) y0 = bb; if (bb > y1) y1 = bb; }
      }
    });
    if (isFinite(y0)) {
      var p = !roundOff(y0, y1, this.o.ylog) ? (y1 - y0) * 0.06 : (this.o.ylog ? 0.5 : Math.abs(y0) * 0.1 || 1);
      this.view.y0 = this._band(y0 - p, y1 + p); this.view.y1 = y1 + p;
    }
    this.draw();
  };

  // ---------------------------------------------------------------- drawing
  P.draw = function () {
    if (!this.W || !this.view) return;
    var c = this.ctx, T = this._T = RV.theme.get(), b = this.box, self = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = T.bg; c.fillRect(0, 0, this.W, this.H);
    c.font = T.fontSize + 'px ' + T.font; c.lineWidth = 1;
    var xt = linTicks(this.view.x0, this.view.x1, Math.max(2, (b.x1 - b.x0) / 80));
    var yTarget = Math.max(2, (b.y1 - b.y0) / 45);
    var yt = this.o.ylog ? logTicks(this.view.y0, this.view.y1, yTarget) : this.o.ysqrt ? sqrtTicks(this.view.y0, this.view.y1, yTarget) : linTicks(this.view.y0, this.view.y1, yTarget);
    // the band of reflection ticks at the bottom carries no intensity: no grid lines or labels there
    var yLow = this.o.band > 0 && this._band(0, 1) < 0 ? b.y1 - this.o.band : b.y1;
    c.strokeStyle = T.minor; c.beginPath();
    yt.minor.forEach(function (v) { var p = Math.round(self.py(v)) + 0.5; if (p <= yLow) { c.moveTo(b.x0, p); c.lineTo(b.x1, p); } });
    c.stroke();
    c.strokeStyle = T.grid; c.beginPath();
    xt.ticks.forEach(function (v) { var p = Math.round(self.px(v)) + 0.5; if (p >= b.x0 && p <= b.x1) { c.moveTo(p, b.y0); c.lineTo(p, b.y1); } });
    yt.ticks.forEach(function (v) { var p = Math.round(self.py(v)) + 0.5; if (p >= b.y0 && p <= yLow) { c.moveTo(b.x0, p); c.lineTo(b.x1, p); } });
    c.stroke();
    if (yLow < b.y1) { c.strokeStyle = T.grid; c.beginPath(); c.moveTo(b.x0, Math.round(yLow) + 0.5); c.lineTo(b.x1, Math.round(yLow) + 0.5); c.stroke(); }
    c.strokeStyle = T.axis;
    if (!this.o.ylog && this.view.y0 < 0 && this.view.y1 > 0) { var zy = Math.round(this.py(0)) + 0.5; c.beginPath(); c.moveTo(b.x0, zy); c.lineTo(b.x1, zy); c.stroke(); }
    c.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
    c.fillStyle = T.ink2; c.textAlign = 'center'; c.textBaseline = 'top';
    xt.ticks.forEach(function (v, i) { var p = self.px(v); if (p >= b.x0 - 1 && p <= b.x1 + 1) c.fillText(xt.labels[i], p, b.y1 + 5); });
    c.textAlign = 'right'; c.textBaseline = 'middle';
    yt.ticks.forEach(function (v, i) { var p = self.py(v); if (p >= b.y0 - 1 && p <= yLow + 1) c.fillText(yt.labels[i], b.x0 - 6, p); });
    if (yt.exp) { c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('×10' + sup(yt.exp), b.x0 + 4, b.y0 + 3); }
    c.fillStyle = T.ink; c.font = T.titleSize + 'px ' + T.font;
    if (this.o.xlabel) { c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(this.o.xlabel, (b.x0 + b.x1) / 2, this.H - 4); }
    if (this.o.ylabel) {
      c.save(); c.translate(7 + T.titleSize / 2, (b.y0 + b.y1) / 2); c.rotate(-Math.PI / 2);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(this.o.ylabel, 0, 0); c.restore();
    }
    c.save(); c.beginPath(); c.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); c.clip();
    var vis = this.visibleSeries();
    vis.forEach(function (s) { if (s.mode === 'shade') self._shade(c, s); });
    vis.forEach(function (s) { if (s.mode === 'lines') self._line(c, s); });
    vis.forEach(function (s) { if (s.mode === 'vline') self._vline(c, s); });
    vis.forEach(function (s) { if (s.mode === 'markers') self._markers(c, s); });
    vis.forEach(function (s) { if (s.mode === 'ticks') self._ticks(c, s); });
    c.restore();
    if (this.hoverPt) {
      var hb = 4.5 * T.ms;
      c.strokeStyle = T.ink; c.lineWidth = 1.5 * T.ls;
      c.strokeRect(this.hoverPt[0] - hb, this.hoverPt[1] - hb, 2 * hb, 2 * hb);
    }
    if (!this.series.length && this.o.empty) {
      c.fillStyle = T.ink2; c.font = Math.round(T.titleSize * 13 / 12) + 'px ' + T.font; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(this.o.empty, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.max(1, b.x1 - b.x0 - 16));
    }
    this._legend(c, T);
    if (this.drag && this.drag.mode === 'region' && this.drag.moved) {
      var g = this.drag, gx = Math.min(g.x, g.cx), gw = Math.abs(g.cx - g.x);
      c.fillStyle = T.excluded; c.fillRect(gx, b.y0, gw, b.y1 - b.y0);
      c.strokeStyle = T.zoomLine; c.lineWidth = 1; c.strokeRect(gx + 0.5, b.y0 + 0.5, gw, b.y1 - b.y0);
    }
    if (this.drag && this.drag.mode === 'zoom' && this.drag.moved) {
      var d = this.drag;
      c.fillStyle = T.zoomFill; c.strokeStyle = T.zoomLine; c.lineWidth = 1;
      var rx = Math.min(d.x, d.cx), ry = Math.min(d.y, d.cy), rw = Math.abs(d.cx - d.x), rh = Math.abs(d.cy - d.y);
      if (rh < 5) { ry = b.y0; rh = b.y1 - b.y0; } else if (rw < 5) { rx = b.x0; rw = b.x1 - b.x0; }
      c.fillRect(rx, ry, rw, rh); c.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    }
  };

  P._legend = function (c, T) {
    this.legendHits = [];
    if (!this.o.legend) return;
    var groups = [], seen = {}, self = this;
    this.series.forEach(function (s) {
      if (!s.legend || seen[s.group]) return;
      seen[s.group] = true;
      groups.push({ group: s.group, name: s.name, color: s.color, dash: s.dash, mode: s.mode });
    });
    if (!groups.length) return;
    var more = groups.length - this.o.legendMax;
    if (more > 0) groups = groups.slice(0, this.o.legendMax);
    c.font = T.fontSize + 'px ' + T.font;
    var wMax = 0;
    groups.forEach(function (g) { wMax = Math.max(wMax, c.measureText(g.name).width); });
    var lh = T.fontSize + 4, w = Math.min(wMax + 30, 240), h = groups.length * lh + 8 + (more > 0 ? lh : 0);
    var x = this.box.x1 - w - 6, y = this.box.y0 + 6;
    if (h > this.box.y1 - this.box.y0 - 12) return;
    c.globalAlpha = 0.9; c.fillStyle = T.bg; c.fillRect(x, y, w, h); c.globalAlpha = 1;
    c.strokeStyle = T.grid; c.strokeRect(x + 0.5, y + 0.5, w, h);
    c.textAlign = 'left'; c.textBaseline = 'middle';
    groups.forEach(function (g, i) {
      var yy = y + 4 + i * lh + lh / 2, off = self.hidden.has(g.group);
      c.globalAlpha = off ? 0.35 : 1;
      c.strokeStyle = g.color; c.fillStyle = g.color; c.lineWidth = 1.5 * T.ls;
      if (g.mode === 'ticks') { c.beginPath(); c.moveTo(x + 13, yy - 5); c.lineTo(x + 13, yy + 5); c.stroke(); }
      else if (g.mode === 'markers') { var mk = 3.5 * T.ms; c.fillRect(x + 13.25 - mk / 2, yy - mk / 2, mk, mk); }
      else { c.setLineDash((g.dash || []).map(function (v) { return v * T.ls; })); c.beginPath(); c.moveTo(x + 6, yy); c.lineTo(x + 20, yy); c.stroke(); c.setLineDash([]); }
      c.fillStyle = T.ink;
      var name = g.name;
      while (c.measureText(name).width > w - 30 && name.length > 4) name = name.slice(0, -2);
      c.fillText(name === g.name ? name : name + '…', x + 25, yy);
      c.globalAlpha = 1;
      self.legendHits.push({ x0: x, x1: x + w, y0: yy - lh / 2, y1: yy + lh / 2, group: g.group });
    });
    if (more > 0) { c.fillStyle = T.ink2; c.fillText('+' + more + ' more', x + 25, y + 4 + groups.length * lh + lh / 2); }
  };

  // ---------------------------------------------------------------- interaction
  P._bind = function () {
    var self = this, cv = this.canvas;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function inBox(p) { var b = self.box; return p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1; }
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) {
      var p = pos(e);
      if (!self.view || !inBox(p)) return;
      var mod = (e.ctrlKey || e.metaKey) && (e.button === 0 || e.button === 2) && (self.o.onMark || self.o.onRegion);
      var anchor = !mod && e.button === 2 && self.o.onAnchorStart ? self.o.onAnchorStart(p[0], p[1]) : null;
      var pan = !mod && (e.button === 2 || e.shiftKey || e.button === 1);
      self.drag = { mode: anchor ? 'anchor' : mod ? (e.shiftKey ? 'region' : 'mark') : (pan ? 'pan' : 'zoom'), anchor:anchor, x: p[0], y: p[1], cx: p[0], cy: p[1], v: Object.assign({}, self.view), moved: false };
      if (anchor) { self.auto = false; self.tip.hidden = true; self.hoverPt = null; }
      e.preventDefault();
    });
    window.addEventListener('mousemove', self._winMove = function (e) {
      var d = self.drag;
      if (!d) return;
      var p = pos(e);
      d.cx = Math.max(self.box.x0, Math.min(self.box.x1, p[0])); d.cy = Math.max(self.box.y0, Math.min(self.box.y1, p[1]));
      if (Math.abs(p[0] - d.x) + Math.abs(p[1] - d.y) > 3) d.moved = true;
      if (d.mode === 'anchor' && d.moved && self.o.onAnchorDrag) {
        var at = self.dataAt(d.cx, d.cy); self.o.onAnchorDrag(d.anchor, at[0], at[1]);
      }
      if (d.mode === 'pan' && d.moved) {
        var b = self.box, v = d.v, dx = (p[0] - d.x) / (b.x1 - b.x0) * (v.x1 - v.x0), dy = (p[1] - d.y) / (b.y1 - b.y0) * (v.y1 - v.y0);
        self.view = { x0: v.x0 - dx, x1: v.x1 - dx, y0: v.y0 + dy, y1: v.y1 + dy };
        self.auto = false;
        if (self.o.onView) self.o.onView(self.view);
      }
      self.draw();
    });
    window.addEventListener('mouseup', self._winUp = function (e) {
      var d = self.drag;
      if (!d) return;
      self.drag = null;
      if (d.mode === 'anchor') {
        var p = pos(e);
        d.cx = Math.max(self.box.x0, Math.min(self.box.x1, p[0])); d.cy = Math.max(self.box.y0, Math.min(self.box.y1, p[1]));
        if (Math.abs(p[0] - d.x) + Math.abs(p[1] - d.y) > 3) d.moved = true;
        if (self.o.onAnchorEnd) { var at = self.dataAt(d.cx, d.cy); self.o.onAnchorEnd(d.anchor, at[0], at[1], d.moved); }
        self.draw(); return;
      }
      if (d.mode === 'region' || d.mode === 'mark') {
        self.draw();
        if (d.mode === 'region' && self.o.onRegion) { var a0 = self.ix(Math.min(d.x, d.cx)), a1 = self.ix(Math.max(d.x, d.cx)); self.o.onRegion(d.moved ? a0 : self.ix(d.x), d.moved ? a1 : self.ix(d.x)); }
        else if (d.mode === 'mark' && !d.moved && self.o.onMark) { var dv0 = self.dataAt(d.x, d.y); self.o.onMark(dv0[0], dv0[1], d.x, d.y); }
        return;
      }
      if (d.mode === 'zoom' && d.moved) {
        var w = Math.abs(d.cx - d.x), h = Math.abs(d.cy - d.y), v = self.view;
        var X0 = self.ix(Math.min(d.x, d.cx)), X1 = self.ix(Math.max(d.x, d.cx)), Y0 = self.iy(Math.max(d.y, d.cy)), Y1 = self.iy(Math.min(d.y, d.cy));
        if (w >= 5 && h >= 5) self.view = { x0: X0, x1: X1, y0: Y0, y1: Y1 };
        else if (w >= 5) { self.setXView(X0, X1); if (self.o.onView) self.o.onView(self.view); return; }
        else if (h >= 5) self.view = { x0: v.x0, x1: v.x1, y0: Y0, y1: Y1 };
        self.auto = false;
        self.draw();
        if (self.o.onView) self.o.onView(self.view);
      } else if (!d.moved) {
        var hit = self.legendHits.filter(function (h2) { return d.x >= h2.x0 && d.x <= h2.x1 && d.y >= h2.y0 && d.y <= h2.y1; })[0];
        if (hit) { if (self.hidden.has(hit.group)) self.hidden.delete(hit.group); else self.hidden.add(hit.group); self.draw(); if (self.o.onLegend) self.o.onLegend(); }
        else if (self.o.onClick) { var dv = self.dataAt(d.x, d.y); self.o.onClick(dv[0], dv[1]); }
      }
    });
    cv.addEventListener('dblclick', function () { self.hidden.clear(); self.autoscale(); });
    window.addEventListener('keydown', self._winKey = function (e) {
      if (e.key !== 'Escape' || !self.drag || self.drag.mode !== 'anchor') return;
      var d = self.drag; self.drag = null;
      if (self.o.onAnchorEnd) self.o.onAnchorEnd(d.anchor, 0, 0, false);
      self.draw(); e.preventDefault();
    });
    cv.addEventListener('wheel', function (e) {
      if (!self.view) return;
      var p = pos(e);
      if (!inBox(p)) return;
      e.preventDefault();
      var k = Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0015))), ax = self.ix(p[0]), ay = self.iy(p[1]), v = self.view;
      if (e.altKey) self.view = { x0: v.x0, x1: v.x1, y0: ay + (v.y0 - ay) * k, y1: ay + (v.y1 - ay) * k };       // intensity only
      else self.view = { x0: ax + (v.x0 - ax) * k, x1: ax + (v.x1 - ax) * k, y0: v.y0, y1: v.y1 };                   // 2-theta about the cursor
      self.auto = false; self.draw();
      clearTimeout(self._wt);
      self._wt = setTimeout(function () { if (self.o.onView) self.o.onView(self.view); }, 80);
    }, { passive: false });
    cv.addEventListener('mousemove', function (e) {
      if (self.drag || !self.o.tooltip) return;
      var p = pos(e);
      if (self._raf) return;
      self._raf = requestAnimationFrame(function () { self._raf = 0; self._hover(p); });
    });
    cv.addEventListener('mouseleave', function () { self.tip.hidden = true; if (self.hoverPt) { self.hoverPt = null; self.draw(); } });
  };
  P._hover = function (p) {
    var best = this._nearest(p, 100);
    if (!best) { this.tip.hidden = true; if (this.hoverPt) { this.hoverPt = null; this.draw(); } return; }
    this.hoverPt = best.s.mode === 'ticks' ? null : [best.X, best.Yp];
    this.draw();
    this.tip.innerHTML = this.o.tooltip(best.s, best.i);
    this.tip.hidden = false;
    var tw = this.tip.offsetWidth, th = this.tip.offsetHeight, hw = this.host.clientWidth || this.W, hh = this.host.clientHeight || this.H;
    var x = best.X + 12, y = best.Yp + 12;
    if (x + tw > hw) x = best.X - tw - 12;
    if (y + th > hh) y = best.Yp - th - 12;
    this.tip.style.left = Math.max(0, x) + 'px'; this.tip.style.top = Math.max(0, y) + 'px';
  };
  P._xy = function (s, i) {
    var b = this.ty(s.y[i]);
    return (isFinite(s.x[i]) && isFinite(b)) ? [this.px(s.x[i]), this.py(b)] : null;
  };
  // the pixel rows of the tick band: row 0 nearest the bottom of the frame
  P._tickRow = function (row) { var b = this.box, y1 = b.y1 - 4 - row * ROW; return [y1 - ROW + 2, y1]; };
  P._ticks = function (c, s) {
    var r = this._tickRow(s.row || 0), b = this.box, i;
    c.strokeStyle = s.color; c.lineWidth = Math.max(1, 1.2 * this._T.ls); c.beginPath();
    for (i = 0; i < s.x.length; i++) {
      var X = this.px(s.x[i]);
      if (X < b.x0 || X > b.x1) continue;
      X = Math.round(X) + 0.5;
      c.moveTo(X, r[0]); c.lineTo(X, r[1]);
    }
    c.stroke();
  };
  P._shade = function (c, s) {                                   // excluded or unfitted 2-theta intervals: x pairs
    var b = this.box;
    c.fillStyle = s.color; c.globalAlpha = 1;
    for (var i = 0; i + 1 < s.x.length; i += 2) {
      var a = Math.max(b.x0, this.px(s.x[i])), e = Math.min(b.x1, this.px(s.x[i + 1]));
      if (e > a) c.fillRect(a, b.y0, e - a, b.y1 - b.y0);
    }
  };
  P._line = function (c, s) {
    var pen = false, i, p, ls = this._T.ls, x0 = this.view.x0, x1 = this.view.x1, n = s.x.length;
    c.lineWidth = (s.width || 1.5) * ls; c.setLineDash((s.dash || []).map(function (v) { return v * ls; }));
    c.strokeStyle = s.color; c.globalAlpha = s.alpha != null ? s.alpha : 1; c.beginPath();
    // only the visible stretch, with one point either side
    var lo = 0, hi = n - 1;
    while (lo < n - 1 && s.x[lo + 1] < x0) lo++;
    while (hi > 0 && s.x[hi - 1] > x1) hi--;
    for (i = lo; i <= hi; i++) {
      p = this._xy(s, i);
      if (!p) { pen = false; continue; }
      if (pen) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); pen = true; }
    }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  };
  P._vline = function (c, s) {
    c.strokeStyle = s.color; c.lineWidth = (s.width || 1.5) * this._T.ls;
    c.setLineDash(s.dash || []); c.beginPath();
    for (var i=0;i<s.x.length;i++) { var x=this.px(s.x[i]); c.moveTo(x,this.box.y0); c.lineTo(x,this.box.y1); }
    c.stroke(); c.setLineDash([]);
  };
  P._markers = function (c, s) {
    var T = this._T, sz = (s.size || 3.2) * T.ms, h = sz / 2, i, p, x0 = this.view.x0, x1 = this.view.x1;
    c.fillStyle = s.color; c.globalAlpha = s.alpha != null ? s.alpha : 1;
    if (s.hollow) { c.strokeStyle = s.color; c.lineWidth = s.lineWidth || 1; }
    for (i = 0; i < s.x.length; i++) {
      if (s.x[i] < x0 || s.x[i] > x1) continue;
      p = this._xy(s, i);
      if (!p) continue;
      if (s.hollow) c.strokeRect(p[0] - h - 0.5, p[1] - h - 0.5, sz + 1, sz + 1); else c.fillRect(p[0] - h, p[1] - h, sz, sz);
    }
    c.globalAlpha = 1;
  };
  P._nearest = function (p, maxD2) {
    var best = null, bd = maxD2, self = this;
    if (!this.view) return null;
    this.visibleSeries().forEach(function (s) {
      if (!s.hover) return;
      if (s.mode === 'ticks') {                                // a tick: the cursor inside its row, nearest in x
        var r = self._tickRow(s.row || 0);
        if (p[1] < r[0] - 2 || p[1] > r[1] + 2) return;
        for (var j = 0; j < s.x.length; j++) {
          var X = self.px(s.x[j]), dx = X - p[0], d2 = dx * dx;
          if (d2 < bd && d2 < 36) { bd = d2; best = { s: s, i: j, X: X, Yp: (r[0] + r[1]) / 2 }; }
        }
        return;
      }
      for (var i = 0; i < s.x.length; i++) {
        var q = self._xy(s, i);
        if (!q) continue;
        var ddx = q[0] - p[0], ddy = q[1] - p[1], d = ddx * ddx + ddy * ddy;
        if (d < bd) { bd = d; best = { s: s, i: i, X: q[0], Yp: q[1] }; }
      }
    });
    return best;
  };
  P.dataAt = function (px, py) { return [this.ix(px), this.uy(this.iy(py))]; };
  P.toDataURL = function () { return this.canvas.toDataURL('image/png'); };
  P.destroy = function () {
    if (this._winMove) window.removeEventListener('mousemove', this._winMove);
    if (this._winUp) window.removeEventListener('mouseup', this._winUp);
    if (this._winKey) window.removeEventListener('keydown', this._winKey);
    if (this.ro) this.ro.disconnect();
  };
  return Plot2D;
})();
