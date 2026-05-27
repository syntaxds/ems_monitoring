from datetime import datetime

from flask import Flask, request, jsonify
from services.anomaly_service import analyze_fuel

app = Flask(__name__)

@app.route('/')
def home():
    return "AI Engine Running"

@app.route('/health')
def health():
    return jsonify({
        "status": "running",
        "service": "AI Engine",
        "version": "3.0 Modular Architecture"
    })

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

        if device_id is None:
            return jsonify({
                "error": "device_id is required"
            }), 400

        if fuel_level is None:
            return jsonify({
                "error": "fuel_level is required"
            }), 400

        fuel_level = float(fuel_level)

        result = analyze_fuel(
            device_id,
            fuel_level
        )

        return jsonify(result)

    except Exception as e:
        return jsonify({
           "error": str(e),
           "timestamp": datetime.utcnow().isoformat()
        }), 500

if __name__ == '__main__':
    print("AI Engine Modular Architecture Running")
    app.run(host='0.0.0.0', port=5001)