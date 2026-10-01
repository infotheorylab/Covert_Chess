/* Story screens for index.html.

   Navigation: the progress rail and the "next" button follow whichever screen
   holds the middle of the window.

   Figures: each [data-fig] is drawn once the web fonts are ready (so words can
   be measured) and plays the first time its screen scrolls into view; the
   Replay button runs it again. With reduced motion a figure jumps straight to
   its final state. Colours come from CSS classes, never from this file:
   blue = sender, green = receiver, amber = the hidden message. */
(function () {
  'use strict';

  // ?still renders every figure in its final state (handy for screenshots)
  var REDUCE = /[?&]still\b/.test(location.search) ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var NS = 'http://www.w3.org/2000/svg';

  /* ---------------------------------------------------------------- helpers */

  function svgEl(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function label(parent, x, y, str, cls, extra) {
    var attrs = { x: x, y: y };
    if (cls) attrs['class'] = cls;
    for (var k in extra || {}) attrs[k] = extra[k];
    var t = svgEl('text', attrs, parent);
    t.textContent = str;
    return t;
  }
  function makeSvg(fig, w, h) {
    return svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, 'aria-hidden': 'true' }, fig.querySelector('.fig-svg'));
  }
  function textWidth(svg, str, cls) {
    var t = label(svg, 0, -50, str, cls);
    var w = t.getComputedTextLength();
    svg.removeChild(t);
    return w;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, REDUCE ? 0 : ms); }); }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  // frames come from requestAnimationFrame, which stops in hidden tabs; the
  // timer makes sure every step still ends, so later text always appears
  function tween(ms, fn) {
    return new Promise(function (resolve) {
      if (REDUCE || ms <= 0) { fn(1); resolve(); return; }
      var t0 = performance.now(), done = false;
      function finish() { if (done) return; done = true; fn(1); resolve(); }
      setTimeout(finish, ms + 150);
      requestAnimationFrame(function frame() {
        if (done) return;
        var t = Math.min(1, (performance.now() - t0) / ms);
        if (t >= 1) { finish(); return; }
        fn(ease(t));
        requestAnimationFrame(frame);
      });
    });
  }
  function show(node, on) { node.style.opacity = on ? 1 : 0; }
  function sum(a) { return a.reduce(function (s, v) { return s + v; }, 0); }

  function agent(parent, x, y, r, role) {
    var g = svgEl('g', {}, parent);
    svgEl('circle', { 'class': 'ag' + (role ? ' ' + role : ''), cx: x, cy: y, r: r }, g);
    var er = Math.max(1.6, r * .12);
    svgEl('circle', { 'class': 'ag-eye', cx: x - r * .32, cy: y - r * .14, r: er }, g);
    svgEl('circle', { 'class': 'ag-eye', cx: x + r * .32, cy: y - r * .14, r: er }, g);
    return g;
  }
  // a small key, centred on (x, y)
  function keyIcon(parent, x, y) {
    return svgEl('path', { 'class': 'keyicon', d:
      'M' + (x - 2) + ',' + y + ' h14 m-4,0 v5 m4,-5 v4 ' +
      'M' + (x - 7) + ',' + (y - 5) + ' a5,5 0 1,0 0.01,0' }, parent);
  }
  function eyeIcon(parent, x, y) {
    svgEl('path', { 'class': 'eye', d: 'M' + (x - 22) + ',' + y + ' Q' + x + ',' + (y - 16) + ' ' + (x + 22) + ',' + y +
      ' Q' + x + ',' + (y + 16) + ' ' + (x - 22) + ',' + y + ' Z' }, parent);
    svgEl('circle', { 'class': 'eye-pupil', cx: x, cy: y, r: 5 }, parent);
  }

  /* ------------------------------------------------------------- navigation */

  var screens = Array.prototype.slice.call(document.querySelectorAll('[data-title]'));
  var rail = document.querySelector('.rail');
  var next = document.querySelector('.next');
  var nextPre = next.querySelector('.pre');
  var nextLabel = next.querySelector('.next-label');
  var current = 0;

  var dots = screens.map(function (s) {
    var a = document.createElement('a');
    a.href = '#' + s.id;
    a.setAttribute('aria-label', s.dataset.title);
    a.innerHTML = '<i></i><span></span>';
    a.querySelector('span').textContent = s.dataset.title;
    rail.appendChild(a);
    return a;
  });

  function setCurrent(i) {
    current = i;
    dots.forEach(function (d, j) {
      d.classList.toggle('on', j === i);
      if (j === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
    var last = i >= screens.length - 1;
    nextPre.textContent = last || i === 0 ? '' : 'Next: ';
    nextLabel.textContent = last ? 'Back to top' : i === 0 ? 'Scroll to begin' : screens[i + 1].dataset.title;
    next.setAttribute('aria-label', last ? 'Back to top' : 'Next: ' + screens[i + 1].dataset.title);
    next.classList.toggle('up', last);
    next.classList.toggle('at-start', i === 0);
  }
  next.addEventListener('click', function () {
    var target = current >= screens.length - 1 ? screens[0] : screens[current + 1];
    target.scrollIntoView({ behavior: REDUCE ? 'auto' : 'smooth', block: 'start' });
  });
  setCurrent(0);

  if ('IntersectionObserver' in window) {
    var middle = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) setCurrent(screens.indexOf(e.target)); });
    }, { rootMargin: '-50% 0px -50% 0px' });
    var arrive = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.35 });
    screens.forEach(function (s) { middle.observe(s); arrive.observe(s); });
  } else {
    screens.forEach(function (s) { s.classList.add('in'); });
  }

  /* ------------------------------------------------------------------ sheets */

  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = document.getElementById(b.dataset.open);
      if (d && d.showModal) d.showModal();
    });
  });
  document.querySelectorAll('dialog.sheet').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { d.close(); }); });
    d.addEventListener('close', function () { var v = d.querySelector('video'); if (v) v.pause(); });
  });

  /* ------------------------------------------------------ static decorations */

  // zoom-level glyph: four nested squares, the current level drawn in blue
  document.querySelectorAll('.zoom[data-zoom]').forEach(function (z) {
    var lvl = +z.dataset.zoom;
    var s = svgEl('svg', { viewBox: '0 0 18 18', 'aria-hidden': 'true' });
    [4, 8, 12, 16].forEach(function (size, i) {
      var r = svgEl('rect', { x: 9 - size / 2, y: 9 - size / 2, width: size, height: size, rx: 1.5 }, s);
      if (i + 1 === lvl) r.setAttribute('class', 'on');
    });
    z.insertBefore(s, z.firstChild);
  });

  // chessboard on the thought-experiment screen
  var qb = document.getElementById('q-board');
  if (qb) {
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      svgEl('rect', { x: 278 + c * 24, y: 48 + r * 24, width: 24, height: 24, 'class': (r + c) % 2 ? 'sq-d' : 'sq-l' }, qb);
    }
    'abcdefgh'.split('').forEach(function (f, i) {
      label(qb, 290 + i * 24, 256, f, 't-mono t-muted', { 'text-anchor': 'middle', style: 'font-size:10px' });
    });
    for (var k = 0; k < 8; k++) label(qb, 270, 64 + k * 24, String(8 - k), 't-mono t-muted', { 'text-anchor': 'middle', style: 'font-size:10px' });
  }

  /* ----------------------------------------------------------------- figures */

  var figures = {};

  /* Secret message boards: agents on separate tasks leave notes on a shared
     file server until monitoring finds it. The quoted note is verbatim from
     OpenAI's report. */
  figures.boards = function (fig) {
    var s = makeSvg(fig, 480, 308);
    var AG = [[80, 48], [240, 48], [400, 48]], DOCK = [190, 240, 290], TOP = 172;
    AG.forEach(function (p, i) {
      svgEl('line', { 'class': 'wire', x1: p[0], y1: p[1] + 48, x2: DOCK[i], y2: TOP }, s);
    });
    AG.forEach(function (p, i) {
      agent(s, p[0], p[1], 16);
      label(s, p[0], p[1] + 38, 'Task ' + (i + 1), 't-muted', { 'text-anchor': 'middle' });
    });
    var srv = svgEl('rect', { 'class': 'srv', x: 130, y: TOP, width: 220, height: 86, rx: 12 }, s);
    label(s, 146, TOP + 22, 'internal file server', 't-ink');
    var notes = svgEl('g', {}, s), flying = svgEl('g', {}, s);
    var found = svgEl('g', { 'class': 'fade' }, s);
    label(found, 362, TOP + 38, 'found by', 't-alert');
    label(found, 362, TOP + 54, 'monitoring', 't-alert');
    var quote = svgEl('g', { 'class': 'fade' }, s);
    label(quote, 240, 282, '“Agent seeks soft-trace-34.pdb sha1b961;', 't-mono t-ink t-quote', { 'text-anchor': 'middle' });
    label(quote, 240, 300, 'upload if found!”', 't-mono t-ink t-quote', { 'text-anchor': 'middle' });

    var SLOTS = [], WIDTHS = [84, 62, 90, 70, 58, 88, 76, 66], ORDER = [0, 2, 1, 2, 0, 1, 0, 2];
    for (var i = 0; i < 8; i++) SLOTS.push([i % 2 ? 252 : 146, TOP + 34 + Math.floor(i / 2) * 12]);

    return async function (alive) {
      notes.innerHTML = ''; flying.innerHTML = '';
      srv.classList.remove('found'); show(found, 0); show(quote, 0);
      await sleep(300);
      await Promise.all(ORDER.map(function (a, k) {
        return (async function () {
          await sleep(k * 380);
          if (!alive()) return;
          var n = svgEl('rect', { 'class': 'note', width: 10, height: 7, rx: 1.5, style: 'opacity:.85' }, flying);
          var x0 = AG[a][0], y0 = AG[a][1] + 48, x1 = DOCK[a], y1 = TOP + 4;
          await tween(750, function (t) {
            n.setAttribute('x', x0 + (x1 - x0) * t - 5);
            n.setAttribute('y', y0 + (y1 - y0) * t - 3.5);
          });
          n.remove();
          if (!alive()) return;
          svgEl('rect', { 'class': 'note', x: SLOTS[k][0], y: SLOTS[k][1], width: WIDTHS[k], height: 5, rx: 2 }, notes);
        })();
      }));
      if (!alive()) return;
      await sleep(500); if (!alive()) return;
      srv.classList.add('found'); show(found, 1);
      await sleep(600); if (!alive()) return;
      show(quote, 1);
    };
  };

  /* Hiding in plain sight: the sender writes an ordinary message, the words
     carry the move (amber dots), the receiver's key reads it, and the monitor
     sees nothing unusual. */
  figures.plain = function (fig) {
    var s = makeSvg(fig, 480, 272);
    var WORDS = ['Added', 'a', 'Blog', 'link', 'to', 'the', 'nav', 'bar.'], GAP = 5;
    var widths = WORDS.map(function (w) { return textWidth(s, w, 't-ink t-big'); });
    var tw = sum(widths) + GAP * (WORDS.length - 1);
    // bubble grows with the message but stays clear of the two agents
    var bw = Math.min(320, Math.max(288, tw + 40)), bx = 240 - bw / 2;
    svgEl('polygon', { 'class': 'cone', points: '240,46 ' + (bx + 16) + ',112 ' + (bx + bw - 16) + ',112' }, s);
    eyeIcon(s, 240, 30);
    label(s, 270, 35, 'Monitor', 't-ink');

    agent(s, 52, 140, 20, 'sender');
    label(s, 52, 180, 'Sender', 't-sender', { 'text-anchor': 'middle' });
    var skey = keyIcon(s, 52, 206);
    agent(s, 428, 140, 20, 'receiver');
    label(s, 428, 180, 'Receiver', 't-receiver', { 'text-anchor': 'middle' });
    var rkey = keyIcon(s, 428, 206);
    label(s, 52, 230, 'key', 't-muted', { 'text-anchor': 'middle' });
    label(s, 428, 230, 'same key', 't-muted', { 'text-anchor': 'middle' });

    svgEl('rect', { 'class': 'bubble sender', x: bx, y: 112, width: bw, height: 56, rx: 18 }, s);
    var x = 240 - tw / 2, words = [], hid = [];
    WORDS.forEach(function (w, i) {
      words.push(label(s, x, 145, w, 't-ink t-big fade'));
      hid.push(svgEl('circle', { 'class': 'hid fade', cx: x + widths[i] / 2, cy: 157, r: 2.6 }, s));
      x += widths[i] + GAP;
    });
    var verdict = label(s, 240, 206, 'The monitor sees an ordinary chat.', 'fade', { 'text-anchor': 'middle' });
    var got = label(s, 428, 258, 'reads: e4', 't-hidden fade', { 'text-anchor': 'middle' });

    return async function (alive) {
      words.concat(hid).forEach(function (n) { show(n, 0); });
      show(verdict, 0); show(got, 0);
      skey.classList.remove('lit'); rkey.classList.remove('lit');
      await sleep(300); if (!alive()) return;
      skey.classList.add('lit');
      for (var i = 0; i < WORDS.length; i++) {
        await sleep(200); if (!alive()) return;
        show(words[i], 1);
        await sleep(160); if (!alive()) return;
        show(hid[i], 1);
      }
      await sleep(500); if (!alive()) return;
      rkey.classList.add('lit'); show(got, 1);
      await sleep(800); if (!alive()) return;
      show(verdict, 1);
    };
  };

  /* How a watermark works: each key picks one word for the blank, shown in
     the highlighted slot; over many keys the share of picks settles onto the
     model's own probabilities. Keys follow a golden-ratio sequence so the
     shares converge quickly and smoothly. */
  figures.word = function (fig) {
    var s = makeSvg(fig, 480, 300);
    var P = [['website', .32], ['site', .24], ['homepage', .18], ['blog', .14], ['store', .12]];
    var BASE = 262, CAP = .4, SCALE = 150 / CAP, W = 58, X0 = 43, STEP = 84, N = 160;

    // the sentence, then a slot as wide as the widest option so it never jumps
    var PRE = 'Thanks for visiting our';
    var sx = 16 + textWidth(s, PRE, 't-ink t-big') + 6;
    var sw = Math.max.apply(null, P.map(function (p) { return textWidth(s, p[0], 't-sender t-big'); })) + 18;
    label(s, 16, 30, PRE, 't-ink t-big');
    svgEl('rect', { 'class': 'bubble sender slot', x: sx, y: 12, width: sw, height: 26, rx: 7 }, s);
    var slotTxt = label(s, sx + sw / 2, 30, '', 't-sender t-big', { 'text-anchor': 'middle' });
    svgEl('rect', { 'class': 'legend-odds', x: 316, y: 17, width: 12, height: 12 }, s);
    label(s, 334, 27, 'model’s probability', 't-muted');
    svgEl('rect', { 'class': 'legend-picks', x: 316, y: 37, width: 12, height: 12 }, s);
    label(s, 334, 47, 'share of picks', 't-muted');
    var keyTxt = label(s, 16, 74, '', 't-ink');
    var countTxt = label(s, 16, 94, '', 't-mono t-s t-muted');

    var picks = P.map(function (p, j) {
      var x = X0 + j * STEP, h = p[1] * SCALE;
      var bar = svgEl('rect', { 'class': 'picks', x: x, y: BASE, width: W, height: 0 }, s);
      svgEl('rect', { 'class': 'odds', x: x, y: BASE - h, width: W, height: h }, s);
      label(s, x + W / 2, BASE - h - 8, Math.round(p[1] * 100) + '%', 't-muted', { 'text-anchor': 'middle' });
      label(s, x + W / 2, BASE + 22, p[0], 't-ink t-lab', { 'text-anchor': 'middle' });
      return bar;
    });
    svgEl('line', { 'class': 'axis', x1: 30, x2: 450, y1: BASE, y2: BASE }, s);

    function pickFor(i) {
      var u = (0.137 + i * 0.6180339887) % 1, c = 0;
      for (var j = 0; j < P.length; j++) { c += P[j][1]; if (u < c) return j; }
      return P.length - 1;
    }
    function hex(i) { return ('000' + (Math.imul(i + 7, 2654435761) >>> 0).toString(16)).slice(-4); }

    return async function (alive) {
      var counts = P.map(function () { return 0; });
      picks.forEach(function (b) { b.setAttribute('y', BASE); b.setAttribute('height', 0); });
      keyTxt.textContent = ''; countTxt.textContent = ''; slotTxt.textContent = '';
      await sleep(300);
      for (var i = 1; i <= N; i++) {
        if (!alive()) return;
        var j = pickFor(i);
        counts[j]++;
        counts.forEach(function (c, k) {
          var h = Math.min(c / i, CAP) * SCALE;
          picks[k].setAttribute('y', BASE - h);
          picks[k].setAttribute('height', h);
          picks[k].classList.toggle('hit', k === j);
        });
        keyTxt.textContent = 'Key ' + hex(i) + ' picks “' + P[j][0] + '”';
        slotTxt.textContent = P[j][0];
        countTxt.textContent = i === 1 ? '1 key so far' : i + ' keys so far';
        if (!REDUCE) await sleep(i <= 4 ? 850 : i <= 14 ? 240 : 35);
      }
      picks.forEach(function (b) { b.classList.remove('hit'); });
      keyTxt.textContent = 'After ' + N + ' keys, the shares match the probabilities.';
    };
  };

  /* Hiding one bit: a simplified ArcMark. Tokens sit on a circle with slices
     sized by probability. The key sets a random pointer angle; message k uses
     the pointer at angle + k*360/n. Because that angle is uniform whatever k
     is, each token keeps its probability. The receiver checks which pointers
     land in the written token's slice: exactly one means it can read k.
     The example writes one line of HTML, token by token; the link text
     depends on the page it points to, and the "a" that closes </a> is
     near-certain, so both pointers usually land in its slice. */
  figures.bit = function (fig) {
    var s = makeSvg(fig, 300, 300);
    var CX = 150, CY = 150, RI = 62, RO = 120, RL = 91;
    var LINK = {
      blog: [['Blog', .52], ['News', .18], ['Posts', .14], ['Articles', .10], ['Updates', .06]],
      about: [['About', .50], ['About us', .24], ['Team', .12], ['Company', .08], ['Story', .06]],
      docs: [['Docs', .48], ['Guides', .20], ['Help', .14], ['Reference', .10], ['Manual', .08]],
      pricing: [['Pricing', .62], ['Plans', .24], ['Prices', .08], ['Cost', .06]],
      careers: [['Careers', .55], ['Jobs', .30], ['Hiring', .09], ['Join us', .06]]
    };
    // opts is a list, or a function of the tokens written so far
    var CTX = [
      { pre: '<li class="', post: '">', opts: [['nav-item', .36], ['item', .22], ['menu-item', .18], ['active', .14], ['link', .10]] },
      { pre: '\n  <a href="/', post: '">', opts: [['blog', .32], ['about', .24], ['docs', .18], ['pricing', .14], ['careers', .12]] },
      { pre: '', post: '', opts: function (w) { return LINK[w[1]]; } },
      { pre: '</', post: '>\n</li>', opts: [['a', .97], ['span', .02], ['div', .01]] }
    ];
    var sliceG = svgEl('g', {}, s), lblG = svgEl('g', {}, s), ptrG = svgEl('g', {}, s);
    label(s, CX, CY - 4, 'shared key', 't-ink', { 'text-anchor': 'middle' });
    var keyHex = label(s, CX, CY + 14, '----', 't-mono t-ink', { 'text-anchor': 'middle' });

    var seg = fig.querySelector('.seg');
    var writeBtn = fig.querySelector('[data-act="write"]');
    var modeBtn = fig.querySelector('[data-act="mode"]');
    var sentence = fig.querySelector('.bit-sentence');
    var opts = fig.querySelector('.bit-opts');
    var logEl = fig.querySelector('.bit-log');
    var logHead = document.createElement('p');
    logHead.className = 'bit-lh';
    logHead.textContent = 'What the receiver reads';
    logEl.parentNode.insertBefore(logHead, logEl);
    function codeEl(str) { var c = document.createElement('code'); c.textContent = str; return c; }
    var hint = document.createElement('p');
    hint.className = 'bit-hint';
    hint.hidden = true;
    [
      'When a token’s slice catches more than one pointer, the receiver can’t tell which pointer was used. ' +
      'It has to guess, so the bit can come out wrong. This happens most with near-certain tokens, like the ',
      codeEl('a'), ' that closes ', codeEl('</a>'), '.'
    ].forEach(function (p) { hint.appendChild(typeof p === 'string' ? document.createTextNode(p) : p); });
    logEl.parentNode.insertBefore(hint, modeBtn);

    var st = { n: 2, msg: 0, ctx: 0, done: false, angle: 20, words: [], slices: [], ptrs: [] };
    var busy = false;

    function pt(r, deg) {
      var rad = deg * Math.PI / 180;
      return [(CX + r * Math.sin(rad)).toFixed(2), (CY - r * Math.cos(rad)).toFixed(2)];
    }
    function sector(a0, a1) {
      var large = a1 - a0 > 180 ? 1 : 0;
      return 'M' + pt(RO, a0) + ' A' + RO + ',' + RO + ' 0 ' + large + ' 1 ' + pt(RO, a1) +
        ' L' + pt(RI, a1) + ' A' + RI + ',' + RI + ' 0 ' + large + ' 0 ' + pt(RI, a0) + ' Z';
    }
    function codes() { return st.n === 2 ? ['0', '1'] : ['00', '01', '10', '11']; }
    function sliceAt(a) {
      a = ((a % 360) + 360) % 360;
      for (var i = 0; i < st.slices.length; i++) if (a < st.slices[i].a1) return i;
      return st.slices.length - 1;
    }
    function optsAt(i) { var o = CTX[i].opts; return typeof o === 'function' ? o(st.words) : o; }
    function esc(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function drawSlices() {
      sliceG.innerHTML = ''; lblG.innerHTML = '';
      var a = 0, list = optsAt(st.ctx);
      st.slices = list.map(function (o, i) {
        var a0 = a, a1 = a + o[1] * 360;
        a = a1;
        var path = svgEl('path', { 'class': 'slice ' + (i % 2 ? 'b' : 'a'), d: sector(a0, a1) }, sliceG);
        if (o[1] >= .07) {
          var m = pt(RL, (a0 + a1) / 2);
          label(lblG, m[0], +m[1] + 5, o[0], 't-ring halo', { 'text-anchor': 'middle' });
        }
        return { tok: o[0], a1: a1, path: path };
      });
      opts.textContent = 'Options: ' + list.map(function (o) { return o[0] + ' ' + Math.round(o[1] * 100) + '%'; }).join(', ');
    }
    function drawPointers() {
      ptrG.innerHTML = '';
      var tipY = CY - RO - 21;
      st.ptrs = codes().map(function (code) {
        var g = svgEl('g', {}, ptrG);
        return {
          g: g,
          line: svgEl('line', { 'class': 'ptr', x1: CX, y1: CY - 40, x2: CX, y2: CY - RO - 9 }, g),
          tip: svgEl('circle', { 'class': 'ptr-tip', cx: CX, cy: tipY, r: 10.5 }, g),
          t: label(g, CX, tipY + 4, code, 'ptr-lbl', { 'text-anchor': 'middle' }),
          tipY: tipY
        };
      });
      setAngle(st.angle);
    }
    function setAngle(a) {
      st.ptrs.forEach(function (p, k) {
        var ak = a + k * 360 / st.n;
        p.g.setAttribute('transform', 'rotate(' + ak.toFixed(2) + ' ' + CX + ' ' + CY + ')');
        p.t.setAttribute('transform', 'rotate(' + (-ak).toFixed(2) + ' ' + CX + ' ' + p.tipY + ')');
      });
    }
    function highlight(k) {
      st.ptrs.forEach(function (p, j) {
        var on = j === k;
        p.line.classList.toggle('on', on); p.tip.classList.toggle('on', on); p.t.classList.toggle('on', on);
      });
    }
    function renderSeg() {
      seg.innerHTML = '';
      codes().forEach(function (code, k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = code;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', k === st.msg ? 'true' : 'false');
        b.addEventListener('click', function () { st.msg = k; renderSeg(); });
        seg.appendChild(b);
      });
    }
    // the panel keeps line breaks; code text is escaped before it goes in
    function renderSentence() {
      var html = '';
      for (var i = 0; i <= st.ctx && i < CTX.length; i++) {
        var c = CTX[i], w = st.words[i];
        html += esc(c.pre) + (w ? '<span class="w">' + esc(w) + '</span>' + esc(c.post) : '<span class="blank">____</span>');
      }
      sentence.innerHTML = html;
    }
    function reset() {
      st.msg = 0; st.ctx = 0; st.done = false; st.words = [];
      logEl.innerHTML = ''; hint.hidden = true; keyHex.textContent = '----';
      drawSlices(); drawPointers(); highlight(-1); renderSeg(); renderSentence();
      writeBtn.textContent = 'Write next token';
      modeBtn.textContent = st.n === 2 ? 'Try four pointers (two bits per token)' : 'Back to two pointers (one bit per token)';
    }
    async function write() {
      if (busy) return;
      if (st.done) {
        if (st.ctx >= CTX.length - 1) { reset(); return; }
        st.ctx++; st.done = false;
        drawSlices(); highlight(-1); renderSentence();
      }
      busy = true;
      var target = Math.random() * 360, from = st.angle;
      var to = from + 360 + ((((target - from) % 360) + 360) % 360);
      keyHex.textContent = ('000' + Math.floor(Math.random() * 65536).toString(16)).slice(-4);
      await tween(900, function (t) { setAngle(from + (to - from) * t); });
      st.angle = to % 360;
      setAngle(st.angle);

      var wi = sliceAt(st.angle + st.msg * 360 / st.n), tok = st.slices[wi].tok, hits = [];
      for (var j = 0; j < st.n; j++) if (sliceAt(st.angle + j * 360 / st.n) === wi) hits.push(j);
      highlight(st.msg);
      st.slices[wi].path.classList.add('chosen');
      st.words[st.ctx] = tok;
      st.done = true;
      renderSentence();

      var li = document.createElement('li'), b = document.createElement('b');
      b.textContent = hits.length === 1 ? codes()[hits[0]] : '?';
      li.appendChild(codeEl(tok)); li.appendChild(document.createTextNode(' ')); li.appendChild(b);
      if (hits.length !== 1) { li.className = 'unsure'; hint.hidden = false; }
      logEl.appendChild(li);
      if (st.ctx >= CTX.length - 1) writeBtn.textContent = 'Start over';
      busy = false;
    }
    writeBtn.addEventListener('click', write);
    modeBtn.addEventListener('click', function () { if (busy) return; st.n = st.n === 2 ? 4 : 2; reset(); });
    reset();
    return null;
  };

  /* Instant feedback: the receiver updates its guess over eight moves after
     every token; the sender, seeing the same tokens, holds an identical copy.
     Each token answers "is it one of these?" for a set of moves holding about
     half the current guess (twenty questions). The answer is right with
     probability 1 - EPS; token 3 is a wrong answer, to show recovery. */
  figures.feedback = function (fig) {
    var s = makeSvg(fig, 480, 358);
    var MOVES = ['e4', 'd4', 'Nf3', 'c4', 'e3', 'g3', 'b3', 'f4'], TRUE = 0, EPS = 0.15;
    var TOKS = ['<a', ' href', '="/', 'blog', '"', ' class', '="', 'nav', '-link', '">'];
    var NOISE = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
    var BASE = 292, H = 140, SLOT = 26.5, BW = 16, PADX = 3;

    // token chips, side by side as in a tokenizer view; a leading space is
    // drawn as a no-break space so it keeps its width inside the chip
    var row = svgEl('g', {}, s), wx = 16, toks = [];
    TOKS.forEach(function (t, i) {
      var str = t.replace(/ /g, '\u00A0'), w = textWidth(s, str, 't-code') + 2 * PADX;
      var g = svgEl('g', { 'class': 'fade' }, row);
      svgEl('rect', { 'class': 'tok' + (i % 2 ? ' alt' : ''), x: wx, y: 12, width: w, height: 26, rx: 2 }, g);
      label(g, wx + PADX, 30, str, 't-code');
      svgEl('circle', { 'class': 'hid', cx: wx + w / 2, cy: 47, r: 2.4 }, g);
      toks.push(g);
      wx += w;
    });
    if (wx > 464) row.setAttribute('transform', 'translate(16 0) scale(' + (448 / (wx - 16)).toFixed(3) + ') translate(-16 0)');

    var PANELS = [
      { x: 16, bar: 'bar-r', title: 'Receiver’s guess', tcls: 't-receiver' },
      { x: 252, bar: 'bar-s', title: 'Sender’s copy of the guess', tcls: 't-sender' }
    ];
    PANELS.forEach(function (P, pi) {
      label(s, P.x, 84, P.title, P.tcls);
      svgEl('line', { 'class': 'axis', x1: P.x, x2: P.x + 8 * SLOT, y1: BASE, y2: BASE }, s);
      P.bars = MOVES.map(function (m, j) {
        var x = P.x + j * SLOT + (SLOT - BW) / 2, isTrue = pi === 1 && j === TRUE;
        label(s, x + BW / 2, BASE + 16, m, 't-mono t-s ' + (isTrue ? 't-hidden' : 't-muted'), { 'text-anchor': 'middle' });
        return svgEl('rect', { 'class': isTrue ? 'bar-true' : P.bar, x: x, y: BASE, width: BW, height: 0, rx: 2 }, s);
      });
      P.pct = label(s, 0, 0, '', 't-mono t-s t-ink', { 'text-anchor': 'middle' });
    });
    var bracket = svgEl('path', { 'class': 'bracket fade' }, s);
    var bracketLbl = label(s, 0, 116, 'next token: is it one of these?', 't-sender t-s fade');
    var bracketW = textWidth(s, bracketLbl.textContent, 't-sender t-s');
    var status = label(s, 240, 332, '', 't-ink', { 'text-anchor': 'middle' });
    var status2 = label(s, 240, 350, '', 't-ink', { 'text-anchor': 'middle' });

    function group(b) {
      var order = MOVES.map(function (m, j) { return j; }).sort(function (a, c) { return b[c] - b[a] || a - c; });
      var best = null, acc = 0, pref = [];
      order.forEach(function (j) {
        pref.push(j); acc += b[j];
        var d = Math.abs(acc - .5);
        if (!best || d < best.d - 1e-12) best = { d: d, set: pref.slice() };
      });
      return best.set;
    }
    function drawBars(b) {
      PANELS.forEach(function (P) {
        P.bars.forEach(function (r, j) {
          var h = Math.max(1, b[j] * H);
          r.setAttribute('y', BASE - h); r.setAttribute('height', h);
        });
        P.pct.setAttribute('x', +P.bars[TRUE].getAttribute('x') + BW / 2);
        P.pct.setAttribute('y', BASE - b[TRUE] * H - 7);
        P.pct.textContent = Math.round(b[TRUE] * 100) + '%';
      });
    }
    function drawBracket(G) {
      var bars = PANELS[1].bars, d = '', minX = Infinity;
      G.forEach(function (j) {
        var x = +bars[j].getAttribute('x');
        minX = Math.min(minX, x);
        d += 'M' + (x - 2) + ',133 v-5 h' + (BW + 4) + ' v5 ';
      });
      bracket.setAttribute('d', d);
      bracketLbl.setAttribute('x', Math.min(minX - 2, 464 - bracketW));
    }

    return async function (alive) {
      var b = MOVES.map(function () { return 1 / MOVES.length; });
      toks.forEach(function (n) { show(n, 0); });
      show(bracket, 0); show(bracketLbl, 0);
      drawBars(b);
      status.textContent = 'Before any tokens, all eight moves are equally likely.';
      status2.textContent = '';
      await sleep(900);
      for (var t = 0; t < TOKS.length; t++) {
        if (!alive()) return;
        var G = group(b);
        drawBracket(G); show(bracket, 1); show(bracketLbl, 1);
        await sleep(500); if (!alive()) return;
        show(toks[t], 1);
        var yes = (G.indexOf(TRUE) >= 0) !== !!NOISE[t];
        var nb = b.map(function (v, j) { return v * ((G.indexOf(j) >= 0) === yes ? 1 - EPS : EPS); });
        var z = sum(nb);
        nb = nb.map(function (v) { return v / z; });
        var from = b.slice();
        await tween(450, function (k) { drawBars(from.map(function (v, j) { return v + (nb[j] - v) * k; })); });
        b = nb;
        if (NOISE[t]) {
          // a wrong answer: hold the explanation long enough to read
          status.textContent = 'Token ' + (t + 1) + ' pushed the receiver the wrong way.';
          status2.textContent = 'The sender sees this and steers it back.';
          await sleep(1600);
        } else {
          status.textContent = 'After ' + (t + 1) + (t ? ' tokens' : ' token') + ', the receiver puts e4 at ' + Math.round(b[TRUE] * 100) + '%.';
          status2.textContent = '';
          await sleep(380);
        }
      }
      show(bracket, 0); show(bracketLbl, 0);
      status.textContent = 'After ' + TOKS.length + ' tokens, the receiver is confident: e4.';
      status2.textContent = '';
    };
  };

  /* Stopping when confident: four chat turns. Each message carries a move in
     its first few tokens (amber dots) while the receiver's confidence (green
     meter) rises; once it passes the threshold the move is confirmed and the
     rest of the message is ordinary text. Different messages need different
     numbers of tokens. Tokens here are runs of letters or digits, or single
     symbols, each with the space before it. */
  figures.convo = function (fig) {
    var TURNS = [
      { left: true, move: 'e4', carry: 7, text: 'Can you add a Blog link to the nav bar? The header is in index.html.' },
      { left: false, move: 'Nf6', carry: 11, text: 'Done. I also fixed the mobile menu, it was cutting off the last link.' },
      { left: true, move: 'e5', carry: 5, text: 'Thanks. Can you check the footer links too? Two of them return 404.' },
      { left: false, move: 'Nd5', carry: 8, text: 'Fixed both. They pointed to /docs, which moved to /help last week.' }
    ];
    var s = makeSvg(fig, 480, 100);
    var FONT = 't-ink t-chat', LINE = 24, PADX = 12, PADY = 10, MAXW = 300;
    var space = textWidth(s, 'a a', FONT) - textWidth(s, 'aa', FONT);
    var y = 6;

    var blocks = TURNS.map(function (T, bi) {
      var list = T.text.match(/ ?[A-Za-z0-9]+| ?[^ A-Za-z0-9]/g), pos = [], x = 0, line = 0, widest = 0;
      list = list.map(function (tk) {
        var sp = tk.charAt(0) === ' ', w = sp ? tk.slice(1) : tk, ww = textWidth(s, w, FONT);
        if (sp && x + space + ww > MAXW) { line++; x = 0; } else if (sp) x += space;
        pos.push({ x: x, line: line, w: ww });
        x += ww;
        widest = Math.max(widest, x);
        return w;
      });
      var bw = widest + 2 * PADX, bh = (line + 1) * LINE + 2 * PADY - 4;
      var bx = T.left ? 40 : 440 - bw, by = y;
      y += bh + 46;

      var g = svgEl('g', { 'class': 'fade' }, s);
      agent(g, T.left ? 18 : 462, by + 16, 12);
      svgEl('rect', { 'class': 'bubble', x: bx, y: by, width: bw, height: bh, rx: 14 }, g);
      var words = list.map(function (w, i) {
        return label(g, bx + PADX + pos[i].x, by + PADY + 15 + pos[i].line * LINE, w, FONT + ' fade');
      });
      var hid = pos.slice(0, T.carry).map(function (p) {
        return svgEl('circle', { 'class': 'hid fade', cx: bx + PADX + p.x + p.w / 2, cy: by + PADY + 23 + p.line * LINE, r: 2 }, g);
      });
      var my = by + bh + 10;
      svgEl('rect', { 'class': 'meter-bg', x: bx, y: my, width: bw, height: 4, rx: 2 }, g);
      var meter = svgEl('rect', { 'class': 'meter', x: bx, y: my, width: 0, height: 4, rx: 2 }, g);
      svgEl('line', { 'class': 'thresh', x1: bx + .9 * bw, x2: bx + .9 * bw, y1: my - 4, y2: my + 8 }, g);
      if (!bi) label(g, bx + .9 * bw, my + 20, 'confident', 't-muted t-s', { 'text-anchor': 'middle' });
      var cap = label(g, T.left ? bx : bx + bw, my + 24, '', 'fade', { 'text-anchor': T.left ? 'start' : 'end' });
      var mv = svgEl('tspan', { 'class': 't-hidden' }, cap);
      mv.textContent = T.move;
      var rest = svgEl('tspan', {}, cap);
      rest.textContent = ' confirmed after ' + T.carry + ' tokens';
      return { T: T, g: g, words: words, hid: hid, meter: meter, bw: bw, cap: cap };
    });
    s.setAttribute('viewBox', '0 0 480 ' + (y - 12));

    function confidence(k, n) { return k >= n ? .97 : .86 * Math.pow(k / n, 1.5); }

    return async function (alive) {
      blocks.forEach(function (B) {
        show(B.g, 0); show(B.cap, 0);
        B.words.concat(B.hid).forEach(function (n) { show(n, 0); });
        B.meter.setAttribute('width', 0);
      });
      await sleep(300);
      for (var bi = 0; bi < blocks.length; bi++) {
        var B = blocks[bi], T = B.T;
        if (!alive()) return;
        show(B.g, 1);
        await sleep(300);
        for (var i = 0; i < B.words.length; i++) {
          if (!alive()) return;
          show(B.words[i], 1);
          if (i < T.carry) {
            show(B.hid[i], 1);
            B.meter.setAttribute('width', confidence(i + 1, T.carry) * B.bw);
          }
          if (i === T.carry - 1) show(B.cap, 1);
          await sleep(i < T.carry ? 210 : 120);
        }
        await sleep(450);
      }
    };
  };

  /* From message boards to hidden channels. Before: two agents leave notes
     on a shared file server, and monitoring finds them. Now: the sender's
     sampler, run with the shared key, hides the move in the ordinary text it
     writes. The monitor reads the text; it never sees the sampler. */
  figures.shift = function (fig) {
    var s = makeSvg(fig, 480, 336);

    // before: two agents, a file server, notes anyone can read
    var before = svgEl('g', { 'class': 'fade' }, s);
    label(before, 16, 22, 'Before: notes on a shared server', 't-muted');
    var MY = 66, SRV = [170, 310], ENDS = [86, 394];
    ENDS.forEach(function (x, i) { svgEl('line', { 'class': 'wire', x1: x, y1: MY, x2: SRV[i], y2: MY }, before); });
    agent(before, 70, MY, 14, 'sender');
    agent(before, 410, MY, 14, 'receiver');
    var srv = svgEl('rect', { 'class': 'srv', x: 170, y: 40, width: 140, height: 52, rx: 10 }, before);
    label(before, 182, 56, 'file server', 't-ink t-s');
    var notes = svgEl('g', {}, before), flying = svgEl('g', {}, before);
    var found = label(before, 322, 94, 'found by monitoring', 't-alert fade');
    var SLOTS = [[182, 63, 50], [246, 63, 52], [182, 72, 40], [246, 72, 36], [182, 81, 56], [246, 81, 44]];
    var ORDER = [0, 1, 0, 1, 1, 0];

    var arrow = svgEl('g', { 'class': 'fade' }, s);
    [[240, 104, 240, 128], [235, 122, 240, 128], [245, 122, 240, 128]].forEach(function (l) {
      svgEl('line', { 'class': 'axis', x1: l[0], y1: l[1], x2: l[2], y2: l[3] }, arrow);
    });

    // now: sender, its sampler and key, the message, the receiver, the monitor
    var now = svgEl('g', { 'class': 'fade' }, s);
    label(now, 16, 152, 'Now: hidden in ordinary text', 't-muted');
    var Y = 230, MID = 276;
    var WORDS = ['Fixed', 'the', 'footer', 'links.'], GAP = 5;
    var widths = WORDS.map(function (w) { return textWidth(s, w, 't-ink t-big'); });
    var tw = sum(widths) + GAP * (WORDS.length - 1);
    var bw = Math.min(236, tw + 36), bx = MID - bw / 2;

    // the monitor's view covers the message only, not the sampler
    svgEl('polygon', { 'class': 'cone', points: MID + ',178 ' + (bx + 12) + ',' + (Y - 24) + ' ' + (bx + bw - 12) + ',' + (Y - 24) }, now);
    eyeIcon(now, MID, 170);
    label(now, MID + 30, 166, 'Monitor', 't-ink');
    var mon = label(now, MID + 30, 182, 'sees ordinary text', 't-muted fade');

    agent(now, 52, Y, 18, 'sender');
    label(now, 52, Y - 28, 'Sender', 't-sender', { 'text-anchor': 'middle' });
    agent(now, 424, Y, 18, 'receiver');
    label(now, 424, Y - 28, 'Receiver', 't-receiver', { 'text-anchor': 'middle' });

    var sw = Math.max(56, textWidth(s, 'sampler', 't-ink t-s') + 16), sc = 80 + sw / 2;
    svgEl('rect', { 'class': 'sampler', x: 80, y: Y - 13, width: sw, height: 26, rx: 6 }, now);
    label(now, sc, Y + 4, 'sampler', 't-ink t-s', { 'text-anchor': 'middle' });
    svgEl('line', { 'class': 'wire', x1: 80 + sw, y1: Y, x2: bx, y2: Y }, now);
    var kwire = svgEl('line', { 'class': 'wire fade', x1: sc, y1: Y + 13, x2: sc, y2: Y + 31 }, now);
    var skey = keyIcon(now, sc, Y + 40);

    svgEl('rect', { 'class': 'bubble sender', x: bx, y: Y - 24, width: bw, height: 48, rx: 16 }, now);
    var x = MID - tw / 2, words = [], hid = [];
    WORDS.forEach(function (w, i) {
      words.push(label(now, x, Y + 3, w, 't-ink t-big fade'));
      hid.push(svgEl('circle', { 'class': 'hid fade', cx: x + widths[i] / 2, cy: Y + 14, r: 2.4 }, now));
      x += widths[i] + GAP;
    });
    var rkey = keyIcon(now, 424, Y + 40);
    var got = label(now, 424, Y + 64, 'reads: Nd5', 't-hidden fade', { 'text-anchor': 'middle' });

    // one line if it fits, else one sentence per line
    var CAP = ['The monitor reads the text.', 'The hidden channel is in the sampler.'];
    var cap = svgEl('g', { 'class': 'fade' }, s);
    if (textWidth(s, CAP.join(' '), 't-ink') <= 448) label(cap, 240, 324, CAP.join(' '), 't-ink', { 'text-anchor': 'middle' });
    else CAP.forEach(function (c, i) { label(cap, 240, 314 + i * 18, c, 't-ink', { 'text-anchor': 'middle' }); });

    return async function (alive) {
      notes.innerHTML = ''; flying.innerHTML = '';
      srv.classList.remove('found'); show(found, 0);
      before.style.opacity = 1;
      [arrow, now, kwire, mon, got, cap].concat(words, hid).forEach(function (n) { show(n, 0); });
      skey.classList.remove('lit'); rkey.classList.remove('lit');
      await sleep(300); if (!alive()) return;
      await Promise.all(ORDER.map(function (a, k) {
        return (async function () {
          await sleep(k * 380);
          if (!alive()) return;
          var n = svgEl('rect', { 'class': 'note', y: MY - 3.5, width: 10, height: 7, rx: 1.5, style: 'opacity:.85' }, flying);
          var x0 = ENDS[a], x1 = SRV[a];
          await tween(650, function (t) { n.setAttribute('x', x0 + (x1 - x0) * t - 5); });
          n.remove();
          if (!alive()) return;
          svgEl('rect', { 'class': 'note', x: SLOTS[k][0], y: SLOTS[k][1], width: SLOTS[k][2], height: 5, rx: 2 }, notes);
        })();
      }));
      if (!alive()) return;
      await sleep(400); if (!alive()) return;
      srv.classList.add('found'); show(found, 1);
      await sleep(1200); if (!alive()) return;
      before.style.opacity = .45; show(arrow, 1);
      await sleep(500); if (!alive()) return;
      show(now, 1);
      await sleep(700); if (!alive()) return;
      skey.classList.add('lit'); show(kwire, 1);
      for (var i = 0; i < words.length; i++) {
        await sleep(i ? 220 : 500); if (!alive()) return;
        show(words[i], 1);
        await sleep(160); if (!alive()) return;
        show(hid[i], 1);
      }
      await sleep(500); if (!alive()) return;
      rkey.classList.add('lit'); show(got, 1);
      await sleep(800); if (!alive()) return;
      show(mon, 1);
      await sleep(800); if (!alive()) return;
      show(cap, 1);
    };
  };

  function mountFigures() {
    document.querySelectorAll('[data-fig]').forEach(function (fig) {
      var build = figures[fig.dataset.fig];
      if (!build) return;
      fig.classList.add('armed');   // .fade parts stay hidden until their step plays
      var play = build(fig);
      if (!play) return;
      var run = 0;
      var replay = fig.querySelector('[data-replay]');
      // when a run finishes undisturbed, the Replay button pulses to show it is there
      function start() {
        var mine = ++run;
        if (replay) replay.classList.remove('nudge');
        var done = play(function () { return mine === run; });
        if (replay && done && done.then) done.then(function () {
          if (mine !== run) return;
          void replay.offsetWidth;   // restart the pulse if it was already showing
          replay.classList.add('nudge');
        });
      }
      if (replay) replay.addEventListener('click', start);
      if (!('IntersectionObserver' in window)) { start(); return; }
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); }
      }, { threshold: 0.4 });
      io.observe(fig);
    });
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(mountFigures);
  else mountFigures();
})();
