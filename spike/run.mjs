import { assertRuntimeCompatibility } from "./runtime-compatibility.mjs";
import { Client } from "eve/client";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shortLease = process.argv.includes("--short-lease");
const lease20 = process.argv.includes("--lease-seconds=20");
const leaseOverride = shortLease || lease20;
assert.ok(!(shortLease && lease20), "Choose one lease override");
const leaseSeconds = shortLease ? 2 : lease20 ? 20 : 860;
assert.ok(
  process.argv
    .slice(2)
    .every((arg) => ["--short-lease", "--lease-seconds=20"].includes(arg)),
  "Only --short-lease or --lease-seconds=20 is accepted",
);
const report = {
  config: {
    ownershipLeaseSeconds: leaseSeconds,
    override: leaseOverride,
    status:
      "Source-observed experimental setting; not a stable documented public API",
    acceptanceWindowMs: 30000,
  },
  schemaVersion: 1,
  framework: {
    name: "eve",
    version: JSON.parse(
      await readFile(join(root, "node_modules/eve/package.json"), "utf8"),
    ).version,
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    localOnly: true,
    model: "deterministic-test-model",
    inheritedCredentials: false,
  },
  cases: [],
};
report.runtimeCompatibility = await assertRuntimeCompatibility(root);
const sourceFiles = [
  "package.json",
  "package-lock.json",
  "spike/runtime-compatibility.mjs",
  "spike/run.mjs",
  "spike/locked-start.py",
];
async function addSources(dir) {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await addSources(relative);
    else if (entry.isFile()) sourceFiles.push(relative);
  }
}
await addSources("agent");
report.sourceSnapshot = {};
for (const relative of sourceFiles.sort())
  report.sourceSnapshot[relative] = createHash("sha256")
    .update(await readFile(join(root, relative)))
    .digest("hex");
const leaseHelperPath =
  "node_modules/eve/dist/src/compiled/_chunks/workflow/helpers-DlLD3ov_.js";
report.framework.leaseHelperSha256 = createHash("sha256")
  .update(await readFile(join(root, leaseHelperPath)))
  .digest("hex");
if (leaseOverride)
  assert.equal(
    report.framework.leaseHelperSha256,
    "747627feb4fc23f0bd998d2f4ca42969b6681380ded6d57fef3dd6fe5ca14903",
    "Experimental lease override requires reviewed helper bytes",
  );
const children = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function kill(child) {
  if (!child) return;
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((r) => child.once("exit", r));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  children.delete(child);
  await bounded(exited, 3000, "process exit");
}
async function port() {
  const server = createServer();
  await new Promise((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  const value = server.address().port;
  await new Promise((r) => server.close(r));
  return value;
}
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function events(snapshot) {
  return snapshot.events.map((event) => event.type);
}
function pending(snapshot) {
  const open = new Map();
  for (const event of snapshot.events) {
    if (event.type === "input.requested")
      for (const request of event.data.requests)
        open.set(request.requestId, request);
    if (event.type === "input.resolved")
      for (const resolution of event.data.resolutions)
        open.delete(resolution.requestId);
  }
  return [...open.values()];
}
async function attempts(dir) {
  const file = join(dir, "attempts.jsonl");
  return existsSync(file)
    ? (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
}
async function start(app, probe, secret, barrier, fixedPort) {
  const listenPort = fixedPort ?? (await port());
  const host = `http://127.0.0.1:${listenPort}`;
  // Explicit allowlist: no provider tokens, user config, telemetry credentials or .env files.
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(app, "home"),
    TMPDIR: app,
    NODE_ENV: "production",
    CI: "1",
    EVE_TELEMETRY_DISABLED: "1",
    ...(leaseOverride
      ? { WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS: String(leaseSeconds) }
      : {}),
    ARL_SPIKE_TEST: "1",
    ARL_SPIKE_DIR: probe,
    ARL_SPIKE_SECRET: secret,
    ...(barrier ? { ARL_SPIKE_BARRIER: "tool_started" } : {}),
  };
  await mkdir(env.HOME, { recursive: true });
  const child = spawn(
    "/usr/bin/python3",
    [join(root, "spike/locked-start.py"), process.execPath, String(listenPort)],
    { cwd: app, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.add(child);
  let stopped = false;
  let logs = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk.toString()).slice(-16000);
    });
  child.on("error", () => {});
  const client = new Client({
    host,
    auth: { basic: { username: "spike", password: secret } },
    redirect: "error",
  });
  try {
    await bounded(
      (async () => {
        while (true) {
          if (stopped) return;
          if (child.exitCode !== null)
            throw new Error(
              `Server exited ${child.exitCode}: ${logs.replaceAll(secret, "[redacted]").replaceAll(app, "[temp]")}`,
            );
          try {
            const response = await fetch(`${host}/eve/v1/health`, {
              signal: AbortSignal.timeout(1000),
              headers: {
                authorization: `Basic ${Buffer.from(`spike:${secret}`).toString("base64")}`,
              },
            });
            if (response.ok) return;
          } catch {}
          await sleep(100);
        }
      })(),
      30000,
      "server startup",
    );
  } catch (error) {
    stopped = true;
    await kill(child);
    throw new Error(
      `${error.message}: ${logs.replaceAll(secret, "[redacted]").replaceAll(app, "[temp]")}`,
    );
  }
  const contender = spawn(
    "/usr/bin/python3",
    [join(root, "spike/locked-start.py"), process.execPath, String(listenPort)],
    { cwd: app, env, detached: true, stdio: "ignore" },
  );
  children.add(contender);
  const contenderCode = await bounded(
    new Promise((r, j) => {
      contender.once("error", j);
      contender.once("exit", r);
    }),
    3000,
    "lock contender",
  );
  children.delete(contender);
  assert.equal(
    contenderCode,
    73,
    "Second worker must fail closed on the OS lock",
  );
  return {
    child,
    client,
    port: listenPort,
    lockContenderExitCode: contenderCode,
    logs: () =>
      logs
        .replaceAll(secret, "[redacted]")
        .replaceAll(app, "[temp-app]")
        .replaceAll(probe, "[temp-probe]"),
  };
}
async function runCase(name, crashTool) {
  const dir = await mkdtemp(join(tmpdir(), "arl-spike-"));
  const app = join(dir, "app");
  const probe = join(dir, "probe");
  await mkdir(app);
  await mkdir(probe);
  for (const name of [".output", "agent", "package.json", "package-lock.json"])
    await cp(join(root, name), join(app, name), { recursive: true });
  await symlink(join(root, "node_modules"), join(app, "node_modules"), "dir");
  const secret = randomBytes(32).toString("hex");
  const row = { name, status: "FAIL", attempts: [], events: [] };
  report.cases.push(row);
  let server;
  const abort = new AbortController();
  const began = performance.now();
  try {
    server = await start(app, probe, secret, crashTool);
    row.lockContenderExitCode = server.lockContenderExitCode;
    await bounded(
      (async () => {
        const { session, response } = await server.client.sessions.create({
          message: "Run the synthetic durability probe.",
          signal: abort.signal,
        });
        const initial = await response.result();
        assert.equal(initial.status, "waiting");
        const snapshot = await session.snapshot({ signal: abort.signal });
        const requests = pending(snapshot);
        assert.equal(requests.length, 1);
        const turnId = snapshot.events.find(
          (event) => event.type === "turn.started",
        )?.data.turnId;
        assert.ok(turnId);
        assert.equal(
          snapshot.events.some((event) => event.type === "turn.completed"),
          false,
        );
        row.initialEvents = events(snapshot);
        row.pendingRequestPersisted = false;
        assert.equal(
          (await attempts(probe)).length,
          0,
          "Tool must not run before approval",
        );
        const sessionId = session.state.sessionId;
        const requestId = requests[0].requestId;
        if (!crashTool) {
          await kill(server.child);
          server = await start(app, probe, secret, false, server.port);
          const attached = server.client.sessions.attach(sessionId);
          const recovered = await attached.snapshot({ signal: abort.signal });
          assert.deepEqual(
            pending(recovered).map((r) => r.requestId),
            [requestId],
          );
          row.pendingRequestPersisted = true;
          const current = server.client.sessions.attach(sessionId, {
            streamIndex: recovered.session.streamIndex,
          });
          const resumed = await current.respond(
            [{ requestId, optionId: "approve" }],
            { signal: abort.signal },
          );
          const result = await resumed.result();
          row.responseBoundary = result.status;
          while (true) {
            abort.signal.throwIfAborted();
            const final = await attached.snapshot({ signal: abort.signal });
            row.events = events(final);
            if (
              final.events.some(
                (event) =>
                  event.type === "turn.completed" &&
                  event.data.turnId === turnId,
              )
            ) {
              assert.equal(pending(final).length, 0);
              break;
            }
            if (
              row.events.some((e) =>
                ["turn.failed", "session.failed"].includes(e),
              )
            )
              throw new Error("Approval resumed into terminal failure");
            await sleep(100);
          }
          const observed = await attempts(probe);
          assert.equal(observed.filter((a) => a.phase === "started").length, 1);
          assert.equal(
            observed.filter((a) => a.phase === "completed").length,
            1,
          );
          row.status = "PASS";
        } else {
          const resumed = await session.respond(
            [{ requestId, optionId: "approve" }],
            { signal: abort.signal },
          );
          // Drain this stream; killing the process is expected to interrupt the transport.
          resumed.result().catch(() => {});
          while (!existsSync(join(probe, "barrier"))) {
            abort.signal.throwIfAborted();
            await sleep(50);
          }
          assert.equal(
            (await attempts(probe)).filter((a) => a.phase === "started").length,
            1,
          );
          await kill(server.child);
          await writeFile(join(probe, "release"), "release\n");
          server = await start(app, probe, secret, true, server.port);
          const attached = server.client.sessions.attach(sessionId);
          while (true) {
            abort.signal.throwIfAborted();
            const recovered = await attached.snapshot({ signal: abort.signal });
            row.events = events(recovered);
            if (
              recovered.events.some(
                (event) =>
                  event.type === "turn.completed" &&
                  event.data.turnId === turnId,
              )
            ) {
              assert.equal(pending(recovered).length, 0);
              row.status = "PASS";
              row.recoveredAfterInterruptedTool = true;
              break;
            }
            if (
              row.events.some((e) =>
                ["turn.failed", "session.failed"].includes(e),
              )
            ) {
              row.reason =
                "Framework recorded terminal failure after interrupted tool";
              break;
            }
            await sleep(100);
          }
          const observed = await attempts(probe);
          assert.equal(
            observed.filter((a) => a.phase === "completed").length,
            1,
            "One completed local probe required",
          );
          row.toolStartedAttempts = observed.filter(
            (a) => a.phase === "started",
          ).length;
          row.note =
            "Interrupted tool may be retried. This is not an exactly-once side-effect guarantee.";
        }
      })(),
      30000,
      name,
    );
  } catch (error) {
    row.status = "FAIL";
    row.reason = String(error.message)
      .replaceAll(secret, "[redacted]")
      .replaceAll(dir, "[temp]")
      .slice(0, 2000);
  } finally {
    abort.abort();
    await kill(server?.child);
    if (process.env.ARL_SPIKE_LOG_DIR && server) {
      await mkdir(process.env.ARL_SPIKE_LOG_DIR, { recursive: true });
      await writeFile(
        join(process.env.ARL_SPIKE_LOG_DIR, `${name}.log`),
        server.logs(),
      );
    }
    row.attempts = (await attempts(probe)).map(({ phase }) => ({ phase }));
    row.durationMs = Math.round(performance.now() - began);
    await rm(dir, { recursive: true, force: true });
  }
}
try {
  assert.match(process.version, /^v24\./, "Run spike with Node 24");
  await runCase("approval-survives-process-restart", false);
  await runCase("interrupted-tool-recovery", true);
} catch (error) {
  report.error = String(error.message);
} finally {
  for (const child of children) await kill(child);
  report.outcome =
    !report.error &&
    report.cases.length === 2 &&
    report.cases.every((c) => c.status === "PASS")
      ? leaseOverride
        ? "CONDITIONAL_GO"
        : "GO"
      : "NO_GO";
  await mkdir(join(root, "spike-results"), { recursive: true });
  await writeFile(
    join(root, "spike-results/latest.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.outcome === "NO_GO" ? 1 : 0;
}
