import os
import joblib
import numpy as np

from datetime import datetime
from sklearn.ensemble import IsolationForest


MODEL_DIR = "model"

MODEL_VERSION = "1.1.0"

LATEST_MODEL_PATH = os.path.join(
    MODEL_DIR,
    "model.pkl"
)

VERSIONED_MODEL_PATH = os.path.join(
    MODEL_DIR,
    f"model_v{MODEL_VERSION}.pkl"
)

os.makedirs(MODEL_DIR, exist_ok=True)


# IMPROVED TRAINING DATA
# [fuel_level, voltage]

train_data = np.array([
    [50, 12.4],
    [52, 12.5],
    [49, 12.3],
    [51, 12.6],
    [53, 12.4],
    [50, 12.5],
    [48, 12.2],
    [54, 12.6],
    [47, 12.3],
    [55, 12.7],
    [46, 12.4],
    [56, 12.5],
    [58, 12.6],
    [45, 12.2],
    [57, 12.4],
    [52, 12.7]
])


def create_model(training_data=train_data):

    model = IsolationForest(
        contamination=0.1,
        random_state=42,
        n_estimators=100
    )

    model.fit(training_data)

    return model


def save_model(model):

    # SAVE VERSIONED MODEL
    joblib.dump(
        model,
        VERSIONED_MODEL_PATH
    )

    # UPDATE LATEST MODEL
    joblib.dump(
        model,
        LATEST_MODEL_PATH
    )


def load_model():

    try:

        if os.path.exists(LATEST_MODEL_PATH):

            return joblib.load(
                LATEST_MODEL_PATH
            )

        model = create_model()

        save_model(model)

        return model

    except Exception:

        model = create_model()

        save_model(model)

        return model


model = load_model()


def predict_telemetry(
    fuel,
    voltage
):

    features = [[fuel, voltage]]

    prediction = model.predict(features)[0]

    raw_score = model.decision_function(
        features
    )[0]

    # INVERTED NORMALIZED SCORE
    # 1.0 = normal
    # 0.0 = anomaly

    normalized_score = round(
        max(0, min(1, raw_score + 0.5)),
        3
    )

    return {
        "prediction": int(prediction),
        "raw_score": float(raw_score),
        "score": normalized_score,
        "model_version": MODEL_VERSION
    }


def retrain_model(new_data):

    global model

    if not new_data:

        return {
            "status": "failed",
            "error": "No training data provided"
        }

    try:

        train_array = np.array(
            new_data,
            dtype=float
        )

        if len(train_array.shape) != 2:

            return {
                "status": "failed",
                "error": "Training data must be 2D"
            }

        model = IsolationForest(
            contamination=0.1,
            random_state=42,
            n_estimators=100
        )

        model.fit(train_array)

        save_model(model)

        return {
            "status": "retrained",
            "samples": len(new_data),
            "model_version": MODEL_VERSION,
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:

        return {
            "status": "failed",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }