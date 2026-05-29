/**
 * ============================================================
 *  IoT-AI Based Secure Fuel Monitoring - ESP32 MAIN Firmware
 *  Updated: HiveMQ Cloud (TLS port 8883) + CAM IP via UART
 *
 *  CHANGELOG:
 *  v1.1 - Fix orphan code after checkCameraReady()
 *  v1.2 - Fix GPS: gpsFixed tidak pernah di-reset ke false
 *       - Fix GPS: tambah pengecekan HDOP untuk akurasi
 *       - Fix GPS: minimal 4 satelit sebelum dianggap valid
 *       - Fix GPS: debug info lebih lengkap (HDOP + sats saat waiting)
 * ============================================================
 * Hardware (ESP32 30-pin):
 *   - GPS NEO-7M   → Serial2  RX2=GPIO16, TX2=GPIO17
 *   - ESP32-CAM MB → Serial1  RX1=GPIO25 (dari UOT cam),
 *                              TX1=GPIO26 (ke UOR cam)
 *   - Fuel Sensor  → DUMMY (simulated)
 *
 * Libraries (Arduino Library Manager):
 *   - TinyGPSPlus  by Mikal Hart
 *   - PubSubClient by Nick O'Leary
 *   - ArduinoJson  by Benoit Blanchon
 * ============================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <time.h>

// ─── CONFIG - SESUAIKAN INI ──────────────────────────────────
// Secrets (WiFi + MQTT user/pass + device token) live in secrets.h, which is
// gitignored. Copy secrets.example.h -> secrets.h and fill in real values.
#include "secrets.h"

const char* WIFI_SSID     = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;

const char* MQTT_HOST     = "b056696384c54d209bcc1388636b4415.s1.eu.hivemq.cloud";
const int   MQTT_PORT     = 8883;
const char* MQTT_USER     = SECRET_MQTT_USER;
const char* MQTT_PASS     = SECRET_MQTT_PASS;

const char* MQTT_TOPIC    = "device/EXCAVATOR_001/telemetry";
const char* DEVICE_ID     = "EXCAVATOR_001";
const char* DEVICE_TOKEN  = SECRET_DEVICE_TOKEN;
// ─────────────────────────────────────────────────────────────

// ─── PIN ASSIGNMENT ──────────────────────────────────────────
#define GPS_RX_PIN   16
#define GPS_TX_PIN   17
#define GPS_BAUD     9600

#define CAM_RX_PIN   25
#define CAM_TX_PIN   26
#define CAM_BAUD     115200
// ─────────────────────────────────────────────────────────────

// ─── INTERVAL ────────────────────────────────────────────────
#define PUBLISH_INTERVAL_MS    15000    // 15 detik
#define CAM_TRIGGER_INTERVAL   600000   // 10 menit
// ─────────────────────────────────────────────────────────────

// ─── DUMMY FUEL CONFIG ───────────────────────────────────────
#define FUEL_TANK_CAPACITY  600.0
#define FUEL_INITIAL        450.0
#define FUEL_DRAIN_PER_SEC  0.05
// ─────────────────────────────────────────────────────────────

// ─── GPS QUALITY CONFIG ──────────────────────────────────────
#define GPS_MIN_SATELLITES  4       // minimal satelit agar dianggap valid
#define GPS_MAX_HDOP        3.0     // HDOP < 3.0 = akurasi cukup baik
                                    // HDOP < 1.0 = excellent
                                    // HDOP < 2.0 = good
                                    // HDOP < 3.0 = moderate (cukup untuk tracking)
                                    // HDOP > 5.0 = poor (jangan dipakai)
// ─────────────────────────────────────────────────────────────

// ─── HiveMQ Cloud Root CA ────────────────────────────────────
static const char* HIVEMQ_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoBggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

// ─── OBJECTS ─────────────────────────────────────────────────
HardwareSerial   gpsSerial(2);
HardwareSerial   camSerial(1);
TinyGPSPlus      gps;
WiFiClientSecure wifiClient;
PubSubClient     mqttClient(wifiClient);

// ─── STATE VARIABLES ─────────────────────────────────────────
float         fuelLevel    = FUEL_INITIAL;
bool          engineOn     = true;
float         battVoltage  = 12.6;
double        gpsLat       = 0.0;
double        gpsLng       = 0.0;
bool          gpsFixed     = false;
float         gpsHdop      = 99.0;   // HDOP terakhir (99 = tidak diketahui)
int           gpsSats      = 0;      // jumlah satelit terakhir
String        camIP        = "";
unsigned long lastPublish  = 0;
unsigned long lastCamShot  = 0;
unsigned long lastDrain    = 0;
unsigned long lastGpsDebug = 0;

// ─── SETUP ───────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║   ESP32 MAIN - Fuel Monitor Boot     ║");
  Serial.println("║   Broker  : HiveMQ Cloud (TLS)       ║");
  Serial.println("║   GPS Fix : Min 4 sats, HDOP < 3.0   ║");
  Serial.println("╚══════════════════════════════════════╝");

  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.printf("[GPS]  Serial2 started  RX=GPIO%d  TX=GPIO%d  baud=%d\n",
                GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);

  camSerial.begin(CAM_BAUD, SERIAL_8N1, CAM_RX_PIN, CAM_TX_PIN);
  Serial.printf("[CAM]  Serial1 started  RX=GPIO%d  TX=GPIO%d  baud=%d\n",
                CAM_RX_PIN, CAM_TX_PIN, CAM_BAUD);

  connectWiFi();
  syncNTP();

  // ── TLS Setup ──────────────────────────────────────────────
  // Gunakan setInsecure() dulu untuk test koneksi.
  // Setelah berhasil, ganti dengan setCACert(HIVEMQ_CA_CERT).
  wifiClient.setInsecure();             // ← SEMENTARA: skip verifikasi CA
  // wifiClient.setCACert(HIVEMQ_CA_CERT); // ← PRODUKSI: aktifkan ini

  wifiClient.setTimeout(15000);
  mqttClient.setSocketTimeout(30);
  mqttClient.setKeepAlive(60);

  Serial.println("[TLS]  Mode: setInsecure (test mode)");

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(1024);

  delay(2000);
  checkCameraReady();

  Serial.println("[MAIN] Setup selesai. Masuk main loop...\n");
  Serial.println("[GPS]  Menunggu cold start... letakkan di luar ruangan!\n");
}

// ─── LOOP ────────────────────────────────────────────────────
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Putus! Reconnecting...");
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  readCamUart();
  readGPS();
  updateDummyFuel();

  unsigned long now = millis();

  if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = now;
    publishSensorData();
  }

  if (now - lastCamShot >= CAM_TRIGGER_INTERVAL) {
    lastCamShot = now;
    triggerCamera();
  }
}

// ─── WiFi ────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to '%s'", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(1000);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Gagal connect. Akan retry di loop.");
  }
}

// ─── NTP Time Sync ───────────────────────────────────────────
void syncNTP() {
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("[NTP]  Syncing");
  struct tm ti;
  int tries = 0;
  while (!getLocalTime(&ti) && tries < 20) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (tries < 20) {
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &ti);
    Serial.printf("\n[NTP]  OK: %s WIB\n", buf);
  } else {
    Serial.println("\n[NTP]  GAGAL sync! TLS mungkin bermasalah.");
  }
}

// ─── MQTT Reconnect (Non-Blocking) ───────────────────────────
void reconnectMQTT() {
  static unsigned long lastAttempt = 0;
  if (millis() - lastAttempt < 5000) return;
  lastAttempt = millis();

  Serial.printf("[MQTT] Connecting to %s:%d ... ", MQTT_HOST, MQTT_PORT);

  String clientId = String(DEVICE_ID) + "_" + String(random(0xffff), HEX);

  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
    Serial.println("Connected! ✓");
    Serial.printf("[MQTT] Topic  : %s\n", MQTT_TOPIC);
  } else {
    int state = mqttClient.state();
    Serial.printf("Gagal (state=%d)\n", state);
    // -4 = TIMEOUT       → TLS lambat / firewall
    // -2 = CONNECT_FAILED → host/port salah atau TLS error
    // -1 = DISCONNECTED
    //  4 = BAD_CREDENTIAL → user/pass salah
    //  5 = UNAUTHORIZED   → tidak punya akses
  }
}

// ─── Baca UART dari ESP32-CAM ────────────────────────────────
void readCamUart() {
  while (camSerial.available()) {
    String line = camSerial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    if (line.startsWith("CAM_IP:")) {
      camIP = line.substring(7);
      Serial.println("[CAM]  IP diterima: " + camIP);
      Serial.println("[CAM]  Stream URL : http://" + camIP + "/stream");
      Serial.println("[CAM]  mDNS URL   : http://excavator-cam.local/stream");

    } else if (line.startsWith("CAM_OK:")) {
      Serial.println("[CAM]  Foto berhasil #" + line.substring(7));

    } else if (line.startsWith("CAM_ERROR:")) {
      Serial.println("[CAM]  ERROR: " + line.substring(10));

    } else if (line == "CAM_READY") {
      Serial.println("[CAM]  Status: READY ✓");

    } else if (line.startsWith("CAM_WIFI_OK:")) {
      Serial.println("[CAM]  WiFi OK: " + line.substring(12));

    } else if (line.startsWith("CAM_MDNS:")) {
      Serial.println("[CAM]  mDNS: " + line.substring(9));

    } else {
      Serial.println("[CAM]  " + line);
    }
  }
}

// ─── GPS ─────────────────────────────────────────────────────
void readGPS() {
  // Baca semua byte yang tersedia dari GPS
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Ambil nilai HDOP & satelit saat ini
  float  currentHdop = gps.hdop.isValid()       ? gps.hdop.hdop()         : 99.0;
  int    currentSats = gps.satellites.isValid()  ? gps.satellites.value()  : 0;

  // ── Evaluasi kualitas fix ──────────────────────────────────
  // Syarat valid: lokasi valid + min 4 satelit + HDOP < GPS_MAX_HDOP
  if (gps.location.isValid()
      && currentSats >= GPS_MIN_SATELLITES
      && currentHdop < GPS_MAX_HDOP)
  {
    gpsLat   = gps.location.lat();
    gpsLng   = gps.location.lng();
    gpsHdop  = currentHdop;
    gpsSats  = currentSats;
    gpsFixed = true;

  } else {
    // Kondisi tidak memenuhi syarat → tandai tidak valid
    // (koordinat lama TIDAK dikirim sebagai "valid")
    gpsHdop  = currentHdop;
    gpsSats  = currentSats;
    gpsFixed = false;
  }

  // ── Debug setiap 10 detik ──────────────────────────────────
  unsigned long now = millis();
  if (now - lastGpsDebug >= 10000) {
    lastGpsDebug = now;

    if (gpsFixed) {
      Serial.printf(
        "[GPS]  ✓ Fix OK  | Lat=%.6f Lng=%.6f | Sats=%d | HDOP=%.1f | Alt=%.1fm\n",
        gpsLat, gpsLng, gpsSats, gpsHdop,
        gps.altitude.isValid() ? gps.altitude.meters() : 0.0
      );
    } else {
      // Tampilkan info penyebab kenapa belum fix
      Serial.printf(
        "[GPS]  ✗ No Fix  | chars=%lu | sentences=%lu | fix=%lu | fail=%lu\n",
        gps.charsProcessed(),
        gps.passedChecksum() + gps.failedChecksum(),
        gps.sentencesWithFix(),
        gps.failedChecksum()
      );
      Serial.printf(
        "[GPS]           | Sats=%d (min:%d) | HDOP=%.1f (max:%.1f) | locValid=%s\n",
        currentSats, GPS_MIN_SATELLITES,
        currentHdop, GPS_MAX_HDOP,
        gps.location.isValid() ? "YES" : "NO"
      );

      // Peringatan jika chars=0 → kemungkinan pin RX/TX terbalik
      if (gps.charsProcessed() < 10 && now > 30000) {
        Serial.println("[GPS]  ⚠ WARNING: chars sangat sedikit! Cek pin RX/TX GPS.");
        Serial.println("[GPS]  ⚠ Coba swap: gpsSerial.begin(baud, SERIAL_8N1, GPS_TX_PIN, GPS_RX_PIN)");
      }
    }
  }
}

// ─── Dummy Fuel Simulation ───────────────────────────────────
void updateDummyFuel() {
  unsigned long now = millis();
  if (engineOn && (now - lastDrain >= 1000)) {
    lastDrain   = now;
    fuelLevel  -= FUEL_DRAIN_PER_SEC;
    battVoltage = 12.0 + (float)(random(0, 12)) / 10.0;
    if (fuelLevel < 0.0) fuelLevel = 0.0;
  }
}

// ─── Publish Data ke MQTT ────────────────────────────────────
void publishSensorData() {
  if (!mqttClient.connected()) {
    Serial.println("[MQTT] Skip publish – belum terkoneksi.");
    return;
  }

  Serial.println("\n[MQTT] === Preparing publish ===");

  char ts[25] = "";
  struct tm ti;
  if (getLocalTime(&ti)) {
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", &ti);
  } else {
    snprintf(ts, sizeof(ts), "ms:%lu", millis());
  }

  StaticJsonDocument<960> doc;
  doc["device_id"]     = DEVICE_ID;
  doc["device_token"]  = DEVICE_TOKEN;
  doc["timestamp"]     = ts;
  doc["fuel_level"]    = round(fuelLevel * 10.0) / 10.0;
  doc["fuel_pct"]      = round((fuelLevel / FUEL_TANK_CAPACITY) * 1000.0) / 10.0;
  doc["engine_status"] = engineOn ? "running" : "off";
  doc["voltage"]       = round(battVoltage * 10.0) / 10.0;

  // GPS: kirim koordinat hanya jika benar-benar valid
  doc["gps_valid"]     = gpsFixed;
  doc["satellites"]    = gpsSats;
  doc["hdop"]          = gpsFixed ? round(gpsHdop * 10.0) / 10.0 : 99.0;

  if (gpsFixed) {
    // Koordinat valid → kirim nilai asli
    doc["latitude"]    = serialized(String(gpsLat, 6));
    doc["longitude"]   = serialized(String(gpsLng, 6));
  } else {
    // Tidak valid → kirim null agar dashboard tidak plot titik salah
    doc["latitude"]    = serialized("null");
    doc["longitude"]   = serialized("null");
  }

  // Info kamera jika IP sudah diterima
  if (camIP.length() > 0) {
    doc["cam_ip"]      = camIP;
    doc["stream_url"]  = "http://" + camIP + "/stream";
    doc["mdns_url"]    = "http://excavator-cam.local/stream";
  }

  char payload[960];
  size_t len = serializeJson(doc, payload);

  Serial.printf("[MQTT] Topic  : %s\n", MQTT_TOPIC);
  Serial.printf("[MQTT] Payload: %s\n", payload);
  Serial.printf("[MQTT] Size   : %d bytes\n", len);

  if (mqttClient.publish(MQTT_TOPIC, payload, true)) {
    Serial.println("[MQTT] ✓ Published OK");
  } else {
    Serial.printf("[MQTT] ✗ Publish GAGAL (state=%d)\n", mqttClient.state());
  }

  Serial.printf(
    "[INFO] Fuel=%.1fL (%.1f%%) | Volt=%.1fV | GPS=%s (sats=%d hdop=%.1f) | CAM=%s\n",
    fuelLevel,
    (fuelLevel / FUEL_TANK_CAPACITY) * 100.0,
    battVoltage,
    gpsFixed ? "FIX" : "NO FIX",
    gpsSats,
    gpsHdop,
    camIP.length() > 0 ? camIP.c_str() : "unknown"
  );
  Serial.println("[MQTT] ================================\n");
}

// ─── Trigger Foto ke ESP32-CAM ───────────────────────────────
void triggerCamera() {
  Serial.println("[CAM]  Sending CAPTURE command...");
  camSerial.println("CAPTURE");
}

// ─── Cek apakah CAM sudah siap ───────────────────────────────
void checkCameraReady() {
  Serial.println("[CAM]  Checking ESP32-CAM status...");

  delay(500);
  readCamUart();

  camSerial.println("STATUS");
  delay(500);
  readCamUart();
}
