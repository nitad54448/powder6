/*  The PDF report of the selected datasets: for each, the pattern with its difference curve (drawn in the light theme,
 *  as on paper) and the results of the Results tab; then the structure solution of the Solve tab, if there is one.
 *  A small PDF 1.4 writer of its own (no library): A4 pages, the standard fonts Helvetica, Helvetica-Bold and Courier in
 *  WinAnsi encoding (Greek letters spelled out), the plots as JPEG images.
 *  RV.pdf.report()  (the Report button, File menu);  RV.pdf.build(list) -> Uint8Array, for tests.
 */
RV.pdf = (function () {
  'use strict';
  var S = RV.state.S, St = RV.state, ui = RV.ui;
  var PW = 595.28, PH = 841.89, ML = 46, MR = 46, MT = 50, MB = 52, TW = PW - ML - MR;
  var MAX_IMAGES = 30;

  // ---------------------------------------------------------------- text: WinAnsi bytes, widths
  var CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
                 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
                 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  var SPELL = { 'θ': 'theta', 'Θ': 'Theta', 'λ': 'lambda', 'Λ': 'Lambda', 'σ': 'sigma', 'Σ': 'Sum', 'χ': 'chi', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta',
                'Δ': 'Delta', 'ρ': 'rho', 'η': 'eta', 'π': 'pi', 'ω': 'omega', 'Ω': 'Omega', 'φ': 'phi', 'Φ': 'Phi', 'ψ': 'psi', 'ε': 'epsilon', 'κ': 'kappa', 'ν': 'nu',
                'τ': 'tau', 'ξ': 'xi', 'ζ': 'zeta', 'μ': 'mu', '√': 'sqrt', '≤': '<=', '≥': '>=', '≈': '~', '→': '->', '←': '<-', '⟨': '<', '⟩': '>', '−': '-', '‑': '-',
                '′': "'", '″': '"', '∞': 'inf', '✕': 'x', '⚠': '!', '⁻': '^-', '⁺': '^+', '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
                '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', ' ': ' ', ' ': ' ', ' ': ' ' };
  // the string as WinAnsi codes, one per character (what the widths and the PDF string are made of)
  function codes(s) {
    var out = [];
    String(s == null ? '' : s).replace(/\t/g, '   ').split('').forEach(function (ch) {
      var c = ch.charCodeAt(0);
      if (c >= 32 && c < 127) { out.push(c); return; }
      if (c >= 0xA0 && c <= 0xFF) { out.push(c); return; }
      if (CP1252[c]) { out.push(CP1252[c]); return; }
      var sp = SPELL[ch];
      if (sp) { for (var i = 0; i < sp.length; i++) out.push(sp.charCodeAt(i)); return; }
      if (c >= 0xD800 && c <= 0xDBFF) return;      // the first half of a pair: the second one prints the '?'
      out.push(63);
    });
    return out;
  }
  function pdfString(cs) {
    var s = '(';
    cs.forEach(function (c) {
      if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
      else if (c < 32 || c > 126) s += '\\' + ('00' + c.toString(8)).slice(-3);
      else s += String.fromCharCode(c);
    });
    return s + ')';
  }
  // Helvetica and Helvetica-Bold widths of ASCII 32-126 (AFM, 1/1000 em); Courier is 600 throughout
  var HV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
            1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
            333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var HB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
            975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
            333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  var FONTS = { F1: { name: 'Helvetica', w: HV }, F2: { name: 'Helvetica-Bold', w: HB }, F3: { name: 'Courier', w: null } };
  function width(cs, font, size) {
    var t = FONTS[font].w, s = 0;
    cs.forEach(function (c) { s += !t ? 600 : (c >= 32 && c <= 126 ? t[c - 32] : 556); });
    return s * size / 1000;
  }
  // lines of at most maxW points, broken at spaces (a word longer than a line is cut)
  function wrap(text, font, size, maxW) {
    var words = String(text).split(/ +/), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (width(codes(next), font, size) <= maxW || !cur) cur = next;
      else { lines.push(cur); cur = w; }
      while (width(codes(cur), font, size) > maxW && cur.length > 1) {
        var n = cur.length;
        while (n > 1 && width(codes(cur.slice(0, n)), font, size) > maxW) n--;
        lines.push(cur.slice(0, n)); cur = cur.slice(n);
      }
    });
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }

  // ---------------------------------------------------------------- the document: pages of drawing operations
  function Doc() { this.pages = []; this.images = []; this.y = 0; this.page = null; this.newPage(); }
  Doc.prototype.newPage = function () { this.page = []; this.pages.push(this.page); this.y = PH - MT; };
  Doc.prototype.need = function (h) { if (this.y - h < MB) this.newPage(); };
  Doc.prototype.text = function (x, y, s, font, size, grey) {
    this.page.push('BT /' + font + ' ' + size + ' Tf ' + (grey != null ? grey.toFixed(2) + ' g ' : '0 g ') + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td ' + pdfString(codes(s)) + ' Tj ET');
  };
  Doc.prototype.rule = function (y, grey) { this.page.push((grey == null ? 0.75 : grey).toFixed(2) + ' G 0.6 w ' + ML + ' ' + y.toFixed(2) + ' m ' + (PW - MR).toFixed(2) + ' ' + y.toFixed(2) + ' l S'); };
  Doc.prototype.heading = function (s, size, gap) {
    size = size || 12;
    var lines = wrap(s, 'F2', size, TW), lh = size * 1.25;
    this.need((gap || 10) + lines.length * lh + 16);
    this.y -= gap == null ? 10 : gap;
    var self = this;
    lines.forEach(function (l) { self.y -= lh; self.text(ML, self.y + size * 0.22, l, 'F2', size); });
    this.y -= 4;
  };
  Doc.prototype.para = function (s, size, grey) {
    size = size || 9;
    var lines = wrap(s, 'F1', size, TW), lh = size * 1.3, self = this;
    lines.forEach(function (l) { self.need(lh); self.y -= lh; self.text(ML, self.y + size * 0.22, l, 'F1', size, grey); });
  };
  // monospaced lines; a block of lines with tabs is set in columns when it fits, else wrapped with a hanging indent
  Doc.prototype.mono = function (lines, size) {
    size = size || 7.6;
    var cw = 0.6 * size, maxC = Math.floor(TW / cw), lh = size * 1.32, self = this, i = 0;
    function emit(s) { self.need(lh); self.y -= lh; self.text(ML, self.y + size * 0.22, s, 'F3', size); }
    function wrapMono(s) {
      if (codes(s).length <= maxC) { emit(s); return; }
      var first = true;
      while (s.length) {
        var room = first ? maxC : maxC - 4, cut = s.length <= room ? s.length : s.lastIndexOf(' ', room);
        if (cut <= room / 3) cut = Math.min(room, s.length);
        emit((first ? '' : '    ') + s.slice(0, cut));
        s = s.slice(cut).replace(/^ +/, '');
        first = false;
      }
    }
    while (i < lines.length) {
      if (lines[i].indexOf('\t') < 0) { wrapMono(lines[i]); i++; continue; }
      var j = i, rows = [];
      while (j < lines.length && lines[j].indexOf('\t') >= 0) { rows.push(lines[j].split('\t')); j++; }
      var nc = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0), w = [];
      for (var c = 0; c < nc; c++) w.push(rows.reduce(function (m, r) { return Math.max(m, r[c] != null ? codes(r[c]).length : 0); }, 0));
      var total = w.reduce(function (a, b) { return a + b; }, 0) + 2 * (nc - 1);
      rows.forEach(function (r) {
        if (total <= maxC) emit(r.map(function (cell, k) { var t = String(cell); return k < r.length - 1 ? t + new Array(Math.max(0, w[k] - codes(t).length) + 3).join(' ') : t; }).join(''));
        else wrapMono(r.join('   '));
      });
      i = j;
    }
  };
  Doc.prototype.image = function (img, maxH, caption) {
    var w = TW, h = w * img.h / img.w;
    if (maxH && h > maxH) { h = maxH; w = h * img.w / img.h; }
    this.need(h + (caption ? 16 : 6));
    var k = this.images.length;
    this.images.push(img);
    this.y -= h;
    this.page.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + (ML + (TW - w) / 2).toFixed(2) + ' ' + this.y.toFixed(2) + ' cm /Im' + k + ' Do Q');
    if (caption) { this.y -= 11; this.text(ML, this.y, caption, 'F1', 8, 0.35); }
    this.y -= 6;
  };
  // the text of the Results tab and of the Solve tab: '## ' and '### ' lines are headings, '#' lines are dropped
  Doc.prototype.report = function (lines) {
    var buf = [], self = this;
    function flush() { if (buf.length) { self.mono(buf); buf = []; } }
    lines.forEach(function (l) {
      if (/^###\s/.test(l)) { flush(); self.heading(l.replace(/^###\s*/, ''), 9.5, 8); }
      else if (/^##\s/.test(l)) { flush(); self.heading(l.replace(/^##\s*/, ''), 11, 12); }
      else if (/^#/.test(l)) { /* file headers */ }
      else if (!l.trim()) { flush(); self.y -= 3; }
      else buf.push(l);
    });
    flush();
  };

  // ---------------------------------------------------------------- bytes
  function ascii(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  function dataURLBytes(url) {
    var b64 = url.slice(url.indexOf(',') + 1), bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pdfDate(d) { function two(n) { return (n < 10 ? '0' : '') + n; } return 'D:' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()); }
  Doc.prototype.bytes = function (title) {
    var chunks = [], offs = [], pos = 0;
    function put(b) { chunks.push(b); pos += b.length; }
    function obj(n, body) { offs[n] = pos; put(ascii(n + ' 0 obj\n')); body.forEach(put); put(ascii('\nendobj\n')); }
    // 1 catalog, 2 pages, 3-5 fonts, 6 info, then the images, then per page its content and the page
    var nImg = this.images.length, firstImg = 7, firstPage = firstImg + nImg, np = this.pages.length;
    put(ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    obj(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
    var kids = [];
    for (var p = 0; p < np; p++) kids.push((firstPage + 2 * p + 1) + ' 0 R');
    obj(2, [ascii('<< /Type /Pages /Count ' + np + ' /Kids [' + kids.join(' ') + '] >>')]);
    ['F1', 'F2', 'F3'].forEach(function (f, k) { obj(3 + k, [ascii('<< /Type /Font /Subtype /Type1 /BaseFont /' + FONTS[f].name + ' /Encoding /WinAnsiEncoding >>')]); });
    obj(6, [ascii('<< /Title ' + pdfString(codes(title)) + ' /Producer ' + pdfString(codes('Powder 6, ' + RV.version)) + ' /CreationDate (' + pdfDate(new Date()) + ') >>')]);
    this.images.forEach(function (img, k) {
      var data = img.bytes || dataURLBytes(img.url);
      obj(firstImg + k, [ascii('<< /Type /XObject /Subtype /Image /Width ' + img.w + ' /Height ' + img.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + data.length + ' >>\nstream\n'), data, ascii('\nendstream')]);
    });
    var xo = this.images.map(function (_, k) { return '/Im' + k + ' ' + (firstImg + k) + ' 0 R'; }).join(' ');
    this.pages.forEach(function (ops, p) {
      var foot = 'BT /F1 7.5 Tf 0.45 g ' + ML + ' 28 Td ' + pdfString(codes(title)) + ' Tj ET BT /F1 7.5 Tf 0.45 g ' + (PW - MR - 60).toFixed(2) + ' 28 Td ' + pdfString(codes('page ' + (p + 1) + ' of ' + np)) + ' Tj ET';
      var content = ascii(ops.join('\n') + '\n' + foot);
      obj(firstPage + 2 * p, [ascii('<< /Length ' + content.length + ' >>\nstream\n'), content, ascii('\nendstream')]);
      obj(firstPage + 2 * p + 1, [ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>' +
                                        (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >> /Contents ' + (firstPage + 2 * p) + ' 0 R >>')]);
    });
    var nObj = firstPage + 2 * np, xref = pos, x = 'xref\n0 ' + nObj + '\n0000000000 65535 f \n';
    for (var n = 1; n < nObj; n++) x += ('0000000000' + offs[n]).slice(-10) + ' 00000 n \n';
    put(ascii(x + 'trailer\n<< /Size ' + nObj + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
    var out = new Uint8Array(pos), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  };

  // ---------------------------------------------------------------- the plots, in the light theme
  function withLightTheme(fn) {
    var root = document.documentElement, was = root.getAttribute('data-theme');
    if (was === 'light') return fn();
    root.setAttribute('data-theme', 'light'); RV.theme.refresh();
    try { return fn(); } finally { root.setAttribute('data-theme', was); RV.theme.refresh(); }
  }
  function plotImage(ds) {
    var W = 980, H1 = 430, H2 = 150, k = 2, m = S.settings.noBackground ? 'lin' : S.settings.yscale;
    var s = RV.plots.build([ds]);
    var p1 = new RV.Plot2D(null, { width: W, height: H1, scale: k, ylog: m === 'log', ysqrt: m === 'sqrt', legendMax: 10 + S.phases.length,
                                    ylabel: S.settings.noBackground ? 'Intensity − background /counts' : m === 'sqrt' ? 'Intensity /counts (√ scale)' : m === 'log' ? 'Intensity /counts (log scale)' : 'Intensity /counts',
                                    band: S.settings.showTicks && S.phases.length ? S.phases.length * 9 + 7 : 0 });
    p1.setSeries(s.main);
    var p2 = new RV.Plot2D(null, { width: W, height: H2, scale: k, xlabel: '2θ /°', ylabel: 'obs − calc', legend: false });
    p2.setSeries(s.diff);
    if (p1.view) p2.setXView(p1.view.x0, p1.view.x1);
    var c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = W * k; c.height = (H1 + H2) * k;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(p1.canvas, 0, 0); g.drawImage(p2.canvas, 0, H1 * k);
    return { url: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height };
  }

  // ---------------------------------------------------------------- the report
  function build(list) {
    var d = new Doc(), title = 'Powder 6 report, ' + ui.stamp().slice(0, 16), sol = RV.solve && RV.solve.report ? RV.solve.report() : { lines: [] };
    d.heading('Powder 6: Rietveld, Le Bail and WPPF', 16, 0);
    d.para(ui.stamp() + '. Powder 6, version ' + RV.version + ', fit core ' + RVCore.VERSION + '. ' + list.length + (list.length === 1 ? ' dataset' : ' datasets') + '; phases: ' +
           (S.phases.map(function (p) { return p.name + ' (' + St.sgText(p.sg) + ', ' + RVCore.METHOD_LABELS[p.method] + ')'; }).join(', ') || 'none') + '.', 9, 0.25);
    d.y -= 4; d.rule(d.y); d.y -= 2;
    var overall = RV.results.globalReportText(list);
    if (overall) d.report(overall.split('\n'));
    var cons = RV.results.constraintsText(list);
    if (cons) d.report(cons.split('\n'));
    var nImg = 0;
    var images = withLightTheme(function () {
      return list.map(function (ds) {
        if (nImg >= MAX_IMAGES) return null;
        try { nImg++; return plotImage(ds); } catch (e) { return null; }
      });
    });
    list.forEach(function (ds, i) {
      if (i > 0) d.newPage();
      d.heading(ds.name, 13, 6);
      if (images[i]) d.image(images[i], 360, 'Observed (points), calculated, background' + (S.settings.showPhases ? ', phases' : '') + (S.settings.showTicks ? ' and reflections' : '') + '; below, obs − calc.');
      else if (i >= MAX_IMAGES) d.para('(plot left out: only the first ' + MAX_IMAGES + ' datasets are drawn)', 8, 0.4);
      var lines = RV.results.reportText([ds], true).split('\n').filter(function (l) { return !/^## Dataset /.test(l); });
      d.report(lines);
    });
    if (sol.lines.length) {
      d.newPage();
      d.report(sol.lines);
      if (sol.image) { d.y -= 6; d.image(sol.image, 420, sol.image.title); }
      if (sol.densityImage) { d.y -= 6; d.image(sol.densityImage, 420, sol.densityImage.title); }
    }
    return d.bytes(title);
  }
  function report() {
    var list = St.selected();
    if (!list.length) { ui.toast('Select one or more datasets first.', 'warn'); return; }
    var bytes;
    try { bytes = build(list); } catch (e) { ui.toast('The report could not be written: ' + ((e && e.message) || e), 'err'); return; }
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), a = document.createElement('a');
    a.href = url; a.download = 'powder6_report_' + ui.fileStamp() + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    ui.toast('Report of ' + list.length + (list.length === 1 ? ' dataset' : ' datasets') + ' saved as PDF (' + Math.round(bytes.length / 1024) + ' kB).', 'ok');
  }
  return { report: report, build: build, codes: codes };
})();
