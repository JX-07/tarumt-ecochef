# Mobile App

Consumer-facing Expo Router and TypeScript application. Route declarations stay in `app/`; implementation belongs in `src/features`.

EC-008 provides an auth-gated shell: `(auth)` contains sign-in routes and `(tabs)` contains the signed-in consumer destinations. Configure Firebase using `EXPO_PUBLIC_FIREBASE_*` values before running `pnpm dev:mobile`.

The app is pinned to Expo SDK 58. From the repository root, `pnpm dev:mobile` clears Metro's cache and starts the project for Expo Go. Use `pnpm dev:mobile-client` with an installed development build when testing native Speaking Mode or remote push notifications; those native capabilities are not available in Expo Go.

## Fridge Sensor notifications

Set `EXPO_PUBLIC_EAS_PROJECT_ID` in `apps/mobile/.env`, configure Android/iOS push credentials for that EAS project, and rebuild after adding the `expo-notifications` plugin. When a signed-in user has at least one paired sensor, the app requests notification permission and registers its Expo push token with the EcoChef API. `EXPO_PUSH_ACCESS_TOKEN` is required by the API only when enhanced push security is enabled for the Expo project.

## Sensor provisioning development build

QR scanning uses `expo-camera`; automatic ESP32 setup uses the native `react-native-ble-plx` module.
Expo Go cannot load that BLE module. After dependency or plugin changes, rebuild the development client:

```powershell
pnpm --filter @ecochef/mobile android
pnpm --filter @ecochef/mobile dev:client
```

The customer setup flow intentionally does not display the readings URL or sensor key. Factory identity
creation and the BLE firmware protocol live under `services/iot_gateway`.

### Android emulator API connection

If the emulator cannot reach `10.0.2.2:8000`, forward the API port over ADB:

```powershell
& "$env:LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" reverse tcp:8000 tcp:8000
```

Set `EXPO_PUBLIC_API_URL=http://127.0.0.1:8000/api/v1` in `apps/mobile/.env`, then reload Expo. Restart Expo with `--clear` if the login connection check still displays the old address. The API must be running on the computer. Repeat the ADB command after restarting the emulator. Physical devices require their own forwarding or a reachable LAN address.
