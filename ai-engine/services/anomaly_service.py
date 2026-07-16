import os
import logging
import numpy as np
from datetime import datetime
from logging.handlers import RotatingFileHandler
from model.isolation_forest import predict_telemetry


LOW_FUEL_THRESHOLD = 10
LOW_VOLTAGE_THRESHOLD = 11.5
MAX_HISTORY = 10
MAX_FUEL_LEVEL = 250


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


def analyze_fuel(
    device_id,
    fuel,
    voltage=12.4,
    engine_status="ON"
):

    if device_id not in fuel_history:
        fuel_history[device_id] = []

    fuel_history[device_id].append(fuel)

    if len(fuel_history[device_id]) > MAX_HISTORY:
        fuel_history[device_id].pop(0)

    history = fuel_history[device_id]

    metrics["total_predictions"] += 1

    ml_result = predict_telemetry(
        fuel,
        voltage
    )

    prediction = ml_result["prediction"]
    score = ml_result["score"]
    model_version = ml_result["model_version"]

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

    elif engine_status == "off" and len(history) >= 2:

        previous_fuel = history[-2]

        if previous_fuel - fuel > 5:

            is_anomaly = True
            reason = "Fuel drop detected while engine is OFF"
            risk = "HIGH"
            severity_code = 3
            anomaly_type = "engine_off_fuel_drop"

    # TREND & ML ANALYSIS

    if not is_anomaly and len(history) >= 2:

        previous_fuel = history[-2]

        drop = previous_fuel - fuel

        # COMBINE RULE + ML SIGNAL
        if drop > 15 and prediction == -1:

            is_anomaly = True
            reason = "Sudden fuel drop confirmed by ML"
            risk = "HIGH"
            severity_code = 3
            anomaly_type = "fuel_drop"

        elif drop > 15:

            is_anomaly = True
            reason = "Sudden fuel drop detected"
            risk = "MEDIUM"
            severity_code = 2
            anomaly_type = "fuel_drop"

    # ML FALLBACK

    if not is_anomaly and prediction == -1:

        is_anomaly = True
        reason = "Anomaly detected by ML model"
        risk = "MEDIUM"
        severity_code = 2
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
        "history": history,
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