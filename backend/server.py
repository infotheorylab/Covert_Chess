"""FastAPI WebSocket server — BAM chess demo.

Run (from backend/ directory):
    uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1

workers MUST be 1: the shared model lives in a single process.
"""
from __future__ import annotations
import asyncio
import os
from typing import Callable
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from lm_backend_shared import SharedModelPool
from bam.bam_tracker    import BAMConfig           # ← bam package
from bam.arcmark_adapter import ArcMarkConfig
from session             import DemoSession

MODEL_NAME     = os.getenv("MODEL_NAME",     "meta-llama/Llama-3.1-8B-Instruct")
STOCKFISH_PATH = os.getenv("STOCKFISH_PATH", "/usr/games/stockfish")
SKILL_LEVEL    = int(os.getenv("SKILL_LEVEL",  "5"))
MAX_SESSIONS   = int(os.getenv("MAX_SESSIONS", "20"))  # raised for group pod

# Models the UI may switch between. Keys are HF ids; values are short labels
# the frontend shows. Model selection is GLOBAL (one shared GPU, one resident
# model): switching rebuilds every active session onto the new model.
ALLOWED_MODELS = {
    "meta-llama/Llama-3.1-8B-Instruct": "llama8b",
    "microsoft/phi-4":                  "phi4-14b",
}
active_model: str = MODEL_NAME

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="BAM Chess Demo")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

pool: SharedModelPool | None = None
sessions: dict[str, DemoSession] = {}
gen_lock: asyncio.Semaphore | None = None   # one GPU generation at a time

# Ordered list of session_ids whose turns are waiting or in progress. The GPU
# processes one turn at a time (gen_lock), so index 0 is generating and everyone
# else is queued behind it. Used only to tell waiting users their position;
# it does not itself serialise anything (gen_lock does that).
turn_queue: list[str] = []
_send_by_session: dict[str, Callable] = {}


async def _broadcast_queue_positions() -> None:
    """Tell each waiting session how many turns are ahead of it."""
    for pos, sid in enumerate(turn_queue):
        send = _send_by_session.get(sid)
        if send is None:
            continue
        try:
            if pos == 0:
                # Front of the line — actively generating; clear any queue notice.
                await send({"type": "queue", "position": 0, "ahead": 0})
            else:
                await send({"type": "queue", "position": pos, "ahead": pos})
        except Exception:
            pass


@app.on_event("startup")
async def startup() -> None:
    global pool, gen_lock
    hf_token = os.getenv("HF_TOKEN")
    if hf_token:
        from huggingface_hub import login
        login(token=hf_token)
    pool = SharedModelPool(MODEL_NAME)
    gen_lock = asyncio.Semaphore(1)   # created inside the event loop
    print("[server] Ready.")


@app.get("/")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/health")
async def health():
    return {"status": "ok", "sessions": len(sessions),
            "vram_gb": pool.vram_gb() if pool else 0}


@app.websocket("/ws/{session_id}")
async def ws_endpoint(websocket: WebSocket, session_id: str) -> None:
    global active_model
    await websocket.accept()

    if session_id not in sessions:
        if len(sessions) >= MAX_SESSIONS:
            await websocket.send_json(
                {"type": "error", "msg": "Server at capacity — try again later."}
            )
            await websocket.close()
            return
        sessions[session_id] = DemoSession(
            lm1=pool.make_backend(active_model),
            lm2=pool.make_backend(active_model),
            stockfish_path=STOCKFISH_PATH,
            gen_lock=gen_lock,
            # Values match the reference implementation (compare.py):
            #   EPS_NOISE=EPS_CONF=0.4, GAMMA=0.5, RHO_NACK=0.75,
            #   rho_ACK auto-derives to 1-1/M (rho_ack=None), P_FIELD=4,
            #   R_RESOLUTION=4, PHI=0.
            bam_cfg=BAMConfig(
                eps_noise_comm=0.4,
                eps_noise_conf=0.4,
                gamma_1=0.5,
                rho_ack=0.99,      # auto = 1 - 1/M per message (reference ra=1-1/L)
                rho_nack=0.75,
                p_field=4,
            ),
            adapter_cfg=ArcMarkConfig(
                p_field=4, r_resolution=4,
                shared_seed=0xA12C, top_k=50,
                sinkhorn_max_iter=4000,
                sinkhorn_stop_thr=1e-4,
                sinkhorn_reg=0.2,
                sinkhorn_method="sinkhorn_log",
            ),
        )

    session = sessions[session_id]
    await websocket.send_json({
        "type": "ready", "session_id": session_id,
        "fen": session.chess.fen(), "turn": session.turn_count,
        "active_model": active_model,
        "models": [{"id": mid, "label": lbl} for mid, lbl in ALLOWED_MODELS.items()],
    })

    async def send(msg: dict) -> None:
        await websocket.send_json(msg)

    # Register this session's sender so the queue broadcaster can reach it.
    _send_by_session[session_id] = send

    try:
        while True:
            data = await websocket.receive_json()
            t    = data.get("type")
            if t == "user_turn":
                # Join the queue and tell everyone their position. If someone is
                # already generating, this user is told how many are ahead.
                turn_queue.append(session_id)
                await _broadcast_queue_positions()
                try:
                    await session.handle_user_turn(
                        chat=str(data.get("chat", "")),
                        move_uci=str(data.get("move", "")),
                        send=send,
                    )
                finally:
                    # Leave the queue whether the turn succeeded or errored, and
                    # refresh everyone still waiting so positions advance.
                    try:
                        turn_queue.remove(session_id)
                    except ValueError:
                        pass
                    await _broadcast_queue_positions()
            elif t == "reset":
                session.reset()
                await send({"type": "reset_ok", "fen": "start", "turn": 0})
            elif t == "set_prompts":
                session.set_prompts(
                    prompt_a=data.get("prompt_a", ""),
                    prompt_b=data.get("prompt_b", ""),
                )
                await send({"type": "prompts_ok",
                            "prompt_a": session.prompt_a,
                            "prompt_b": session.prompt_b})
            elif t == "set_difficulty":
                level = int(data.get("level", 10))
                session.chess.set_skill_level(level)
                await send({"type": "difficulty_ok", "level": level})
            elif t == "set_model":
                requested = str(data.get("model", ""))
                if requested not in ALLOWED_MODELS:
                    await send({"type": "error",
                                "msg": f"Unknown model: {requested}"})
                elif requested == active_model:
                    await send({"type": "model_ok", "model": active_model,
                                "label": ALLOWED_MODELS[active_model]})
                else:
                    # Global switch. Serialize on the GPU lock so no generation is
                    # mid-flight, then rebuild EVERY active session onto the new
                    # model (the pool evicts the old weights, so stale backends
                    # would otherwise crash on their next turn).
                    await send({"type": "status",
                                "msg": f"Loading {ALLOWED_MODELS[requested]} — this can take a moment…"})
                    async with gen_lock:
                        loop = asyncio.get_event_loop()
                        await loop.run_in_executor(None, pool.switch_model, requested)
                        for sess in list(sessions.values()):
                            sess.set_model(pool, requested)
                        active_model = requested
                    # Notify everyone the model changed.
                    for sid, snd in list(_send_by_session.items()):
                        try:
                            await snd({"type": "model_ok", "model": active_model,
                                       "label": ALLOWED_MODELS[active_model]})
                        except Exception:
                            pass
            elif t == "get_prompts":
                await send({"type": "prompts_loaded",
                            "prompt_a": session.prompt_a,
                            "prompt_b": session.prompt_b})
            elif t == "ping":
                await send({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "msg": str(exc)})
        except Exception:
            pass
    finally:
        # Free the slot — without this, sessions accumulate until MAX_SESSIONS
        # is hit and every new visitor gets "server at capacity".
        sessions.pop(session_id, None)
        _send_by_session.pop(session_id, None)
        # If the user disconnected mid-turn, drop them from the queue and let
        # the rest advance.
        removed = False
        while session_id in turn_queue:
            turn_queue.remove(session_id)
            removed = True
        if removed:
            await _broadcast_queue_positions()