import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "../apps/mobile/node_modules/typescript/lib/typescript.js";

const source = fs.readFileSync(new URL("../apps/mobile/src/lib/api.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client(payload, status = 500) {
  const context = vm.createContext({ exports: {}, nativeReceiver: true, fetch: async function () {
    assert.equal(this.nativeReceiver, true);
    return { ok: status < 400, status, json: async () => payload };
  } });
  vm.runInContext(code, context);
  return context.exports.createMobileApi("http://example.test/api/v1", () => "test-token");
}

test("object-shaped server error details preserve the server message", async () => {
  await assert.rejects(client({ message: "An unexpected error occurred.", details: { request_id: "test-id" } }).getMarketplaceStores(), { message: "An unexpected error occurred." });
});
test("array-shaped validation errors remain readable", async () => {
  await assert.rejects(client({ details: [{ loc: ["query", "search"], msg: "Too long" }] }, 422).getMarketplaceStores(), { message: "search: Too long" });
});
test("successful marketplace requests preserve the native fetch receiver", async () => {
  const payload = { stores: [], total: 0 };
  assert.equal(await client(payload, 200).getMarketplaceStores(), payload);
});
