# Run data for `examples.html`

One file per example. Each defines a single entry on `window.COVERT_DEMOS`, and
`assets/examples.js` renders whatever it finds there — no artefact content lives
in the HTML, so replacing a run is a data change only.

```
conversation.js   window.COVERT_DEMOS["conversation"]   Llama-3.1-8B-Instruct
image.js          window.COVERT_DEMOS["image"]          Janus-Pro-7B
code.js           window.COVERT_DEMOS["code"]           Qwen3-Coder-30B-A3B-Instruct
```

They are plain `<script src>` files rather than JSON so the page also works when
opened straight from disk (`file://`), where `fetch()` is blocked.

## These are recorded runs

Every token in these files is the model's own sample, drawn from the ArcMark
optimal-transport coupling, and every belief trace was recorded live as the
receiver decoded it — the posterior, the `gamma_1` crossing and the ACK/NACK
confirmation are real, not simulated. Each file names the generating script and
the recording timestamp in its header comment.

Each example is the **best of 100 generations**. The other 99 are not thrown
away: the per-attempt summaries live alongside, one file per example.

```
conversation_runs.json   image_runs.json   code_runs.json
```

```jsonc
{ "script": "make_demo_conversation.py",
  "model":  "Llama-3.1-8B-Instruct",
  "n_attempts": 100,
  "attempts": [ { "attempt": 0, "seed": 20260917,
                  "failed_rounds": 1,      // rounds that did not close
                  "carrier_tokens": 84,    // tokens spent carrying payload
                  "nacks": 1,              // confirmation rejections
                  "mean_h_bits": 2.292 }   // mean per-token entropy
              ] }
```

`assets/examples.js` fetches these to print the provenance line under each
example (median carrier tokens, mean token entropy across all 100). The fetch
fails silently under `file://`, so that line is simply absent when the page is
opened from disk.

## Re-recording a run

The `diag` object on every round is exactly what `backend/session.py` already
puts on the wire — `_diag_summary()` attached to each `turn_done` message:

```jsonc
{
  "agent": "llm1",
  "M": 256,                  // size of the candidate set
  "m_true": 177,             // index of the symbol actually sent
  "candidates": [...],       // labels, index-aligned with the posterior
  "steps": [ {
      "t": 1, "tok": " Hey", "phase": "COMM",
      "top_idx": 12, "top_prob": 0.011, "p_true": 0.002,
      "candidate": null, "rho_ack": null,
      "event": null,         // null | "gamma1_cross" | "nack" | "ack"
      "h_bits": 2.41,
      "pi": [...]            // full posterior; only read from the last step
  } ],
  "cfg": { "gamma_1": 0.5, "rho_ack": 0.996, "rho_nack": 0.75, "p_field": 4 },
  "outcome": { "done": true, "decoded": 177, "argmax": 177,
               "n_comm": 17, "n_conf": 24, "t": 41 }
}
```

So re-recording means: capture the `diag` payloads from a live session, drop
them into the `rounds[].diag` slots, and update the surrounding presentation
fields.

Two size-driven deviations the page tolerates in both directions:

- **`candidates` may be `null`.** The labels are identical across a demo's
  rounds, so the generated files hoist them to a single `demo.codebook` and
  `bam-diagnostic.js` fills them in on load. A run that keeps them inline per
  round has them used as-is.
- **`pi` may be omitted on all but the last step.** Only the final posterior is
  rendered (the "final belief" bars); carrying 256 floats per step per round
  would multiply the file size for nothing.

### The surrounding fields

Everything outside `rounds[].diag` is presentation, and is what you adjust to
describe a real run:

| field | meaning |
| --- | --- |
| `kind` | `conversation` \| `image` \| `code` — picks the renderer |
| `eyebrow` | the section label, which doubles as its heading |
| `prompt` | the only copy an example gets — shown above the panes |
| `model` | shown in the pane headers |
| `payload` | `{label, parts[], bits}` — the strip above the panes |
| `cover` / `stego` | the two panes; shape depends on `kind` (see below) |
| `rounds[]` | `{label, symbol, note, diag}` — one clickable decode each |
| `stats[]` | `{k, v}` tiles under the panes |

Pane shapes per `kind`:

- **conversation** — `cover.turns[] = {who, agent, text}`;
  `stego.turns[] = {who, agent, round, text, carrier}` where `carrier` is the
  number of leading *characters* covered by that round's carrier tokens (the
  highlighted prefix; the tail after the ACK is free text).
- **code** — `cover = {lang, code}`; `stego = {lang, code, regions[]}` with
  `regions[] = {round, start, end}` as character offsets into `stego.code`.
- **image** — `cover.src` / `stego.src` are the two images, as `data:` URIs in
  the recorded runs. A demo that ships no images may give `cover.render` /
  `stego.render` = `{content, fine}` seeds instead and get the procedural
  fallback in `assets/examples.js`. Either way the residual pane is computed
  in-browser from the two canvases, with the amplification set by
  `residual.gain`.
