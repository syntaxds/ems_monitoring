import csv
import random

rows = [["fuel_level", "voltage"]]

for cycle in range(20):

    fuel = random.uniform(230, 249.75)

    while fuel >= 0:

        voltage = round(random.uniform(12.2, 12.7), 1)

        rows.append([
            round(fuel, 1),
            voltage
        ])

        fuel -= random.choice([
            random.uniform(0.0, 0.1),
            random.uniform(0.2, 0.5)
        ])

    # refuel
    rows.append([
        round(random.uniform(230, 249.75), 1),
        round(random.uniform(12.5, 12.7), 1)
    ])

with open(
    "data/training_data.csv",
    "w",
    newline=""
) as f:

    writer = csv.writer(f)
    writer.writerows(rows)

print(f"Generated {len(rows)-1} training samples.")
