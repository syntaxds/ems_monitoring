import os
import logging
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from model.isolation_forest import predict_telemetry


MAX_FUEL_LEVEL             = 249.75
LOW_FUEL_THRESHOLD         = 10.0
LOW_VOLTAGE_THRESHOLD      = 12.0
ENGINE_OFF_DROP_THRESHOLD  = 5.0
FUEL_DROP_THRESHOLD        = 15.0
MAX_HISTORY                = 30    
MAX_BURN_RATE_LPH          = 25.0  # PC135-class practical ceiling while running -> HIGH
WARN_BURN_RATE_LPH         = 20.0  # heavy-duty ceiling -> MEDIUM (HIGH if ML corroborates)
MIN_RATE_WINDOW_SECONDS    = 300.0 # below this, a computed L/h rate is dominated by sensor
                                    # noise; fall back to the coarse absolute-drop check

fuel_history = {}
metrics = {
    "total_predictions": 0,
    "total_anomalies": 0
}

log_dir = os.path.join(
    os.path.dirname(__file__),
    "..",
    "logs"
)

os.makedirs(log_dir, exist_ok=True)

log_path = os.path.join(
    log_dir,
    "anomaly.log"
)


logger = logging.getLogger("anomaly_logger")

if not logger.handlers:

    logger.setLevel(logging.INFO)

    handler = RotatingFileHandler(
        log_path,
        maxBytes=1024 * 1024,
        backupCount=3
    )

    formatter = logging.Formatter(
        "%(asctime)s | %(message)s"
    )

    handler.setFormatter(formatter)

    logger.addHandler(handler)


def write_anomaly_log(
    device_id,
    anomaly_type,
    reason
):

    logger.info(
        f"{device_id} | "
        f"{anomaly_type} | "
        f"{reason}"
    )


def parse_timestamp(ts):
    """Parse a client-supplied ISO 8601 timestamp into a UTC-aware datetime.
    Returns None on missing/non-string/malformed input so callers can degrade
    gracefully instead of crashing. Handles the trailing 'Z' emitted by
    JS Date.toISOString() (e.g. "2026-05-23T13:17:20.176Z"), which
    datetime.fromisoformat() does not accept on Python < 3.11.
    """

    if not ts or not isinstance(ts, str):
        return None

    try:
        normalized = ts[:-1] + "+00:00" if ts.endswith("Z") else ts
        dt = datetime.fromisoformat(normalized)

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        return dt

    except (ValueError, TypeError):
        return None


def analyze_fuel(
    device_id,
    fuel,
    voltage=12.4,
    engine_status="on",
    timestamp=None
):

    now = parse_timestamp(timestamp) or datetime.now(timezone.utc)

    if device_id not in fuel_history:
        fuel_history[device_id] = []

    fuel_history[device_id].append({"fuel": fuel, "timestamp": now})

    if len(fuel_history[device_id]) > MAX_HISTORY:
        fuel_history[device_id].pop(0)

    history = fuel_history[device_id]

    metrics["total_predictions"] += 1

    ml_result = predict_telemetry(
        fuel,
        voltage
    )

    prediction = ml_result.get("prediction", 1)
    score = ml_result.get("score", 0.5)
    model_version = ml_result.get("model_version", "unknown")

    confidence = round(
        abs(0.5 - score) * 2,
        3
    )

    is_anomaly = False
    reason = "Normal telemetry behavior"
    risk = "LOW"
    severity_code = 1
    anomaly_type = "normal"

    # RULE-BASED HIGH PRIORITY CHECKS

    if fuel < 0 or fuel > MAX_FUEL_LEVEL:

        is_anomaly = True
        reason = "Invalid fuel level (sensor error)"
        risk = "HIGH"
        severity_code = 3
        anomaly_type = "invalid_sensor"

    elif fuel < LOW_FUEL_THRESHOLD:

        is_anomaly = False
        reason = "Low fuel level"
        risk = "LOW"
        severity_code = 1
        anomaly_type = "normal"

    elif voltage < LOW_VOLTAGE_THRESHOLD:

        is_anomaly = True
        reason = "Low voltage detected"
        risk = "MEDIUM"
        severity_code = 2
        anomaly_type = "low_voltage"

    elif engine_status.lower() == "off" and len(history) >= 2:

        previous_fuel = history[-2]["fuel"]

        if previous_fuel - fuel > ENGINE_OFF_DROP_THRESHOLD:

            is_anomaly = True
            reason = "Fuel drop detected while engine is OFF"
            risk = "HIGH"
            severity_code = 3
            anomaly_type = "engine_off_fuel_drop"

    # BURN-RATE ANALYSIS
    #
    # Physically-grounded L/hour check calibrated to a Komatsu PC135-class
    # excavator (idle ~3-5, light duty ~8-12, heavy duty ~15-20, practical
    # ceiling ~25 L/h while running), replacing the old absolute-liters-drop
    # + naive ML corroboration. Anchored to the OLDEST sample still held in
    # this device's rolling window (not just the previous reading) so a
    # single sensor-noise blip doesn't compute to an absurd rate at a ~15s
    # publish cadence, and gated on MIN_RATE_WINDOW_SECONDS of elapsed time
    # before a rate is trusted at all.
    if not is_anomaly and engine_status.lower() != "off" and len(history) >= 2:

        baseline = history[0]
        elapsed_seconds = (now - baseline["timestamp"]).total_seconds()

        if elapsed_seconds >= MIN_RATE_WINDOW_SECONDS:

            drop = baseline["fuel"] - fuel
            rate_lph = (drop / elapsed_seconds) * 3600.0 if drop > 0 else 0.0

            if rate_lph > MAX_BURN_RATE_LPH:

                is_anomaly = True
                reason = f"Fuel burn rate {rate_lph:.1f} L/h exceeds physical ceiling for this engine class"
                risk = "HIGH"
                severity_code = 3
                anomaly_type = "fuel_drop"

            elif rate_lph > WARN_BURN_RATE_LPH:

                if prediction == -1:

                    is_anomaly = True
                    reason = f"Fuel burn rate {rate_lph:.1f} L/h above heavy-duty range, confirmed by ML"
                    risk = "HIGH"
                    severity_code = 3
                    anomaly_type = "fuel_drop"

                else:

                    is_anomaly = True
                    reason = f"Fuel burn rate {rate_lph:.1f} L/h above heavy-duty range"
                    risk = "MEDIUM"
                    severity_code = 2
                    anomaly_type = "fuel_drop"

        else:

            # DEGRADED-MODE SAFETY NET: not enough elapsed time yet for a
            # reliable rate (device just started reporting, fuel_history was
            # just reset by a restart, or the client timestamp is missing/
            # malformed and we're timing off server-arrival clock instead).
            # Fall back to the old coarse absolute-liters check against the
            # immediately previous reading, with its original ML corroboration.
            previous_fuel = history[-2]["fuel"]
            drop = previous_fuel - fuel

            if drop > FUEL_DROP_THRESHOLD and prediction == -1:

                is_anomaly = True
                reason = "Sudden fuel drop confirmed by ML (insufficient timing data for rate check)"
                risk = "HIGH"
                severity_code = 3
                anomaly_type = "fuel_drop"

            elif drop > FUEL_DROP_THRESHOLD:

                is_anomaly = True
                reason = "Sudden fuel drop detected (insufficient timing data for rate check)"
                risk = "MEDIUM"
                severity_code = 2
                anomaly_type = "fuel_drop"

    # ML FALLBACK (INFORMATIONAL ONLY)
    #
    # IsolationForest flags any statistically unusual (fuel, voltage) point in
    # isolation, with no notion of rate/direction/context. Demoted to a
    # non-alerting, informational classification: surfaced in the response for
    # observability/tuning, but never independently creates a backend alert
    # (is_anomaly stays False, so write_anomaly_log below is never called and
    # mqttService.js's alert insert never fires for this branch alone).
    if not is_anomaly and prediction == -1:

        reason = "Statistically unusual reading (ML) — no rule violation, informational only"
        risk = "LOW"
        severity_code = 1
        anomaly_type = "ml_detected"

    if is_anomaly:

        metrics["total_anomalies"] += 1

        write_anomaly_log(
            device_id,
            anomaly_type,
            reason
        )

    return {
    "timestamp": datetime.utcnow().isoformat(),
    "device_id": device_id,
    "fuel_level": fuel,
    "voltage": voltage,
    "engine_status": engine_status,
    "history": [h["fuel"] for h in history],
    "anomaly_score": score,
    "confidence": confidence,
    "model_version": model_version,
    "anomaly": is_anomaly,
    "risk_level": risk,
    "anomaly_type": anomaly_type,
    "severity_code": severity_code,
    "reason": reason
}


def get_metrics():

    total_predictions = metrics["total_predictions"]
    total_anomalies = metrics["total_anomalies"]

    anomaly_rate = 0

    if total_predictions > 0:

        anomaly_rate = round(
            (total_anomalies / total_predictions) * 100,
            2
        )

    return {
        "total_predictions": total_predictions,
        "total_anomalies": total_anomalies,
        "anomaly_rate": anomaly_rate
    }