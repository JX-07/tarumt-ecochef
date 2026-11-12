import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checker = fileURLToPath(new URL("./check-theme-usage.mjs", import.meta.url));
const runFixture = (files) => {
  const tempParent = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempParent, "ecochef-theme-check-"));
  try {
    const fixture = { "packages/design-tokens/tokens.css": ":root { --ec-font-sans: Arial; --ec-color-text: #173c39; }", ...files };
    for (const [name, source] of Object.entries(fixture)) {
      const file = path.join(directory, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
    }
    return spawnSync(process.execPath, [checker], { cwd: directory, encoding: "utf8" });
  } finally {
    // Delete only the task-created fixture, never a computed parent directory.
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), tempParent);
    assert.ok(path.basename(resolved).startsWith("ecochef-theme-check-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};

test("accepts shared typography and CSS tokens", () => {
  const result = runFixture({
    "apps/mobile/src/example.tsx": `import { Text } from "./shared/components/themed-text"; const style = { fontSize: typography.mobile.size.caption, fontWeight: typography.weight.bold };`,
    "apps/web/app/styles.css": `body { font-family: var(--ec-font-sans); font-size: var(--ec-font-sans); font-weight: inherit; color: var(--ec-color-text); }`,
    "apps/web/src/example.tsx": `const style = { fontFamily: "var(--ec-font-sans)" }; const pdfColor = rgb(colors.text);`,
  });
  assert.equal(result.status, 0, result.stderr);
});

for (const [description, file, source, expected] of [
  ["inline web font size", "apps/web/src/example.tsx", `const style = { fontSize: 14 };`, "literal font size"],
  ["multiline mobile font family", "apps/mobile/src/example.ts", `const style = { fontFamily:\n "Other Font" };`, "literal font family"],
  ["named font weight", "apps/web/app/example.tsx", `const style = { fontWeight: "bold" };`, "literal font weight"],
  ["fractional CSS font size", "apps/web/app/example.css", `p { font-size: .875rem; }`, "literal CSS font size"],
  ["CSS line height", "apps/web/app/example.css", `p { line-height: 1.5; }`, "literal CSS line height"],
  ["native text import in TS", "apps/mobile/src/example.ts", `import { Text as Body } from "react-native";`, "shared themed Text/TextInput"],
  ["native text through namespace", "apps/mobile/src/example.tsx", `import * as Native from "react-native"; const text = <Native.Text />;`, "shared themed Text/TextInput"],
  ["SVG font size prop", "apps/web/app/example.tsx", `const chart = <text fontSize={12} />;`, "literal font size prop"],
  ["HSL color", "apps/mobile/src/example.ts", `const style = { color: "hsl(150, 50%, 30%)" };`, "raw color"],
  ["undefined web src token", "apps/web/src/example.tsx", `const style = { color: "var( --ec-missing)" };`, "undefined token --ec-missing"],
  ["undefined token alias", "packages/design-tokens/tokens.css", `:root { --ec-color-text: var(--ec-missing); }`, "undefined token --ec-missing"],
]) {
  test(`rejects ${description}`, () => {
    const result = runFixture({ [file]: source });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(expected), result.stderr);
    assert.ok(result.stderr.includes(file.replaceAll("/", path.sep)), result.stderr);
  });
}

test("ignores generated output and allows the shared native wrapper", () => {
  const result = runFixture({
    "apps/mobile/.expo-export-check/example.tsx": `const style = { color: "#fff", fontSize: 14 };`,
    "apps/web/app/node_modules/library/example.ts": `const style = { fontSize: 14 };`,
    "apps/mobile/src/shared/components/themed-text.tsx": `import { Text as NativeText } from "react-native"; const style = { fontFamily: Platform.select(typography.nativeFontFamily) };`,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("rejects source containing invalid UTF-8 instead of silently replacing bytes", () => {
  const result = runFixture({
    "apps/mobile/src/example.tsx": Buffer.from([0x63, 0x6f, 0x6e, 0x73, 0x74, 0x20, 0x96]),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.includes("invalid UTF-8"), result.stderr);
});
