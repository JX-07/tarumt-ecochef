import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const apkPath = process.env.ECOCHEF_ANDROID_APK_PATH || "/app/downloads/ecochef.apk";
  try {
    const file = await stat(apkPath);
    if (!file.isFile()) return new Response("Android app is not available yet.", { status: 404 });
    const stream = Readable.toWeb(createReadStream(apkPath)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": 'attachment; filename="EcoChef.apk"',
        "Content-Length": String(file.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return new Response("Android app is not available yet.", { status: 404 });
    }
    throw error;
  }
}
