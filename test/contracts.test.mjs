import test from "node:test";
import assert from "node:assert/strict";
import {
  ActionSchema,
  ResolutionSchema,
  payloadDigest,
  proposalDigest,
} from "../agent/lib/lab/contracts.ts";
import { assertFixtureTools } from "../agent/lib/lab/fixture-model.ts";
const action = {
  deliveryId: "delivery-001",
  kind: "request_update",
  note: "Please provide a delivery update.",
};
test("authorization refresh preserves payload identity but changed context does not", () => {
  const r = ResolutionSchema.parse({
    key: "key",
    runId: "run",
    proposalDigest: proposalDigest("run", action, 1, 1),
    action,
    expectedRevision: 1,
    policyVersion: 1,
    epoch: 1,
    expiresAt: 100,
  });
  assert.equal(
    payloadDigest(r),
    payloadDigest({ ...r, epoch: 2, expiresAt: 200 }),
  );
  assert.notEqual(
    payloadDigest(r),
    payloadDigest({ ...r, expectedRevision: 2 }),
  );
  assert.equal(
    ActionSchema.safeParse({ ...action, note: "Send a real payment" }).success,
    false,
  );
});
test("fixture refuses any extra shell, provider or hidden tool", () => {
  const permitted = [
    "get_delivery",
    "get_resolution_policy",
    "record_resolution",
  ].map((name) => ({ type: "function", name }));
  assert.doesNotThrow(() => assertFixtureTools(permitted));
  assert.throws(() =>
    assertFixtureTools([...permitted, { type: "function", name: "bash" }]),
  );
  assert.throws(() =>
    assertFixtureTools([
      ...permitted,
      { type: "provider", name: "web_search" },
    ]),
  );
  assert.throws(() => assertFixtureTools(permitted.slice(1)));
});

import { validateLimits } from "../agent/lib/lab/limits.ts";
test("unknown inherited limit names cannot enter run configuration", () => {
  for (const key of ["constructor", "toString", "__proto__"])
    assert.throws(
      () => validateLimits(JSON.parse(`{"${key}":1}`)),
      /unknown limit/,
    );
});
