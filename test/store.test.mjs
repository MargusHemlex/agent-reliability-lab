import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppStore } from "../agent/lib/lab/store.ts";
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "arl-store-"));
  const path = join(dir, "app.sqlite");
  const store = new AppStore(path);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.activateEpoch(1, 0);
  store.createRun({
    runId: "r1",
    deliveryId: "delivery-001",
    epoch: 1,
    now: 0,
  });
  return { store, path };
}
const action = {
  deliveryId: "delivery-001",
  kind: "request_update",
  note: "Please provide a delivery update.",
};
const propose = (store) =>
  store.propose("r1", {
    action,
    expectedRevision: 1,
    policyVersion: 1,
    now: 100,
    epoch: 1,
  });
const approve = (store) => {
  const p = propose(store);
  store.approve("r1", { proposalDigest: p.digest, now: 200 });
  return p;
};
test("approval bindings, immutable proposals and durable single consumption", (t) => {
  const { store, path } = fixture(t);
  const proposal = propose(store);
  assert.throws(
    () => store.createDispatch("r1", { now: 200, epoch: 1 }),
    /denied/,
  );
  assert.throws(
    () => store.approve("r1", { proposalDigest: "wrong", now: 200 }),
    /conflict/,
  );
  assert.throws(
    () =>
      store.propose("r1", {
        action: { ...action, note: "other" },
        expectedRevision: 1,
        policyVersion: 1,
        now: 200,
        epoch: 1,
      }),
    /immutable/,
  );
  store.approve("r1", { proposalDigest: proposal.digest, now: 200 });
  assert.throws(
    () => store.approve("r1", { proposalDigest: proposal.digest, now: 201 }),
    /conflict/,
  );
  const first = store.createDispatch("r1", { now: 300, epoch: 1 });
  const second = store.createDispatch("r1", { now: 400, epoch: 1 });
  assert.equal(first.key, second.key);
  assert.equal(store.getRun("r1").toolCalls, 1);
  const reopened = new AppStore(path);
  try {
    assert.equal(reopened.getRun("r1").intent.key, first.key);
    assert.equal(reopened.getRun("r1").approval.consumed, true);
  } finally {
    reopened.close();
  }
});
test("expiry before intent never creates intent", (t) => {
  const { store } = fixture(t);
  approve(store);
  assert.throws(
    () => store.createDispatch("r1", { now: 900200, epoch: 1 }),
    /denied/,
  );
  assert.equal(store.getRun("r1").intent, null);
});
test("cancel linearization preserves accepted-effect truth", (t) => {
  const { store } = fixture(t);
  approve(store);
  store.cancel("r1", 250);
  assert.throws(
    () => store.createDispatch("r1", { now: 300, epoch: 1 }),
    /denied/,
  );
  assert.equal(store.getRun("r1").state, "cancelled");
  store.createRun({
    runId: "r2",
    deliveryId: "delivery-001",
    epoch: 1,
    now: 0,
  });
  const p = store.propose("r2", {
    action,
    expectedRevision: 1,
    policyVersion: 1,
    now: 100,
    epoch: 1,
  });
  store.approve("r2", { proposalDigest: p.digest, now: 200 });
  store.createDispatch("r2", { now: 300, epoch: 1 });
  store.cancel("r2", 400);
  assert.equal(store.getRun("r2").state, "executing");
  store.markUnknown("r2", "timeout", 500, 1);
  assert.throws(() => store.fail("r2", "timeout", 600, 1), /reconciliation/);
  store.succeed("r2", { effectId: "synthetic-effect" }, 700, 1);
  assert.equal(store.getRun("r2").state, "succeeded");
  assert.equal(store.getRun("r2").cancellationRequested, true);
});
test("epoch fencing and same-key reconciliation after ownership replacement", (t) => {
  const { store } = fixture(t);
  approve(store);
  const intent = store.createDispatch("r1", { now: 300, epoch: 1 });
  store.activateEpoch(2, 400);
  assert.throws(() => store.succeed("r1", {}, 500, 1), /stale/);
  assert.throws(
    () => store.createDispatch("r1", { now: 500, epoch: 1 }),
    /stale/,
  );
  assert.equal(
    store.createDispatch("r1", { now: 500, epoch: 2 }).key,
    intent.key,
  );
  store.succeed("r1", { effectId: "effect" }, 600, 2);
});
test("reapproval has stable key and append-only approval history", (t) => {
  const { store } = fixture(t);
  const p = approve(store);
  const first = store.createDispatch("r1", { now: 300, epoch: 1 });
  store.awaitReapproval("r1", 900201, 1);
  assert.equal(store.getRun("r1").state, "awaiting_reapproval");
  store.approve("r1", { proposalDigest: p.digest, now: 900202 });
  const second = store.createDispatch("r1", { now: 900203, epoch: 1 });
  assert.equal(first.key, second.key);
  assert.ok(second.expiresAt > first.expiresAt);
  assert.equal(
    store.getEvents("r1").filter((e) => e.kind === "approval_decision").length,
    2,
  );
});
test("read replay is bound to output and does not spend budget twice", (t) => {
  const { store } = fixture(t);
  store.recordRead(
    "r1",
    "get_delivery",
    { id: "delivery-001" },
    { revision: 1 },
    100,
    1,
  );
  store.recordRead(
    "r1",
    "get_delivery",
    { id: "delivery-001" },
    { revision: 1 },
    200,
    1,
  );
  assert.equal(store.getRun("r1").toolCalls, 1);
  assert.throws(
    () =>
      store.recordRead(
        "r1",
        "get_delivery",
        { id: "delivery-001" },
        { revision: 2 },
        300,
        1,
      ),
    /replay conflict/,
  );
  for (let i = 0; i < 7; i++)
    store.recordRead("r1", "get_policy", { id: i }, { version: i }, 300 + i, 1);
  assert.throws(
    () =>
      store.recordRead("r1", "get_policy", { id: 9 }, { version: 9 }, 400, 1),
    /budget/,
  );
  assert.equal(store.getRun("r1").toolCalls, 8);
});

test("cached reads replay after proposal without consuming budget or bypassing fencing", (t) => {
  const { store } = fixture(t);
  const input = { id: "delivery-001" },
    output = { revision: 1 };
  store.recordRead("r1", "get_delivery", input, output, 100, 1);
  propose(store);
  assert.deepEqual(store.getRead("r1", "get_delivery", input), output);
  assert.deepEqual(
    store.recordRead("r1", "get_delivery", input, output, 200, 1),
    output,
  );
  assert.equal(store.getRun("r1").toolCalls, 1);
  assert.equal(store.getRun("r1").state, "awaiting_approval");
  assert.throws(
    () =>
      store.recordRead("r1", "get_delivery", input, { revision: 2 }, 200, 1),
    /replay conflict/,
  );
  assert.throws(
    () => store.recordRead("r1", "get_delivery", input, output, 200),
    /stale worker/,
  );
});

test("late committed receipt resolves reapproval states truthfully", (t) => {
  const { store } = fixture(t);
  const p = approve(store);
  store.createDispatch("r1", { now: 300, epoch: 1 });
  store.awaitReapproval("r1", 900201, 1);
  store.approve("r1", { proposalDigest: p.digest, now: 900202 });
  store.markUnknown("r1", "lookup_unavailable", 900203, 1);
  assert.equal(store.getRun("r1").state, "unknown_outcome");
  store.succeed("r1", { effectId: "late-effect" }, 900204, 1);
  assert.equal(store.getRun("r1").state, "succeeded");
});
test("late receipt may resolve awaiting reapproval without fresh dispatch", (t) => {
  const { store } = fixture(t);
  approve(store);
  store.createDispatch("r1", { now: 300, epoch: 1 });
  store.awaitReapproval("r1", 900201, 1);
  store.succeed("r1", { effectId: "late-effect" }, 900202, 1);
  assert.equal(store.getRun("r1").state, "succeeded");
  assert.equal(store.getRun("r1").toolCalls, 1);
});
