import Link from "next/link";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

export const dynamic = "force-dynamic";

export default async function DownloadPage() {
  const apkPath = process.env.ECOCHEF_ANDROID_APK_PATH || "/app/downloads/ecochef.apk";
  const available = await access(apkPath, constants.R_OK)
    .then(() => true)
    .catch(() => false);

  return (
    <main className="app-download-page">
      <h1>Get EcoChef</h1>
      <p>Install EcoChef on your Android phone to manage your food and recipes.</p>
      {available ? (
        <a href="/download/android" className="app-download-button">
          Download Android app
        </a>
      ) : (
        <p>The Android download is being prepared. Please check back soon.</p>
      )}
      <p>After downloading, open the APK on your Android phone and follow the install prompts.</p>
      <p>iPhone installation requires an App Store or TestFlight release.</p>
      <Link href="/login">Open the web portal</Link>
    </main>
  );
}
