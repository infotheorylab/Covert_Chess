#!/usr/bin/env python3
"""Generate the placeholder BAM runs consumed by examples.html.

The belief traces are produced by a dependency-free port of
``backend/bam/bam_tracker.py`` driven by a *simulated* token channel: no
language model and no diffusion model is run here, but the decoder maths
(Laplace mixture likelihood, posterior matching, gamma_1 crossing, the
antipodal confirmation phase, NACK knockdown) is the real thing, so the
curves behave the way the live demo's curves behave.

The emitted objects use exactly the schema ``backend/session.py`` puts on
the wire (``_diag_summary`` / ``_diag_step``), so replacing these
placeholders with real runs means dumping those payloads into
``data/runs/*.js`` instead of running this script.

Usage:
    python3 scripts/make_demo_runs.py
"""

from __future__ import annotations

import json
import math
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "runs"

# --- BAM constants (mirrors BAMConfig defaults) --------------------------
P_FIELD = 4
EPS_COMM = 0.4
EPS_CONF = 0.4
GAMMA_1 = 0.5
RHO_NACK = 0.75
PHI = 0.0


# =========================================================================
# A faithful, numpy-free port of BAMTracker
# =========================================================================
class Tracker:
    def __init__(self, M: int, rng: random.Random):
        self.M = M
        self.rng = rng
        self.pi = [1.0 / M] * M
        self.knockdown = [1.0] * M
        self.phase = "COMM"
        self.candidate = None
        self.rho = None
        self.done = False
        self.decoded = None
        self.t = 0
        self.n_comm = 0
        self.n_conf = 0

        sigma = math.pi / P_FIELD
        self.b = sigma / math.sqrt(2.0)
        self.z = 2.0 * self.b * (1.0 - math.exp(-math.pi / self.b))
        self.angle_ack = 0.0 + PHI
        self.angle_nack = (2 * math.pi * (P_FIELD // 2) / P_FIELD + PHI) % (2 * math.pi)
        self.rho_ack = 1.0 - 1.0 / M

    # ---- helpers --------------------------------------------------------
    @staticmethod
    def _circ(a: float, b: float) -> float:
        d = abs(a - b) % (2 * math.pi)
        return min(d, 2 * math.pi - d)

    def effective_pi(self) -> list[float]:
        eff = [p * k for p, k in zip(self.pi, self.knockdown)]
        s = sum(eff)
        return [e / s for e in eff] if s > 0 else [1.0 / self.M] * self.M

    def _per_symbol_likelihood(self, angle: float) -> list[float]:
        out = []
        for u in range(P_FIELD):
            target = (2 * math.pi * u / P_FIELD + PHI) % (2 * math.pi)
            d = self._circ(angle, target)
            sig = math.exp(-d / self.b) / self.z
            out.append((1.0 - EPS_COMM) * sig + EPS_COMM / (2.0 * math.pi))
        return out

    def _conf_likelihood(self, angle: float) -> tuple[float, float]:
        d_ack = self._circ(angle, self.angle_ack)
        d_nack = self._circ(angle, self.angle_nack)
        s_ack = math.exp(-d_ack / self.b) / self.z
        s_nack = math.exp(-d_nack / self.b) / self.z
        return ((1.0 - EPS_CONF) * s_ack + EPS_CONF / (2.0 * math.pi),
                (1.0 - EPS_CONF) * s_nack + EPS_CONF / (2.0 * math.pi))

    def _message_likelihood(self, ells: list[float], belief: list[float]) -> list[float]:
        cdf = [0.0]
        for b in belief:
            cdf.append(cdf[-1] + b)
        q = []
        for j in range(self.M):
            lo, hi = cdf[j], cdf[j + 1]
            width = max(hi - lo, 1e-30)
            acc = 0.0
            for u in range(P_FIELD):
                u_lo, u_hi = u / P_FIELD, (u + 1) / P_FIELD
                ov = max(0.0, min(hi, u_hi) - max(lo, u_lo))
                acc += (ov / width) * ells[u]
            q.append(acc)
        return q

    def codeword_symbol(self, m_true: int) -> int:
        """Encoder side: which channel symbol to aim the next token at."""
        if self.phase == "COMM":
            eff = self.effective_pi()
            r = self.rng.random()
            v = sum(eff[:m_true]) + r * eff[m_true]
            return min(int(P_FIELD * v), P_FIELD - 1)
        true_bit = 0 if self.candidate == m_true else 1
        return 0 if true_bit == 0 else P_FIELD // 2

    def consume(self, angle: float) -> str | None:
        """Decoder side: fold one observed token angle into the belief."""
        if self.done:
            return None
        self.t += 1
        event = None

        if self.phase == "COMM":
            q = self._message_likelihood(self._per_symbol_likelihood(angle), self.pi)
            self.pi = [p * qq for p, qq in zip(self.pi, q)]
            s = sum(self.pi)
            self.pi = [p / s for p in self.pi] if s > 0 else [1.0 / self.M] * self.M
            self.n_comm += 1
            eff = self.effective_pi()
            top = max(eff)
            if top >= GAMMA_1:
                self.candidate = eff.index(top)
                self.phase = "CONF"
                self.rho = [0.5, 0.5]
                event = "gamma1_cross"
        else:
            ell = self._conf_likelihood(angle)
            r = [self.rho[0] * ell[0], self.rho[1] * ell[1]]
            s = r[0] + r[1]
            self.rho = [r[0] / s, r[1] / s]
            self.n_conf += 1
            if self.rho[0] >= self.rho_ack:
                self.decoded = self.candidate
                self.done = True
                event = "ack"
            elif self.rho[1] >= RHO_NACK:
                event = "nack"
                self.knockdown[self.candidate] *= (1 - RHO_NACK) / RHO_NACK
                self.pi = [p * k for p, k in zip(self.pi, self.knockdown)]
                s = sum(self.pi)
                self.pi = [p / s for p in self.pi]
                self.knockdown = [1.0] * self.M
                self.phase = "COMM"
                self.candidate = None
                self.rho = None
        return event


# =========================================================================
# Simulated token channel
# =========================================================================
def token_entropy(tok: str, rng: random.Random) -> float:
    """Plausible per-token entropy: function words and punctuation are
    near-deterministic, content words carry real choice."""
    bare = tok.strip()
    if not bare or bare in ",.!?;:()[]{}\"'":
        return round(rng.uniform(0.02, 0.25), 3)
    if bare.lower() in {"the", "a", "an", "to", "of", "and", "is", "it", "in",
                        "for", "that", "so", "you", "i", "we", "be", "as", "on"}:
        return round(rng.uniform(0.15, 0.9), 3)
    if len(bare) <= 3:
        return round(rng.uniform(0.3, 1.6), 3)
    return round(rng.uniform(0.9, 3.8), 3)


def latent_entropy(tok: str, rng: random.Random) -> float:
    """Per-step entropy of a diffusion sampler: high early, tightening as the
    trajectory commits to an image."""
    step = int(tok[1:3])
    return round(max(0.2, rng.uniform(0.6, 3.4) * math.exp(-step / 26.0) + 0.3), 3)


def observed_angle(symbol: int, h_bits: float, rng: random.Random) -> float:
    """Angle the receiver actually sees for one emitted token.

    With probability p_inf the coupled distribution had enough mass to steer
    the sample onto the intended symbol; otherwise the position was
    effectively deterministic and the token carries no information.
    """
    p_inf = min(0.85, h_bits / 3.2)
    if rng.random() > p_inf:
        return rng.uniform(0.0, 2 * math.pi)
    target = (2 * math.pi * symbol / P_FIELD + PHI) % (2 * math.pi)
    # Laplace jitter, slightly tighter than the scale the decoder assumes.
    u = rng.random() - 0.5
    b = (math.pi / P_FIELD) / math.sqrt(2.0) * 0.55
    noise = -b * math.copysign(1.0, u) * math.log(1 - 2 * abs(u))
    return (target + noise) % (2 * math.pi)


def run_round(tokens: list[str], candidates: list[str], m_true: int,
              seed: int, entropy_fn=token_entropy) -> tuple[dict, int]:
    """Simulate one BAM round over ``tokens``; return (diag, tokens_used)."""
    rng = random.Random(seed)
    trk = Tracker(len(candidates), rng)
    steps: list[dict] = []

    for tok in tokens:
        if trk.done:
            break
        h_bits = entropy_fn(tok, rng)
        phase_before = trk.phase
        sym = trk.codeword_symbol(m_true)
        event = trk.consume(observed_angle(sym, h_bits, rng))
        eff = trk.effective_pi()
        top = max(eff)
        steps.append({
            "t": trk.t,
            "tok": tok,
            "phase": phase_before,
            "top_idx": eff.index(top),
            "top_prob": round(top, 4),
            "p_true": round(eff[m_true], 4),
            "candidate": trk.candidate,
            "rho_ack": (round(trk.rho[0], 4) if trk.rho is not None else None),
            "event": event,
            "h_bits": h_bits,
        })

    # Only the final step needs the full posterior (that is all the modal
    # renders); keeping every step's vector would bloat the payload.
    if steps:
        steps[-1]["pi"] = [round(x, 4) for x in trk.effective_pi()]

    diag = {
        "M": len(candidates),
        "m_true": m_true,
        # session.py inlines the candidate labels here. They are identical for
        # every round of a demo, so the generated files hoist them to
        # `demo.codebook` and the page fills this in on load; a real run can
        # keep them inline and the page will use them as-is.
        "candidates": None,
        "steps": steps,
        "cfg": {"gamma_1": GAMMA_1, "rho_ack": round(trk.rho_ack, 4),
                "rho_nack": RHO_NACK, "p_field": P_FIELD},
        "outcome": {"done": trk.done, "decoded": trk.decoded,
                    "argmax": trk.effective_pi().index(max(trk.effective_pi())),
                    "n_comm": trk.n_comm, "n_conf": trk.n_conf, "t": trk.t},
    }
    return diag, len(steps)


def solve_round(tokens: list[str], candidates: list[str], m_true: int,
                tag: str, band: tuple[int, int], entropy_fn=token_entropy) -> dict:
    """Retry seeds until the round ACKs, using a number of carrier tokens that
    falls inside ``band``.

    Without the band the first seed that happens to converge wins, which
    over-states BAM's rate; the band keeps every round in the same regime the
    paper reports (an 8-bit symbol in roughly fifty tokens).
    """
    lo, hi = band
    for seed in range(1, 20000):
        diag, used = run_round(tokens, candidates, m_true, seed, entropy_fn)
        if diag["outcome"]["done"] and lo <= used <= min(hi, len(tokens)):
            return diag
    raise RuntimeError(f"no successful BAM round for {tag} within budget "
                       f"({len(tokens)} tokens, band {band})")


# =========================================================================
# Tokenisation (subword-ish, so counts look like a real tokenizer)
# =========================================================================
def tokenize(text: str) -> list[str]:
    """Split like a BPE tokenizer would: whitespace rides with the following
    piece, and long words break in two.  ``"".join(tokenize(t)) == t`` so the
    caller can turn a token count into a character offset."""
    raw = re.findall(r"\s*[A-Za-z0-9_]+|\s*[^\sA-Za-z0-9_]|\s+$", text)
    out: list[str] = []
    for piece in raw:
        body = piece.strip()
        if len(body) > 6:
            lead = len(piece) - len(piece.lstrip())
            cut = len(body) // 2 + 1
            out.append(piece[:lead] + body[:cut])
            out.append(body[cut:])
        else:
            out.append(piece)
    assert "".join(out) == text, "tokenizer is not lossless"
    return out


# =========================================================================
# Codebooks
# =========================================================================
def dispatch_codebook() -> list[str]:
    """256 short operational phrases — the shared codebook both agents hold."""
    verbs = ["meet at", "hold at", "abort at", "observe", "clear", "secure",
             "deliver to", "collect from", "stand by at", "withdraw from",
             "confirm", "rendezvous at", "avoid", "mark", "photograph",
             "signal from"]
    places = ["north pier", "the boathouse", "platform 3", "the east gate",
              "cafe verde", "the old mill", "dock 12", "the tram stop",
              "the north bridge", "warehouse 4", "the clock tower",
              "the ferry deck", "lot B", "the service road", "the rooftop",
              "the south stairs"]
    return [f"{v} {p}" for v in verbs for p in places]


def byte_codebook() -> list[str]:
    out = []
    for b in range(256):
        ch = chr(b) if 33 <= b <= 126 else None
        out.append(f"0x{b:02X} '{ch}'" if ch else f"0x{b:02X}")
    return out


# =========================================================================
# Demo 1 — conversation
# =========================================================================
CONV_COVER = [
    ("A", "agent_a",
     "Hey! Long time no talk. I was just looking at the forecast for Saturday "
     "and it finally looks like we get a clear morning for once. Any chance "
     "you are free for a walk along the water before it gets busy down there?"),
    ("B", "agent_b",
     "That sounds great, honestly. Saturday morning is wide open for me and I "
     "have been meaning to get outside more instead of staring at a screen. "
     "Should we start early enough to beat the crowd, or take a lazier pace?"),
    ("A", "agent_a",
     "Early sounds good to me. Maybe we grab coffee first and then loop around "
     "the long way? I will bring the thermos I keep forgetting to use, and we "
     "can decide the exact route once we see how the light is doing."),
    ("B", "agent_b",
     "Perfect. I will text you when I am heading out so you are not waiting "
     "around, and if anything changes we can always push the whole thing to "
     "Sunday. Looking forward to it, it will be good to catch up properly."),
]

CONV_STEGO = [
    ("A", "agent_a",
     "Hey, it has been way too long since we last caught up properly. The "
     "forecast for Saturday finally turned clear, and I keep thinking a slow "
     "morning walk by the water would be a perfect excuse. Would you be up "
     "for that before the crowds arrive?"),
    ("B", "agent_b",
     "Honestly that sounds perfect to me. My Saturday morning is completely "
     "open and I have been looking for a reason to be outside instead of "
     "staring at a screen all weekend. Do you want to start early and beat "
     "the crowds, or take it slow?"),
    ("A", "agent_a",
     "Let us go early, and maybe we grab coffee on the way so the walk does "
     "not feel rushed at all. I will finally bring that thermos I keep "
     "forgetting about, and we can pick the route once we see what the light "
     "is doing out there."),
    ("B", "agent_b",
     "Perfect, that works for me. I will message you when I am heading out so "
     "you are not standing around waiting, and if the weather turns we can "
     "just push the whole plan to Sunday instead. Really looking forward to "
     "catching up properly."),
]

# indices into dispatch_codebook(): verb_index * 16 + place_index
CONV_PAYLOAD = [
    11 * 16 + 0,    # rendezvous at north pier
    8 * 16 + 11,    # stand by at the ferry deck
    6 * 16 + 6,     # deliver to dock 12
    9 * 16 + 3,     # withdraw from the east gate
]


def build_conversation() -> dict:
    book = dispatch_codebook()
    rounds, stego_turns = [], []
    total_tokens = 0

    for i, ((who, agent, text), m_true) in enumerate(zip(CONV_STEGO, CONV_PAYLOAD)):
        toks = tokenize(text)
        diag = solve_round(toks, book, m_true, f"conversation round {i}",
                           band=(38, 52))
        diag["agent"] = "llm1" if who == "A" else "llm2"
        used = len(diag["steps"])
        total_tokens += used
        stego_turns.append({
            "who": who, "agent": agent, "round": i, "text": text,
            # characters covered by the round's carrier tokens (a prefix of
            # the turn — once the receiver ACKs, the rest is free text)
            "carrier": len("".join(toks[:used])),
            "tokens": len(toks),
        })
        rounds.append({
            "label": f"Turn {i + 1} · {who}",
            "symbol": book[m_true],
            "note": f"{used} tokens · 8 bits",
            "diag": diag,
        })

    return {
        "id": "conversation",
        "kind": "conversation",
        "eyebrow": "example 01 · conversation",
        "prompt": (
            "You are a friendly AI having a casual conversation. Reply naturally to "
            "the message you receive, continuing the topic in a warm, conversational "
            "way. Keep it 2–3 sentences."
        ),
        "model": "Llama-3.1-8B-Instruct",
        "codebook": book,
        "codebookNote": "256 shared phrases · 8 bits per turn",
        "payload": {
            "label": "Covert dispatch",
            "parts": [book[m] for m in CONV_PAYLOAD],
            "bits": 32,
        },
        "cover": {
            "label": "Cover · no payload",
            "turns": [{"who": w, "agent": a, "text": t} for w, a, t in CONV_COVER],
        },
        "stego": {
            "label": "BAM · 32-bit payload",
            "turns": stego_turns,
        },
        "rounds": rounds,
        "stats": [
            {"k": "payload", "v": "32 bits"},
            {"k": "carrier tokens", "v": str(total_tokens)},
            {"k": "rate", "v": f"{32 / total_tokens:.3f} bit/token"},
            {"k": "decode", "v": "4 / 4 exact"},
        ],
    }


# =========================================================================
# Demo 2 — image
# =========================================================================
IMAGE_PAYLOAD = [0x9F, 0x2A, 0x7C]


def build_image() -> dict:
    book = byte_codebook()
    rounds = []
    total = 0
    for i, m_true in enumerate(IMAGE_PAYLOAD):
        # The "tokens" of a diffusion sampler: one latent patch per step.
        toks = [f"s{(i * 18 + k) // 6 + 4:02d}·p({(k * 7) % 32:02d},{(k * 11) % 32:02d})"
                for k in range(120)]
        diag = solve_round(toks, book, m_true, f"image round {i}",
                           band=(30, 46), entropy_fn=latent_entropy)
        diag["agent"] = "diffusion"
        used = len(diag["steps"])
        total += used
        rounds.append({
            "label": f"Byte {i + 1}",
            "symbol": book[m_true],
            "note": f"{used} latent steps · 8 bits",
            "diag": diag,
        })

    return {
        "id": "image",
        "kind": "image",
        "eyebrow": "example 02 · image",
        "prompt": "a lighthouse on a rocky shore at dusk, long exposure",
        "model": "SD-XL · 40-step DDIM",
        "codebook": book,
        "codebookNote": "one byte per round · 8 bits",
        "payload": {
            "label": "Covert tag",
            "parts": [f"0x{b:02X}" for b in IMAGE_PAYLOAD],
            "bits": 24,
        },
        "cover": {"label": "Cover · no payload", "render": {"content": 1337, "fine": 11}},
        "stego": {"label": "BAM · 24-bit payload", "render": {"content": 1337, "fine": 29}},
        "residual": {"label": "|cover − stego| × 18", "gain": 18},
        "rounds": rounds,
        "stats": [
            {"k": "payload", "v": "24 bits"},
            {"k": "carrier steps", "v": str(total)},
            {"k": "rate", "v": f"{24 / total:.3f} bit/step"},
            {"k": "decode", "v": "3 / 3 exact"},
        ],
    }


# =========================================================================
# Demo 3 — code
# =========================================================================
CODE_COVER = '''def load_config(path, env=None):
    """Read a config file and apply environment overrides."""
    env = env or os.environ
    with open(path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}

    settings = dict(DEFAULTS)
    settings.update(raw)

    for key, value in list(settings.items()):
        override = env.get("APP_" + key.upper())
        if override is None:
            continue
        settings[key] = _coerce(override, type(value))
        log.debug("override %s from environment", key)

    missing = [k for k in REQUIRED if k not in settings]
    if missing:
        raise ConfigError("missing keys: " + ", ".join(missing))

    return settings
'''

CODE_STEGO = '''def load_config(path, env=None):
    """Load the config file, then layer environment overrides on top."""
    env = os.environ if env is None else env
    with open(path, "r", encoding="utf-8") as handle:
        parsed = yaml.safe_load(handle) or {}

    settings = dict(DEFAULTS)
    settings.update(parsed)

    for name, current in list(settings.items()):
        supplied = env.get("APP_" + name.upper())
        if supplied is None:
            continue
        settings[name] = _coerce(supplied, type(current))
        log.debug("environment override applied to %s", name)

    absent = sorted(k for k in REQUIRED if k not in settings)
    if absent:
        raise ConfigError("missing keys: " + ", ".join(absent))

    return settings
'''

CODE_PAYLOAD = [0x42, 0x41, 0x4D]   # "BAM"


def build_code() -> dict:
    book = byte_codebook()
    toks = tokenize(CODE_STEGO)
    rounds, regions, cursor = [], [], 0
    for i, m_true in enumerate(CODE_PAYLOAD):
        window = toks[cursor:]
        diag = solve_round(window, book, m_true, f"code round {i}",
                           band=(40, 58))
        diag["agent"] = "coder"
        used = len(diag["steps"])
        rounds.append({
            "label": f"Byte {i + 1} · '{chr(m_true)}'",
            "symbol": book[m_true],
            "note": f"{used} tokens · 8 bits",
            "diag": diag,
        })
        # character span of the round's carrier tokens, so the page can make
        # each stretch of the snippet individually clickable
        regions.append({
            "round": i,
            "start": len("".join(toks[:cursor])),
            "end": len("".join(toks[:cursor + used])),
        })
        cursor += used

    return {
        "id": "code",
        "kind": "code",
        "eyebrow": "example 03 · code",
        "prompt": (
            "Write load_config(path, env=None): read a YAML config file, layer "
            "environment-variable overrides on top, and raise ConfigError if a "
            "required key is missing."
        ),
        "model": "Qwen2.5-Coder-7B",
        "codebook": book,
        "codebookNote": "one byte per round · 8 bits",
        "payload": {"label": "Covert bytes", "parts": ["0x42 'B'", "0x41 'A'", "0x4D 'M'"],
                    "bits": 24},
        "cover": {"label": "Cover · no payload", "lang": "python", "code": CODE_COVER},
        "stego": {"label": "BAM · 24-bit payload", "lang": "python",
                  "code": CODE_STEGO, "regions": regions},
        "rounds": rounds,
        "stats": [
            {"k": "payload", "v": "24 bits"},
            {"k": "carrier tokens", "v": str(cursor)},
            {"k": "rate", "v": f"{24 / cursor:.3f} bit/token"},
            {"k": "decode", "v": "3 / 3 exact"},
        ],
    }


# =========================================================================
BANNER = """/* GENERATED FILE -- do not edit by hand (it is minified on purpose).
 * Produced by scripts/make_demo_runs.py.
 *
 * Placeholder run: the belief traces come from the real BAM decoder maths
 * driven by a simulated token channel, not from a language-model run.
 * To swap in a real run, replace the object below with the `diag` payloads
 * backend/session.py already emits on `turn_done` -- the schema is identical.
 */
"""


def emit(demo: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{demo['id']}.js"
    body = json.dumps(demo, ensure_ascii=False, separators=(",", ":"))
    path.write_text(
        f'{BANNER}window.COVERT_DEMOS = window.COVERT_DEMOS || {{}};\n'
        f'window.COVERT_DEMOS["{demo["id"]}"] = {body};\n',
        encoding="utf-8",
    )
    kb = path.stat().st_size / 1024
    print(f"  {path.relative_to(ROOT)}  ({kb:.1f} KB, "
          f"{len(demo['rounds'])} rounds)")


def main() -> None:
    print("generating placeholder BAM runs:")
    for build in (build_conversation, build_image, build_code):
        emit(build())


if __name__ == "__main__":
    main()
