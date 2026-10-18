import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  launch,
  runtimeEnvironment,
  diagnostic,
  withCleanup,
} from "./fixture-process.mjs";

test("only the explicit Electron runtime flag is forwarded", () => {
  assert.deepEqual(
    runtimeEnvironment({
      ELECTRON_RUN_AS_NODE: "1",
      AI_GATEWAY_API_KEY: "sentinel",
      NODE_OPTIONS: "--inspect",
      ARL_LIVE_OPT_IN: "1",
    }),
    { ELECTRON_RUN_AS_NODE: "1" },
  );
  assert.deepEqual(runtimeEnvironment({ ELECTRON_RUN_AS_NODE: "0" }), {});
});

test("early child exit is actionable and arbitrary child secrets are never emitted", async () => {
  const secret = "sentinel-not-a-recognizable-key";
  const h = launch(
    process.execPath,
    [
      "-e",
      `console.error('${secret} Authorization: Bearer hidden'); process.exit(17)`,
    ],
    process.cwd(),
    runtimeEnvironment(),
    "sandbox startup",
  );
  await once(h.child, "close");
  let error;
  try {
    h.assertRunning();
  } catch (e) {
    error = e;
  }
  assert.ok(error);
  const output = diagnostic(error, "scenario");
  assert.equal(JSON.parse(output).exitCode, 17);
  assert.equal(JSON.parse(output).phase, "sandbox startup");
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes("Bearer"));
});

test("spawn failure retains safe error code without command or secrets", async () => {
  const h = launch(
    "/nonexistent/sentinel-secret",
    [],
    process.cwd(),
    {},
    "sandbox startup",
  );
  await new Promise((resolve) => h.child.once("close", resolve));
  assert.throws(
    () => h.assertRunning(),
    (error) => {
      const output = diagnostic(error, "scenario");
      assert.equal(JSON.parse(output).code, "ENOENT");
      assert.ok(!output.includes("sentinel-secret"));
      return true;
    },
  );
});

test("scenario error survives cleanup failure and both diagnostics exclude unknown secrets", async () => {
  const original = new Error("unknown-secret api_key=another-secret");
  const emitted = [];
  await assert.rejects(
    withCleanup(
      async () => {
        throw original;
      },
      async () => {
        throw new Error("cleanup-secret");
      },
      (e, p) => emitted.push(diagnostic(e, p)),
    ),
    (e) => e === original,
  );
  emitted.push(diagnostic(original, "scenario"));
  assert.equal(emitted.length, 2);
  assert.ok(!emitted.join("").includes("secret"));
  assert.equal(JSON.parse(emitted[0]).phase, "cleanup");
});

test("isolated child does not receive parent secrets or runtime injection", async () => {
  const parent = {
    ELECTRON_RUN_AS_NODE: "1",
    AI_GATEWAY_API_KEY: "sentinel-api",
    ARL_OPERATOR_SECRET: "sentinel-operator",
    NODE_OPTIONS: "--inspect",
    ARL_LIVE_OPT_IN: "1",
  };
  const h = launch(
    process.execPath,
    [
      "-e",
      "process.exit(process.env.ELECTRON_RUN_AS_NODE === '1' && !process.env.AI_GATEWAY_API_KEY && !process.env.ARL_OPERATOR_SECRET && !process.env.NODE_OPTIONS && !process.env.ARL_LIVE_OPT_IN ? 0 : 9)",
    ],
    process.cwd(),
    runtimeEnvironment(parent),
    "sandbox startup",
  );
  await once(h.child, "close");
  assert.equal(h.child.exitCode, 0);
});

test("successful action cannot hide cleanup failure", async () => {
  const error = new Error("cleanup private payload");
  let reported = false;
  await assert.rejects(
    withCleanup(
      async () => 1,
      async () => {
        throw error;
      },
      () => {
        reported = true;
      },
    ),
    (e) => e === error,
  );
  assert.ok(reported);
});
