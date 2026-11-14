// EcoChef Sensor Set reference firmware (ESP32 Arduino core 3.x).
// Libraries: NimBLE-Arduino, ArduinoJson. Configure real sensor pins/calibration for production hardware.
#include <ArduinoJson.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <WiFi.h>

static const char* DEVICE_CODE = "ENOSE-F57630";
static const char* BLE_NAME = "EcoChef-F57630";
static const char* SERVICE_UUID = "7d2b0001-6c62-4b5f-9f2a-6f8c2c9a4100";
static const char* CONFIG_UUID = "7d2b0002-6c62-4b5f-9f2a-6f8c2c9a4100";
static const char* STATUS_UUID = "7d2b0003-6c62-4b5f-9f2a-6f8c2c9a4100";
static const uint8_t MQ3_PIN = 32;
static const uint8_t MQ135_PIN = 33;
static const uint8_t MQ136_PIN = 34;
static const uint8_t MQ137_PIN = 35;
static const uint8_t DHT_PIN = 27;
static const uint8_t DHT_TYPE = DHT22;

Preferences preferences;
DHT dht(DHT_PIN, DHT_TYPE);
NimBLECharacteristic* statusCharacteristic = nullptr;
String configBuffer;
String wifiSsid, wifiPassword, readingUrl, sensorKey;
unsigned long lastReadingAt = 0;
unsigned long lastStatusAt = 0;
unsigned long lastDiagnosticsAt = 0;
unsigned long lastClimateAt = 0;
float latestTemperature = NAN;
float latestHumidity = NAN;

void readClimate() {
  const float humidity = dht.readHumidity();
  const float temperature = dht.readTemperature();
  if (!isnan(humidity) && !isnan(temperature)) {
    latestHumidity = humidity;
    latestTemperature = temperature;
  }
}

void printSensorDiagnostics() {
  const int mq3 = analogRead(MQ3_PIN);
  const int mq135 = analogRead(MQ135_PIN);
  const int mq136 = analogRead(MQ136_PIN);
  const int mq137 = analogRead(MQ137_PIN);
  Serial.printf(
    "SENSORS raw ADC | MQ3=%d%s MQ135=%d%s MQ136=%d%s MQ137=%d%s | DHT22=%.1fC %.1f%%RH%s\n",
    mq3, (mq3 <= 5 || mq3 >= 4090) ? "!" : "",
    mq135, (mq135 <= 5 || mq135 >= 4090) ? "!" : "",
    mq136, (mq136 <= 5 || mq136 >= 4090) ? "!" : "",
    mq137, (mq137 <= 5 || mq137 >= 4090) ? "!" : "",
    latestTemperature, latestHumidity,
    (isnan(latestTemperature) || isnan(latestHumidity)) ? " !check wiring" : ""
  );
}

void reportStatus(const char* value) {
  statusCharacteristic->setValue(value);
  statusCharacteristic->notify();
}

bool postReading() {
  if (WiFi.status() != WL_CONNECTED || readingUrl.isEmpty() || sensorKey.isEmpty()) return false;
  readClimate();
  if (isnan(latestTemperature) || isnan(latestHumidity)) {
    Serial.println("DHT22 reading unavailable; reading was not uploaded");
    return false;
  }
  StaticJsonDocument<256> reading;
  // Replace these raw examples with the production board's pin mapping and sensor driver.
  reading["mq3"] = analogRead(MQ3_PIN);
  reading["mq135"] = analogRead(MQ135_PIN);
  reading["mq136"] = analogRead(MQ136_PIN);
  reading["mq137"] = analogRead(MQ137_PIN);
  reading["temperature_c"] = latestTemperature;
  reading["humidity_percent"] = latestHumidity;
  reading["freshness_status"] = "unknown";
  String body;
  serializeJson(reading, body);
  HTTPClient http;
  http.begin(readingUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Sensor-Key", sensorKey);
  const int response = http.POST(body);
  http.end();
  return response >= 200 && response < 300;
}

void saveConfiguration() {
  preferences.begin("ecochef", false);
  preferences.putString("ssid", wifiSsid);
  preferences.putString("password", wifiPassword);
  preferences.putString("url", readingUrl);
  preferences.putString("key", sensorKey);
  preferences.end();
}

void applyConfiguration(const String& json) {
  StaticJsonDocument<768> config;
  if (deserializeJson(config, json) || config["v"] != 1) { reportStatus("error:Invalid setup data."); return; }
  if (config["action"] == "scan_wifi") {
    Serial.println("EcoChef app requested a 2.4 GHz Wi-Fi scan");
    WiFi.mode(WIFI_STA);
    WiFi.disconnect(false, false);
    const int count = WiFi.scanNetworks(false, true, false, 300, 0);
    Serial.printf("Wi-Fi scan completed: %d network(s) found\n", count);
    // Send one compact notification per network to remain below the default BLE MTU.
    for (int index = 0; index < count && index < 16; index++) {
      StaticJsonDocument<128> network;
      network["ssid"] = WiFi.SSID(index);
      network["rssi"] = WiFi.RSSI(index);
      network["secure"] = WiFi.encryptionType(index) != WIFI_AUTH_OPEN;
      String message = "wifi:";
      serializeJson(network, message);
      // The default BLE notification payload can be only 20 bytes. Stream each
      // result in small framed pieces so network details are not truncated when
      // the phone and ESP32 have not negotiated a larger MTU.
      for (size_t offset = 0; offset < message.length(); offset += 8) {
        const String part = "wifi_part:" + message.substring(offset, offset + 8);
        reportStatus(part.c_str());
        delay(25);
      }
      reportStatus("wifi_end");
      delay(45);
    }
    WiFi.scanDelete();
    reportStatus("wifi_scan_done");
    return;
  }
  wifiSsid = config["ssid"].as<String>();
  wifiPassword = config["password"].as<String>();
  readingUrl = config["readingUrl"].as<String>();
  sensorKey = config["sensorKey"].as<String>();
  if (wifiSsid.isEmpty() || readingUrl.isEmpty() || sensorKey.length() < 20) { reportStatus("error:Setup data is incomplete."); return; }
  Serial.printf("Connecting to Wi-Fi: %s\n", wifiSsid.c_str());
  reportStatus("wifi_connecting");
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  const unsigned long deadline = millis() + 30000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) delay(250);
  if (WiFi.status() != WL_CONNECTED) { Serial.println("Wi-Fi connection failed"); reportStatus("error:Could not join Wi-Fi. Check the name and password."); return; }
  Serial.print("Wi-Fi connected. IP address: ");
  Serial.println(WiFi.localIP());
  reportStatus("api_connecting");
  if (!postReading()) { Serial.println("EcoChef API test reading failed"); reportStatus("error:Wi-Fi connected, but EcoChef could not be reached."); return; }
  saveConfiguration();
  reportStatus("ready");
  Serial.println("EcoChef setup complete; first reading accepted");
}

class ConfigCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
    const std::string value = characteristic->getValue();
    configBuffer += String(value.c_str());
    const int newline = configBuffer.indexOf('\n');
    if (newline < 0) return;
    const String message = configBuffer.substring(0, newline);
    configBuffer = configBuffer.substring(newline + 1);
    applyConfiguration(message);
  }
};

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    Serial.println("EcoChef app connected over Bluetooth");
  }

  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    Serial.println("Bluetooth disconnected; setup advertising restarted");
    NimBLEDevice::startAdvertising();
  }
};

void startProvisioning() {
  NimBLEDevice::init(BLE_NAME);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* service = server->createService(SERVICE_UUID);
  NimBLECharacteristic* config = service->createCharacteristic(CONFIG_UUID, NIMBLE_PROPERTY::WRITE);
  statusCharacteristic = service->createCharacteristic(STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  config->setCallbacks(new ConfigCallbacks());
  service->start();
  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->setName(BLE_NAME);
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();
  Serial.printf("Bluetooth setup active as %s\n", BLE_NAME);
}

void loadConfiguration() {
  preferences.begin("ecochef", true);
  wifiSsid = preferences.getString("ssid");
  wifiPassword = preferences.getString("password");
  readingUrl = preferences.getString("url");
  sensorKey = preferences.getString("key");
  preferences.end();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  dht.begin();
  loadConfiguration();
  startProvisioning(); // Keep available for recovery; production can gate this behind a setup button.
  if (!wifiSsid.isEmpty()) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  }
  Serial.printf("EcoChef sensor %s ready\n", DEVICE_CODE);
}

void loop() {
  if (millis() - lastReadingAt >= 30000) {
    lastReadingAt = millis();
    postReading();
  }
  if (millis() - lastStatusAt >= 10000) {
    lastStatusAt = millis();
    Serial.printf("Status: Bluetooth setup active | Wi-Fi %s\n", WiFi.status() == WL_CONNECTED ? "connected" : "not connected");
  }
  if (millis() - lastDiagnosticsAt >= 2000) {
    lastDiagnosticsAt = millis();
    printSensorDiagnostics();
  }
  if (millis() - lastClimateAt >= 2500) {
    lastClimateAt = millis();
    readClimate();
  }
  delay(50);
}
