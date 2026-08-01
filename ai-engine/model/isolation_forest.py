import os
import joblib
import numpy as np
import pandas as pd

from datetime import datetime
from sklearn.ensemble import IsolationForest

MODEL_VERSION = "1.2.0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_DIR = BASE_DIR

DATA_DIR = os.path.join(
    os.path.dirname(BASE_DIR),
    "data"
)

TRAINING_DATA_PATH = os.path.join(
    DATA_DIR,
    "training_data.csv"
)

LATEST_MODEL_PATH = os.path.join(
    MODEL_DIR,
    "model.pkl"
)

VERSIONED_MODEL_PATH = os.path.join(
    MODEL_DIR,
    f"model_v{MODEL_VERSION}.pkl"
)

os.makedirs(MODEL_DIR, exist_ok=True)


def load_training_data():

    if os.path.exists(TRAINING_DATA_PATH):

        df = pd.read_csv(TRAINING_DATA_PATH)

        required_columns = [
            "fuel_level",
            "voltage"
        ]

        if not all(col in df.columns for col in required_columns):
            raise ValueError(
                f"training_data.csv must contain columns: {required_columns}"
            )

        if df.empty:
            raise ValueError("Training dataset is empty.")

        return df[
            required_columns
        ].values

      # Emergency fallback dataset.
      # Used only if training_data.csv cannot be loaded.
      # This keeps the AI service running for development/testing.
    return np.array([
        [10, 12.4],
        [30, 12.5],
        [50, 12.3],
        [80, 12.6],
        [120, 12.4],
        [170, 12.5],
        [223, 12.4]
    ])


def create_model():

    training_data = load_training_data()

    model = IsolationForest(
        contamination=0.02,
        random_state=42,
        n_estimators=100
    )

    model.fit(training_data)

    return model


def save_model(model):

    joblib.dump(
        model,
        VERSIONED_MODEL_PATH
    )

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

    except Exception as e:

        print(f"[AI MODEL] Failed to load existing model: {e}")
        print("[AI MODEL] Creating a new model...")

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
            contamination=0.02,
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
            "error": str(e)
        }