import { NextRequest } from "next/server";

const apiBaseUrl = () => (
  process.env.ECOCHEF_API_INTERNAL_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? "http://127.0.0.1:8000/api/v1"
).replace(/\/$/, "");

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");
  if (authorization) headers.set("authorization", authorization);
  if (contentType) headers.set("content-type", contentType);

  try {
    const response = await fetch(`${apiBaseUrl()}/${path.join("/")}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    });
    const responseHeaders = new Headers();
    const responseContentType = response.headers.get("content-type");
    if (responseContentType) responseHeaders.set("content-type", responseContentType);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json(
      {
        error: "api_unavailable",
        message: "The EcoChef API is unavailable. Check that the API server is running.",
        details: null,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
