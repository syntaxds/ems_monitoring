// secrets.example.h — TEMPLATE for device credentials.
//
// Copy this file to "secrets.h" (in the same folder) and fill in real values.
// secrets.h is gitignored and must NEVER be committed. Both main and cam
// sketches include "secrets.h".
#ifndef SECRETS_H
#define SECRETS_H

#define SECRET_WIFI_SSID     "your-wifi-ssid"
#define SECRET_WIFI_PASSWORD "your-wifi-password"

// MQTT broker (HiveMQ Cloud) username/password.
#define SECRET_MQTT_USER     "your-mqtt-username"
#define SECRET_MQTT_PASS     "your-mqtt-password"

// Per-device secret; must match devices.device_token in the backend DB.
#define SECRET_DEVICE_TOKEN  "your-device-token"

#endif // SECRETS_H
