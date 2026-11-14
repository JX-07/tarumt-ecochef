import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device, State, type Subscription } from "react-native-ble-plx";

import type { SensorSetupQr } from "./types";

export const ECOCHEF_PROVISIONING_SERVICE = "7d2b0001-6c62-4b5f-9f2a-6f8c2c9a4100";
export const ECOCHEF_CONFIG_CHARACTERISTIC = "7d2b0002-6c62-4b5f-9f2a-6f8c2c9a4100";
export const ECOCHEF_STATUS_CHARACTERISTIC = "7d2b0003-6c62-4b5f-9f2a-6f8c2c9a4100";

const QR_PREFIX = "ecochef://sensor-setup";

export function parseSensorSetupQr(value: string): SensorSetupQr {
  const parsed = new URL(value);
  if (`${parsed.protocol}//${parsed.host}` !== QR_PREFIX)
    throw new Error("This is not an EcoChef sensor QR code.");
  const version = Number(parsed.searchParams.get("v"));
  const deviceCode = parsed.searchParams.get("code")?.trim().toUpperCase() ?? "";
  const claimSecret = parsed.searchParams.get("secret")?.trim() ?? "";
  const bleName = parsed.searchParams.get("ble")?.trim() ?? "";
  if (version !== 1 || deviceCode.length < 4 || claimSecret.length < 24 || !bleName) {
    throw new Error("This sensor QR code is incomplete or unsupported.");
  }
  return { version: 1, deviceCode, claimSecret, bleName };
}

function bytesToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    result +=
      alphabet[(triple >> 18) & 63] +
      alphabet[(triple >> 12) & 63] +
      (b === undefined ? "=" : alphabet[(triple >> 6) & 63]) +
      (c === undefined ? "=" : alphabet[triple & 63]);
  }
  return result;
}

function base64ToText(value?: string | null): string {
  if (!value) return "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  const clean = value.replace(/=+$/, "");
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) continue;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

async function requestBluetoothPermission(): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 31) return;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  if (Object.values(result).some((value) => value !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error("Bluetooth permission is needed to connect your sensor.");
  }
}

async function waitForPoweredOn(manager: BleManager): Promise<void> {
  if ((await manager.state()) === State.PoweredOn) return;
  await new Promise<void>((resolve, reject) => {
    let subscription: Subscription | undefined;
    const timeout = setTimeout(() => {
      subscription?.remove();
      reject(new Error("Turn on Bluetooth, then try again."));
    }, 10_000);
    subscription = manager.onStateChange((state) => {
      if (state !== State.PoweredOn) return;
      clearTimeout(timeout);
      subscription?.remove();
      resolve();
    }, true);
  });
}

async function findDevice(manager: BleManager, bleName: string): Promise<Device> {
  return new Promise<Device>((resolve, reject) => {
    const timeout = setTimeout(() => {
      manager.stopDeviceScan();
      reject(
        new Error("Sensor not found. Hold its setup button until the light pulses, then retry."),
      );
    }, 10_000);
    // Match the factory BLE name instead of filtering by service UUID. Some ESP32
    // advertising stacks move the 128-bit service UUID into the scan response when
    // the name does not fit in the primary advertising packet, and Android can then
    // omit the device when a service filter is supplied.
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        clearTimeout(timeout);
        manager.stopDeviceScan();
        reject(new Error("EcoChef could not scan for the sensor. Check Bluetooth and try again."));
        return;
      }
      if (device && (device.localName === bleName || device.name === bleName)) {
        clearTimeout(timeout);
        manager.stopDeviceScan();
        resolve(device);
      }
    });
  });
}

async function prepareConnectedDevice(device: Device): Promise<Device> {
  let connected = device;
  if (Platform.OS === "android") {
    // A Wi-Fi result containing a 32-character SSID is larger than the default
    // 20-byte GATT notification payload. Negotiate enough room for one complete
    // JSON result before asking the ESP32 to scan.
    connected = await connected.requestMTU(185).catch(() => connected);
  }
  return connected.discoverAllServicesAndCharacteristics();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export type ProvisioningStatus = "wifi_connecting" | "api_connecting" | "ready";
export type SensorWifiNetwork = { ssid: string; rssi: number; secure: boolean };

export async function scanSensorWifiNetworks(setup: SensorSetupQr): Promise<SensorWifiNetwork[]> {
  await requestBluetoothPermission();
  const manager = new BleManager();
  let device: Device | undefined;
  let monitor: Subscription | undefined;
  try {
    await waitForPoweredOn(manager);
    device = await findDevice(manager, setup.bleName);
    device = await device.connect({ timeout: 15_000 });
    device = await prepareConnectedDevice(device);
    const networks = await new Promise<SensorWifiNetwork[]>((resolve, reject) => {
      const found = new Map<string, SensorWifiNetwork>();
      let networkMessage = "";
      const saveNetwork = (message: string) => {
        if (!message.startsWith("wifi:")) return;
        try {
          const network = JSON.parse(message.slice(5)) as SensorWifiNetwork;
          if (network.ssid) found.set(network.ssid, network);
        } catch {
          /* Ignore a malformed result and continue receiving the scan. */
        }
      };
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "The sensor did not return Wi-Fi networks. Confirm it is powered, flashed with EcoChef firmware and in setup mode.",
            ),
          ),
        25_000,
      );
      monitor = device?.monitorCharacteristicForService(
        ECOCHEF_PROVISIONING_SERVICE,
        ECOCHEF_STATUS_CHARACTERISTIC,
        (error, characteristic) => {
          if (error) {
            clearTimeout(timeout);
            reject(new Error("Bluetooth connection to the sensor was lost."));
            return;
          }
          const message = base64ToText(characteristic?.value);
          if (message.startsWith("wifi:")) {
            saveNetwork(message);
          } else if (message.startsWith("wifi_part:")) {
            networkMessage += message.slice(10);
          } else if (message === "wifi_end") {
            saveNetwork(networkMessage);
            networkMessage = "";
          }
          if (message === "wifi_scan_done") {
            clearTimeout(timeout);
            resolve([...found.values()].sort((left, right) => right.rssi - left.rssi));
          }
        },
      );
      // Give Android time to finish enabling notifications (the CCCD write)
      // before the ESP32 starts sending scan results.
      void wait(300)
        .then(() =>
          device?.writeCharacteristicWithResponseForService(
            ECOCHEF_PROVISIONING_SERVICE,
            ECOCHEF_CONFIG_CHARACTERISTIC,
            bytesToBase64(`${JSON.stringify({ v: 1, action: "scan_wifi" })}\n`),
          ),
        )
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
    return networks;
  } finally {
    monitor?.remove();
    if (device) await device.cancelConnection().catch(() => undefined);
    manager.destroy();
  }
}

export async function provisionSensor(
  setup: SensorSetupQr,
  config: { ssid: string; password: string; readingUrl: string; sensorKey: string },
  onStatus: (status: ProvisioningStatus) => void,
): Promise<void> {
  await requestBluetoothPermission();
  const manager = new BleManager();
  let device: Device | undefined;
  let monitor: Subscription | undefined;
  try {
    await waitForPoweredOn(manager);
    device = await findDevice(manager, setup.bleName);
    device = await device.connect({ timeout: 15_000 });
    device = await prepareConnectedDevice(device);
    const completion = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "The sensor did not finish connecting. Check the Wi-Fi password and try again.",
            ),
          ),
        60_000,
      );
      monitor = device?.monitorCharacteristicForService(
        ECOCHEF_PROVISIONING_SERVICE,
        ECOCHEF_STATUS_CHARACTERISTIC,
        (error, characteristic) => {
          if (error) {
            clearTimeout(timeout);
            reject(new Error("Bluetooth connection to the sensor was lost."));
            return;
          }
          const status = base64ToText(characteristic?.value) as
            ProvisioningStatus | `error:${string}`;
          if (status.startsWith("error:")) {
            clearTimeout(timeout);
            reject(new Error(status.slice(6) || "The sensor could not connect."));
            return;
          }
          if (status === "wifi_connecting" || status === "api_connecting") onStatus(status);
          if (status === "ready") {
            clearTimeout(timeout);
            onStatus(status);
            resolve();
          }
        },
      );
    });
    const payload = `${JSON.stringify({ v: 1, ...config })}\n`;
    // BLE writes are deliberately chunked so provisioning works before MTU negotiation on both platforms.
    for (let offset = 0; offset < payload.length; offset += 120) {
      await device.writeCharacteristicWithResponseForService(
        ECOCHEF_PROVISIONING_SERVICE,
        ECOCHEF_CONFIG_CHARACTERISTIC,
        bytesToBase64(payload.slice(offset, offset + 120)),
      );
    }
    await completion;
  } finally {
    monitor?.remove();
    if (device) await device.cancelConnection().catch(() => undefined);
    manager.destroy();
  }
}
