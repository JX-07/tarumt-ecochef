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

function bytesToBase64(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
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

function base64ToBytes(value?: string | null): Uint8Array {
  if (!value) return new Uint8Array();
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
  return new Uint8Array(bytes);
}

function base64ToText(value?: string | null): string {
  return new TextDecoder().decode(base64ToBytes(value));
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
        new Error(
          "Sensor not found. Power-cycle the ESP32, close other Bluetooth apps and try again.",
        ),
      );
    }, 15_000);
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
      const advertisesEcoChefService = device?.serviceUUIDs?.some(
        (uuid) => uuid.toLowerCase() === ECOCHEF_PROVISIONING_SERVICE,
      );
      if (
        device &&
        (device.localName === bleName || device.name === bleName || advertisesEcoChefService)
      ) {
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
  try {
    await waitForPoweredOn(manager);
    device = await findDevice(manager, setup.bleName);
    device = await device.connect({ timeout: 15_000 });
    device = await prepareConnectedDevice(device);
    await device.writeCharacteristicWithResponseForService(
      ECOCHEF_PROVISIONING_SERVICE,
      ECOCHEF_CONFIG_CHARACTERISTIC,
      bytesToBase64("S\n"),
    );
    let count: number | undefined;
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = base64ToText(
        (
          await device.readCharacteristicForService(
            ECOCHEF_PROVISIONING_SERVICE,
            ECOCHEF_STATUS_CHARACTERISTIC,
          )
        ).value,
      );
      const match = /^wifi_scan_ready:(\d+)$/.exec(status);
      if (match) {
        count = Number(match[1]);
        break;
      }
      if (status.startsWith("error:")) {
        const detail = status.slice(6);
        if (/^Invalid setup data\.?$/i.test(detail)) {
          throw new Error(
            "This ESP32 has older EcoChef firmware. Flash the latest ecochef_sensor.ino (Wi-Fi protocol v3), then try again.",
          );
        }
        throw new Error(detail);
      }
      await wait(500);
    }
    if (count === undefined || count > 16) {
      throw new Error("The sensor did not return a Wi-Fi scan. Flash the latest EcoChef firmware.");
    }
    const found = new Map<string, SensorWifiNetwork>();
    for (let index = 0; index < count; index++) {
      const bytes: number[] = [];
      let complete = false;
      for (let part = 0; part < 32; part++) {
        const offset = bytes.length;
        await device.writeCharacteristicWithResponseForService(
          ECOCHEF_PROVISIONING_SERVICE,
          ECOCHEF_CONFIG_CHARACTERISTIC,
          bytesToBase64(`G${index},${offset}\n`),
        );
        const prefix = `W${index},${offset}:`;
        let response: Uint8Array | undefined;
        for (let attempt = 0; attempt < 10; attempt++) {
          const characteristic = await device.readCharacteristicForService(
            ECOCHEF_PROVISIONING_SERVICE,
            ECOCHEF_STATUS_CHARACTERISTIC,
          );
          const value = base64ToBytes(characteristic.value);
          const marker = new TextDecoder().decode(value.slice(0, prefix.length));
          if (marker === prefix || new TextDecoder().decode(value) === `E${index},${offset}`) {
            response = value;
            break;
          }
          await wait(50);
        }
        if (!response) throw new Error("A Wi-Fi result was not returned over Bluetooth.");
        if (new TextDecoder().decode(response) === `E${index},${offset}`) {
          complete = true;
          break;
        }
        const payload = response.slice(prefix.length);
        if (!payload.length) throw new Error("An empty Wi-Fi result was returned over Bluetooth.");
        bytes.push(...payload);
      }
      if (!complete) throw new Error("A Wi-Fi result was incomplete over Bluetooth.");
      try {
        const network = JSON.parse(
          new TextDecoder().decode(new Uint8Array(bytes)),
        ) as SensorWifiNetwork;
        if (
          typeof network.ssid !== "string" ||
          !network.ssid ||
          typeof network.rssi !== "number" ||
          !Number.isFinite(network.rssi) ||
          typeof network.secure !== "boolean"
        ) {
          throw new Error("Invalid Wi-Fi result");
        }
        found.set(network.ssid, network);
      } catch {
        throw new Error("A Wi-Fi result was corrupted over Bluetooth. Try scanning again.");
      }
    }
    return [...found.values()].sort((left, right) => right.rssi - left.rssi);
  } finally {
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
    const payloadBytes = new TextEncoder().encode(payload);
    // Allow Android to enable notifications before the ESP32 reports connection status.
    await wait(300);
    // The 20-byte chunks also work when MTU negotiation falls back to the BLE minimum.
    for (let offset = 0; offset < payloadBytes.length; offset += 20) {
      await device.writeCharacteristicWithResponseForService(
        ECOCHEF_PROVISIONING_SERVICE,
        ECOCHEF_CONFIG_CHARACTERISTIC,
        bytesToBase64(payloadBytes.slice(offset, offset + 20)),
      );
    }
    await completion;
  } finally {
    monitor?.remove();
    if (device) await device.cancelConnection().catch(() => undefined);
    manager.destroy();
  }
}
