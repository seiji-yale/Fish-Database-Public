/**
 * The viewer inside `snapshot.html` (T-020 Step 3): plain CSS and plain JavaScript, no libraries and no
 * network. The script builds the page with DOM calls and `textContent` only (never `innerHTML`), so the
 * data cannot inject markup. Keep both strings free of backticks, `${` and `</script`: they are pasted
 * into the page as they are.
 */

export const SNAPSHOT_STYLE = `
:root { color-scheme: light dark; --bg:#fafaf7; --fg:#1d2430; --muted:#5b6573; --line:#d6dae0; --card:#fff; --accent:#0b5cad; --chip:#e8eef6; }
@media (prefers-color-scheme: dark) { :root { --bg:#14181f; --fg:#e8ebf0; --muted:#a2acba; --line:#333b48; --card:#1b212b; --accent:#7db4f0; --chip:#26303f; } }
* { box-sizing: border-box; }
body { margin:0; font:16px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
a { color:var(--accent); }
.top { padding:12px 16px; border-bottom:1px solid var(--line); background:var(--card); }
.top h1 { margin:0; font-size:1.25rem; }
.banner { margin:2px 0 0; color:var(--muted); font-size:.9rem; }
main { max-width:960px; margin:0 auto; padding:16px; }
.foot { max-width:960px; margin:0 auto; padding:16px; color:var(--muted); font-size:.85rem; }
.tools { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
.tools input, .tools select { font:inherit; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:var(--card); color:var(--fg); min-height:40px; }
.tools input { flex:1 1 220px; }
.count { color:var(--muted); font-size:.9rem; margin:0 0 8px; }
.cards { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.card { display:block; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:inherit; text-decoration:none; }
.card:hover, .card:focus-visible { border-color:var(--accent); outline:2px solid var(--accent); outline-offset:1px; }
.card .name { font-weight:600; }
.card .meta { color:var(--muted); font-size:.9rem; }
.badge { display:inline-block; padding:1px 8px; border-radius:10px; background:var(--chip); font-size:.8rem; margin-left:6px; }
h2 { font-size:1.05rem; margin:20px 0 6px; border-bottom:1px solid var(--line); padding-bottom:4px; }
h3 { font-size:1rem; margin:0 0 4px; }
dl.facts { display:grid; grid-template-columns:max-content 1fr; gap:4px 12px; margin:0; }
dl.facts dt { color:var(--muted); }
dl.facts dd { margin:0; overflow-wrap:anywhere; }
.box { border:1px solid var(--line); border-radius:8px; background:var(--card); padding:10px 12px; margin-bottom:8px; }
.table-wrap { overflow-x:auto; }
table { border-collapse:collapse; width:100%; background:var(--card); }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; font-size:.92rem; }
th { color:var(--muted); font-weight:600; }
.pics { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.pics img { max-width:160px; max-height:160px; border:1px solid var(--line); border-radius:6px; background:#fff; }
.pics figure { margin:0; font-size:.8rem; color:var(--muted); }
.empty { color:var(--muted); }
pre.seq { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; }
@media print { .tools { display:none; } }
`;

export const SNAPSHOT_SCRIPT = `
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('snapshot-data').textContent);
  var app = document.getElementById('app');
  var query = '';
  var status = 'all';

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i += 1) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }
  function show(value) { return value === null || value === undefined || value === '' ? '\\u2014' : String(value); }
  function label(key) { var s = key.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  var TYPES = { pcr: 'PCR', pcr_sequence: 'PCR + sequencing', fluorescence: 'Fluorescence', tails: 'Tails', none: 'None', custom: 'Custom' };
  function typeLabel(t) { return TYPES[t] || label(t); }
  function safeUrl(url) { return /^https?:\\/\\//i.test(url) ? url : null; }

  function formatTime(iso) {
    try {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
      var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
      return o.year + '-' + o.month + '-' + o.day + ' ' + (o.hour === '24' ? '00' : o.hour) + ':' + o.minute;
    } catch (e) { return iso; }
  }
  document.getElementById('generated').textContent = 'Generated ' + formatTime(data.generatedAt) + ' (New York time)';

  function haystack(line) {
    var parts = [line.name, line.gene, line.notes, line.status].concat(line.phenotypes);
    line.attributes.forEach(function (a) { parts.push(a.key, a.value); });
    line.protocols.forEach(function (p) { parts.push(p.label, p.notes); });
    line.cryo.forEach(function (c) { parts.push(c.place, c.box, c.notes); });
    line.references.forEach(function (r) { parts.push(r.title, r.note); });
    return parts.filter(Boolean).join(' ').toLowerCase();
  }
  data.lines.forEach(function (line) { line.search = haystack(line); });

  function pictures(files) {
    var shown = files.filter(function (f) { return f.isImage; });
    var others = files.filter(function (f) { return !f.isImage; });
    var box = h('div', { class: 'pics' });
    shown.forEach(function (f) {
      box.appendChild(h('figure', null, h('a', { href: f.path }, h('img', { src: f.path, alt: f.caption || f.name, loading: 'lazy' })), f.caption || f.name));
    });
    others.forEach(function (f) { box.appendChild(h('a', { href: f.path }, f.name)); });
    return files.length ? box : null;
  }

  function renderList() {
    var search = h('input', { type: 'search', placeholder: 'Search name, gene, notes\\u2026', 'aria-label': 'Search lines', value: query });
    var select = h('select', { 'aria-label': 'Status' });
    [['all', 'All statuses'], ['Current', 'Current'], ['Breeding', 'Breeding'], ['Closed', 'Closed']].forEach(function (o) {
      var opt = h('option', { value: o[0] }, o[1]);
      if (o[0] === status) opt.selected = true;
      select.appendChild(opt);
    });
    var count = h('p', { class: 'count', role: 'status' });
    var list = h('ul', { class: 'cards' });
    function fill() {
      var n = query.trim().toLowerCase();
      var shownRows = data.lines.filter(function (line) {
        return (status === 'all' || line.status === status) && (n === '' || line.search.indexOf(n) !== -1);
      });
      count.textContent = shownRows.length + ' of ' + data.lines.length + ' lines';
      list.textContent = '';
      shownRows.forEach(function (line) {
        list.appendChild(h('li', null, h('a', { class: 'card', href: '#/line/' + encodeURIComponent(line.id) },
          h('span', { class: 'name' }, line.name), h('span', { class: 'badge' }, line.status),
          h('div', { class: 'meta' }, [line.gene, line.dob ? 'DOB ' + line.dob : null, 'Gen ' + line.generation, 'IDed ' + line.idedNumber].filter(Boolean).join(' \\u00b7 ')))));
      });
      if (!shownRows.length) list.appendChild(h('li', { class: 'empty' }, 'No lines match.'));
    }
    search.addEventListener('input', function () { query = search.value; fill(); });
    select.addEventListener('change', function () { status = select.value; fill(); });
    app.textContent = '';
    app.appendChild(h('div', { class: 'tools' }, search, select));
    app.appendChild(count);
    app.appendChild(list);
    fill();
  }

  function facts(pairs) {
    var dl = h('dl', { class: 'facts' });
    pairs.forEach(function (p) { dl.appendChild(h('dt', null, p[0])); dl.appendChild(h('dd', null, show(p[1]))); });
    return dl;
  }

  function fieldValue(value) {
    if (Array.isArray(value)) {
      if (!value.length) return '\\u2014';
      return value.map(function (item) {
        if (item !== null && typeof item === 'object') return Object.keys(item).map(function (k) { return k + ': ' + item[k]; }).join(', ');
        return String(item);
      }).join('; ');
    }
    return show(value);
  }

  function table(headers, rows) {
    var head = h('tr', null);
    headers.forEach(function (t) { head.appendChild(h('th', { scope: 'col' }, t)); });
    var body = h('tbody', null);
    rows.forEach(function (r) {
      var tr = h('tr', null);
      r.forEach(function (cell) { tr.appendChild(h('td', null, show(cell))); });
      body.appendChild(tr);
    });
    return h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, head), body));
  }

  function section(title, content, emptyText) {
    return [h('h2', null, title), content || h('p', { class: 'empty' }, emptyText)];
  }

  function renderDetail(line) {
    app.textContent = '';
    app.appendChild(h('p', null, h('a', { href: '#/' }, '\\u2190 All lines')));
    app.appendChild(h('h2', { style: 'border:0;font-size:1.4rem;margin:8px 0' }, line.name, h('span', { class: 'badge' }, line.status)));
    app.appendChild(facts([
      ['Gene', line.gene], ['Date of birth', line.dob], ['Generation', line.generation], ['IDed number', line.idedNumber],
      ['Last ID date', line.lastIdDate], ['Breeding started', line.breedingStartedAt],
      line.status === 'Closed' ? ['Closed', [line.closedAt, line.closedReason].filter(Boolean).join(' \\u2014 ')] : null,
      ['Notes', line.notes], ['Last updated', formatTime(line.updatedAt) + ' by ' + line.updatedBy]
    ].filter(Boolean)));

    var phen = line.phenotypes.length ? h('ul', null) : null;
    line.phenotypes.forEach(function (p) { phen.appendChild(h('li', null, p)); });
    section('Phenotypes', phen, 'None recorded.').forEach(function (n) { app.appendChild(n); });

    section('Attributes', line.attributes.length ? facts(line.attributes.map(function (a) { return [a.key, a.value]; })) : null, 'None recorded.').forEach(function (n) { app.appendChild(n); });

    var protocols = line.protocols.length ? h('div', null) : null;
    line.protocols.forEach(function (p) {
      var box = h('div', { class: 'box' }, h('h3', null, p.label, p.current ? h('span', { class: 'badge' }, 'Current') : null), h('div', { class: 'meta' }, typeLabel(p.type)));
      var keys = Object.keys(p.fields);
      if (keys.length) box.appendChild(facts(keys.map(function (k) { return [label(k), fieldValue(p.fields[k])]; })));
      if (p.notes) box.appendChild(h('p', null, p.notes));
      var pics = pictures(p.files); if (pics) box.appendChild(pics);
      protocols.appendChild(box);
    });
    section('ID methods', protocols, 'None recorded.').forEach(function (n) { app.appendChild(n); });

    var geno = null;
    if (line.genotyping.length) {
      geno = h('div', null, table(['Date', 'Gen', 'Positive', 'Screened', 'Method', 'New generation', 'Notes', 'By'], line.genotyping.map(function (g) {
        return [g.date, g.generation, g.positive, g.screened, g.protocol, g.newGeneration ? 'Yes' + (g.newDob ? ' (DOB ' + g.newDob + ')' : '') : 'No', g.notes, g.by];
      })));
      line.genotyping.forEach(function (g) { var pics = pictures(g.files); if (pics) { geno.appendChild(h('p', { class: 'meta' }, 'Gel images, ' + g.date)); geno.appendChild(pics); } });
    }
    section('Genotyping records', geno, 'None recorded.').forEach(function (n) { app.appendChild(n); });

    section('Cryopreservation', line.cryo.length ? table(['Date', 'Place', 'Box', 'Cryo IDs', 'Vials', 'Notes'], line.cryo.map(function (c) {
      var ids = c.detailsUnknown ? 'details unknown' : (c.idStart || c.idEnd) ? [c.idStart, c.idEnd].filter(Boolean).join(' \\u2013 ') : null;
      return [c.date, c.place, c.box, ids, c.count, c.notes];
    })) : null, 'None recorded.').forEach(function (n) { app.appendChild(n); });

    var refs = line.references.length ? h('ul', null) : null;
    line.references.forEach(function (r) {
      var url = r.url ? safeUrl(r.url) : null;
      var target = url ? h('a', { href: url }, r.title) : r.file ? h('a', { href: r.file.path }, r.title) : r.title;
      refs.appendChild(h('li', null, target, r.url && !url ? ' (' + r.url + ')' : null, r.note ? ' \\u2014 ' + r.note : null));
    });
    section('References', refs, 'None recorded.').forEach(function (n) { app.appendChild(n); });
  }

  function route() {
    var match = /^#\\/line\\/(.+)$/.exec(location.hash);
    if (match) {
      var id = decodeURIComponent(match[1]);
      var line = data.lines.filter(function (l) { return l.id === id; })[0];
      if (line) { document.title = line.name + ' \\u2014 ' + document.getElementById('app-name').textContent + ' (read-only copy)'; renderDetail(line); window.scrollTo(0, 0); return; }
    }
    document.title = document.getElementById('app-name').textContent + ' (read-only copy)';
    renderList();
  }
  window.addEventListener('hashchange', route);
  route();
})();
`;
