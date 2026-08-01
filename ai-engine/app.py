import os
import logging
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from services.anomaly_service import analyze_fuel, get_metrics
from model.isolation_forest import retrain_model, MODEL_VERSION

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

AI_VERSION = MODEL_VERSION
AI_API_KEY = os.getenv("AI_API_KEY", "")


def validate_api_key(req):

    if not AI_API_KEY:
        return True

    api_key = req.headers.get("x-api-key")

    return api_key == AI_API_KEY


def unauthorized_response():

    return jsonify({
        "error": "Unauthorized"
    }), 401


def error_response(message, code=400):

    return jsonify({
        "error": message,
        "timestamp": datetime.utcnow().isoformat()
    }), code


@app.route("/")
def home():

    return "AI Engine Running"


@app.route("/health")
@app.route("/internal/ai/health")
def health():

    if not validate_api_key(request):
        return unauthorized_response()

    return jsonify({
        "status": "running",
        "service": "AI Engine",
        "model": "Isolation Forest",
        "model_version": AI_VERSION,
        "timestamp": datetime.utcnow().isoformat(),
        "score_mode": {
            "0.0": "highest anomaly risk",
            "1.0": "fully normal behavior"
        }
    })


@app.route("/docs/anomaly-score")
def anomaly_score_docs():

    return jsonify({
        "anomaly_score": {
            "0.0": "highest anomaly risk",
            "1.0": "fully normal behavior"
        }
    })


@app.route("/metrics")
def metrics():

    if not validate_api_key(request):
        return unauthorized_response()

    result = get_metrics()

    result["model_version"] = AI_VERSION

    return jsonify(result)


@app.route("/internal/ai/analyze", methods=["POST"])
def analyze():

    try:

        if not validate_api_key(request):
            return unauthorized_response()

        req = request.get_json(silent=True)

        if not req:
            return error_response("Request body required")

        device_id = req.get("device_id")
        fuel_level = req.get("fuel_level")
        voltage = req.get("voltage", 12.4)
        engine_status = str(
            req.get("engine_status", "running")
        ).lower()
        timestamp = req.get("timestamp")

        if device_id is None:
            return error_response("device_id is required")

        if fuel_level is None:
            return error_response("fuel_level is required")

        if engine_status not in ("running", "idle", "off"):
            return error_response(
                "engine_status must be 'running', 'idle', or 'off'"
            )

        try:
            fuel_level = float(fuel_level)
            voltage = float(voltage)

        except (ValueError, TypeError):
            return error_response(
                "fuel_level and voltage must be numeric"
            )

        logger.info(
            "Analyze | device=%s | fuel=%s | voltage=%s | engine=%s",
            device_id,
            fuel_level,
            voltage,
            engine_status
        )

        result = analyze_fuel(
            device_id,
            fuel_level,
            voltage,
            engine_status,
            timestamp
        )

        result["status"] = "processed"

        return jsonify(result)

    except Exception as e:

        logger.exception("Analyze endpoint failed")

        return error_response(str(e), 500)


@app.route("/internal/ai/analyze/batch", methods=["POST"])
def analyze_batch():

    try:

        if not validate_api_key(request):
            return unauthorized_response()

        req = request.get_json(silent=True)

        if not req:
            return error_response("Request body required")

        devices = req.get("devices", [])

        results = []

        for device in devices:

            try:

                device_id = device.get("device_id")

                if device_id is None:
                    raise ValueError("device_id is required")

                fuel_level = float(
                    device.get("fuel_level", 0)
                )

                voltage = float(
                    device.get("voltage", 12.4)
                )

                engine_status = str(
                    device.get("engine_status", "running")
                ).lower()

                timestamp = device.get("timestamp")

                if engine_status not in ("running", "idle", "off"):
                    raise ValueError(
                        "engine_status must be 'running', 'idle', or 'off'"
                    )

                logger.info(
                    "Batch Analyze | device=%s | fuel=%s | voltage=%s | engine=%s",
                    device_id,
                    fuel_level,
                    voltage,
                    engine_status
                )

                result = analyze_fuel(
                    device_id,
                    fuel_level,
                    voltage,
                    engine_status,
                    timestamp
                )

                result["status"] = "processed"

                results.append(result)

            except Exception as device_error:

                logger.exception(
                    "Batch analyze failed for device %s",
                    device.get("device_id")
                )

                results.append({
                    "status": "failed",
                    "device_id": device.get("device_id"),
                    "error": str(device_error),
                    "timestamp": datetime.utcnow().isoformat()
                })

        return jsonify(results)

    except Exception as e:

        logger.exception("Batch endpoint failed")

        return error_response(str(e), 500)


@app.route("/retrain", methods=["POST"])
def retrain():

    try:

        if not validate_api_key(request):
            return unauthorized_response()

        req = request.get_json(silent=True)

        if not req:
            return error_response("Request body required")

        training_data = req.get("training_data")

        if not training_data:
            return error_response(
                "training_data is required"
            )

        logger.info(
            "Retraining model with %d samples",
            len(training_data)
        )

        result = retrain_model(training_data)

        return jsonify(result)

    except Exception as e:

        logger.exception("Retrain endpoint failed")

        return error_response(str(e), 500)


if __name__ == "__main__":

    logger.info("====================================")
    logger.info(" EMS Monitoring AI Engine")
    logger.info(" Isolation Forest Service Running")
    logger.info(" AI Version : %s", AI_VERSION)
    logger.info(" Port : 5001")
    logger.info("====================================")

    app.run(
        host="0.0.0.0",
        port=5001,
        threaded=True
    )