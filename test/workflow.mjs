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
  "spike/locked-start.py",
  "package.json",
  "package-lock.json",
])
  report.sourceSnapshot[p] = createHash("sha256")
    .update(await readFile(join(root, p)))
    .digest("hex");
const children = new Set();
const dirs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await sleep(50);
  }
  throw new Error(`${label}: timed out${last ? ` (${last.message})` : ""}`);
}
async function freePort() {
  const s = createServer();
  await new Promise((r, j) => {
    s.once("error", j);
    s.listen(0, "127.0.0.1", r);
  });
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function kill(child) {
  if (!child) return;
  const ended =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((r) => child.once("exit", r));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  await ended;
  children.delete(child);
}
function launch(command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let logs = "";
  for (const s of [child.stdout, child.stderr])
    s.on("data", (chunk) => {
      logs = (logs + chunk).slice(-16000);
    });
  child.on("error", () => {});
  return { child, logs: () => logs };
}
async function fixture({ before = false, after = false, clock = false } = {}) {
  const app = await mkdtemp(
    join(process.env.TMPDIR ?? "/tmp", "arl-workflow-"),
  );
  dirs.push(app);
  for (const p of [
    ".output",
    "agent",
    "lab",
    "sandbox",
    "spike",
    "package.json",
    "package-lock.json",
  ])
    await cp(join(root, p), join(app, p), { recursive: true });
  await symlink(join(root, "node_modules"), join(app, "node_modules"), "dir");
  await mkdir(join(app, "home"));
  await mkdir(join(app, "worker-barrier"));
  await mkdir(join(app, "service-barrier"));
  const clockPath = join(app, "clock.json");
  if (clock)
    await writeFile(
      clockPath,
      JSON.stringify({ now: Date.now(), generation: 0 }),
    );
  const servicePort = await freePort(),
    workerPort = await freePort();
  const secret = randomBytes(32).toString("hex"),
    operator = randomBytes(32).toString("hex");
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(app, "home"),
    TMPDIR: app,
    NODE_ENV: "production",
    CI: "1",
    EVE_TELEMETRY_DISABLED: "1",
    ARL_TEST_MODE: "1",
    ARL_SERVICE_SECRET: secret,
    ARL_OPERATOR_SECRET: operator,
    ARL_SANDBOX_DB: join(app, "sandbox.sqlite"),
    ARL_SANDBOX_PORT: String(servicePort),
    ARL_SERVICE_URL: `http://127.0.0.1:${servicePort}`,
    ARL_LAB_MODE: "fixture",
    ARL_LAB_DB: join(app, "lab.sqlite"),
    WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS: "20",
    ...(clock ? { ARL_CLOCK_FILE: clockPath } : {}),
    ...(before ? { ARL_LAB_BARRIER_DIR: join(app, "worker-barrier") } : {}),
    ...(after ? { ARL_SERVICE_BARRIER_DIR: join(app, "service-barrier") } : {}),
  };
  const server = launch(process.execPath, ["sandbox/server.ts"], app, env);
  await until(async () => {
    if (server.child.exitCode !== null) throw new Error("sandbox exited");
    const r = await fetch(`${env.ARL_SERVICE_URL}/policy`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(500),
    });
    return r.ok;
  }, "sandbox readiness");
  let worker;
  const host = `http://127.0.0.1:${workerPort}`;
  const api = async (path, body) => {
    const r = await fetch(host + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${operator}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    const data = await r.json();
    return { status: r.status, ...data };
  };
  const start = async () => {
    worker = launch(
      "/usr/bin/python3",
      ["spike/locked-start.py", process.execPath, String(workerPort)],
      app,
      env,
    );
    await until(async () => {
      if (worker.child.exitCode !== null) throw new Error("worker exited");
      return (await api("/lab/runs")).status === 200;
    }, "worker readiness");
  };
  await start();
  const effectCount = () => {
    const db = new DatabaseSync(env.ARL_SANDBOX_DB, { readOnly: true });
    try {
      return db.prepare("SELECT count(*) AS count FROM effects").get().count;
    } finally {
      db.close();
    }
  };
  const inspect = async (id) => {
    const r = await api(`/lab/runs/${id}`);
    assert.equal(r.status, 200);
    return r;
  };
  const waiting = async (id) =>
    until(async () => {
      const r = await inspect(id);
      return r.run.state === "awaiting_approval" && r;
    }, "approval wait");
  const create = async () => {
    const r = await api("/lab/runs", { deliveryId: "delivery-001" });
    assert.equal(r.status, 201);
    return r.run.runId;
  };
  const approve = async (id) => {
    const r = await inspect(id);
    return until(async () => {
      const result = await api(`/lab/runs/${id}/approve`, {
        proposalDigest: r.run.proposal.digest,
      });
      return result.status === 200 && result;
    }, "approval API readiness");
  };
  return {
    app,
    env,
    api,
    create,
    waiting,
    approve,
    inspect,
    effectCount,
    assertAccessBoundaries: async (sessionId) => {
      const missing = await fetch(host + "/lab/runs", {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(missing.status, 403, "worker requires operator token");
      const browser = await fetch(host + "/lab/runs", {
        headers: {
          authorization: `Bearer ${operator}`,
          origin: "http://unexpected.invalid",
        },
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(browser.status, 403, "worker rejects browser Origin");
      // Even the valid operator credential must not authenticate the raw eve channel.
      const raw = new Client({
        host,
        headers: { authorization: `Bearer ${operator}` },
        redirect: "error",
      });
      await assert.rejects(
        raw.sessions
          .attach(sessionId)
          .respond([{ requestId: "untrusted-request", optionId: "approve" }], {
            signal: AbortSignal.timeout(3000),
          }),
        (error) => [401, 403].includes(error.status),
      );
      return {
        operatorMissingTokenStatus: missing.status,
        operatorOriginStatus: browser.status,
        rawEveApprovalDenied: true,
      };
    },
    advanceClock: async (now, generation) => {
      assert.ok(clock, "injected clock required");
      await writeFile(clockPath + ".next", JSON.stringify({ now, generation }));
      await rename(clockPath + ".next", clockPath);
    },
    killWorker: () => kill(worker.child),
    restart: start,
    stop: async () => {
      await kill(worker.child);
      await kill(server.child);
    },
  };
}
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
      const id = await f.create();
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
} finally {
  for (const child of [...children]) await kill(child);
  await mkdir(join(root, "reports"), { recursive: true });
  const output =
    process.env.ARL_WORKFLOW_REPORT ?? join(root, "reports/workflow.json");
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}
