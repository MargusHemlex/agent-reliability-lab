import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// This experiment relies on pinned, source-observed ownership semantics.
// Refuse a changed runtime instead of silently assuming those semantics persist.
const files = {
  "dist/src/compiled/_chunks/workflow/helpers-DlLD3ov_.js":
    "747627feb4fc23f0bd998d2f4ca42969b6681380ded6d57fef3dd6fe5ca14903",
  "dist/src/compiled/@workflow/core/runtime.js":
    "4422b829266cd9daf01d5a9b861aa5dbccf3c1a0a3ab8398da85e60e74d5397e",
  "dist/src/compiled/@workflow/world-local/index.js":
    "2b049eae015887730a6b92a0fd00fd1cb099543859ed9f7490a377c1bae1a516",
};
export async function assertRuntimeCompatibility(root) {
  const base = join(root, "node_modules/eve");
  const version = JSON.parse(
    await readFile(join(base, "package.json"), "utf8"),
  ).version;
  assert.equal(
    version,
    "0.80.1",
    "Runtime version requires a new compatibility review",
  );
  const hashes = {};
  for (const [relative, expected] of Object.entries(files)) {
    const actual = createHash("sha256")
      .update(await readFile(join(base, relative)))
      .digest("hex");
    assert.equal(
      actual,
      expected,
      `Runtime bytes require a new compatibility review: ${relative}`,
    );
    hashes[relative] = actual;
  }
  return { version, hashes };
}
