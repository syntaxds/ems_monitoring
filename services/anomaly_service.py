import numpy as np
from model.isolation_forest import predict_telemetry
from datetime import datetime
import os


LOW_FUEL_THRESHOLD = 10

LOW_VOLTAGE_THRESHOLD = 11.5

MAX_HISTORY = 10


fuel_history = {}

metrics = {

    "total_predictions": 0,

    "total_anomalies": 0

}


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

    if fuel < LOW_FUEL_THRESHOLD:

        is_anomaly = True

        reason = "Fuel level below safe threshold"

        risk = "HIGH"

        severity_code = 3

        anomaly_type = "low_fuel"

    elif voltage < LOW_VOLTAGE_THRESHOLD:

        is_anomaly = True

        reason = "Low voltage detected"

        risk = "MEDIUM"

        severity_code = 2

        anomaly_type = "low_voltage"

    elif engine_status == "OFF" and len(history) >= 2:

        previous_fuel = history[-2]

        if previous_fuel - fuel > 5:

            is_anomaly = True

            reason = "Fuel drop detected while engine is OFF"

            risk = "HIGH"

            severity_code = 3

            anomaly_type = "engine_off_fuel_drop"

    elif fuel > 100:

        is_anomaly = True

        reason = "Invalid fuel level (sensor error)"

        risk = "HIGH"

        severity_code = 3

        anomaly_type = "invalid_sensor"

    if len(history) >= 2 and not is_anomaly and fuel >=LOW_FUEL_THRESHOLD:

        previous_fuel = history[-2]

        drop = previous_fuel - fuel

        if drop > 15:

            is_anomaly = True

            reason = "Sudden fuel drop detected"

            risk = "HIGH"

            severity_code = 3

            anomaly_type = "fuel_drop"

    if len(history) >= 5 and not is_anomaly:

        trend = np.diff(history)

        if all(t < 0 for t in trend[-3:]):

            is_anomaly = True

            reason = "Consistent decreasing pattern detected"

            risk = "MEDIUM"

            severity_code = 2

            anomaly_type = "decreasing_trend"

    elif prediction == -1 and not is_anomaly:

        is_anomaly = True

        reason = "Anomaly detected by ML model"

        risk = "MEDIUM"

        severity_code = 2

        anomaly_type = "ml_detected"

    if is_anomaly:

        metrics["total_anomalies"] += 1

        if is_anomaly:

            log_path = os.path.join(
                os.path.dirname(__file__),
                "..",
                "logs",
                "anomaly.log"
   )

    with open(log_path, "a") as log_file:

            log_file.write(
                f"{datetime.utcnow()} | "
                f"{device_id} | "
                f"{anomaly_type} | "
                f"{reason}\n"
            )
   
    return {

        "device_id": device_id,

        "fuel_level": fuel,

        "voltage": voltage,

        "engine_status": engine_status,

        "history": history,

        "anomaly_score": score,

        "confidence": confidence,

        "model_version": model_version,

        "is_anomaly": is_anomaly,

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