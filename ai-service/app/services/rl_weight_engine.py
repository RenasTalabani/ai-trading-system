"""
RLWeightEngine — self-learning signal weight adjustment.
Reward winning signal combinations, punish losing ones.
Weights stored in saved_models/signal_weights.json (survives restarts).
"""
import json
import logging
import os
import threading
from typing import Optional

logger = logging.getLogger("ai-service.rl_weight_engine")

_WEIGHTS_FILE = os.path.join(
    os.environ.get("MODEL_PATH", "./saved_models"),
    "signal_weights.json",
)

DEFAULT_WEIGHTS = {
    "technical": 0.45,
    "news":      0.20,
    "social":    0.10,
    "macro":     0.25,
}

LEARNING_RATE   = 0.02    # how much to shift on each update

# T-041 (2026-08-22): MIN_WEIGHT/MAX_WEIGHT below are applied to each
# weight's *pre-normalisation* raw value inside record_outcome(), before
# _normalise() rescales the whole dict to sum to 1.0. That rescale step
# was not itself bounded, so the *effective* weight actually returned by
# get_weights() (and used directly in every live rl_score fusion formula)
# could end up outside [MIN_WEIGHT, MAX_WEIGHT] despite the names "floor"
# and "ceiling" implying an absolute bound on that effective weight.
# Confirmed by simulation at the time: sustained, realistic feedback
# (the same signal source consistently winning, the others consistently
# losing) converged "technical" to an effective weight of ~0.7277 --
# above the documented 0.70 ceiling. Left undecided at the time since a
# real fix needs an algorithm choice (enforcing sum=1.0 AND a per-key box
# constraint simultaneously isn't a single unambiguous one-line change).
#
# T-069 (2026-08-29, owner-authorized fix): the owner reviewed this gap
# together with its real, live-observed consequence -- the "macro"
# component drifting to ~72% of the fused score, which independently
# combined with a separate vocabulary bug (T-068) to make it
# mathematically impossible for any asset to pass MIN_FUSED_SCORE
# regardless of real market conditions -- and authorized bounding the
# *effective* (post-normalisation) weight directly, using an iterative
# clamp-and-redistribute pass (see _clamp_to_effective_bounds()) so the
# RL engine can still adapt within a meaningful range but can never again
# let one component structurally dominate the fusion. The original
# pre-normalisation MIN_WEIGHT/MAX_WEIGHT below are UNCHANGED and still
# serve their original purpose (rate-limiting how far a single update can
# move a raw weight) -- MIN_EFFECTIVE_WEIGHT/MAX_EFFECTIVE_WEIGHT are a
# second, independent bound on the final value actually used.
MIN_WEIGHT      = 0.05    # floor on each weight's raw pre-normalisation value
MAX_WEIGHT      = 0.70    # ceiling on each weight's raw pre-normalisation value
MIN_UPDATES_LOG = 5       # only log drift after N updates

# T-069: bounds on the final, effective (post-normalisation) weight --
# what get_weights() actually returns and every live fusion formula
# actually uses. 10%/45% chosen so the RL engine keeps a meaningful
# adaptive range (a 4.5x spread between the weakest and strongest
# possible component) while guaranteeing no single signal can ever
# structurally decide every outcome on its own. Feasible for this
# engine's 4 weights (4*0.10=0.40 <= 1.0 <= 4*0.45=1.80); would need
# reassessing if the number of weighted components ever changes.
MIN_EFFECTIVE_WEIGHT = 0.10
MAX_EFFECTIVE_WEIGHT = 0.45


def _clamp_to_effective_bounds(weights: dict, min_w: float = MIN_EFFECTIVE_WEIGHT,
                                max_w: float = MAX_EFFECTIVE_WEIGHT) -> dict:
    """Clamp every value in `weights` (assumed to already sum to ~1.0)
    into [min_w, max_w] while keeping the total at exactly 1.0 -- standard
    iterative water-filling / simplex projection with box constraints.

    Redistributes the total proportionally among the still-"free"
    weights, then pins the SINGLE worst remaining bound violation (not
    every violator at once) and repeats. Pinning matters one at a time:
    if several weights are simultaneously out of bounds, clamping all of
    them to their exact respective bound in one shot can overshoot the
    total (e.g. two weights over the ceiling and two under the floor can
    sum to more than 1.0 once each is pinned to its own bound -- there is
    no guarantee the bounds alone are individually consistent with
    sum=1.0, only that *some* feasible assignment exists when
    n*min_w <= 1.0 <= n*max_w). Pinning the worst violator, then
    re-deriving the rest from the shrunk remaining budget, converges to a
    feasible point in at most len(weights) iterations (each iteration
    permanently pins one more weight, or none remain violating and the
    loop is done).
    """
    w = dict(weights)
    fixed: dict = {}
    free = list(w.keys())

    for _ in range(len(w) + 1):
        if not free:
            break

        remaining  = 1.0 - sum(fixed.values())
        free_total = sum(w[k] for k in free)
        if free_total <= 0:
            share = remaining / len(free)
            for k in free:
                w[k] = share
        else:
            scale = remaining / free_total
            for k in free:
                w[k] = w[k] * scale

        violators = [k for k in free if w[k] > max_w + 1e-9 or w[k] < min_w - 1e-9]
        if not violators:
            break

        worst = max(violators, key=lambda k: max(w[k] - max_w, min_w - w[k]))
        w[worst] = max_w if w[worst] > max_w else min_w
        fixed[worst] = w[worst]
        free.remove(worst)

    return {k: round(v, 6) for k, v in w.items()}


class RLWeightEngine:

    def __init__(self):
        self._lock    = threading.Lock()
        self._weights = self._load()
        self._updates = 0

    # ── Public API ────────────────────────────────────────────────────────────

    def get_weights(self) -> dict:
        with self._lock:
            return dict(self._weights)

    def record_outcome(
        self,
        result: str,                     # "WIN" or "LOSS"
        signal_contributions: dict,      # e.g. {"technical": 0.6, "news": 0.3, ...}
    ) -> dict:
        """
        Update weights based on trade outcome.
        signal_contributions = normalised fraction each source contributed to decision.
        Returns new weights.
        """
        if result not in ("WIN", "LOSS"):
            return self.get_weights()

        direction = 1 if result == "WIN" else -1

        with self._lock:
            for key in DEFAULT_WEIGHTS:
                contrib = signal_contributions.get(key, 0.25)
                delta   = direction * LEARNING_RATE * contrib
                self._weights[key] = max(
                    MIN_WEIGHT,
                    min(MAX_WEIGHT, self._weights[key] + delta),
                )

            self._weights = self._normalise(self._weights)
            self._updates += 1

            if self._updates % 10 == 0:
                logger.info(
                    f"[RL] weights after {self._updates} updates: "
                    + ", ".join(f"{k}={v:.3f}" for k, v in self._weights.items())
                )

            self._save()
            return dict(self._weights)

    def reset(self) -> dict:
        with self._lock:
            self._weights = dict(DEFAULT_WEIGHTS)
            self._updates = 0
            self._save()
            return dict(self._weights)

    def stats(self) -> dict:
        with self._lock:
            return {
                "weights":       dict(self._weights),
                "total_updates": self._updates,
                "weights_file":  _WEIGHTS_FILE,
            }

    # ── Internals ─────────────────────────────────────────────────────────────

    def _load(self) -> dict:
        try:
            if os.path.exists(_WEIGHTS_FILE):
                with open(_WEIGHTS_FILE) as f:
                    data = json.load(f)
                weights = {k: float(data.get(k, DEFAULT_WEIGHTS[k])) for k in DEFAULT_WEIGHTS}
                logger.info(f"[RL] Loaded weights: {weights}")
                return self._normalise(weights)
        except Exception as e:
            logger.warning(f"[RL] Could not load weights, using defaults: {e}")
        return dict(DEFAULT_WEIGHTS)

    def _save(self) -> None:
        try:
            os.makedirs(os.path.dirname(_WEIGHTS_FILE), exist_ok=True)
            with open(_WEIGHTS_FILE, "w") as f:
                json.dump(self._weights, f, indent=2)
        except Exception as e:
            logger.warning(f"[RL] Could not save weights: {e}")

    @staticmethod
    def _normalise(w: dict) -> dict:
        total = sum(w.values())
        if total <= 0:
            return dict(DEFAULT_WEIGHTS)
        naive = {k: v / total for k, v in w.items()}
        # T-069: the naive rescale above is what used to be returned
        # directly -- it can (and, per T-041's simulation, eventually
        # does) push an individual weight outside [MIN_EFFECTIVE_WEIGHT,
        # MAX_EFFECTIVE_WEIGHT] even though every value going in already
        # respected [MIN_WEIGHT, MAX_WEIGHT]. Clamp-and-redistribute the
        # naive result so the *returned* weights always stay in bounds.
        bounded = _clamp_to_effective_bounds(naive)
        if any(abs(bounded[k] - round(naive[k], 4)) > 1e-4 for k in bounded):
            logger.info(
                f"[RL] T-069 effective-weight bounds "
                f"([{MIN_EFFECTIVE_WEIGHT:.0%}, {MAX_EFFECTIVE_WEIGHT:.0%}]) adjusted "
                f"the naively-renormalised weights: "
                f"{ {k: round(v, 4) for k, v in naive.items()} } -> {bounded}"
            )
        return bounded
