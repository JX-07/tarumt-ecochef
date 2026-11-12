# IoT Gateway

## Customer setup

Production units are factory registered with `tools/create_device_identity.py`. The resulting QR label
contains a one-time claim secret; the API stores only its SHA-256 hash. The mobile app scans that label,
claims the unit for the signed-in customer, and sends Wi-Fi/API credentials directly to the ESP32 over
BLE using the service and characteristics documented in `firmware/ecochef_sensor/ecochef_sensor.ino`.

Customers never type a device code or see the readings URL/private key. The manual HTTP contract below
is retained only for firmware development and diagnostics. BLE support requires an Expo development
build (`pnpm dev:mobile-client`), because Expo Go cannot load `react-native-ble-plx`.

Before manufacturing or local hardware testing:

1. Apply database migration `0051_sensor_provisioning.sql`.
2. Generate a factory identity and QR payload.
3. Put its device code and BLE name into the firmware build for that unit.
4. Flash the firmware and print the generated QR payload on the enclosure or quick-start card.

## Firmware diagnostics

EcoChef's mobile pairing flow creates a private ingestion key for each ESP32 electronic nose.
Send readings to the URL shown after pairing:

```http
POST /api/v1/fridge-sensors/readings
Content-Type: application/json
X-Sensor-Key: <one-time key shown in the mobile app>

{
  "mq3": 912,
  "mq135": 744,
  "mq136": 318,
  "mq137": 405,
  "temperature_c": 4.8,
  "humidity_percent": 71.2,
  "freshness_status": "unknown",
  "confidence": null,
  "model_version": null
}
```

The API stores raw readings without claiming that they are ppm measurements. A compatible inference
gateway may populate `freshness_status`, `confidence`, and `model_version`. EcoChef creates a spoilage
alert only after two `spoiled` results at confidence >= 0.85 within 30 minutes.

The current artifact produced by `services/ai_training/train.cmd run enose` was trained on MQ2, MQ3,
MQ4, MQ5, MQ135, MQ136, temperature and humidity. It must not be applied directly to the new
MQ3/MQ135/MQ136/MQ137 hardware vector. Collect and label matching recordings, regenerate
`enose_spoilage.csv`, and retrain before emitting model classifications. Until then, send `unknown`
and use the app for transparent live monitoring and data collection.

MQ sensors are cross-sensitive screening devices. They cannot identify pathogens or establish that
food is safe to eat.
