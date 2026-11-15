const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/features/fridge-sensors/provisioning.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function createScanner(networks, corrupt = false, legacy = false) {
  const results = networks.map((network) => Buffer.from(JSON.stringify(network), "utf8"));
  let status = Buffer.from("idle");
  const device = {
    name: "EcoChef-F57630",
    async connect() {
      return this;
    },
    async requestMTU() {
      return this;
    },
    async discoverAllServicesAndCharacteristics() {
      return this;
    },
    async cancelConnection() {},
    async writeCharacteristicWithResponseForService(_service, _characteristic, value) {
      const command = Buffer.from(value, "base64").toString("utf8").trim();
      if (command === "S") {
        status = Buffer.from(
          legacy ? "error:Invalid setup data." : `wifi_scan_ready:${results.length}`,
        );
      } else {
        const match = /^G(\d+),(\d+)$/.exec(command);
        assert.ok(match, `Unexpected command: ${command}`);
        const index = Number(match[1]);
        const offset = Number(match[2]);
        const prefix = `W${index},${offset}:`;
        const result = results[index];
        status =
          offset >= result.length
            ? Buffer.from(`E${index},${offset}`)
            : Buffer.concat([
                Buffer.from(prefix),
                result.subarray(offset, offset + 20 - prefix.length),
              ]);
        if (corrupt && index === 0 && offset === 0) status[prefix.length] = 0xff;
        assert.ok(status.length <= 20);
      }
      return this;
    },
    async readCharacteristicForService() {
      return { value: status.toString("base64") };
    },
  };
  class BleManager {
    async state() {
      return "PoweredOn";
    }
    startDeviceScan(_services, _options, callback) {
      callback(null, device);
    }
    stopDeviceScan() {}
    destroy() {}
  }
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => {
      if (name === "react-native")
        return {
          Platform: { OS: "android", Version: 35 },
          PermissionsAndroid: {
            PERMISSIONS: { BLUETOOTH_SCAN: "scan", BLUETOOTH_CONNECT: "connect" },
            RESULTS: { GRANTED: "granted" },
            async requestMultiple() {
              return { scan: "granted", connect: "granted" };
            },
          },
        };
      if (name === "react-native-ble-plx") return { BleManager, State: { PoweredOn: "PoweredOn" } };
      throw new Error(`Unexpected import: ${name}`);
    },
    module,
    module.exports,
  );
  return module.exports.scanSensorWifiNetworks({ bleName: "EcoChef-F57630" });
}

test("pulls and displays 16 Wi-Fi networks including split UTF-8 names", async () => {
  const networks = Array.from({ length: 16 }, (_, index) => ({
    ssid: `Kitchen-网络-${index}-long-name`,
    rssi: -80 + index,
    secure: true,
  }));
  const actual = await createScanner(networks);
  assert.equal(actual.length, 16);
  assert.deepEqual(actual, [...networks].reverse());
});

test("only reports an empty list when the sensor reports zero results", async () => {
  assert.deepEqual(await createScanner([]), []);
});

test("rejects a damaged BLE result instead of displaying zero networks", async () => {
  await assert.rejects(
    createScanner([{ ssid: "Kitchen", rssi: -50, secure: true }], true),
    /corrupted over Bluetooth/,
  );
});

test("identifies firmware that does not understand the v3 scan command", async () => {
  await assert.rejects(createScanner([], false, true), /older EcoChef firmware/);
});
