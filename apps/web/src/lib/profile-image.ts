const key = (role: "business" | "admin") => `ecochef.${role}.profile-image`;

export const profileImageEvent = (role: "business" | "admin") =>
  `ecochef:${role}-profile-image-updated`;

export function loadProfileImage(role: "business" | "admin") {
  return typeof window === "undefined" ? null : window.localStorage.getItem(key(role));
}

export function saveProfileImage(role: "business" | "admin", value: string) {
  window.localStorage.setItem(key(role), value);
  window.dispatchEvent(new CustomEvent(profileImageEvent(role), { detail: value }));
}

export async function prepareProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, or WebP image.");
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The profile image could not be read."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("The selected image could not be opened."));
    next.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The profile image could not be prepared.");
  const size = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(
    image,
    (image.naturalWidth - size) / 2,
    (image.naturalHeight - size) / 2,
    size,
    size,
    0,
    0,
    256,
    256,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}
