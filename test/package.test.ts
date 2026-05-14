import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("package exposes a single Pi extension entry", () => {
  assert.deepEqual(pkg.pi.extensions, ["./src/index.ts"]);
});

test("package stays a thin adapter with only peer Pi runtime dependencies", () => {
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies["@earendil-works/pi-ai"], "*");
  assert.equal(pkg.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(pkg.peerDependencies["@earendil-works/pi-tui"], "*");
  assert.equal(pkg.peerDependencies.typebox, "*");
});
