# T-093 (2026-09-01, production incident): ai-service went completely
# unresponsive in production for 12+ minutes -- Railway kept reporting the
# deployment RUNNING, but every request (including a bare /health) timed
# out with no response, and the last log line before it went silent was
# `libgomp: Thread creation failed: Resource temporarily unavailable`
# (an OS-level thread-exhaustion crash, distinct from the asyncio-level
# CPU-oversubscription issue T-086 already fixed via news_analyzer.py's
# FinBERT semaphore).
#
# Root cause: nothing anywhere in this codebase ever set OMP_NUM_THREADS /
# MKL_NUM_THREADS / OPENBLAS_NUM_THREADS / torch.set_num_threads()
# (confirmed by grep -- zero matches across the whole app/ tree before this
# fix). Every native PyTorch/OpenMP call therefore defaults to spawning as
# many OpenMP worker threads as the runtime auto-detects available -- and
# with no process-wide cap, that cost multiplies by every CONCURRENT
# Python-level call into PyTorch: news_analyzer.py's FinBERT scoring
# (already bounded to 3 concurrent calls by T-086's semaphore, but each of
# those 3 can independently spawn its own uncapped OpenMP thread team) PLUS
# translation_service.py's NLLB-200 .generate() calls, dispatched once per
# non-English Telegram channel via asyncio.gather with NO limiter at all
# until this same fix (see translation_service.py) -- up to 3 more
# concurrent, uncapped native calls. A live Global Scan can have both
# subsystems in flight at once. Confirmed live via `railway metrics`: this
# service's actual Railway allocation is 8.0 vCPU / 8192MB -- a handful of
# concurrent inference calls each spawning an uncapped OpenMP thread team
# (which, in a container, can auto-detect a higher thread count than the
# cgroup CPU quota actually allows the process to use) is enough to exceed
# the container's OS thread limit.
#
# Fix: pin every native math library to a small, explicit thread count,
# set as environment variables here -- the first lines of the actual
# process entrypoint (`python run.py`, matches railway.json's startCommand
# and the Dockerfile's CMD exactly) -- so they're in place before torch,
# numpy, or transformers are imported anywhere in the app.* import chain
# that follows. OpenMP/MKL/OpenBLAS read these once, at first native call;
# setting them after import would be too late.
#
# THREADS_PER_CALL=2 chosen against the confirmed 8.0 vCPU limit: worst
# realistic concurrent burst is 3 FinBERT calls (existing semaphore) + 2
# translation calls (new semaphore added this same fix, see
# translation_service.py) = 5 concurrent native calls x 2 threads each =
# 10 native compute threads at peak, ~1.25x oversubscription of 8 cores --
# comfortably tolerable (some oversubscription is normal and even
# beneficial, since not all 5 calls are simultaneously CPU-bound for their
# entire duration), a world away from the uncapped, unbounded-multiplier
# behavior that caused the actual incident.
import os

_THREADS_PER_CALL = "2"
for _env_var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_env_var, _THREADS_PER_CALL)

try:
    # Import torch here, first, so it's the one that actually initializes
    # OpenMP -- with the env vars above already set. Also an explicit,
    # defense-in-depth second layer: these calls configure PyTorch's own
    # thread-pool bookkeeping directly, independent of whether the
    # environment variables above are honored by this exact torch/OpenMP
    # build. Wrapped defensively -- a torch import failure here must never
    # block the app from starting (mirrors this codebase's established
    # load-lazily-and-degrade pattern for every other ML dependency), and
    # set_num_interop_threads() raises if the interop pool was already used
    # by anything, which should never happen this early but isn't worth a
    # hard crash either way.
    import torch
    torch.set_num_threads(int(_THREADS_PER_CALL))
    torch.set_num_interop_threads(1)
except Exception:
    pass

import uvicorn
from app.config import get_settings

settings = get_settings()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", settings.ai_service_port))
    uvicorn.run(
        "app.main:app",
        host=settings.ai_service_host,
        port=port,
        reload=(settings.environment == "development"),
        log_level=settings.log_level.lower(),
        workers=1,
    )
