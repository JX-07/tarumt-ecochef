export function marketplaceImageUrl(value: string | undefined, apiBaseUrl: string) {
  if (!value) return undefined;
  const apiOrigin = apiBaseUrl.replace(/\/api\/v1\/?$/i, "").replace(/\/$/, "");
  try {
    const parsed = new URL(value);
    if (parsed.pathname.includes("/api/v1/vendor/product-images/")) {
      return `${apiOrigin}${parsed.pathname}${parsed.search}`;
    }
    return value;
  } catch {
    return `${apiOrigin}/${value.replace(/^\//, "")}`;
  }
}
