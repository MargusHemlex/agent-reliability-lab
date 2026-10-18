import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppStore } from "../agent/lib/lab/store.ts";
const policy = {
  requestedModelId: "openai/gpt-4o-mini",
  maxCostMicrousd: 1000,
  priceTableDate: "2026-10-18",
};
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "arl-live-budget-"));
  const path = join(dir, "app.sqlite");
  const s = new AppStore(path);
  s.activateEpoch(1);
  s.createRun({
    runId: "live",
    deliveryId: "delivery-001",
    epoch: 1,
    now: 0,
    mode: "live",
  });
  t.after(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { s, path };
}
const reserve = (s, id, extra = {}) =>
  s.reserveModel("live", {
    id,
    requestedTokens: 1600,
    now: 1,
    epoch: 1,
    singleDispatch: true,
    reservedCostMicrousd: 600,
    live: policy,
    ...extra,
  });
const finish = (s, id, extra = {}) =>
  s.finishModel("live", {
    id,
    now: 2,
    epoch: 1,
    inputTokens: 10,
    outputTokens: 20,
    estimatedCostMicrousd: 10,
    outcome: "completed",
    ...extra,
  });
test("live cost reservation and unresolved-call denial survive database reopen", (t) => {
  const { s, path } = setup(t);
  reserve(s, "m1");
  assert.equal(s.getRun("live").sourceMode, "live_pending");
  const reopened = new AppStore(path);
  t.after(() => reopened.close());
  assert.throws(() => reserve(reopened, "m1"), /model_dispatch_replay/);
  assert.throws(() => reserve(reopened, "m2"), /live_usage_unknown/);
  assert.equal(
    reopened.getRun("live").budget.models.m1.reservedCostMicrousd,
    600,
  );
});
test("live cumulative estimate charges max reserve and actual and is lower-only immutable", (t) => {
  const { s } = setup(t);
  reserve(s, "m1");
  finish(s, "m1");
  assert.equal(s.getRun("live").sourceMode, "live");
  assert.throws(() => reserve(s, "m2", { now: 3 }), /budget exhausted/);
  assert.throws(
    () => reserve(s, "m2", { live: { ...policy, maxCostMicrousd: 100000 } }),
    /live_policy_conflict/,
  );
  assert.equal(s.getRun("live").budget.modelTurns, 1);
  assert.equal(s.getRun("live").state, "failed");
  assert.equal(s.getRun("live").error, "live_cost_budget");
  assert.equal(s.getRun("live").budget.exhausted, "live_cost_budget");
});
test("unknown provider usage prevents all further paid calls without erasing charged reserve", (t) => {
  const { s } = setup(t);
  reserve(s, "m1");
  finish(s, "m1", {
    inputTokens: null,
    outputTokens: null,
    estimatedCostMicrousd: null,
    outcome: "live_timeout_or_abort",
  });
  assert.throws(() => reserve(s, "m2", { now: 3 }), /live_usage_unknown/);
  assert.equal(s.getRun("live").budget.models.m1.reservedCostMicrousd, 600);
});
test("live and fixture modes cannot share a run or bypass live policy", (t) => {
  const { s } = setup(t);
  assert.throws(
    () =>
      s.reserveModel("live", { id: "m", requestedTokens: 1, now: 1, epoch: 1 }),
    /live_mode_binding_denied/,
  );
  s.createRun({
    runId: "fixture",
    deliveryId: "delivery-001",
    now: 0,
    epoch: 1,
  });
  assert.throws(
    () =>
      s.reserveModel("fixture", {
        id: "m",
        requestedTokens: 1,
        now: 1,
        epoch: 1,
        singleDispatch: true,
        live: policy,
        reservedCostMicrousd: 1,
      }),
    /live_mode_binding_denied/,
  );
  assert.throws(
    () => reserve(s, "m", { live: { ...policy, maxCostMicrousd: 100001 } }),
    /invalid_live_policy/,
  );
});
