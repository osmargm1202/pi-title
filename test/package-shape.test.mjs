import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package is a Pi extension scaffold", () => {
  assert.equal(pkg.name, "pi-title");
  assert.deepEqual(pkg.pi.extensions, ["./extensions/title.ts"]);
  assert.ok(pkg.peerDependencies["@earendil-works/pi-coding-agent"]);
});
