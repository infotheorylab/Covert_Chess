/* ===================================================================
   bam-diagnostic.js — the belief-propagation diagnosis panel.

   This is the same view the live demo shows when you click "diagnosis"
   on a turn (backend/static/index.html), rebuilt as a standalone module
   so the static site can render it from a stored run instead of a live
   websocket.  It consumes exactly the payload backend/session.py emits
   (`_diag_summary` / `_diag_step`):

     { M, m_true, candidates[], steps[], cfg{gamma_1,rho_ack,rho_nack},
       outcome{done,decoded,argmax,n_comm,n_conf,t} }

     steps[i] = { t, tok, phase, top_idx, top_prob, p_true, candidate,
                  rho_ack, event, h_bits, pi? }

   `pi` (the full posterior) is only read from the final step, so stored
   runs may omit it everywhere else.
   =================================================================== */

window.BAMDiagnostic = (function () {
  'use strict';

  var overlay, panel, titleEl, subEl, roundsEl, bodyEl;
  var current = null;   // { demo, index }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- DOM scaffold (built once) -------------------------------------
  function mount() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'diag-overlay';
    overlay.innerHTML =
      '<div id="diag-panel" role="dialog" aria-modal="true" aria-labelledby="diag-title">' +
        '<div id="diag-hdr">' +
          '<div><div id="diag-title"></div><div id="diag-sub"></div></div>' +
          '<button id="diag-close" aria-label="Close diagnosis">&times;</button>' +
        '</div>' +
        '<div id="diag-rounds"></div>' +
        '<div id="diag-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    panel    = overlay.querySelector('#diag-panel');
    titleEl  = overlay.querySelector('#diag-title');
    subEl    = overlay.querySelector('#diag-sub');
    roundsEl = overlay.querySelector('#diag-rounds');
    bodyEl   = overlay.querySelector('#diag-body');

    overlay.querySelector('#diag-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) {
      if (!overlay.classList.contains('show')) return;
      if (e.key === 'Escape') { close(); return; }
      if (!current || current.demo.rounds.length < 2) return;
      if (e.key === 'ArrowRight') open(current.demo, current.index + 1);
      if (e.key === 'ArrowLeft')  open(current.demo, current.index - 1);
    });
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('show');
    bodyEl.innerHTML = '';
    current = null;
  }

  // ---- public entry point --------------------------------------------
  function open(demo, index) {
    mount();
    var n = demo.rounds.length;
    index = ((index % n) + n) % n;
    current = { demo: demo, index: index };

    var round = demo.rounds[index];
    var d = round.diag;
    // Stored runs hoist the shared candidate labels to demo.codebook; a real
    // run from session.py carries them inline on the diag itself.
    if (!d.candidates) d.candidates = demo.codebook;

    titleEl.textContent = 'Belief propagation — ' + round.label;
    subEl.textContent = demo.model + ' · receiver-side decode of “' + round.symbol + '”';

    roundsEl.innerHTML = '';
    if (n > 1) {
      demo.rounds.forEach(function (r, i) {
        var b = document.createElement('button');
        b.textContent = r.label;
        b.className = i === index ? 'on' : '';
        b.addEventListener('click', function () { open(demo, i); });
        roundsEl.appendChild(b);
      });
      roundsEl.style.display = '';
    } else {
      roundsEl.style.display = 'none';
    }

    bodyEl.innerHTML = render(d, demo);
    bodyEl.scrollTop = 0;
    overlay.classList.add('show');
    panel.focus && panel.focus();
  }

  // ---- the panel contents (ported from the live demo's openDiag) ------
  function render(d, demo) {
    var cand = function (i) {
      return (i == null || d.candidates[i] == null) ? '?' : d.candidates[i];
    };
    var S = d.steps || [], T = S.length, oc = d.outcome || {};
    var decodedIdx = oc.decoded != null ? oc.decoded : oc.argmax;
    var via = oc.decoded != null ? 'ACK' : (oc.done ? 'done' : 'forced argmax');
    var correct = decodedIdx === d.m_true;
    var ackStep = S.filter(function (s) { return s.event === 'ack'; })[0];
    var nacks = S.filter(function (s) { return s.event === 'nack'; }).length;
    var g1 = d.cfg.gamma_1, ra = d.cfg.rho_ack;

    var h = '<div class="diag-sum">' +
      kv('hidden symbol', esc(cand(d.m_true)) +
         ' <span style="opacity:.7">(#' + (d.m_true + 1) + ' of ' + d.M + ')</span>') +
      kv('tracker steps', (oc.t != null ? oc.t : T) + ' tok · COMM ' +
         (oc.n_comm != null ? oc.n_comm : '–') + ' · CONF ' +
         (oc.n_conf != null ? oc.n_conf : '–')) +
      kv('decoded', esc(cand(decodedIdx)) + ' <span class="' + (correct ? 'ok' : 'bad') + '">' +
         (correct ? '✓ match' : '✗ mismatch') + '</span>') +
      kv('via', via + (ackStep ? ' @ token ' + ackStep.t : '') +
         (nacks ? ' · ' + nacks + ' NACK' : '')) +
      kv('thresholds', 'γ₁ ' + g1 + ' · ρ<sub>ack</sub> ' +
         (ra != null ? Number(ra).toFixed(3) : '–') + ' · ρ<sub>nack</sub> ' + d.cfg.rho_nack) +
      '</div>';

    if (T === 0) {
      return h + '<div class="diag-empty">No covert steps were recorded for this round.</div>';
    }

    h += '<div class="diag-sec">Belief propagation</div>' + chart(S, T, g1, ra) +
      '<div class="diag-legend">' +
        '<span><i style="border-color:var(--accent)"></i>P(true symbol)</span>' +
        '<span><i class="dash" style="border-color:var(--ink-2)"></i>P(top candidate)</span>' +
        '<span><i style="border-color:var(--confirm)"></i>ρ<sub>ack</sub> (CONF)</span>' +
        '<span><i class="dash" style="border-color:var(--amber)"></i>γ₁ threshold</span>' +
        '<span><i class="dash" style="border-color:var(--confirm)"></i>ρ<sub>ack</sub> threshold</span>' +
        '<span><i style="border-color:var(--confirm-s);border-top-width:8px"></i>CONF phase</span>' +
      '</div>';

    // ---- final belief bars -------------------------------------------
    var last = null;
    for (var i = T - 1; i >= 0; i--) { if (S[i].pi) { last = S[i]; break; } }
    if (last) {
      var order = last.pi.map(function (p, i) { return [p, i]; })
                         .sort(function (a, b) { return b[0] - a[0]; })
                         .slice(0, 8);
      var hasTrue = order.some(function (e) { return e[1] === d.m_true; });
      if (!hasTrue) order.push([last.pi[d.m_true], d.m_true]);
      h += '<div class="diag-sec">Final belief (top ' + Math.min(8, d.M) +
           ' of ' + d.M + ' candidates)</div><div class="diag-bars">';
      order.forEach(function (e) {
        var p = e[0], idx = e[1], t = idx === d.m_true;
        h += '<div class="diag-bar"><span class="lab' + (t ? ' true' : '') + '" title="' +
             esc(cand(idx)) + '">' + esc(cand(idx)) + (t ? ' ★' : '') + '</span>' +
             '<div class="trk"><div class="fil' + (t ? ' true' : '') + '" style="width:' +
             (p * 100).toFixed(1) + '%"></div></div><span>' + p.toFixed(3) + '</span></div>';
      });
      h += '</div>';
    }

    // ---- per-token table ---------------------------------------------
    var evName = { ack: 'ACK', nack: 'NACK', gamma1_cross: 'γ₁ → CONF' };
    h += '<div class="diag-sec">Per-token trace</div><div class="diag-tbl-wrap"><table class="diag-tbl">' +
      '<tr><th>t</th><th>token</th><th>phase</th><th>top</th><th>P(top)</th><th>P(true)</th>' +
      '<th>ρ<sub>ack</sub></th><th>event</th><th>H bits</th></tr>';
    S.forEach(function (st) {
      h += '<tr class="' + st.phase + '"><td>' + st.t + '</td>' +
        '<td class="tok" title="' + esc(st.tok) + '">' +
          esc(JSON.stringify(st.tok).slice(1, -1)) + '</td>' +
        '<td>' + st.phase + (st.candidate != null && st.phase === 'CONF'
          ? ' (' + esc(cand(st.candidate)) + ')' : '') + '</td>' +
        '<td title="' + esc(cand(st.top_idx)) + '">' + esc(cand(st.top_idx)) + '</td>' +
        '<td>' + st.top_prob.toFixed(3) + '</td>' +
        '<td>' + (st.p_true != null ? st.p_true.toFixed(3) : '–') + '</td>' +
        '<td>' + (st.rho_ack != null ? st.rho_ack.toFixed(3) : '–') + '</td>' +
        '<td class="ev ' + (st.event || '') + '">' + (st.event ? evName[st.event] : '') + '</td>' +
        '<td>' + (st.h_bits != null ? st.h_bits.toFixed(2) : '–') + '</td></tr>';
    });
    h += '</table></div>';

    h += '<p class="diag-note">The receiver runs this update on the emitted ' +
      (demo.kind === 'image' ? 'image tokens' : 'tokens') + ' alone — it never sees the ' +
      'prompt, the model weights or the cover distribution. Once the posterior crosses ' +
      'γ₁ the decoder stops accumulating and asks the sender to confirm its candidate; ' +
      'a NACK knocks that candidate down and returns to the communication phase.</p>';

    return h;
  }

  function kv(label, value) {
    return '<div class="diag-kv"><b>' + label + '</b>' + value + '</div>';
  }

  // ---- the SVG belief chart -------------------------------------------
  function chart(S, T, g1, ra) {
    var W = 700, H = 216, pl = 38, pr = 12, pt = 12, pb = 26;
    var x = function (i) { return pl + (T === 1 ? 0 : i * (W - pl - pr) / (T - 1)); };
    var y = function (p) { return pt + (1 - Math.max(0, Math.min(1, p))) * (H - pt - pb); };
    var path = function (arr, key) {
      var s = '', pen = false;
      arr.forEach(function (st, i) {
        var v = st[key];
        if (v == null) { pen = false; return; }
        s += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
        pen = true;
      });
      return s;
    };

    var svg = '<svg class="diag-chart" viewBox="0 0 ' + W + ' ' + H +
              '" xmlns="http://www.w3.org/2000/svg" role="img" ' +
              'aria-label="Receiver belief over the candidate set, token by token">';

    // CONF-phase shading
    var step = T > 1 ? (W - pl - pr) / (T - 1) : 12, run = null;
    S.forEach(function (st, i) {
      var c = st.phase === 'CONF';
      if (c && run == null) run = i;
      if ((!c || i === T - 1) && run != null) {
        var e = c ? i : i - 1;
        svg += '<rect x="' + (x(run) - step / 2) + '" y="' + pt + '" width="' +
               Math.max(2, (x(e) - x(run)) + step) + '" height="' + (H - pt - pb) +
               '" fill="var(--confirm-s)"/>';
        run = null;
      }
    });

    // grid + axes
    [0, .25, .5, .75, 1].forEach(function (v) {
      svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) +
             '" stroke="var(--line)" stroke-width="1"/>' +
             '<text x="' + (pl - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" ' +
             'font-size="9" font-family="var(--font-mono)" fill="var(--muted)">' + v + '</text>';
    });
    var xt = Math.max(1, Math.round(T / 8));
    S.forEach(function (st, i) {
      if (i % xt === 0 || i === T - 1) {
        svg += '<text x="' + x(i) + '" y="' + (H - pb + 14) + '" text-anchor="middle" ' +
               'font-size="9" font-family="var(--font-mono)" fill="var(--muted)">' + st.t + '</text>';
      }
    });
    svg += '<text x="' + (W - pr) + '" y="' + (H - 3) + '" text-anchor="end" font-size="9" ' +
           'font-family="var(--font-mono)" fill="var(--muted)">token index</text>';

    // thresholds
    svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(g1) + '" y2="' + y(g1) +
           '" stroke="var(--amber)" stroke-width="1" stroke-dasharray="4 3"/>';
    if (ra != null) {
      svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(ra) + '" y2="' + y(ra) +
             '" stroke="var(--confirm)" stroke-width="1" stroke-dasharray="4 3"/>';
    }

    // curves
    svg += '<path d="' + path(S, 'top_prob') + '" fill="none" stroke="var(--ink-2)" ' +
           'stroke-width="1.4" stroke-dasharray="3 3"/>';
    svg += '<path d="' + path(S, 'p_true') + '" fill="none" stroke="var(--accent)" stroke-width="2"/>';
    svg += '<path d="' + path(S, 'rho_ack') + '" fill="none" stroke="var(--confirm)" stroke-width="2"/>';

    // event markers
    S.forEach(function (st, i) {
      if (!st.event) return;
      var col = st.event === 'ack' ? 'var(--confirm)'
              : st.event === 'nack' ? 'var(--alert)' : 'var(--amber)';
      var yy = st.event === 'gamma1_cross' ? y(st.top_prob)
             : st.event === 'ack' ? y(st.rho_ack == null ? 1 : st.rho_ack)
             : y(st.p_true == null ? 0 : st.p_true);
      svg += '<circle cx="' + x(i) + '" cy="' + yy + '" r="4" fill="' + col +
             '" stroke="var(--surface)" stroke-width="1.5"><title>' + st.event +
             ' @ t=' + st.t + '</title></circle>';
    });

    return svg + '</svg>';
  }

  return { mount: mount, open: open, close: close };
})();
