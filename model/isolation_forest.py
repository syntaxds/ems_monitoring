import os
import joblib
import numpy as np

from sklearn.ensemble import IsolationForest


MODEL_PATH = "model/model.pkl"

MODEL_VERSION = "1.0.0"


# TRAINING DATA
train_data = np.array([
    [50, 12.4],
    [52, 12.5],
    [49, 12.3],
    [51, 12.6],
    [53, 12.4],
    [50, 12.5],
    [48, 12.2],
    [54, 12.6]
])


def create_model():

    model = IsolationForest(
        contamination=0.1,
        random_state=42
    )

    model.fit(train_data)

    return model


# LOAD EXISTING MODEL
if os.path.exists(MODEL_PATH):

    model = joblib.load(MODEL_PATH)

else:

    model = create_model()

    joblib.dump(
        model,
        MODEL_PATH
    )


def predict_telemetry(
    fuel,
    voltage
):

    # MULTI-FEATURE PREDICTION
    prediction = model.predict([
        [fuel, voltage]
    ])[0]

    # RAW ANOMALY SCORE
    raw_score = model.decision_function([
        [fuel, voltage]
    ])[0]

    # NORMALIZED SCORE
    # 0.0 = highest anomaly risk
    # 1.0 = fully normal behavior
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

    train_array = np.array(new_data)

    model = IsolationForest(
        contamination=0.1,
        random_state=42
    )

    model.fit(train_array)

    joblib.dump(
        model,
        MODEL_PATH
    )

    return {

        "status": "retrained",

        "samples": len(new_data),

        "model_version": MODEL_VERSION

    }