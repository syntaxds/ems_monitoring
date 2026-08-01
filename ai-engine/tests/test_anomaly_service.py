import pytest
from datetime import datetime, timedelta, timezone

from services import anomaly_service as svc


@pytest.fixture(autouse=True)
def reset_state():
    svc.fuel_history.clear()
    svc.metrics["total_predictions"] = 0
    svc.metrics["total_anomalies"] = 0
    yield
    svc.fuel_history.clear()


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def stub_ml(prediction=1, score=0.9):
    def _predict(fuel, voltage):
        return {"prediction": prediction, "score": score, "model_version": "test"}
    return _predict


BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_tiny_drop_short_interval_no_anomaly(monkeypatch):
    monkeypatch.setattr(svc, "predict_telemetry", stub_ml())

    svc.analyze_fuel("D1", 200.0, engine_status="running", timestamp=iso(BASE))
    result = svc.analyze_fuel(
        "D1", 199.0, engine_status="running", timestamp=iso(BASE + timedelta(seconds=15))
    )

    assert result["anomaly"] is False


def test_high_burn_rate_while_running_is_high(monkeypatch):
    monkeypatch.setattr(svc, "predict_telemetry", stub_ml())

    svc.analyze_fuel("D2", 200.0, engine_status="running", timestamp=iso(BASE))
    # 10 L drop over 10 min = 60 L/h, above the 25 L/h ceiling
    result = svc.analyze_fuel(
        "D2", 190.0, engine_status="running", timestamp=iso(BASE + timedelta(minutes=10))
    )

    assert result["anomaly"] is True
    assert result["risk_level"] == "HIGH"


def test_moderate_burn_rate_is_medium(monkeypatch):
    monkeypatch.setattr(svc, "predict_telemetry", stub_ml())  # prediction=1, no ML corroboration

    svc.analyze_fuel("D3", 200.0, engine_status="running", timestamp=iso(BASE))
    # ~22 L/h over 10 min => drop = 22 * (10/60) ~= 3.67 L
    result = svc.analyze_fuel(
        "D3", 196.33, engine_status="running", timestamp=iso(BASE + timedelta(minutes=10))
    )

    assert result["anomaly"] is True
    assert result["risk_level"] == "MEDIUM"


def test_engine_off_drop_still_high(monkeypatch):
    monkeypatch.setattr(svc, "predict_telemetry", stub_ml())

    svc.analyze_fuel("D4", 200.0, engine_status="off", timestamp=iso(BASE))
    result = svc.analyze_fuel(
        "D4", 190.0, engine_status="off", timestamp=iso(BASE + timedelta(seconds=30))
    )

    assert result["anomaly"] is True
    assert result["risk_level"] == "HIGH"
    assert result["anomaly_type"] == "engine_off_fuel_drop"


def test_missing_timestamp_falls_back_to_absolute_threshold(monkeypatch):
    monkeypatch.setattr(svc, "predict_telemetry", stub_ml())

    svc.analyze_fuel("D5", 200.0, engine_status="running")
    result = svc.analyze_fuel("D5", 180.0, engine_status="running")  # 20 L drop, no timestamp

    assert result["anomaly"] is True
    assert result["risk_level"] == "MEDIUM"
    assert "insufficient timing data" in result["reason"].lower()


def test_single_ml_outlier_normal_rate_is_low_not_medium(monkeypatch):
    monkeypatch.setattr(svc, "predict_telemetry", stub_ml(prediction=-1, score=0.1))

    result = svc.analyze_fuel(
        "D6", 200.0, engine_status="running", timestamp=iso(BASE)
    )

    assert result["anomaly"] is False
    assert result["risk_level"] == "LOW"


def test_idle_engine_status_accepted_without_error(monkeypatch):
    monkeypatch.setattr(svc, "predict_telemetry", stub_ml())

    result = svc.analyze_fuel("D7", 200.0, engine_status="idle", timestamp=iso(BASE))

    assert result["device_id"] == "D7"
