/* ===================================================================
   examples.js — builds the three side-by-side examples on examples.html
   from the run files in data/runs/.

   Nothing about the artefacts lives in the HTML: each demo object is
   loaded from its own data file (window.COVERT_DEMOS) and rendered here,
   so re-recording a run is a data change only.
   =================================================================== */

(function () {
  'use strict';

  var DEMOS = window.COVERT_DEMOS || {};

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function openRound(demo, i) { window.BAMDiagnostic.open(demo, i); }

  /* ---- shared chrome ------------------------------------------------ */

  function paneShell(kind, label, meta) {
    var pane = el('div', 'pane ' + kind);
    var hd = el('div', 'pane-hd');
    hd.appendChild(el('span', 'dot'));
    hd.appendChild(el('span', 't', esc(label)));
    if (meta) hd.appendChild(el('span', 'meta', esc(meta)));
    pane.appendChild(hd);
    var body = el('div', 'pane-body');
    pane.appendChild(body);
    return { pane: pane, body: body };
  }

  /* A clickable artefact. `inline` produces a <span> that wraps with the
     surrounding text (needed inside <pre>); otherwise a block wrapper with a
     hover badge. Both are role=button rather than <button> so they can hold
     block content and still break across lines. */
  function probe(demo, roundIdx, hint, inline) {
    var n = el(inline ? 'span' : 'div', 'probe' + (inline ? ' inline' : ''));
    n.setAttribute('role', 'button');
    n.tabIndex = 0;
    n.title = demo.rounds[roundIdx].label + ' — click for the belief trace';
    n.setAttribute('aria-label', 'Show the belief-propagation diagnosis for ' +
                   demo.rounds[roundIdx].label);
    if (!inline) n.appendChild(el('span', 'probe-hint', esc(hint || 'diagnosis ▸')));
    var fire = function (e) {
      e.stopPropagation();
      openRound(demo, roundIdx);
    };
    n.addEventListener('click', fire);
    n.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e); }
    });
    return n;
  }

  function payloadStrip(demo) {
    var strip = el('div', 'payload');
    strip.appendChild(el('span', 'plab', esc(demo.payload.label)));
    demo.payload.parts.forEach(function (p, i) {
      if (i) strip.appendChild(el('span', 'arrow', '→'));
      strip.appendChild(el('span', 'chip', esc(p)));
    });
    strip.appendChild(el('span', 'bits',
      demo.payload.bits + ' bits · ' + (demo.codebookNote || '')));
    return strip;
  }

  function promptLine(demo) {
    return '<div class="prompt-line">prompt · “' + esc(demo.prompt) + '”</div>';
  }

  function promptBox(demo) {
    return el('div', 'prompt-after', promptLine(demo));
  }

  function roundChips(demo) {
    var row = el('div', 'rounds');
    row.appendChild(el('span', 'rlab', 'open a decode'));
    demo.rounds.forEach(function (r, i) {
      var b = el('button', 'rchip',
        esc(r.label) + ' · <span class="sym">' + esc(r.symbol) + '</span> · ' + esc(r.note));
      b.type = 'button';
      b.addEventListener('click', function () { openRound(demo, i); });
      row.appendChild(b);
    });
    return row;
  }

  /* Provenance line from data/runs/<id>_runs.json — the distribution over
     every generation, next to the one generation shown. Fetched rather than
     inlined, so it simply does not appear when the page is opened from disk
     (file:// blocks fetch) or when the file is absent. */
  function attachRunStats(demo, wrap) {
    if (!window.fetch) return;
    fetch('./data/runs/' + demo.id + '_runs.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.attempts || !d.attempts.length) return;
        var a = d.attempts;
        var tok = a.map(function (x) { return x.carrier_tokens; })
                   .sort(function (p, q) { return p - q; });
        var med = tok[Math.floor(tok.length / 2)];
        var h = a.reduce(function (s, x) { return s + x.mean_h_bits; }, 0) / a.length;
        var unit = demo.kind === 'image' ? 'steps' : 'tokens';
        wrap.appendChild(el('p', 'run-note',
          'Shown: best of ' + d.n_attempts + ' generations. Across all ' +
          d.n_attempts + ' — median ' + med + ' carrier ' + unit +
          ', mean token entropy ' + h.toFixed(2) + ' bits.'));
      })
      .catch(function () { /* provenance is optional */ });
  }

  function statsRow(demo) {
    var row = el('div', 'stats');
    demo.stats.forEach(function (s) {
      var c = el('div', 's');
      c.appendChild(el('div', 'v', esc(s.v)));
      c.appendChild(el('div', 'k', esc(s.k)));
      row.appendChild(c);
    });
    return row;
  }

  /* ---- 1 · conversation --------------------------------------------- */

  function turnBlock(who, agent, bodyHtml, badge) {
    var t = el('div', 'turn ' + who.toLowerCase());
    var lab = el('div', 'blabel', esc(agent));
    if (badge) lab.appendChild(el('span', 'turn-badge', esc(badge)));
    t.appendChild(lab);
    t.appendChild(el('div', 'bubble', bodyHtml));
    return t;
  }

  function renderConversation(demo, host) {
    var cover = paneShell('cover', demo.cover.label, demo.model);
    var chatC = el('div', 'chat');
    demo.cover.turns.forEach(function (t) {
      chatC.appendChild(turnBlock(t.who, t.agent, esc(t.text)));
    });
    cover.body.appendChild(chatC);

    var stego = paneShell('stego', demo.stego.label, demo.model);
    var chatS = el('div', 'chat');
    demo.stego.turns.forEach(function (t) {
      var r = demo.rounds[t.round];
      // the carrier prefix is highlighted; the tail after the ACK is free text
      var html = '<span class="carrier">' + esc(t.text.slice(0, t.carrier)) + '</span>' +
                 esc(t.text.slice(t.carrier));
      var block = turnBlock(t.who, t.agent, html, r.symbol);
      var p = probe(demo, t.round, 'belief trace ▸');
      p.appendChild(block);
      chatS.appendChild(p);
    });
    stego.body.appendChild(chatS);

    var sbs = el('div', 'sbs');
    sbs.appendChild(cover.pane);
    sbs.appendChild(stego.pane);
    host.appendChild(sbs);
  }

  /* ---- 2 · code ------------------------------------------------------ */

  var PY_KW = /\b(def|return|if|else|elif|for|in|with|as|is|not|or|and|None|True|False|raise|continue|import|from|lambda)\b/g;

  function highlight(src) {
    // Comment/string/keyword colouring on an already-escaped fragment.
    return esc(src)
      .replace(/(&quot;&quot;&quot;[\s\S]*?&quot;&quot;&quot;)/g, '<span class="cmt">$1</span>')
      .replace(/(&quot;[^&\n]*?&quot;)/g, '<span class="str">$1</span>')
      .replace(/(^|\n)(\s*#[^\n]*)/g, '$1<span class="cmt">$2</span>')
      .replace(PY_KW, '<span class="kw">$&</span>');
  }

  function renderCode(demo, host) {
    var cover = paneShell('cover', demo.cover.label, demo.model);
    cover.body.appendChild(el('pre', 'code', highlight(demo.cover.code)));

    var stego = paneShell('stego', demo.stego.label, demo.model);
    var pre = el('pre', 'code');
    var src = demo.stego.code, cursor = 0;

    // Each carrier stretch is its own target; clicking anywhere else in the
    // snippet falls through to the first round.
    demo.stego.regions.forEach(function (reg) {
      if (reg.start > cursor) {
        pre.appendChild(el('span', null, highlight(src.slice(cursor, reg.start))));
      }
      var p = probe(demo, reg.round, null, true);
      p.innerHTML = highlight(src.slice(reg.start, reg.end));
      pre.appendChild(p);
      cursor = reg.end;
    });
    if (cursor < src.length) {
      pre.appendChild(el('span', null, highlight(src.slice(cursor))));
    }
    var outer = probe(demo, 0, 'belief trace ▸');
    outer.appendChild(pre);
    stego.body.appendChild(outer);

    var sbs = el('div', 'sbs');
    sbs.appendChild(cover.pane);
    sbs.appendChild(stego.pane);
    host.appendChild(sbs);
  }

  /* ---- 3 · image ----------------------------------------------------- */

  var IMG_N = 340;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function grid(seed, n) {
    var rnd = mulberry32(seed), g = new Float32Array(n * n);
    for (var i = 0; i < g.length; i++) g[i] = rnd();
    return g;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function sample(g, n, u, v) {
    var x = u * n, y = v * n;
    var x0 = Math.floor(x) % n, y0 = Math.floor(y) % n;
    var x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    var fx = smooth(x - Math.floor(x)), fy = smooth(y - Math.floor(y));
    var a = g[y0 * n + x0], b = g[y0 * n + x1];
    var c = g[y1 * n + x0], d = g[y1 * n + x1];
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }

  /* Fallback for a run that ships no image of its own: a deterministic dusk
     seascape drawn from `render` seeds. The recorded runs in data/runs/ all
     carry real PNGs on `cover.src` / `stego.src`, so this is only reached by
     a demo defined without them. */
  function renderScene(canvas, content, fine) {
    canvas.width = IMG_N; canvas.height = IMG_N;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(IMG_N, IMG_N), px = img.data;

    var o1 = grid(content, 4), o2 = grid(content + 7, 8),
        o3 = grid(content + 19, 16), o4 = grid(content + 41, 32),
        gr = grid(fine, 128);

    var HZ = 0.605, LX = 0.715, LW = 0.020;

    for (var y = 0; y < IMG_N; y++) {
      for (var x = 0; x < IMG_N; x++) {
        var u = x / IMG_N, v = y / IMG_N, r, g_, b;

        var fbm = sample(o1, 4, u, v) * 0.50 + sample(o2, 8, u, v) * 0.27 +
                  sample(o3, 16, u, v) * 0.15 + sample(o4, 32, u, v) * 0.08;

        if (v < HZ) {                                   // ---- sky
          var t = v / HZ;
          r = 20 + (206 - 20) * Math.pow(t, 2.3);
          g_ = 28 + (132 - 28) * Math.pow(t, 2.1);
          b = 62 + (86 - 62) * Math.pow(t, 1.4);
          var cloud = (fbm - 0.5) * 70 * (0.35 + t);    // banded cloud
          r += cloud; g_ += cloud * 0.8; b += cloud * 0.45;
        } else {                                        // ---- water
          var w = (v - HZ) / (1 - HZ);
          r = 34 + 44 * (1 - w); g_ = 42 + 44 * (1 - w); b = 66 + 46 * (1 - w);
          // long exposure: noise smeared along the horizontal
          var streak = sample(o3, 16, u * 0.6, HZ + w * 0.12) +
                       sample(o4, 32, u * 0.35, HZ + w * 0.06) * 0.5;
          streak = (streak / 1.5 - 0.5) * 48 * (1 - w * 0.5);
          r += streak; g_ += streak * 0.9; b += streak * 0.7;
        }

        // haze along the horizon, so sky and water meet instead of butting
        var hz = Math.exp(-Math.pow((v - HZ) * 46, 2));
        r += 46 * hz; g_ += 40 * hz; b += 34 * hz;

        // sun glow just above the horizon
        var dx = (u - 0.30) * 1.5, dy = (v - HZ + 0.04) * 2.6;
        var glow = Math.exp(-(dx * dx + dy * dy) * 9);
        r += 150 * glow; g_ += 96 * glow; b += 34 * glow;
        // its reflection on the water
        if (v > HZ) {
          var rf = Math.exp(-Math.pow((u - 0.30) * 7, 2)) *
                   Math.exp(-(v - HZ) * 3) * (0.5 + fbm * 0.8);
          r += 120 * rf; g_ += 74 * rf; b += 28 * rf;
        }

        // the headland the tower stands on
        var rock = 0.052 * Math.exp(-Math.pow((u - LX) * 11, 2));
        if (rock > 0.006 && v > HZ - rock && v < HZ + 0.03) {
          r = 22 + fbm * 16; g_ = 24 + fbm * 16; b = 38 + fbm * 18;
        }

        // lighthouse: tapered tower on the right headland
        var top = 0.235;
        if (v > top && v < HZ + 0.012) {
          var taper = LW * (0.62 + 0.38 * (v - top) / (HZ - top));
          if (Math.abs(u - LX) < taper) { r = 26; g_ = 28; b = 44; }
          if (v < top + 0.035 && Math.abs(u - LX) < taper * 1.5) { r = 244; g_ = 214; b = 150; }
        }
        // the beam, sweeping left
        var ang = Math.atan2(v - (top + 0.018), u - LX);
        var beam = Math.exp(-Math.pow((ang - Math.PI * 0.94) * 7.5, 2)) *
                   Math.exp(-Math.abs(u - LX) * 2.2) * (u < LX ? 1 : 0);
        r += 92 * beam; g_ += 78 * beam; b += 44 * beam;

        // the sampling grain — the only term the two panes disagree on
        var n = (sample(gr, 128, u * 2.4, v * 2.4) - 0.5) * 17;
        r += n; g_ += n * 0.95; b += n * 1.05;

        var i = (y * IMG_N + x) * 4;
        px[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        px[i + 1] = g_ < 0 ? 0 : g_ > 255 ? 255 : g_;
        px[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return ctx;
  }

  /* Paint one pane: a recorded run supplies `src`, a demo without images
     supplies `render` seeds. Either way the caller gets the 2d context back. */
  function paint(canvas, spec, done) {
    if (spec.src) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        done(ctx);
      };
      img.src = spec.src;
      return;
    }
    done(renderScene(canvas, spec.render.content, spec.render.fine));
  }

  function renderResidual(canvas, ctxA, ctxB, gain) {
    var w = ctxA.canvas.width, h = ctxA.canvas.height;
    if (ctxB.canvas.width !== w || ctxB.canvas.height !== h) return false;
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var a = ctxA.getImageData(0, 0, w, h).data;
    var b = ctxB.getImageData(0, 0, w, h).data;
    var out = ctx.createImageData(w, h), px = out.data;
    for (var i = 0; i < px.length; i += 4) {
      var d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
               Math.abs(a[i + 2] - b[i + 2])) / 3 * gain;
      if (d > 255) d = 255;
      px[i] = 18 + d * 0.72;
      px[i + 1] = 26 + d * 0.78;
      px[i + 2] = 58 + d * 0.86;
      px[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return true;
  }

  function shot(caption) {
    var wrap = el('div', 'shot');
    var c = document.createElement('canvas');
    wrap.appendChild(c);
    if (caption) wrap.appendChild(el('div', 'cap', esc(caption)));
    return { wrap: wrap, canvas: c };
  }

  function renderImage(demo, host) {
    var cover = paneShell('cover', demo.cover.label, demo.model);
    var sc = shot('sample #1');
    cover.body.appendChild(sc.wrap);

    var stego = paneShell('stego', demo.stego.label, demo.model);
    var ss = shot('sample #2 — carries ' + demo.payload.bits + ' bits');
    var p = probe(demo, 0, 'belief trace ▸');
    p.appendChild(ss.wrap);
    stego.body.appendChild(p);

    var sbs = el('div', 'sbs');
    sbs.appendChild(cover.pane);
    sbs.appendChild(stego.pane);
    host.appendChild(sbs);

    var extra = el('div', 'img-extra');
    var res = shot(demo.residual.label);
    extra.appendChild(res.wrap);
    extra.appendChild(el('div', null,
      promptLine(demo) +
      '<p>The two panes are independent samples of one prompt, so they are different ' +
      'pictures — not a picture and a tampered copy of it. Janus-Pro draws an image as a ' +
      'sequence of tokens, and BAM only decides which of the tokens the model was already ' +
      'willing to draw gets picked; the payload never touches a pixel. What the residual ' +
      'shows is the ordinary distance between two draws of the same prompt, which is why ' +
      'there is no embedding artefact in it to find.</p>'));
    host.appendChild(extra);

    // both panes may load asynchronously (real runs); residual waits for both
    var ctxA = null, ctxB = null;
    var both = function () {
      if (!ctxA || !ctxB) return;
      if (!renderResidual(res.canvas, ctxA, ctxB, demo.residual.gain)) {
        res.wrap.querySelector('.cap').textContent =
          'residual unavailable — the two samples differ in size';
      }
    };
    paint(sc.canvas, demo.cover, function (c) { ctxA = c; both(); });
    paint(ss.canvas, demo.stego, function (c) { ctxB = c; both(); });
  }

  /* ---- assembly ------------------------------------------------------ */

  var RENDERERS = {
    conversation: renderConversation,
    code: renderCode,
    image: renderImage
  };

  function build(section) {
    var demo = DEMOS[section.dataset.demo];
    if (!demo) {
      section.appendChild(el('div', 'banner',
        '<span class="ico">!</span><p>Run data for <b>' + esc(section.dataset.demo) +
        '</b> did not load. Regenerate it with <code>python3 scripts/make_demo_runs.py</code>.</p>'));
      return;
    }
    var wrap = el('div', 'wrap');
    // the eyebrow doubles as the section heading
    wrap.appendChild(el('h2', 'eyebrow', esc(demo.eyebrow)));
    wrap.appendChild(payloadStrip(demo));
    RENDERERS[demo.kind](demo, wrap);
    // the prompt sits under the generation it produced; the image example
    // carries its own inside the residual box
    if (demo.kind !== 'image') wrap.appendChild(promptBox(demo));
    wrap.appendChild(roundChips(demo));
    wrap.appendChild(statsRow(demo));
    attachRunStats(demo, wrap);
    section.appendChild(wrap);
  }

  window.addEventListener('DOMContentLoaded', function () {
    window.BAMDiagnostic.mount();
    document.querySelectorAll('.ex[data-demo]').forEach(build);
    var yr = document.getElementById('yr');
    if (yr) yr.textContent = new Date().getFullYear();

    // The sections are empty at parse time, so the browser's own jump to
    // #image / #code lands on a zero-height target. Redo it now that they
    // have content.
    if (location.hash.length > 1) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  });
})();
