# Deploy EcoChef on Railway

Railway hosts the API, web portal, PostgreSQL, and the Android APK download. The Android app is built and signed with Expo EAS, then the APK is uploaded to a Railway volume. iOS installation requires TestFlight or the App Store.

## Railway services

Create a Railway project from a Git repository containing this workspace. Add PostgreSQL, an API service, and a web service.

| Service | Root directory | Config file              |
| ------- | -------------- | ------------------------ |
| API     | `/apps/api`    | `/apps/api/railway.json` |
| Web     | `/`            | `/apps/web/railway.json` |

For the web service, keep the repository root so pnpm can read the workspace packages. Set the service's Railway config file path to the value above. Generate public domains for API and web.

On the web service, create a persistent volume mounted at `/app/downloads`. The download route reads `/app/downloads/ecochef.apk`; set `ECOCHEF_ANDROID_APK_PATH` if using another mount path. Open `https://YOUR-WEB-DOMAIN/download` to see the download page.

## Variables

API: Set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `FIREBASE_PROJECT_ID`, `ECOCHEF_ENV=production`, and `ECOCHEF_CORS_ALLOWED_ORIGINS=https://YOUR-WEB-DOMAIN`. Add the relevant Gemini, Geoapify, Stripe, and push variables from `apps/api/.env.example` as those features are enabled. Paste the full Firebase Admin service-account JSON into the secret `FIREBASE_CREDENTIALS_JSON` variable. Do not upload that JSON to GitHub.

For the mobile one-tap test payment button, set `STRIPE_SIMULATED_PAYMENTS_ENABLED=true` and `STRIPE_API_KEY` to a Stripe test key (`sk_test_` or a restricted `rk_test_` key with the required permissions). The button remains unavailable with a live key. These test payments create Stripe test transactions and mark the order paid in EcoChef; they do not charge real money.

Web: Set `NEXT_PUBLIC_API_URL=https://YOUR-API-DOMAIN/api/v1`, `ECOCHEF_API_INTERNAL_URL=https://YOUR-API-DOMAIN/api/v1`, the Firebase web values, and the Stripe publishable key from `apps/web/.env.example`. Public `NEXT_PUBLIC_` values are embedded during the web build, so redeploy after changing them.

The API health endpoint is `https://YOUR-API-DOMAIN/api/v1/health/ready`. Apply the ordered SQL files in `infra/database/migrations` to a new PostgreSQL database before testing application features. Do not run the initial migration against a database with existing user data.

## Android release

1. In Expo EAS, set `EXPO_PUBLIC_API_URL=https://YOUR-API-DOMAIN/api/v1` and the `EXPO_PUBLIC_FIREBASE_*` values in the **preview** environment. The app's local `.env` is not available during a cloud build.
2. From `apps/mobile`, run `eas build --platform android --profile preview`. This profile produces a signed, installable APK. Retain the signing credentials for future updates.
3. Download the APK from EAS and upload it to the web service's Railway volume as `/ecochef.apk` within the volume (mounted in the service at `/app/downloads`) using `railway volume files upload .\\EcoChef.apk /ecochef.apk` or the volume browser.
4. Visit `https://YOUR-WEB-DOMAIN/download` on an Android phone, download the APK, and install it. Android may ask the user to allow installation from the browser.

The web download is a direct distribution path. For broad public Android distribution and automatic store updates, publish the release through Google Play. For iPhone users, build and distribute through TestFlight or the App Store.
