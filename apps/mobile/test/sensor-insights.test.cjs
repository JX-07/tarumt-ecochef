const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/features/fridge-sensors/sensor-insights.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRef = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => {
    if (name === "@ecochef/design-tokens")
      return { colors: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(`Unexpected import: ${name}`);
  },
  moduleRef,
  moduleRef.exports,
);
const { createGasCalibration, gasChannelReference, gasTrendInsight } = moduleRef.exports;

function readings(lastValues = {}, spike = false) {
  const start = Date.parse("2026-11-16T00:00:00Z");
  return Array.from({ length: 70 }, (_, index) => ({
    captured_at: new Date(start + index * 60_000).toISOString(),
    mq3: index >= 50 ? (lastValues.mq3 ?? 200) : 200,
    mq135: index >= 50 ? (lastValues.mq135 ?? 200) : 200,
    mq136: index >= 50 ? (lastValues.mq136 ?? 200) : 200,
    mq137: index >= 50 ? (lastValues.mq137 ?? 200) : 200,
    ...(spike && index === 69 ? { mq3: 800 } : {}),
  }));
}

test("waits for enough history before comparing gas channels", () => {
  assert.equal(gasTrendInsight(readings().slice(0, 10)).kind, "collecting");
});

test("does not treat one isolated spike as a sustained change", () => {
  assert.equal(gasTrendInsight(readings({}, true)).kind, "steady");
});

test("reports one consistently rising channel separately", () => {
  assert.deepEqual(gasTrendInsight(readings({ mq3: 320 })), {
    kind: "single_change",
    channels: ["MQ-3"],
  });
});

test("reports multiple sustained rises for a fridge check", () => {
  assert.deepEqual(gasTrendInsight(readings({ mq3: 320, mq136: 330 })), {
    kind: "multiple_changes",
    channels: ["MQ-3", "MQ-136"],
  });
});

test("uses the same baseline and rise guide shown on the MQ scale", () => {
  const samples = readings({ mq3: 320, mq136: 330 });
  assert.deepEqual(gasChannelReference(samples, "mq3"), {
    baseline: 200,
    current: 320,
    riseAt: 250,
  });
  assert.deepEqual(gasTrendInsight(samples).channels, ["MQ-3", "MQ-136"]);
});

test("ignores a stuck zero channel", () => {
  const samples = readings({ mq3: 320, mq136: 330 });
  for (const sample of samples) sample.mq135 = 0;
  assert.deepEqual(gasTrendInsight(samples).channels, ["MQ-3", "MQ-136"]);
});

test("creates a quick calibration from six recent readings", () => {
  const samples = readings().slice(0, 6);
  assert.deepEqual(createGasCalibration(samples), {
    capturedAt: samples[5].captured_at,
    channels: {
      mq3: { baseline: 200, variation: 0 },
      mq135: { baseline: 200, variation: 0 },
      mq136: { baseline: 200, variation: 0 },
      mq137: { baseline: 200, variation: 0 },
    },
  });
});

test("requires three readings after calibration before warning", () => {
  const samples = readings({ mq3: 320, mq136: 330 });
  const calibration = createGasCalibration(samples.slice(0, 6));
  assert.equal(gasTrendInsight(samples.slice(0, 8), calibration).kind, "collecting");
  assert.deepEqual(gasTrendInsight(samples, calibration), {
    kind: "multiple_changes",
    channels: ["MQ-3", "MQ-136"],
  });
});
