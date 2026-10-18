import { assertRuntimeCompatibility } from "./runtime-compatibility.mjs";
import { Client } from "eve/client";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:net";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeCompatibility = await assertRuntimeCompatibility(root);
const dir = await mkdtemp(join(tmpdir(), "arl-owner-"));
const app = join(dir, "app");
const probe = join(dir, "probe");
const children = [];
const secret = randomBytes(32).toString("hex");
const abort = new AbortController();
const deadline = setTimeout(
  () => abort.abort(new Error("ownership experiment exceeded 45000ms")),
  45000,
);
const report = {
  schemaVersion: 1,
  experiment: "launcher-only-death",
  leaseSeconds: 20,
  frameworkVersion: "0.80.1",
  mode: "fixture",
  cases: [],
  sourceSnapshot: {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function poll(fn) {
  while (true) {
    abort.signal.throwIfAborted();
    const value = await fn();
    if (value) return value;
    await sleep(50);
  }
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
async function start() {
  const port = await freePort();
  const child = spawn(
    "/usr/bin/python3",
    [join(root, "spike/locked-start.py"), process.execPath, String(port)],
    {
      cwd: app,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: join(app, "home"),
        TMPDIR: app,
        NODE_ENV: "production",
        EVE_TELEMETRY_DISABLED: "1",
        ARL_SPIKE_TEST: "1",
        ARL_SPIKE_SECRET: secret,
        ARL_SPIKE_DIR: probe,
        ARL_SPIKE_BARRIER: "tool_started",
        WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS: "20",
      },
    },
  );
  children.push(child);
  child.on("error", () => {});
  const host = `http://127.0.0.1:${port}`;
  await poll(async () => {
    if (child.exitCode !== null)
      throw new Error(`launcher exited ${child.exitCode}`);
    try {
      return (
        await fetch(`${host}/eve/v1/health`, {
          signal: AbortSignal.timeout(500),
        })
      ).ok;
    } catch {
      return false;
    }
  });
  return {
    child,
    client: new Client({
      host,
      auth: { basic: { username: "spike", password: secret } },
      redirect: "error",
    }),
  };
}
async function log() {
  return existsSync(join(probe, "attempts.jsonl"))
    ? (await readFile(join(probe, "attempts.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
}
try {
  report.runtimeCompatibility = runtimeCompatibility;
  assert.match(process.version, /^v24\./);
  for (const p of [
    "spike/runtime-compatibility.mjs",
    "agent/tools/probe.ts",
    "spike/locked-start.py",
    "spike/ownership.mjs",
    "package-lock.json",
  ])
    report.sourceSnapshot[p] = createHash("sha256")
      .update(await readFile(join(root, p)))
      .digest("hex");
  await mkdir(app);
  await mkdir(probe);
  await mkdir(join(app, "home"));
  for (const name of [".output", "agent", "package.json", "package-lock.json"])
    await cp(join(root, name), join(app, name), { recursive: true });
  await symlink(join(root, "node_modules"), join(app, "node_modules"), "dir");
  const first = await start();
  const { session, response } = await first.client.sessions.create({
    message: "Synthetic ownership probe",
    signal: abort.signal,
  });
  const initial = await response.result();
  assert.equal(initial.status, "waiting");
  const snap = await session.snapshot({ signal: abort.signal });
  const request = snap.events.find((e) => e.type === "input.requested").data
    .requests[0];
  const resumed = await session.respond(
    [{ requestId: request.requestId, optionId: "approve" }],
    { signal: abort.signal },
  );
  resumed.result().catch(() => {});
  await poll(() => existsSync(join(probe, "barrier")));
  const original = (await log()).find((e) => e.phase === "started");
  assert.ok(original?.pid);
  report.workerWasLauncher = original.pid === first.child.pid;
  assert.equal(
    report.workerWasLauncher,
    true,
    "The actual worker must hold the launcher lock directly",
  );
  // Deliberately kill only the launcher PID, unlike earlier whole-group crash tests.
  const exited = new Promise((r) => first.child.once("exit", r));
  first.child.kill("SIGKILL");
  await exited;
  report.originalWorkerAliveAfterLauncherDeath = alive(original.pid);
  report.workerDeathObservedAtNs = process.hrtime.bigint().toString();
  const second = await start();
  report.secondStartAccepted = true;
  if (report.originalWorkerAliveAfterLauncherDeath) {
    await poll(
      async () =>
        (await log()).filter((e) => e.phase === "started").length >= 2,
    );
    report.oldWorkerStillAliveAtSecondInvocation = alive(original.pid);
    report.secondInvocationWhileOriginalBlocked = !existsSync(
      join(probe, "release"),
    );
  } else {
    report.oldWorkerStillAliveAtSecondInvocation = false;
  }
  await writeFile(join(probe, "release"), "release\n");
  await poll(async () => (await log()).some((e) => e.phase === "completed"));
  const observed = await log();
  if (!report.originalWorkerAliveAfterLauncherDeath) {
    const replacements = observed.filter(
      (e) => e.phase === "started" && e.invocationId !== original.invocationId,
    );
    assert.equal(replacements.length, 1, "One replacement invocation required");
    assert.equal(
      replacements[0].pid,
      second.child.pid,
      "Replacement worker must also hold its lock directly",
    );
    assert.equal(
      observed.filter(
        (e) =>
          e.phase === "completed" &&
          e.invocationId === replacements[0].invocationId,
      ).length,
      1,
    );
    assert.equal(
      observed.filter(
        (e) =>
          e.phase === "completed" && e.invocationId === original.invocationId,
      ).length,
      0,
    );
    report.replacementRecoveryCompleted = true;
  }
  report.attempts = observed.map(
    ({ phase, invocationId, pid, monotonicNs }) => ({
      phase,
      invocationId,
      pid,
      monotonicNs,
    }),
  );
  report.outcome = report.originalWorkerAliveAfterLauncherDeath
    ? "UNSAFE_LAUNCHER_LOCK"
    : "PASS_WORKER_HELD_LOCK";
  report.limits =
    "Single-host lock lifetime only; not a distributed lease or transactional effect test";
} catch (error) {
  report.outcome = "INCONCLUSIVE";
  report.reason = String(error.message)
    .replaceAll(secret, "[redacted]")
    .replaceAll(dir, "[temp]");
} finally {
  abort.abort();
  clearTimeout(deadline);
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await sleep(100);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(root, "spike-results"), { recursive: true });
  await writeFile(
    join(root, "spike-results/ownership.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.outcome === "PASS_WORKER_HELD_LOCK" ? 0 : 1;
}
