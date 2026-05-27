import numpy as np
from model.isolation_forest import predict_fuel

LOW_FUEL_THRESHOLD = 10
MAX_HISTORY = 10

fuel_history = {}

def analyze_fuel(device_id, fuel):

    # Create device history
    if device_id not in fuel_history:
        fuel_history[device_id] = []

    fuel_history[device_id].append(fuel)

    # Limit history size
    if len(fuel_history[device_id]) > MAX_HISTORY:
        fuel_history[device_id].pop(0)

    history = fuel_history[device_id]

    # Machine learning prediction
    ml_result = predict_fuel(fuel)

    prediction = ml_result["prediction"]
    score = ml_result["score"]

    # Default result
    is_anomaly = False
    reason = "Normal fuel usage"
    risk = "LOW"
    severity_code = 1

    # Low fuel detection
    if fuel < LOW_FUEL_THRESHOLD:

        is_anomaly = True
        reason = "Fuel level below safe threshold"
        risk = "HIGH"
        severity_code = 3

    # Invalid sensor value
    elif fuel > 100:

        is_anomaly = True
        reason = "Invalid fuel level (sensor error)"
        risk = "HIGH"
        severity_code = 3

    # Sudden fuel drop
    if len(history) >= 2:

        previous_fuel = history[-2]
        drop = previous_fuel - fuel

        if drop > 15:

            is_anomaly = True
            reason = "Sudden fuel drop detected"
            risk = "HIGH"
            severity_code = 3

    # Trend detection
    if len(history) >= 5:

        trend = np.diff(history)

        if all(t < 0 for t in trend[-3:]):

            is_anomaly = True
            reason = "Consistent decreasing pattern detected"
            risk = "MEDIUM"
            severity_code = 2

    # ML fallback
    if prediction == -1 and not is_anomaly:

        is_anomaly = True
        reason = "Anomaly detected by ML model"
        risk = "MEDIUM"
        severity_code = 2

    return {
        "device_id": device_id,
        "fuel_level": fuel,
        "history": history,
        "anomaly_score": score,
        "is_anomaly": is_anomaly,
        "risk_level": risk,
        "severity_code": severity_code,
        "reason": reason
    }