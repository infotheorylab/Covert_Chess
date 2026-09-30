/* Interactive results chart for index.html: message error rate vs. average
   message length, one model at a time.

   Data: data/results/c4_comparison.js (window.BAM_RESULTS). Error bars are one
   standard error: binomial on the error rate (n = 1000 trials), and the
   reported standard error of the length for BAM, whose length varies.
   Series colours come from --series-N on .viz; every series also has its own
   marker shape, and the Table button shows the same numbers as text. */
(function () {
  'use strict';

  var R = window.BAM_RESULTS;
  var root = document.getElementById('results-chart');
  if (!R || !root) return;

  var NS = 'http://www.w3.org/2000/svg';
  var STYLE = {
    BAM:        { slot: 1, shape: 'square',   label: 'BAM (ours)' },
    FL:         { slot: 2, shape: 'circle',   label: 'ArcMark' },
    MPAC:       { slot: 3, shape: 'triangle', label: 'MPAC' },
    BIMARK:     { slot: 4, shape: 'down',     label: 'BiMark' },
    STEALTHINK: { slot: 5, shape: 'diamond',  label: 'StealthInk' }
  };
  var X_MIN = 15, X_MAX = 62, LOG_C = 0.001;
  var state = { model: 0, log: false, table: false, hidden: {} };

  var tabs = root.querySelector('[data-role="models"]');
  var scaleBtn = root.querySelector('[data-role="scale"]');
  var tableBtn = root.querySelector('[data-role="table"]');
  var legend = root.querySelector('[data-role="legend"]');
  var plot = root.querySelector('[data-role="plot"]');
  var tableWrap = root.querySelector('[data-role="table-view"]');
  var tip = root.querySelector('[data-role="tip"]');

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function color(key) { return 'var(--series-' + STYLE[key].slot + ')'; }
  function pct(v) {
    var p = v * 100;
    return (p === 0 ? '0' : p < 1 ? p.toFixed(1) : p < 10 ? p.toFixed(1).replace(/\.0$/, '') : Math.round(p)) + '%';
  }
  function se(p) { return Math.sqrt(p * (1 - p) / R.trials); }
  function yMap(v) { return state.log ? Math.log10(1 + Math.max(0, v) / LOG_C) : v; }
  var Y_TOP_LOG = Math.log10(1 + 1 / LOG_C);

  // marker path centred on (0, 0), about 9px across
  function markerPath(shape, r) {
    switch (shape) {
      case 'square':   return 'M' + -r + ',' + -r + 'h' + 2 * r + 'v' + 2 * r + 'h' + -2 * r + 'z';
      case 'triangle': return 'M0,' + (-r * 1.2) + 'L' + r * 1.1 + ',' + r * .8 + 'H' + -r * 1.1 + 'z';
      case 'down':     return 'M0,' + r * 1.2 + 'L' + r * 1.1 + ',' + -r * .8 + 'H' + -r * 1.1 + 'z';
      case 'diamond':  return 'M0,' + -r * 1.3 + 'L' + r * 1.3 + ',0L0,' + r * 1.3 + 'L' + -r * 1.3 + ',0z';
      default:         return 'M' + -r + ',0a' + r + ',' + r + ' 0 1,0 ' + 2 * r + ',0a' + r + ',' + r + ' 0 1,0 ' + -2 * r + ',0';
    }
  }
  function marker(parent, key, x, y, r) {
    var m = el('path', { d: markerPath(STYLE[key].shape, r), transform: 'translate(' + x + ',' + y + ')', 'class': 'viz-mark' }, parent);
    m.style.fill = color(key);
    return m;
  }

  /* ---- controls ---- */
  R.models.forEach(function (m, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.name;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', function () { state.model = i; render(); });
    tabs.appendChild(b);
  });
  scaleBtn.addEventListener('click', function () { state.log = !state.log; render(); });
  tableBtn.addEventListener('click', function () { state.table = !state.table; render(); });

  R.models[0].series.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    var key = el('svg', { viewBox: '0 0 26 12', width: 26, height: 12, 'aria-hidden': 'true' });
    var line = el('line', { x1: 1, x2: 25, y1: 6, y2: 6, 'class': 'viz-line' }, key);
    line.style.stroke = color(s.key);
    marker(key, s.key, 13, 6, 3.6);
    b.appendChild(key);
    b.appendChild(document.createTextNode(STYLE[s.key].label));
    b.addEventListener('click', function () {
      state.hidden[s.key] = !state.hidden[s.key];
      render();
    });
    b.dataset.key = s.key;
    legend.appendChild(b);
  });

  /* ---- drawing ---- */
  var hits = [];

  function render() {
    var model = R.models[state.model];
    tabs.querySelectorAll('button').forEach(function (b, i) { b.setAttribute('aria-checked', i === state.model ? 'true' : 'false'); });
    scaleBtn.setAttribute('aria-pressed', state.log ? 'true' : 'false');
    tableBtn.setAttribute('aria-pressed', state.table ? 'true' : 'false');
    legend.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', state.hidden[b.dataset.key] ? 'false' : 'true'); });
    plot.hidden = state.table;
    tableWrap.hidden = !state.table;
    hideTip();
    if (state.table) { renderTable(model); return; }

    // short enough that the whole results screen fits one window
    var W = plot.clientWidth || 800, H = W < 560 ? 280 : Math.round(Math.max(250, Math.min(340, window.innerHeight * .31)));
    var narrow = W < 560;
    var M = { l: narrow ? 46 : 54, r: 16, t: narrow ? 28 : 14, b: 46 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;
    var yTop = state.log ? Y_TOP_LOG : 1;
    function X(v) { return M.l + (v - X_MIN) / (X_MAX - X_MIN) * iw; }
    function Y(v) { return M.t + ih - yMap(v) / yTop * ih; }

    plot.innerHTML = '';
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Message error rate versus average message length on ' + model.name + '. BAM reaches near-zero error at about 45 to 50 tokens; the best earlier method, ArcMark, is still at 7 to 12% at 60 tokens.' }, plot);

    // grid + y ticks
    var yt = state.log ? [0, .001, .01, .1, 1] : [0, .2, .4, .6, .8, 1];
    yt.forEach(function (v) {
      el('line', { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), 'class': 'viz-grid' }, svg);
      var t = el('text', { x: M.l - 8, y: Y(v) + 4, 'text-anchor': 'end', 'class': 'viz-tick' }, svg);
      t.textContent = pct(v);
    });
    [20, 30, 40, 50, 60].forEach(function (v) {
      el('line', { x1: X(v), x2: X(v), y1: M.t + ih, y2: M.t + ih + 5, 'class': 'viz-axis' }, svg);
      var t = el('text', { x: X(v), y: M.t + ih + 20, 'text-anchor': 'middle', 'class': 'viz-tick' }, svg);
      t.textContent = v;
    });
    var xl = el('text', { x: M.l + iw / 2, y: H - 6, 'text-anchor': 'middle', 'class': 'viz-axis-label' }, svg);
    xl.textContent = 'Average message length (tokens)';
    // y title runs up the side, or across the top on phones where the side is too narrow
    var yl = narrow
      ? el('text', { x: 0, y: 12, 'class': 'viz-axis-label' }, svg)
      : el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'class': 'viz-axis-label',
          transform: 'translate(12,' + (M.t + ih / 2) + ') rotate(-90)' }, svg);
    yl.textContent = 'Messages decoded wrong';

    hits = [];
    // draw baselines first so BAM sits on top
    model.series.slice().reverse().forEach(function (s) {
      if (state.hidden[s.key]) return;
      var g = el('g', {}, svg);
      var d = s.points.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[2]).toFixed(1); }).join('');
      var path = el('path', { d: d, 'class': 'viz-line' + (s.key === 'BAM' ? ' ours' : '') }, g);
      path.style.stroke = color(s.key);
      s.points.forEach(function (p) {
        var x = X(p[0]), y = Y(p[2]), e = se(p[2]);
        var bars = el('path', { 'class': 'viz-err', d:
          'M' + x + ',' + Y(Math.min(1, p[2] + e)) + 'V' + Y(Math.max(0, p[2] - e)) +
          (p[1] > 0 ? 'M' + X(p[0] - p[1]) + ',' + y + 'H' + X(p[0] + p[1]) : '') }, g);
        bars.style.stroke = color(s.key);
        var m = marker(g, s.key, x, y, s.key === 'BAM' ? 4.4 : 4);
        hits.push({ x: x, y: y, p: p, s: s, m: m });
      });
    });

    // one direct label, on the series the story is about
    var bam = model.series[0];
    if (!state.hidden.BAM) {
      var last = bam.points[bam.points.length - 1];
      var lbl = el('text', { x: X(last[0] + last[1]) + 8, y: Y(last[2]) + 4, 'class': 'viz-direct' }, svg);
      lbl.textContent = 'BAM';
    }

    var hover = el('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent', 'class': 'viz-hit' }, svg);
    hover.addEventListener('pointermove', onMove);
    hover.addEventListener('pointerdown', onMove);
    hover.addEventListener('pointerleave', hideTip);
  }

  var active = null;
  function onMove(e) {
    var box = plot.getBoundingClientRect(), px = e.clientX - box.left, py = e.clientY - box.top;
    var best = null, bd = 30 * 30;
    hits.forEach(function (h) {
      var d = (h.x - px) * (h.x - px) + (h.y - py) * (h.y - py);
      if (d < bd) { bd = d; best = h; }
    });
    if (!best) { hideTip(); return; }
    showTip(best);
  }
  function showTip(h) {
    if (active && active !== h) active.m.classList.remove('on');
    active = h;
    h.m.classList.add('on');
    var err = h.p[2], wrong = Math.round(err * R.trials);
    tip.innerHTML = '';
    var v = document.createElement('div'); v.className = 'tip-val';
    v.textContent = pct(err) + ' decoded wrong';
    var d = document.createElement('div'); d.className = 'tip-sub';
    d.textContent = wrong.toLocaleString() + ' of ' + R.trials.toLocaleString() + ' messages, ' + h.p[0].toFixed(1) + ' tokens on average';
    var n = document.createElement('div'); n.className = 'tip-name';
    var k = document.createElement('i'); k.style.background = color(h.s.key);
    n.appendChild(k);
    n.appendChild(document.createTextNode(STYLE[h.s.key].label));
    tip.appendChild(v); tip.appendChild(d); tip.appendChild(n);
    tip.hidden = false;
    var left = Math.max(110, Math.min(plot.clientWidth - 110, h.x));
    tip.style.left = left + 'px';
    tip.style.top = (plot.offsetTop + h.y) + 'px';
  }
  function hideTip() {
    tip.hidden = true;
    if (active) { active.m.classList.remove('on'); active = null; }
  }

  function renderTable(model) {
    tableWrap.innerHTML = '';
    var t = document.createElement('table');
    t.className = 'res-table';
    var head = t.createTHead().insertRow();
    ['Method', 'Avg tokens', 'Decoded wrong'].forEach(function (h) {
      var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.appendChild(th);
    });
    var body = t.createTBody();
    model.series.forEach(function (s) {
      s.points.forEach(function (p) {
        var r = body.insertRow();
        if (s.key === 'BAM') r.className = 'ours';
        r.insertCell().textContent = STYLE[s.key].label;
        r.insertCell().textContent = p[0].toFixed(1) + (p[1] > 0 ? ' ± ' + p[1].toFixed(1) : '');
        r.insertCell().textContent = pct(p[2]) + ' ± ' + pct(se(p[2]));
      });
    });
    var wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    wrap.appendChild(t);
    tableWrap.appendChild(wrap);
  }

  var lastW = 0;
  if ('ResizeObserver' in window) {
    new ResizeObserver(function () {
      var w = plot.clientWidth;
      if (w && Math.abs(w - lastW) > 2 && !state.table) { lastW = w; render(); }
    }).observe(plot);
  } else {
    window.addEventListener('resize', render);
  }
  render();
})();
