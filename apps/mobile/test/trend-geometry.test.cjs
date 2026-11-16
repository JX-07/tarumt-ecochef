const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/features/fridge-sensors/components/trend-geometry.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRef = { exports: {} };
new Function("require", "module", "exports", compiled)(require, moduleRef, moduleRef.exports);
const { timePosition } = moduleRef.exports;

test("places readings by time across the selected 24-hour window", () => {
  const end = Date.parse("2026-11-16T01:25:00Z");
  const start = end - 24 * 60 * 60_000;
  const firstReading = "2026-11-16T00:13:00Z";
  assert.equal(timePosition(new Date(start).toISOString(), start, end), 0);
  assert.equal(timePosition(new Date(end).toISOString(), start, end), 1);
  assert.ok(timePosition(firstReading, start, end) > 0.9);
});

test("clamps readings outside the selected window", () => {
  const end = Date.parse("2026-11-16T01:25:00Z");
  const start = end - 6 * 60 * 60_000;
  assert.equal(timePosition("2026-11-15T00:00:00Z", start, end), 0);
  assert.equal(timePosition("2026-11-17T00:00:00Z", start, end), 1);
});
