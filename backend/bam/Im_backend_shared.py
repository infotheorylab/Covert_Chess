"""Weight-sharing, multi-model pool for HFLMBackend.

Loads model weights once into VRAM and hands out multiple HFLMBackend-compatible
objects that share the same nn.Module. For an 8B bf16 model this halves VRAM
from ~32 GB (two full instances) to ~16 GB.

Multi-model support: the pool can hold several named models so the demo can
switch the underlying LLM at runtime (e.g. Llama-3.1-8B vs phi-4). Because a
14B + 8B pair needs ~45 GB, by default the pool keeps only ONE model resident
and evicts the previous one on switch (safe on 24-48 GB GPUs). On a large GPU
(80 GB) set keep_resident=True to cache every loaded model and make switching
instant.

IMPORTANT: switching models changes the tokenizer and vocab size, so any
consumer that caches vocab-sized state (e.g. ArcMarkAdapter permutations) must
be rebuilt after a switch. DemoSession.set_model handles that.
"""
from __future__ import annotations

import gc
import os
from typing import Optional

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from bam.lm_backend import HFLMBackend, DEFAULT_TEMPERATURE   # bam package


class _LoadedModel:
    __slots__ = ("model_name", "tokenizer", "model")

    def __init__(self, model_name, tokenizer, model):
        self.model_name = model_name
        self.tokenizer = tokenizer
        self.model = model


class SharedModelPool:
    def __init__(
        self,
        model_name: str,
        device: Optional[str] = None,
        dtype: Optional[torch.dtype] = None,
        keep_resident: bool = False,
    ) -> None:
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.dtype  = dtype or (
            torch.bfloat16 if self.device.startswith("cuda") else torch.float32
        )
        # keep_resident=True caches every loaded model (needs a big GPU);
        # False evicts the previous model on each switch (safe default).
        self.keep_resident = keep_resident
        self._cache: dict[str, _LoadedModel] = {}
        self.active_name: str = model_name
        self._load(model_name)

    # ---- loading / switching -------------------------------------------
    def _load(self, model_name: str) -> _LoadedModel:
        if model_name in self._cache:
            self.active_name = model_name
            return self._cache[model_name]

        if not self.keep_resident and self._cache:
            # Evict everything before loading the new model to free VRAM.
            self._evict_all()

        print(f"[SharedModelPool] Loading {model_name} -> {self.device} ({self.dtype})")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        if tokenizer.pad_token_id is None:
            tokenizer.pad_token_id = tokenizer.eos_token_id
        model = (
            AutoModelForCausalLM
            .from_pretrained(model_name, torch_dtype=self.dtype)
            .to(self.device)
            .eval()
        )
        entry = _LoadedModel(model_name, tokenizer, model)
        self._cache[model_name] = entry
        self.active_name = model_name
        if self.device.startswith("cuda"):
            used  = torch.cuda.memory_allocated() / 1e9
            total = torch.cuda.get_device_properties(0).total_memory / 1e9
            print(f"[SharedModelPool] Ready. VRAM: {used:.1f}/{total:.1f} GB")
        else:
            print("[SharedModelPool] Ready (CPU).")
        return entry

    def _evict_all(self) -> None:
        for name, entry in list(self._cache.items()):
            entry.model = None
            del self._cache[name]
        gc.collect()
        if self.device.startswith("cuda"):
            torch.cuda.empty_cache()

    def switch_model(self, model_name: str) -> None:
        """Make model_name the active model, loading/evicting as needed."""
        self._load(model_name)

    def is_loaded(self, model_name: str) -> bool:
        return model_name in self._cache

    # ---- backends -------------------------------------------------------
    def make_backend(self, model_name: Optional[str] = None) -> HFLMBackend:
        """Return a backend sharing the weights of the named (or active) model."""
        name = model_name or self.active_name
        entry = self._cache.get(name) or self._load(name)
        backend = object.__new__(HFLMBackend)
        backend.model_name = entry.model_name
        backend.device     = self.device
        backend.dtype      = self.dtype
        backend.tokenizer  = entry.tokenizer
        backend.model      = entry.model
        # Sampling temperature: LM_TEMPERATURE env var, else the repo default.
        backend.temperature = float(os.environ.get("LM_TEMPERATURE", DEFAULT_TEMPERATURE))
        return backend

    # ---- diagnostics ----------------------------------------------------
    def vram_gb(self) -> float:
        if not self.device.startswith("cuda"):
            return 0.0
        return torch.cuda.memory_allocated() / 1e9
