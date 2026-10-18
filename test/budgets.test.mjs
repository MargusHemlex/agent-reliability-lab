import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppStore } from "../agent/lib/lab/store.ts";
import { DEFAULT_LIMITS } from "../agent/lib/lab/limits.ts";
function fixture(t, limits) {
  const dir = mkdtempSync(join(tmpdir(), "arl-budget-"));
  const path = join(dir, "app.sqlite");
  const store = new AppStore(path);
  store.activateEpoch(1);
  store.createRun({
    runId: "r",
    deliveryId: "delivery-001",
    epoch: 1,
    now: 0,
    limits,
  });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, path };
}
const model = (store, id, now = 1, requestedTokens = 1600) =>
  store.reserveModel("r", { id, requestedTokens, now, epoch: 1 });
const tool = (store, id, now = 1, logicalId = id) =>
  store.reserveTool("r", {
    id,
    logicalId,
    toolName: "get_delivery",
    input: { runId: "r" },
    now,
    epoch: 1,
  });
const proposal = (store, now = 10) =>
  store.propose("r", {
    action: {
      deliveryId: "delivery-001",
      kind: "request_update",
      note: "Please provide a delivery update.",
    },
    expectedRevision: 1,
    policyVersion: 1,
    now,
    epoch: 1,
  });
test("limits are validated and copied before first reservation", (t) => {
  const { store } = fixture(t);
  assert.deepEqual(store.getRun("r").limits, DEFAULT_LIMITS);
  const view = store.getRun("r");
  view.limits.modelTurns = 100;
  assert.equal(store.getRun("r").limits.modelTurns, 5);
  assert.throws(
    () =>
      store.createRun({
        runId: "bad",
        deliveryId: "delivery-001",
        epoch: 1,
        now: 0,
        limits: { modelTurns: 6 },
      }),
    /invalid limit/,
  );
});
test("model reservations survive restart, replay once, and fifth turn exhausts before sixth", (t) => {
  const { store, path } = fixture(t);
  model(store, "m1");
  store.finishModel("r", { id: "m1", now: 2, epoch: 1 });
  const reopened = new AppStore(path);
  t.after(() => reopened.close());
  assert.equal(
    reopened.reserveModel("r", {
      id: "m1",
      requestedTokens: 1600,
      now: 3,
      epoch: 1,
    }).finishedAt,
    2,
  );
  assert.equal(reopened.getRun("r").budget.modelTurns, 1);
  assert.equal(reopened.getRun("r").budget.models.m1.inputTokens, null);
  for (let i = 2; i <= 5; i++) model(reopened, `m${i}`, i);
  assert.throws(() => model(reopened, "m6", 6), /budget exhausted/);
  const run = store.getRun("r");
  assert.equal(run.state, "failed");
  assert.equal(run.budget.modelTurns, 5);
  assert.equal(run.budget.requestedModelTokens, 8000);
});
test("requested token limit denies a call before reservation and never fabricates actual usage", (t) => {
  const { store } = fixture(t, { requestedModelTokens: 1600 });
  model(store, "m1");
  assert.throws(() => model(store, "m2", 2), /budget exhausted/);
  const budget = store.getRun("r").budget;
  assert.equal(budget.exhausted, "model_token_budget");
  assert.equal(budget.models.m1.outputTokens, null);
  assert.equal(Object.keys(budget.models).length, 1);
});
test("changed reservation input conflicts without consuming an extra call", (t) => {
  const { store } = fixture(t);
  tool(store, "t1");
  assert.throws(
    () =>
      store.reserveTool("r", {
        id: "t1",
        toolName: "get_delivery",
        input: { runId: "changed" },
        now: 2,
        epoch: 1,
      }),
    /replay conflict/,
  );
  model(store, "m1");
  assert.throws(() => model(store, "m1", 2, 100), /replay conflict/);
  assert.equal(store.getRun("r").toolCalls, 1);
});
test("tool budgets count physical calls, preserve completed bounded output, and stop ninth", (t) => {
  const { store } = fixture(t);
  tool(store, "t1");
  store.finishTool("r", {
    id: "t1",
    output: { status: "delayed" },
    outcome: "succeeded",
    now: 2,
    epoch: 1,
  });
  assert.deepEqual(tool(store, "t1", 3).output, { status: "delayed" });
  for (let i = 2; i <= 8; i++) tool(store, `t${i}`, i + 2);
  assert.throws(() => tool(store, "t9", 12), /budget exhausted/);
  assert.equal(store.getRun("r").toolCalls, 8);
  assert.equal(store.getRun("r").budget.exhausted, "tool_call_budget");
});
test("oversized tool input and output are independently denied", (t) => {
  const { store } = fixture(t, { inputBytes: 100, outputBytes: 100 });
  assert.throws(
    () =>
      store.reserveTool("r", {
        id: "big",
        toolName: "get_delivery",
        input: "x".repeat(100),
        now: 1,
        epoch: 1,
      }),
    /input limit/,
  );
  tool(store, "t1");
  assert.throws(
    () =>
      store.finishTool("r", {
        id: "t1",
        output: "x".repeat(100),
        outcome: "succeeded",
        now: 2,
        epoch: 1,
      }),
    /output limit/,
  );
  assert.equal(store.getRun("r").budget.tools.t1.finishedAt, null);
});
test("approval waiting is excluded while execution before and after is cumulative", (t) => {
  const { store } = fixture(t);
  model(store, "m1", 1);
  const p = proposal(store, 101);
  assert.equal(store.getRun("r").budget.activeMs, 100);
  store.approve("r", { proposalDigest: p.digest, now: 900_101 });
  model(store, "m2", 900_102);
  store.settleActive("r", { now: 900_202, epoch: 1, pause: true });
  assert.equal(store.getRun("r").budget.activeMs, 200);
});
test("active intervals conservatively survive worker death and fence stale completions", (t) => {
  const { store, path } = fixture(t);
  model(store, "m1", 1);
  const reopened = new AppStore(path);
  t.after(() => reopened.close());
  reopened.activateEpoch(2);
  assert.equal(reopened.settleActive("r", { now: 120_001, epoch: 2 }), false);
  assert.equal(reopened.getRun("r").budget.activeMs, 120000);
  assert.equal(store.getRun("r").state, "failed");
  assert.throws(
    () => store.finishModel("r", { id: "m1", now: 120_002, epoch: 1 }),
    /stale worker/,
  );
});
test("three read attempts share durable retry backoff across physical worker calls", (t) => {
  const { store, path } = fixture(t);
  tool(store, "t1", 1, "logical-read");
  store.reserveReadAttempt("r", { id: "a1", toolId: "t1", now: 1, epoch: 1 });
  store.finishReadAttempt("r", {
    id: "a1",
    outcome: "transient",
    now: 2,
    nextRetryAt: 102,
    epoch: 1,
  });
  assert.throws(
    () =>
      store.reserveReadAttempt("r", {
        id: "a2",
        toolId: "t1",
        now: 101,
        epoch: 1,
      }),
    /backoff pending/,
  );
  store.reserveReadAttempt("r", { id: "a2", toolId: "t1", now: 102, epoch: 1 });
  const reopened = new AppStore(path);
  t.after(() => reopened.close());
  reopened.activateEpoch(2);
  reopened.reserveTool("r", {
    id: "t2",
    logicalId: "logical-read",
    toolName: "get_delivery",
    input: { runId: "r" },
    now: 200,
    epoch: 2,
  });
  assert.equal(
    reopened.reserveReadAttempt("r", {
      id: "a3",
      toolId: "t2",
      now: 200,
      epoch: 2,
    }).attempt,
    3,
  );
  assert.equal(reopened.getRun("r").budget.reads.a2.outcome, "interrupted");
  reopened.finishReadAttempt("r", {
    id: "a3",
    outcome: "transient",
    now: 201,
    epoch: 2,
  });
  assert.throws(
    () =>
      reopened.reserveReadAttempt("r", {
        id: "a4",
        toolId: "t2",
        now: 202,
        epoch: 2,
      }),
    /budget exhausted/,
  );
  assert.equal(reopened.getRun("r").budget.exhausted, "read_attempt_budget");
});
test("logical tool deadline is durable and does not expand on reservation replay", (t) => {
  const { store } = fixture(t);
  const reserved = tool(store, "t1", 1);
  assert.equal(reserved.deadline, 10001);
  assert.equal(tool(store, "t1", 9999).deadline, 10001);
  assert.throws(
    () =>
      store.reserveReadAttempt("r", {
        id: "a1",
        toolId: "t1",
        now: 10001,
        epoch: 1,
      }),
    /budget exhausted/,
  );
  assert.equal(store.getRun("r").budget.exhausted, "tool_timeout");
});
test("budget exhaustion preserves an accepted ambiguous intent for read-only reconciliation", (t) => {
  const { store } = fixture(t);
  const p = proposal(store);
  store.approve("r", { proposalDigest: p.digest, now: 20 });
  store.createDispatch("r", { now: 21, epoch: 1 });
  model(store, "m1", 22);
  store.markUnknown("r", "network_timeout", 23, 1);
  assert.equal(store.settleActive("r", { now: 3_600_001, epoch: 1 }), false);
  assert.equal(store.getRun("r").state, "unknown_outcome");
  const before = store.getRun("r").toolCalls;
  const lookup = store.reserveTool("r", {
    id: "reconcile",
    toolName: "record_resolution",
    input: { runId: "r" },
    reconciliation: true,
    now: 3_600_002,
    epoch: 1,
  });
  assert.equal(lookup.reconciliation, true);
  assert.equal(store.getRun("r").toolCalls, before);
  store.succeed("r", { effectId: 1 }, 3_600_003, 1);
  assert.equal(store.getRun("r").state, "succeeded");
});

test("late accounting preserves confirmed permanent denial rather than reopening unknown", (t) => {
  const { store } = fixture(t, { deadlineMs: 100 });
  const p = proposal(store, 10);
  store.approve("r", { proposalDigest: p.digest, now: 20 });
  store.reserveTool("r", {
    id: "write",
    toolName: "record_resolution",
    input: { runId: "r" },
    now: 21,
    epoch: 1,
  });
  store.createDispatch("r", { now: 22, epoch: 1 });
  store.fail("r", "stale_context", 23, 1);
  store.finishTool("r", {
    id: "write",
    outcome: "permanent",
    output: { status: "failed" },
    now: 101,
    epoch: 1,
  });
  const run = store.getRun("r");
  assert.equal(run.state, "failed");
  assert.equal(run.error, "stale_context");
  assert.equal(run.budget.exhausted, "run_deadline");
});

test("dispatch receiver authorization is capped by remaining active execution budget", (t) => {
  const { store } = fixture(t, { activeMs: 1000 });
  model(store, "m1", 1);
  const p = proposal(store, 101);
  store.approve("r", { proposalDigest: p.digest, now: 10000 });
  store.reserveTool("r", {
    id: "write",
    toolName: "record_resolution",
    input: { runId: "r" },
    now: 10001,
    epoch: 1,
  });
  const intent = store.createDispatch("r", { now: 10011, epoch: 1 });
  assert.equal(intent.expiresAt, 10901);
  assert.ok(intent.expiresAt < store.getRun("r").approval.expiresAt);
});
