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
const children = new Set();
export function liveChildPids() {
  return [...children]
    .filter((child) => child.exitCode === null && child.signalCode === null)
    .map((child) => child.pid);
}
const dirs = [];
const caseEvidence = [];
/** Drain persisted per-fixture counters after each scenario has stopped. */
export function takeCaseEvidence() {
  const runs = caseEvidence.splice(0);
  if (!runs.length)
    return {
      attempts: {
        modelTurns: null,
        toolCalls: null,
        readAttempts: null,
        dispatchAttempts: null,
      },
    };
  return {
    attempts: {
      modelTurns: runs.reduce((sum, run) => sum + run.budget.modelTurns, 0),
      toolCalls: runs.reduce((sum, run) => sum + run.toolCalls, 0),
      readAttempts: runs.reduce(
        (sum, run) => sum + Object.keys(run.budget.reads).length,
        0,
      ),
      dispatchAttempts: null,
    },
  };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, label, timeout = 30000) {
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
export async function fixture({
  before = false,
  after = false,
  clock = false,
  readFailures,
  readDelayMs,
  deliveryDescription,
  fixtureToolName,
  sourceRoot = root,
} = {}) {
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
    await cp(join(sourceRoot, p), join(app, p), { recursive: true });
  await symlink(
    join(sourceRoot, "node_modules"),
    join(app, "node_modules"),
    "dir",
  );
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
    ...(readFailures === undefined
      ? {}
      : { ARL_FAULT_READ_FAILURES: String(readFailures) }),
    ...(readDelayMs === undefined
      ? {}
      : { ARL_FAULT_READ_DELAY_MS: String(readDelayMs) }),
    ...(deliveryDescription === undefined
      ? {}
      : { ARL_FAULT_DELIVERY_DESCRIPTION: deliveryDescription }),
    ...(fixtureToolName === undefined
      ? {}
      : { ARL_FAULT_TOOL_NAME: fixtureToolName }),
    ...(before ? { ARL_LAB_BARRIER_DIR: join(app, "worker-barrier") } : {}),
    ...(after ? { ARL_SERVICE_BARRIER_DIR: join(app, "service-barrier") } : {}),
  };
  const server = launch(process.execPath, ["sandbox/server.ts"], app, env);
  await until(async () => {
    if (server.child.exitCode !== null) throw new Error("sandbox exited");
    const r = await fetch(`${env.ARL_SERVICE_URL}/receipts/${"0".repeat(64)}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(500),
    });
    return r.status === 404;
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
  const create = async (limits) => {
    const r = await api("/lab/runs", {
      deliveryId: "delivery-001",
      ...(limits ? { limits } : {}),
    });
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
  let evidenceCaptured = false;
  return {
    app,
    env,
    host,
    operator,
    api,
    create,
    waiting,
    approve,
    inspect,
    effectCount,
    sandbox: async (path, body, namespace = "default") => {
      const response = await fetch(env.ARL_SERVICE_URL + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-arl-namespace": namespace,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, body: await response.json() };
    },
    competingWorker: async () => {
      const candidate = launch(
        "/usr/bin/python3",
        ["spike/locked-start.py", process.execPath, String(await freePort())],
        app,
        env,
      );
      const code = await Promise.race([
        new Promise((resolve) => candidate.child.once("exit", resolve)),
        sleep(3000).then(() => {
          throw new Error("competing worker did not reject ownership");
        }),
      ]);
      children.delete(candidate.child);
      return code;
    },
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
      if (!evidenceCaptured) {
        // A read-only connection inspects persisted records after the worker exits.
        // Query all namespace runs to include browser/API-created runs as well.
        const db = new DatabaseSync(env.ARL_LAB_DB, { readOnly: true });
        try {
          const rows = db.prepare("SELECT data FROM runs ORDER BY id").all();
          for (const row of rows) caseEvidence.push(JSON.parse(row.data));
          evidenceCaptured = true;
        } finally {
          db.close();
        }
      }
      await kill(server.child);
    },
  };
}

export async function cleanup() {
  for (const child of [...children]) await kill(child);
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}
