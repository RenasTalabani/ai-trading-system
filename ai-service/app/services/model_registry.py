"""
Model Registry — versioning, performance history, and auto-rollback.

Persists to {model_path}/registry.json
Keeps last 3 checkpoints per model type.
"""
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("ai-service.model_registry")

REGISTRY_FILE = "registry.json"
MAX_VERSIONS  = 3


class ModelRegistry:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self._path      = os.path.join(model_path, REGISTRY_FILE)
        self._data      = self._load()

    def _load(self) -> dict:
        if os.path.exists(self._path):
            try:
                with open(self._path) as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "schema_version": 1,
            "models":         {},
            "performance_history": [],
        }

    def _save(self):
        os.makedirs(self.model_path, exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(self._data, f, indent=2)

    # ── Version management ────────────────────────────────────────────────────

    def register(self, model_name: str, file_path: str, metrics: dict,
                 notes: str = "") -> str:
        """
        Register a new model version.
        Bumps minor version automatically.
        Prunes old checkpoints beyond MAX_VERSIONS.
        Returns the new version string.
        """
        versions  = self._data["models"].setdefault(model_name, [])

        # Determine next version
        if versions:
            last = versions[-1]["version"]
            major, minor, patch = (int(x) for x in last.lstrip("v").split("."))
            minor += 1
            version = f"v{major}.{minor}.0"
        else:
            version = "v1.0.0"

        entry = {
            "version":    version,
            "file":       os.path.basename(file_path),
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "metrics":    metrics,
            "notes":      notes,
            "status":     "active",
        }

        # Mark previous as retired
        for v in versions:
            if v["status"] == "active":
                v["status"] = "retired"

        versions.append(entry)

        # Prune old checkpoints (keep last MAX_VERSIONS)
        if len(versions) > MAX_VERSIONS:
            old = versions.pop(0)
            old_file = os.path.join(self.model_path, old["file"])
            if os.path.exists(old_file):
                try:
                    # Archive instead of delete
                    arch = old_file + ".bak"
                    shutil.move(old_file, arch)
                    logger.info(f"Registry: archived old checkpoint {old['file']}")
                except Exception:
                    pass

        self._save()
        logger.info(f"Registry: registered {model_name} {version} | metrics={metrics}")
        return version

    def get_active(self, model_name: str) -> Optional[dict]:
        versions = self._data["models"].get(model_name, [])
        for v in reversed(versions):
            if v["status"] == "active":
                return v
        return None

    def rollback(self, model_name: str) -> Optional[dict]:
        """Switch to the previous version."""
        versions = self._data["models"].get(model_name, [])
        active_idx = None
        for i, v in enumerate(versions):
            if v["status"] == "active":
                active_idx = i
                break

        if active_idx is None or active_idx == 0:
            return None  # nothing to roll back to

        versions[active_idx]["status"] = "rolled-back"
        prev = versions[active_idx - 1]
        prev["status"] = "active"
        self._save()

        logger.warning(f"Registry: rolled back {model_name} → {prev['version']}")
        return prev

    def get_all_versions(self, model_name: str) -> list:
        return self._data["models"].get(model_name, [])

    # ── Performance tracking ──────────────────────────────────────────────────

    def record_performance(self, win_rate: float, n_signals: int, notes: str = ""):
        self._data["performance_history"].append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "win_rate":  round(win_rate, 4),
            "n_signals": n_signals,
            "notes":     notes,
        })
        # Keep last 200 records
        self._data["performance_history"] = self._data["performance_history"][-200:]
        self._save()

    def get_performance_trend(self, last_n: int = 20) -> dict:
        hist = self._data["performance_history"][-last_n:]
        if not hist:
            return {"avg_win_rate": None, "trend": "insufficient_data", "records": 0}
        rates   = [h["win_rate"] for h in hist]
        avg     = round(sum(rates) / len(rates), 4)
        trend   = "improving" if rates[-1] > rates[0] else "declining" if rates[-1] < rates[0] else "stable"
        return {"avg_win_rate": avg, "trend": trend, "records": len(hist), "history": hist}

    def summary(self) -> dict:
        out = {}
        for name, versions in self._data["models"].items():
            active = next((v for v in reversed(versions) if v["status"] == "active"), None)
            out[name] = {
                "active_version": active["version"] if active else None,
                "total_versions": len(versions),
                "metrics":        active["metrics"] if active else {},
            }
        return {
            "models":      out,
            "performance": self.get_performance_trend(),
        }
