"""
Tests for ModelRegistry (T-044, 2026-08-24 continuous-improvement pass).

Bug: `register()`'s checkpoint-pruning step -- meant to "archive instead of
delete" old checkpoints once more than MAX_VERSIONS (3) accumulate -- did
`shutil.move(old_file, old_file + ".bak")` using only the *oldest tracked
entry's* filename, with no check for whether any other still-tracked
version (including the brand-new, just-registered active one) points at
that same filename.

Every real caller of `register()` in this codebase saves a given
model_name to a FIXED on-disk filename that never changes between
trainings (`transformer.pt` / `transformer_{asset}.pt` in
TransformerModel._ckpt_path(), `fusion_model.joblib` in
FusionModel._model_file()) -- retraining overwrites that file in place.
So on the 4th (and every subsequent) `register()` call for a given
model_name, the "old" entry being pruned shares the exact same filename
as the brand-new active entry that was just written to disk moments
earlier by the caller's own `model.train()` -- and the archive step
renamed that live, just-trained file out from under itself. Any process
restart afterward (which reloads models from their fixed path on init)
would then find the file missing and silently come back untrained.

Fixed to only archive when no other still-tracked version references the
same filename -- a safe no-op for this codebase's actual fixed-filename
models, while still correctly archiving a genuinely orphaned file if a
future model ever does write distinct per-version filenames.

Zero prior test coverage existed for this module before this pass.
"""
import json
import os

import pytest

from app.services.model_registry import ModelRegistry, MAX_VERSIONS


def _make_registry(tmp_path):
    return ModelRegistry(str(tmp_path))


class TestFreshRegistryDefaults:
    def test_fresh_registry_has_empty_models_and_history(self, tmp_path):
        reg = _make_registry(tmp_path)
        assert reg.get_all_versions("nope") == []
        assert reg.get_active("nope") is None
        assert reg.get_performance_trend() == {
            "avg_win_rate": None, "trend": "insufficient_data", "records": 0,
        }


class TestRegisterVersioning:
    def test_first_register_is_v1_0_0_and_active(self, tmp_path):
        reg = _make_registry(tmp_path)
        version = reg.register("fusion", str(tmp_path / "fusion.joblib"), {"acc": 0.5})
        assert version == "v1.0.0"
        active = reg.get_active("fusion")
        assert active["version"] == "v1.0.0"
        assert active["status"] == "active"

    def test_second_register_bumps_minor_and_retires_previous(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.register("fusion", str(tmp_path / "fusion.joblib"), {"acc": 0.5})
        v2 = reg.register("fusion", str(tmp_path / "fusion.joblib"), {"acc": 0.6})
        assert v2 == "v1.1.0"
        versions = reg.get_all_versions("fusion")
        assert versions[0]["status"] == "retired"
        assert versions[1]["status"] == "active"

    def test_metrics_and_notes_are_stored_on_the_entry(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.register("fusion", str(tmp_path / "fusion.joblib"),
                      {"acc": 0.77}, notes="hello")
        active = reg.get_active("fusion")
        assert active["metrics"] == {"acc": 0.77}
        assert active["notes"] == "hello"


class TestPruningDoesNotClobberTheLiveFileWhenFilenameIsFixed:
    """Direct regression guard for the T-044 fix."""

    def test_registering_beyond_max_versions_with_a_fixed_filename_leaves_the_live_file_untouched(self, tmp_path):
        # This mirrors every real caller in the codebase: the same on-disk
        # filename is reused (overwritten) on every training run.
        model_file = tmp_path / "transformer.pt"
        model_file.write_bytes(b"weights-v1")

        reg = _make_registry(tmp_path)
        for i in range(MAX_VERSIONS + 3):  # push well past the prune threshold
            model_file.write_bytes(f"weights-v{i}".encode())
            reg.register("transformer", str(model_file), {"val_accuracy": 0.5 + i * 0.01})

        # The live file must still exist at its expected fixed path --
        # this is the core regression the old bug broke.
        assert model_file.exists()
        assert not (tmp_path / "transformer.pt.bak").exists()

        # Registry itself still correctly prunes tracked entries to MAX_VERSIONS.
        versions = reg.get_all_versions("transformer")
        assert len(versions) == MAX_VERSIONS
        assert versions[-1]["status"] == "active"

    def test_active_model_remains_loadable_immediately_after_pruning(self, tmp_path):
        # Simulates a process restart's fixed-path load right after the
        # pruning threshold is crossed.
        model_file = tmp_path / "fusion_model.joblib"
        reg = _make_registry(tmp_path)
        for i in range(MAX_VERSIONS + 2):
            model_file.write_bytes(f"weights-{i}".encode())
            reg.register("fusion", str(model_file), {"acc": 0.5})

        assert model_file.exists()
        assert model_file.read_bytes() == f"weights-{MAX_VERSIONS + 1}".encode()

    def test_orphaned_file_with_a_distinct_filename_is_still_archived(self, tmp_path):
        # Safety-net case: if a future caller genuinely writes a distinct
        # per-version file each time, the file that's no longer referenced
        # by any tracked version should still be archived (not deleted).
        reg = _make_registry(tmp_path)
        files = []
        for i in range(MAX_VERSIONS + 1):
            f = tmp_path / f"model_v{i}.bin"
            f.write_bytes(b"data")
            files.append(f)
            reg.register("versioned_model", str(f), {"acc": 0.5})

        # The very first (now-pruned, uniquely-named) file should have been
        # archived to .bak, since no remaining tracked version references it.
        assert not files[0].exists()
        assert (tmp_path / f"{files[0].name}.bak").exists()
        # The files still referenced by tracked versions must remain untouched.
        for f in files[1:]:
            assert f.exists()


class TestGetActive:
    def test_returns_none_for_unknown_model(self, tmp_path):
        reg = _make_registry(tmp_path)
        assert reg.get_active("unknown") is None

    def test_returns_the_active_entry_among_several_versions(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.register("fusion", str(tmp_path / "f.joblib"), {})
        reg.register("fusion", str(tmp_path / "f.joblib"), {})
        v3 = reg.register("fusion", str(tmp_path / "f.joblib"), {})
        assert reg.get_active("fusion")["version"] == v3


class TestRollback:
    def test_rollback_with_no_previous_version_returns_none(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.register("fusion", str(tmp_path / "f.joblib"), {})
        assert reg.rollback("fusion") is None

    def test_rollback_with_unknown_model_returns_none(self, tmp_path):
        reg = _make_registry(tmp_path)
        assert reg.rollback("unknown") is None

    def test_rollback_switches_active_to_previous_version(self, tmp_path):
        reg = _make_registry(tmp_path)
        v1 = reg.register("fusion", str(tmp_path / "f.joblib"), {})
        v2 = reg.register("fusion", str(tmp_path / "f.joblib"), {})
        prev = reg.rollback("fusion")
        assert prev["version"] == v1
        assert reg.get_active("fusion")["version"] == v1

        versions = reg.get_all_versions("fusion")
        rolled_back_entry = next(v for v in versions if v["version"] == v2)
        assert rolled_back_entry["status"] == "rolled-back"


class TestPerformanceTracking:
    def test_record_performance_appends_a_rounded_entry(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.record_performance(win_rate=0.123456789, n_signals=10, notes="ok")
        trend = reg.get_performance_trend()
        assert trend["records"] == 1
        assert trend["history"][0]["win_rate"] == round(0.123456789, 4)
        assert trend["history"][0]["notes"] == "ok"
        assert trend["history"][0]["n_signals"] == 10

    def test_performance_history_capped_at_200_records(self, tmp_path):
        reg = _make_registry(tmp_path)
        for i in range(250):
            reg.record_performance(win_rate=0.5, n_signals=1)
        assert len(reg._data["performance_history"]) == 200

    def test_trend_is_improving_when_latest_exceeds_earliest(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.record_performance(win_rate=0.4, n_signals=10)
        reg.record_performance(win_rate=0.6, n_signals=10)
        assert reg.get_performance_trend()["trend"] == "improving"

    def test_trend_is_declining_when_latest_below_earliest(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.record_performance(win_rate=0.6, n_signals=10)
        reg.record_performance(win_rate=0.4, n_signals=10)
        assert reg.get_performance_trend()["trend"] == "declining"

    def test_trend_is_stable_when_latest_equals_earliest(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.record_performance(win_rate=0.5, n_signals=10)
        reg.record_performance(win_rate=0.5, n_signals=10)
        assert reg.get_performance_trend()["trend"] == "stable"


class TestSummary:
    def test_summary_shape_with_no_models(self, tmp_path):
        reg = _make_registry(tmp_path)
        summary = reg.summary()
        assert summary["models"] == {}
        assert summary["performance"]["trend"] == "insufficient_data"

    def test_summary_reports_active_version_and_total_versions(self, tmp_path):
        reg = _make_registry(tmp_path)
        reg.register("fusion", str(tmp_path / "f.joblib"), {"acc": 0.5})
        v2 = reg.register("fusion", str(tmp_path / "f.joblib"), {"acc": 0.6})
        summary = reg.summary()
        assert summary["models"]["fusion"]["active_version"] == v2
        assert summary["models"]["fusion"]["total_versions"] == 2
        assert summary["models"]["fusion"]["metrics"] == {"acc": 0.6}


class TestPersistence:
    def test_registry_state_survives_reload_from_disk(self, tmp_path):
        reg1 = _make_registry(tmp_path)
        reg1.register("fusion", str(tmp_path / "f.joblib"), {"acc": 0.5})
        reg1.record_performance(win_rate=0.5, n_signals=5)

        reg2 = _make_registry(tmp_path)  # fresh instance, same model_path
        assert reg2.get_active("fusion")["version"] == "v1.0.0"
        assert reg2.get_performance_trend()["records"] == 1

    def test_corrupt_registry_file_falls_back_to_a_fresh_registry(self, tmp_path):
        (tmp_path / "registry.json").write_text("{not valid json")
        reg = _make_registry(tmp_path)
        assert reg.get_all_versions("anything") == []
        assert reg._data["schema_version"] == 1
