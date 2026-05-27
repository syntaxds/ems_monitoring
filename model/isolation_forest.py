import numpy as np
from sklearn.ensemble import IsolationForest

train_data = np.array([
    [50], [52], [49], [51],
    [53], [50], [48], [54]
])

model = IsolationForest(
    contamination=0.1,
    random_state=42
)

model.fit(train_data)

def predict_fuel(fuel):

    prediction = model.predict([[fuel]])[0]

    raw_score = model.decision_function([[fuel]])[0]

    normalized_score = round(
        max(0, min(1, raw_score + 0.5)),
        3
    )

    return {

        "prediction": int(prediction),

        "raw_score": float(raw_score),

        "score": normalized_score

    }