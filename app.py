from datetime import datetime

from flask import Flask, request, jsonify

from services.anomaly_service import (
    analyze_fuel,
    get_metrics
)

from model.isolation_forest import retrain_model


app = Flask(__name__)

AI_VERSION = "1.0.0"


@app.route('/')
def home():

    return "AI Engine Running"


@app.route('/health')
def health():

    return jsonify({

        "status": "running",

        "service": "AI Engine",

        "model": "Isolation Forest",

        "model_version": AI_VERSION,

        "score_mode": {
            "0.0": "highest anomaly risk",
            "1.0": "fully normal behavior"
        }

    })


@app.route('/docs/anomaly-score')
def anomaly_score_docs():

    return jsonify({

        "anomaly_score": {

            "0.0": "highest anomaly risk",

            "1.0": "fully normal behavior"

        }

    })


@app.route('/metrics')
def metrics():

    result = get_metrics()

    result["model_version"] = AI_VERSION

    return jsonify(result)


@app.route('/analyze', methods=['POST'])
def analyze():

    try:

        req = request.json

        if not req:

            return jsonify({
                "error": "Request body required"
            }), 400

        device_id = req.get("device_id")

        fuel_level = req.get("fuel_level")

        voltage = req.get("voltage", 12.4)

        engine_status = req.get(
            "engine_status",
            "ON"
        )

        if device_id is None:

            return jsonify({
                "error": "device_id is required"
            }), 400

        if fuel_level is None:

            return jsonify({
                "error": "fuel_level is required"
            }), 400

        try:

            fuel_level = float(fuel_level)

            voltage = float(voltage)

        except ValueError:

            return jsonify({
                "error": "fuel_level and voltage must be numeric"
            }), 400

        print(
            f"[AI] Analyze request | "
            f"device={device_id} "
            f"fuel={fuel_level} "
            f"voltage={voltage} "
            f"engine_status={engine_status}"
        )

        result = analyze_fuel(
            device_id,
            fuel_level,
            voltage,
            engine_status
        )

        return jsonify(result)

    except Exception as e:

        return jsonify({

            "error": str(e),

            "timestamp": datetime.utcnow().isoformat()

        }), 500


@app.route('/retrain', methods=['POST'])
def retrain():

    try:

        req = request.json

        if not req:

            return jsonify({
                "error": "Request body required"
            }), 400

        training_data = req.get("training_data")

        if not training_data:

            return jsonify({
                "error": "training_data is required"
            }), 400

        print(
            f"[AI] Retraining model with "
            f"{len(training_data)} samples"
        )

        result = retrain_model(
            training_data
        )

        return jsonify(result)

    except Exception as e:

        return jsonify({

            "error": str(e),

            "timestamp": datetime.utcnow().isoformat()

        }), 500


if __name__ == '__main__':

    print("====================================")
    print(" EMS Monitoring AI Engine")
    print(" Isolation Forest Service Running")
    print(f" AI Version : {AI_VERSION}")
    print(" Port : 5001")
    print("====================================")

    app.run(
        host='0.0.0.0',
        port=5001
    )