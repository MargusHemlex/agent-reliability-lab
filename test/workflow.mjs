import assert from "node:assert/strict";
import { Client } from "eve/client";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { AppStore } from "../agent/lib/lab/store.ts";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) await sources(p);
    else if (e.isFile())
      report.sourceSnapshot[p] = createHash("sha256")
        .update(await readFile(join(root, p)))
        .digest("hex");
  }
}
for (const dir of ["agent", "sandbox", "lab"]) await sources(dir);
for (const p of [
  "test/workflow.mjs",
  "test/workflow-fixture.mjs",
  "spike/locked-start.py",
  "package.json",
  "package-lock.json",
])
  report.sourceSnapshot[p] = createHash("sha256")
    .update(await readFile(join(root, p)))
    .digest("hex");
import { fixture, until, cleanup } from "./workflow-fixture.mjs";
async function runCase(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    report.cases.push({
      name,
      status: "pass",
      elapsedMs: Date.now() - started,
      ...details,
    });
    console.log(`${name}: PASS`);
  } catch (error) {
    report.cases.push({
      name,
      status: "fail",
      elapsedMs: Date.now() - started,
      error: error.message,
    });
    throw error;
  }
}
try {
  await runCase("happy_path_duplicate_approval", async () => {
    const f = await fixture();
    try {
      assert.equal(
        (await fetch(f.env.ARL_SERVICE_URL + "/policy")).status,
        401,
      );
      const id = await f.create();
      const w = await f.waiting(id);
      assert.equal(w.run.toolCalls, 2);
      const access = await f.assertAccessBoundaries(w.run.sessionId);
      assert.equal((await f.inspect(id)).run.state, "awaiting_approval");
      assert.equal(f.effectCount(), 0);
      assert.equal(
        (
          await f.api(`/lab/runs/${id}/approve`, {
            proposalDigest: "0".repeat(64),
          })
        ).status,
        409,
      );
      await f.approve(id);
      await f.approve(id);
      const done = await until(async () => {
        const r = await f.inspect(id);
        return r.run.state === "succeeded" && r;
      }, "approved effect");
      assert.equal(f.effectCount(), 1);
      assert.equal(done.run.toolCalls, 3);
      assert.equal(done.run.approval.consumed, true);
      assert.ok(done.run.receipt);
      return { effects: 1, toolCalls: done.run.toolCalls, ...access };
    } finally {
      await f.stop();
    }
  });
  await runCase("approval_persistence_response_gap_repaired", async () => {
    const f = await fixture();
    try {
      const id = await f.create();
      const waiting = await f.waiting(id);
      // Simulate process loss after durable application approval, before eve respond.
      const db = new AppStore(f.env.ARL_LAB_DB);
      try {
        db.approve(id, {
          proposalDigest: waiting.run.proposal.digest,
          now: Date.now(),
        });
      } finally {
        db.close();
      }
      await f.approve(id);
      const done = await until(async () => {
        const r = await f.inspect(id);
        return r.run.state === "succeeded" && r;
      }, "persisted approval response repair");
      assert.equal(f.effectCount(), 1);
      assert.equal(
        done.events.filter((e) => e.kind === "approval_decision").length,
        1,
      );
      return { effects: 1, approvalDecisions: 1 };
    } finally {
      await f.stop();
    }
  });
  for (const operation of ["reject", "cancel"])
    await runCase(`${operation}_before_intent_zero_effect`, async () => {
      const f = await fixture();
      try {
        const id = await f.create();
        await f.waiting(id);
        const result = await f.api(`/lab/runs/${id}/${operation}`, {});
        assert.equal(result.status, 200);
        assert.equal((await f.inspect(id)).run.state, "cancelled");
        assert.equal(f.effectCount(), 0);
        assert.equal((await f.inspect(id)).run.intent, null);
        return { effects: 0 };
      } finally {
        await f.stop();
      }
    });
  await runCase("stale_context_after_proposal_zero_effect", async () => {
    const f = await fixture();
    try {
      const id = await f.create();
      await f.waiting(id);
      const db = new DatabaseSync(f.env.ARL_SANDBOX_DB);
      try {
        db.prepare("UPDATE context SET revision=revision+1 WHERE id=1").run();
      } finally {
        db.close();
      }
      await f.approve(id);
      const done = await until(async () => {
        const r = await f.inspect(id);
        return r.run.state === "failed" && r;
      }, "stale-context permanent denial");
      assert.equal(done.run.error, "stale_context");
      assert.equal(f.effectCount(), 0);
      return { effects: 0, reason: done.run.error };
    } finally {
      await f.stop();
    }
  });
  await runCase("expired_at_commit_reapproval_same_key", async () => {
    const f = await fixture({ before: true, clock: true });
    try {
      const id = await f.create({ approvalTtlMs: 1000 });
      await f.waiting(id);
      await f.approve(id);
      await until(
        () => existsSync(join(f.app, "worker-barrier", "dispatch_ready")),
        "expiry dispatch barrier",
      );
      const original = (await f.inspect(id)).run.intent;
      assert.ok(original);
      assert.equal(f.effectCount(), 0);
      await f.advanceClock(original.expiresAt + 1, 1);
      await writeFile(join(f.app, "worker-barrier", "release"), "release");
      const expired = await until(async () => {
        const r = await f.inspect(id);
        return r.run.state === "awaiting_reapproval" && r;
      }, "commit expiry denial");
      assert.equal(f.effectCount(), 0);
      assert.equal(expired.run.intent.key, original.key);
      await f.approve(id);
      const done = await until(async () => {
        const r = await f.inspect(id);
        return r.run.state === "succeeded" && r;
      }, "same-key reapproval effect");
      assert.equal(f.effectCount(), 1);
      assert.equal(done.run.intent.key, original.key);
      assert.equal(done.run.reapprovals, 1);
      assert.equal(
        done.events.filter((e) => e.kind === "approval_decision").length,
        2,
      );
      return {
        effects: 1,
        reapprovals: 1,
        keyPreserved: true,
        expiredAuthorizationEffects: 0,
      };
    } finally {
      await f.stop();
    }
  });
  await runCase("approval_wait_survives_worker_restart", async () => {
    const f = await fixture();
    try {
      const id = await f.create();
      const before = await f.waiting(id);
      await f.killWorker();
      await f.restart();
      const recovered = await f.waiting(id);
      assert.equal(recovered.run.proposal.digest, before.run.proposal.digest);
      assert.equal(f.effectCount(), 0);
      await f.approve(id);
      await until(
        async () => (await f.inspect(id)).run.state === "succeeded",
        "resumed approval",
      );
      assert.equal(f.effectCount(), 1);
      return { effects: 1, proposalPreserved: true };
    } finally {
      await f.stop();
    }
  });
  await runCase("crash_before_dispatch", async () => {
    const f = await fixture({ before: true });
    try {
      const id = await f.create();
      await f.waiting(id);
      await f.approve(id);
      await until(
        () => existsSync(join(f.app, "worker-barrier", "dispatch_ready")),
        "dispatch barrier",
      );
      const intent = (await f.inspect(id)).run.intent;
      assert.ok(intent);
      assert.equal(f.effectCount(), 0);
      await f.killWorker();
      await writeFile(join(f.app, "worker-barrier", "release"), "release");
      const start = Date.now();
      await f.restart();
      const done = await until(
        async () => {
          const r = await f.inspect(id);
          return r.run.state === "succeeded" && r;
        },
        "before-dispatch recovery",
        30000,
      );
      assert.equal(done.run.intent.key, intent.key);
      assert.equal(f.effectCount(), 1);
      return { effects: 1, recoveryMs: Date.now() - start, keyPreserved: true };
    } finally {
      await f.stop();
    }
  });
  await runCase("crash_after_sandbox_commit_before_checkpoint", async () => {
    const f = await fixture({ after: true });
    try {
      const id = await f.create();
      await f.waiting(id);
      await f.approve(id);
      await until(
        () => existsSync(join(f.app, "service-barrier", "committed")),
        "service commit barrier",
      );
      assert.equal(f.effectCount(), 1);
      const pending = await f.inspect(id);
      assert.equal(pending.run.state, "executing");
      assert.equal(pending.run.receipt, null);
      await f.killWorker();
      await writeFile(join(f.app, "service-barrier", "release"), "release");
      const start = Date.now();
      await f.restart();
      const done = await until(
        async () => {
          const r = await f.inspect(id);
          return r.run.state === "succeeded" && r;
        },
        "after-commit recovery",
        30000,
      );
      assert.equal(done.run.intent.key, pending.run.intent.key);
      assert.equal(f.effectCount(), 1);
      assert.ok(done.run.receipt);
      return { effects: 1, recoveryMs: Date.now() - start, keyPreserved: true };
    } finally {
      await f.stop();
    }
  });

  await runCase(
    "unknown_outcome_absent_receipt_same_key_redispatch",
    async () => {
      const f = await fixture({ before: true });
      try {
        const id = await f.create();
        await f.waiting(id);
        await f.approve(id);
        await until(
          () => existsSync(join(f.app, "worker-barrier", "dispatch_ready")),
          "unknown outcome dispatch barrier",
        );
        const original = (await f.inspect(id)).run.intent;
        assert.ok(original);
        assert.equal(f.effectCount(), 0);
        await f.killWorker();
        const db = new DatabaseSync(f.env.ARL_LAB_DB, { readOnly: true });
        const epoch = db
          .prepare("SELECT epoch FROM ownership WHERE id=1")
          .get().epoch;
        db.close();
        const appStore = new AppStore(f.env.ARL_LAB_DB);
        try {
          appStore.markUnknown(
            id,
            "synthetic_response_loss_before_dispatch",
            Date.now(),
            epoch,
          );
        } finally {
          appStore.close();
        }
        await writeFile(join(f.app, "worker-barrier", "release"), "release");
        await f.restart();
        const restarted = await f.inspect(id);
        assert.equal(restarted.run.intent.key, original.key);
        if (restarted.run.state !== "succeeded") {
          const resumed = await f.api(`/lab/runs/${id}/resume`, {});
          assert.equal(resumed.status, 200);
        }
        const done = await until(
          async () => {
            const result = await f.inspect(id);
            return result.run.state === "succeeded" && result;
          },
          "unknown outcome absent-receipt recovery",
          30000,
        );
        assert.equal(done.run.intent.key, original.key);
        assert.equal(f.effectCount(), 1);
        assert.equal(done.run.receipt.key, original.key);
        return {
          effects: 1,
          keyPreserved: true,
          reconciledAbsentReceipt: true,
        };
      } finally {
        await f.stop();
      }
    },
  );
  await runCase(
    "cancel_after_commit_expiry_confirmation_zero_effect",
    async () => {
      const f = await fixture({ before: true, clock: true });
      try {
        const id = await f.create({ approvalTtlMs: 1000 });
        await f.waiting(id);
        await f.approve(id);
        await until(
          () => existsSync(join(f.app, "worker-barrier", "dispatch_ready")),
          "cancel expiry dispatch barrier",
        );
        const original = (await f.inspect(id)).run.intent;
        assert.ok(original);
        await f.advanceClock(original.expiresAt + 1, 1);
        await writeFile(join(f.app, "worker-barrier", "release"), "release");
        const expired = await until(async () => {
          const result = await f.inspect(id);
          return result.run.state === "awaiting_reapproval" && result;
        }, "confirmed expiry before cancellation");
        assert.equal(f.effectCount(), 0);
        assert.equal(expired.run.intent.key, original.key);
        const cancelled = await f.api(`/lab/runs/${id}/cancel`, {});
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.run.state, "cancelled");
        assert.equal(cancelled.run.cancellationRequested, true);
        const replay = await f.api(`/lab/runs/${id}/approve`, {
          proposalDigest: expired.run.proposal.digest,
        });
        assert.ok(
          replay.status === 409 ||
            (replay.status === 200 && replay.run.state === "cancelled"),
        );
        const final = await f.inspect(id);
        assert.equal(final.run.state, "cancelled");
        assert.equal(final.run.approval.consumed, true);
        assert.equal(
          final.events.filter((event) => event.kind === "approval_decision")
            .length,
          1,
        );
        assert.equal(f.effectCount(), 0);
        return {
          effects: 0,
          terminalState: "cancelled",
          approvalReplayBlocked: true,
        };
      } finally {
        await f.stop();
      }
    },
  );
} finally {
  await cleanup();
  await mkdir(join(root, "reports"), { recursive: true });
  const output =
    process.env.ARL_WORKFLOW_REPORT ?? join(root, "reports/workflow.json");
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
