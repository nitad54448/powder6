/* Shared CIF 1.1 tokenization for structure and powder readers. Comments and
 * text fields are tokens/whitespace, never data-block or loop delimiters. */
(function (root) {
  'use strict';
  function tokens(text) {
    var out = [], i = 0, n = text.length;
    while (i < n) {
      if (/\s/.test(text[i])) { i++; continue; }
      if (text[i] === '#') { while (i < n && text[i] !== '\n') i++; continue; }
      var start = i, value, quote = text[i];
      if (quote === ';' && (i === 0 || text[i - 1] === '\n')) {
        var end = text.indexOf('\n;', i + 1);
        if (end < 0) throw new Error('Unterminated CIF text field.');
        value = text.slice(i + 1, end); i = end + 2;
        out.push({ value: value, quoted: true, start: start }); continue;
      }
      if (quote === "'" || quote === '"') {
        i++; var first = i;
        while (i < n && !(text[i] === quote && (i + 1 === n || /\s/.test(text[i + 1])))) i++;
        if (i === n) throw new Error('Unterminated CIF quoted value.');
        value = text.slice(first, i++);
        out.push({ value: value, quoted: true, start: start }); continue;
      }
      while (i < n && !/\s/.test(text[i])) i++;
      out.push({ value: text.slice(start, i), quoted: false, start: start });
    }
    return out;
  }
  function control(t) { return t && !t.quoted && /^(?:_|data_|loop_$|stop_$|save_|global_$)/i.test(t.value); }
  function parse(content) {
    var text = String(content).replace(/\r\n?/g, '\n'), ts = tokens(text), blocks = [], block = null, i = 0;
    function make(name, start) { block = { name: name, start: start, values: Object.create(null), loops: [] }; blocks.push(block); }
    while (i < ts.length) {
      var t = ts[i++], key = t.value.toLowerCase();
      if (!t.quoted && /^data_/i.test(key)) { make(t.value.slice(5), t.start); continue; }
      if (!block) make('', 0);
      if (!t.quoted && key === 'loop_') {
        var tags = [], values = [];
        while (i < ts.length && !ts[i].quoted && ts[i].value[0] === '_') tags.push(ts[i++].value.toLowerCase());
        if (!tags.length) throw new Error('CIF loop has no data names.');
        while (i < ts.length && !control(ts[i])) values.push(ts[i++].value);
        if (values.length % tags.length) throw new Error('Incomplete CIF loop row in data_' + block.name + '.');
        var rows = [];
        for (var k = 0; k < values.length; k += tags.length) rows.push(values.slice(k, k + tags.length));
        block.loops.push({ tags: tags, rows: rows }); continue;
      }
      if (!t.quoted && key[0] === '_') {
        if (i >= ts.length || control(ts[i])) throw new Error('Missing CIF value for ' + t.value + '.');
        block.values[key] = ts[i++].value; continue;
      }
      if (!t.quoted && /^(?:stop_|global_|save_.*)$/i.test(key)) continue;
      throw new Error('Unexpected CIF value: ' + t.value.slice(0, 60));
    }
    blocks.forEach(function (b, k) { b.text = text.slice(b.start, k + 1 < blocks.length ? blocks[k + 1].start : text.length); });
    return blocks;
  }
  root.CifReader = { tokens: tokens, parse: parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CifReader;
})(typeof window !== 'undefined' ? window : globalThis);
