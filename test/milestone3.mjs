import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { AppStore } from "../agent/lib/lab/store.ts";
import {
  fixture,
  until,
  cleanup,
  takeCaseEvidence,
} from "./workflow-fixture.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = {
  schemaVersion: 1,
  mode: "fixture",
  environment: {
    node: process.version,
    platform: process.platform,
    localOnly: true,
    inheritedCredentials: false,
  },
  cases: [],
  sourceSnapshot: {},
};
async function sources(dir) {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await sources(p);
    else if (entry.isFile())
      report.sourceSnapshot[p] = createHash("sha256")
        .update(await readFile(join(root, p)))
        .digest("hex");
  }
}
for (const dir of ["agent", "sandbox", "lab"]) await sources(dir);
for (const p of [
  "test/milestone3.mjs",
  "test/workflow-fixture.mjs",
  "spike/locked-start.py",
  "package.json",
  "package-lock.json",
])
  report.sourceSnapshot[p] = createHash("sha256")
    .update(await readFile(join(root, p)))
    .digest("hex");
async function runCase(name, fn) {
  const start = Date.now();
  try {
    const details = await fn();
    const persisted = takeCaseEvidence();
    report.cases.push({
      name,
      status: "pass",
      elapsedMs: Date.now() - start,
      ...persisted,
      ...details,
    });
    console.log(`${name}: PASS`);
  } catch (error) {
    const persisted = takeCaseEvidence();
    report.cases.push({
      name,
      status: "fail",
      elapsedMs: Date.now() - start,
      error: error.message,
      ...persisted,
    });
    throw error;
  }
}
const waitState = (f, id, state) =>
  until(async () => {
    const r = await f.inspect(id);
    return r.run.state === state && r;
  }, state);
try {
  for (const [name, limits, reason, expectedModels] of [
    [
      "model_turn_limit_stops_before_write",
      { modelTurns: 1 },
      "model_turn_budget",
      1,
    ],
    [
      "requested_token_limit_stops_first_model",
      { requestedModelTokens: 1599 },
      "model_token_budget",
      0,
    ],
  ])
    await runCase(name, async () => {
      const f = await fixture();
      try {
        const id = await f.create(limits);
        const done = await waitState(f, id, "failed");
        assert.equal(done.run.budget.exhausted, reason);
        assert.equal(done.run.budget.modelTurns, expectedModels);
        assert.equal(f.effectCount(), 0);
        assert.equal(done.run.intent, null);
        return { effects: 0, reason };
      } finally {
        await f.stop();
      }
    });
  await runCase("tool_call_limit_stops_approved_write", async () => {
    const f = await fixture();
    try {
      const id = await f.create({ toolCalls: 2 });
      await f.waiting(id);
      await f.approve(id);
      const done = await waitState(f, id, "failed");
      assert.equal(done.run.budget.exhausted, "tool_call_budget");
      assert.equal(done.run.toolCalls, 2);
      assert.equal(done.run.intent, null);
      assert.equal(f.effectCount(), 0);
      return { effects: 0, toolCalls: 2, reason: done.run.budget.exhausted };
    } finally {
      await f.stop();
    }
  });
  await runCase("approval_wait_excluded_from_active_budget", async () => {
    const f = await fixture({ clock: true });
    try {
      const id = await f.create({ activeMs: 1000 });
      const waiting = await f.waiting(id);
      const before = waiting.run.budget.activeMs;
      assert.equal(waiting.run.budget.activeSince, null);
      await f.advanceClock(waiting.run.createdAt + 1_200_000, 1);
      await f.approve(id);
      const done = await waitState(f, id, "succeeded");
      assert.equal(done.run.budget.activeMs, before);
      assert.equal(done.run.budget.exhausted, null);
      assert.equal(f.effectCount(), 1);
      return {
        effects: 1,
        excludedWaitMs: 1200000,
        activeMs: done.run.budget.activeMs,
      };
    } finally {
      await f.stop();
    }
  });
  await runCase(
    "active_budget_survives_crash_and_blocks_dispatch",
    async () => {
      const f = await fixture({ before: true, clock: true });
      try {
        const id = await f.create({ activeMs: 1000 });
        await f.waiting(id);
        await f.approve(id);
        await until(
          () => existsSync(join(f.app, "worker-barrier", "dispatch_ready")),
          "active crash barrier",
        );
        const before = await f.inspect(id);
        await f.killWorker();
        await f.advanceClock(before.run.createdAt + 1001, 1);
        await writeFile(join(f.app, "worker-barrier", "release"), "release");
        await f.restart();
        const done = await waitState(f, id, "unknown_outcome");
        assert.equal(done.run.budget.exhausted, "active_budget");
        assert.equal(done.run.budget.activeMs, 1000);
        assert.equal(done.run.intent.key, before.run.intent.key);
        assert.equal(f.effectCount(), 0);
        const models = done.run.budget.modelTurns;
        const resumed = await f.api(`/lab/runs/${id}/resume`, {});
        assert.equal(resumed.status, 200);
        assert.equal(resumed.run.state, "unknown_outcome");
        assert.equal(resumed.run.budget.modelTurns, models);
        assert.equal(f.effectCount(), 0);
        return {
          effects: 0,
          activeMs: 1000,
          keyPreserved: true,
          readOnlyRecovery: true,
        };
      } finally {
        await f.stop();
      }
    },
  );
  await runCase(
    "committed_receipt_reconciles_after_active_exhaustion",
    async () => {
      const f = await fixture({ after: true, clock: true });
      try {
        const id = await f.create({ activeMs: 1000 });
        await f.waiting(id);
        await f.approve(id);
        await until(
          () => existsSync(join(f.app, "service-barrier", "committed")),
          "committed exhaustion barrier",
        );
        const before = await f.inspect(id);
        assert.equal(f.effectCount(), 1);
        await f.killWorker();
        await f.advanceClock(before.run.createdAt + 1001, 1);
        const db = new DatabaseSync(f.env.ARL_LAB_DB, { readOnly: true });
        const epoch = db
          .prepare("SELECT epoch FROM ownership WHERE id=1")
          .get().epoch;
        db.close();
        const app = new AppStore(f.env.ARL_LAB_DB);
        try {
          assert.equal(
            app.settleActive(id, { now: before.run.createdAt + 1001, epoch }),
            false,
          );
        } finally {
          app.close();
        }
        await writeFile(join(f.app, "service-barrier", "release"), "release");
        await f.restart();
        const resumed = await f.api(`/lab/runs/${id}/resume`, {});
        assert.equal(resumed.status, 200);
        assert.equal(resumed.run.state, "succeeded");
        assert.equal(
          resumed.run.budget.modelTurns,
          before.run.budget.modelTurns,
        );
        assert.equal(resumed.run.intent.key, before.run.intent.key);
        assert.equal(resumed.run.receipt.key, before.run.intent.key);
        assert.equal(f.effectCount(), 1);
        return { effects: 1, keyPreserved: true, readOnlyRecovery: true };
      } finally {
        await f.stop();
      }
    },
  );
  for (const [name, failures, success] of [
    ["retryable_reads_succeed_on_third_attempt", 2, true],
    ["read_retry_budget_stops_fourth_request", 99, false],
  ])
    await runCase(name, async () => {
      const f = await fixture({ readFailures: failures });
      try {
        const id = await f.create();
        const state = await waitState(
          f,
          id,
          success ? "awaiting_approval" : "failed",
        );
        const attempts = Object.values(state.run.budget.reads);
        const delivery = attempts.filter(
          (a) => state.run.budget.tools[a.toolId].toolName === "get_delivery",
        );
        assert.equal(delivery.length, 3);
        assert.equal(
          delivery.filter((a) => a.outcome === "transient").length,
          success ? 2 : 3,
        );
        assert.equal(f.effectCount(), 0);
        if (success) {
          await f.approve(id);
          await waitState(f, id, "succeeded");
          assert.equal(f.effectCount(), 1);
        } else assert.equal(state.run.budget.exhausted, "read_attempt_budget");
        return { effects: success ? 1 : 0, deliveryAttempts: 3 };
      } finally {
        await f.stop();
      }
    });
  await runCase("read_timeout_then_recovery_within_tool_deadline", async () => {
    const f = await fixture({ readDelayMs: 3100 });
    try {
      const id = await f.create();
      const state = await waitState(f, id, "awaiting_approval");
      const attempts = Object.values(state.run.budget.reads).filter(
        (a) => state.run.budget.tools[a.toolId].toolName === "get_delivery",
      );
      assert.equal(attempts.length, 2);
      assert.equal(attempts[0].outcome, "transient");
      assert.equal(attempts[1].outcome, "succeeded");
      assert.ok(attempts[1].finishedAt - attempts[0].startedAt < 10000);
      assert.equal(f.effectCount(), 0);
      return { effects: 0, deliveryAttempts: 2 };
    } finally {
      await f.stop();
    }
  });
  await runCase(
    "namespace_reset_preserves_existing_run_and_events",
    async () => {
      const f = await fixture();
      try {
        const oldId = await f.create();
        const before = await f.waiting(oldId);
        const reset = await f.api("/lab/namespaces/reset", {});
        assert.equal(reset.status, 200);
        assert.notEqual(reset.namespace.id, before.run.namespace);
        const id = await f.create();
        const next = await f.waiting(id);
        assert.equal(next.run.namespace, reset.namespace.id);
        const retained = await f.inspect(oldId);
        assert.equal(retained.run.namespace, before.run.namespace);
        assert.deepEqual(retained.events, before.events);
        assert.equal((await f.api("/lab/runs")).runs.length, 2);
        await f.approve(oldId);
        await waitState(f, oldId, "succeeded");
        await f.approve(id);
        await waitState(f, id, "succeeded");
        assert.equal(f.effectCount(), 2);
        return { effects: 2, oldRunPreserved: true };
      } finally {
        await f.stop();
      }
    },
  );
  await runCase("operator_cookie_csrf_and_real_approved_workflow", async () => {
    const f = await fixture();
    try {
      const request = async (
        path,
        { body, cookie, csrf, origin = f.host } = {},
      ) =>
        fetch(f.host + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(body === undefined
              ? {}
              : { "content-type": "application/json", origin }),
            ...(cookie ? { cookie } : {}),
            ...(csrf ? { "x-csrf-token": csrf } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
      const page = await request("/operator");
      assert.equal(page.status, 200);
      assert.ok(
        page.headers
          .get("content-security-policy")
          .includes("frame-ancestors 'none'"),
      );
      const html = await page.text();
      assert.ok(html.includes("Fixture mode"));
      assert.ok(!html.includes(f.operator));
      assert.equal((await request("/operator/api/runs")).status, 401);
      const login = await request("/operator/login", {
        body: { secret: f.operator },
      });
      assert.equal(login.status, 200);
      const setCookie = login.headers.get("set-cookie");
      assert.ok(setCookie.includes("HttpOnly"));
      assert.ok(setCookie.includes("SameSite=Strict"));
      const cookie = setCookie.split(";")[0],
        { csrf } = await login.json();
      assert.equal(
        (
          await request("/operator/api/runs", {
            body: { deliveryId: "delivery-001" },
            cookie,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/operator/api/runs", {
            body: { deliveryId: "delivery-001" },
            cookie,
            csrf,
            origin: "http://attacker.invalid",
          })
        ).status,
        403,
      );
      assert.equal((await f.api("/lab/runs")).runs.length, 0);
      const created = await request("/operator/api/runs", {
        body: { deliveryId: "delivery-001" },
        cookie,
        csrf,
      });
      assert.equal(created.status, 201);
      const id = (await created.json()).run.runId;
      const waiting = await f.waiting(id);
      const approval = await until(async () => {
        const response = await request(`/operator/api/runs/${id}/approve`, {
          body: { proposalDigest: waiting.run.proposal.digest },
          cookie,
          csrf,
        });
        return response.status === 200 && response;
      }, "browser approval readiness");
      assert.equal(approval.status, 200);
      const done = await waitState(f, id, "succeeded");
      assert.equal(done.run.toolCalls, 3);
      assert.equal(f.effectCount(), 1);
      assert.equal(
        (await request("/operator/logout", { body: {}, cookie, csrf })).status,
        200,
      );
      assert.equal(
        (await request("/operator/api/runs", { cookie })).status,
        401,
      );
      return { effects: 1, csrfEnforced: true, cookieSession: true };
    } finally {
      await f.stop();
    }
  });
} finally {
  await cleanup();
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(
    process.env.ARL_MILESTONE3_REPORT ?? join(root, "reports/milestone3.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
