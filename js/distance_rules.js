/* The distance-rule language, in one place: "A B N dmin/dmax [shape]", one rule per line.
 *
 * Read by the Wyckoff search (js/rietveld/rv_solve.js: A and B are elements, upper-cased) and by the Rietveld
 * restraints (js/atom_restraints.js: A and B are atom labels, case kept). The shapes are the geometries of
 * WY_LIMITS (js/wyckoff_limits.js), passed in.
 *
 *    page    :  <script defer src="js/distance_rules.js">
 *    worker  :  importScripts('distance_rules.js')
 *    node    :  require('./distance_rules.js')
 */
var DistanceRules = (function () {
  'use strict';
  // the shape a line ends with, as a name of geometries: any word of a shape, or the first two letters or more of one
  // (tet, oct, sq, tri, lin, pl), as long as they belong to one shape only
  function shapeOf(geometries, token) {
    var t = String(token || '').toLowerCase();
    if (t.length < 2) return null;
    var names = Object.keys(geometries);
    var hits = names.filter(function (n) { return geometries[n].words.some(function (w) { return w.indexOf(t) === 0; }); });
    return hits.length === 1 ? hits[0] : null;
  }
  function shapeList(geometries) { return Object.keys(geometries).map(function (n) { return geometries[n].words[0]; }).join(', '); }

  // opts.keepCase: the names A and B are atom labels, not elements: leave their case alone
  function parse(text, geometries, opts) {
    var keepCase = !!(opts && opts.keepCase), SHAPE_LIST = shapeList(geometries);
    var out = [], bad = [], warn = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      var t = line.trim();
      if (!t || t.charAt(0) === '#') return;
      var p = t.split(/[\s,]+/), geometry = null, last = p[p.length - 1].toLowerCase();
      if (p.length > 3 && shapeOf(geometries, last)) { geometry = shapeOf(geometries, last); p.pop(); }
      else if (p.length > 3 && /^[a-z][a-z-]*$/.test(last)) { bad.push('line ' + (i + 1) + ': "' + p[p.length - 1] + '" is not a shape (use ' + SHAPE_LIST + ', or their first letters: tet, oct, sq, tri, lin)'); return; }
      if (p.length < 3) { bad.push('line ' + (i + 1) + ': need at least "A B N dmin/dmax"'); return; }
      var a = keepCase ? p[0] : p[0].toUpperCase(), b = keepCase ? p[1] : p[1].toUpperCase(), rest = p.slice(2), hasSlash = rest.some(function (tok) { return tok.indexOf('/') >= 0; });
      var count = null, mode = null, dmin = null, dmax = null;
      if (!hasSlash) {
        var nums = rest;
        if (rest[0] === '-' || rest[0] === '*') {
          nums = rest.slice(1);
          if (!nums.length) { bad.push('line ' + (i + 1) + ': "' + a + ' ' + b + ' ' + rest[0] + '" states nothing - add a distance, e.g. "' + a + ' ' + b + ' - 2.0"'); return; }
        } else if (/^\d+\+?$/.test(rest[0]) && rest.length === 1) {
          bad.push('line ' + (i + 1) + ': "' + rest[0] + '" on its own is ambiguous - write "' + a + ' ' + b + ' ' + rest[0] + ' dmin/dmax" for a coordination number, or "' + a + ' ' + b + ' ' + rest[0] + '.0" for a distance');
          return;
        }
        dmin = parseFloat(nums[0]);
        if (!Number.isFinite(dmin)) { bad.push('line ' + (i + 1) + ': "' + nums[0] + '" is not a distance'); return; }
        if (nums.length > 1) { dmax = parseFloat(nums[1]); if (!Number.isFinite(dmax)) { bad.push('line ' + (i + 1) + ': "' + nums[1] + '" is not a distance'); return; } }
      } else {
        var range;
        if (rest.length >= 2 && rest[0].indexOf('/') < 0) {
          var c = rest[0];
          if (c !== '-' && c !== '*') {
            var m = /^(\d+)(\+?)$/.exec(c);
            if (!m) { bad.push('line ' + (i + 1) + ': "' + c + '" is not a coordination number (use 4, 4+ or -)'); return; }
            count = parseInt(m[1], 10); mode = m[2] === '+' ? 'atleast' : 'exact';
          }
          range = rest[1];
        } else range = rest[0];
        var sides = range.split('/');
        if (sides.length !== 2) { bad.push('line ' + (i + 1) + ': "' + range + '" should be dmin/dmax'); return; }
        if (sides[0].trim() !== '') { dmin = parseFloat(sides[0]); if (!Number.isFinite(dmin)) { bad.push('line ' + (i + 1) + ': "' + sides[0] + '" is not a distance'); return; } }
        if (sides[1].trim() !== '') { dmax = parseFloat(sides[1]); if (!Number.isFinite(dmax)) { bad.push('line ' + (i + 1) + ': "' + sides[1] + '" is not a distance'); return; } }
      }
      if (dmin === null && dmax === null && count === null) { bad.push('line ' + (i + 1) + ': nothing to enforce - give a count, a distance, or both'); return; }
      if (dmin !== null && dmax !== null && dmax < dmin) { bad.push('line ' + (i + 1) + ': dmax (' + dmax + ') is below dmin (' + dmin + ')'); return; }
      if (geometry) {
        var shape = geometries[geometry];
        if (count !== shape.count || dmax === null) { bad.push('line ' + (i + 1) + ': a ' + shape.words[0] + ' needs exactly ' + shape.count + ' neighbours and an upper distance, e.g. "' + a + ' ' + b + ' ' + shape.count + ' 1.40/1.60 ' + shape.words[0] + '"'); return; }
      }
      if (count !== null && dmax === null) warn.push('line ' + (i + 1) + ': "' + a + ' ' + b + ' ' + count + (mode === 'atleast' ? '+' : '') + ' ' + (dmin == null ? '' : dmin) + '/" counts every ' + b + ' beyond ' + (dmin == null ? 0 : dmin) + ' Å, which is every ' + b + ' in the cell - add an upper distance to make the count mean something');
      out.push({ a: a, b: b, count: count, countMode: mode, dmin: dmin, dmax: dmax, geometry: geometry });
    });
    return { windows: out, bad: bad, warn: warn };
  }
  return { parse: parse, shapeOf: shapeOf, shapeList: shapeList };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DistanceRules;
