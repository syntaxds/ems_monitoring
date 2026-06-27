import csv
import random

rows = [["fuel_level", "voltage"]]

for cycle in range(20):  

    fuel = 100.0

    while fuel >= 5:

        voltage = round(random.uniform(12.2, 12.7), 1)

        rows.append([
            round(fuel, 1),
            voltage
        ])


        fuel -= random.uniform(0.2, 0.5)

    rows.append([
        round(random.uniform(95, 100), 1),
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