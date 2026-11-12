export function recipeImageUrl(
  value: string | null | undefined,
  apiBaseUrl: string,
) {
  if (!value) return undefined;
  const marker = "/api/v1/recipes/images/";
  if (!value.includes(marker)) return value;
  return `${apiBaseUrl.replace(/\/$/, "")}/recipes/images/${value.split(marker)[1]}`;
}
