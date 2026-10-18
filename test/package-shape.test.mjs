import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package exposes the ORGM title Pi extension", () => {
  assert.equal(pkg.name, "pi-title");
  assert.deepEqual(pkg.pi.extensions, ["./extensions/title.ts"]);
  for (const host of ["pi-agent-core", "pi-ai", "pi-coding-agent"]) {
    const name = `@earendil-works/${host}`;
    assert.equal(pkg.peerDependencies[name], "*", `${name} stays host-provided at runtime`);
    assert.equal(pkg.devDependencies[name], "1.3.0", `${name} is tested against exactly Pi 1.3.0`);
    assert.equal(pkg.dependencies?.[name], undefined, `${name} must not be bundled`);
  }
});
