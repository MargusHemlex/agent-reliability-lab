import { assertRuntimeCompatibility } from "./runtime-compatibility.mjs";
import { createCallbackProxy } from "./callback-proxy.mjs";
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
const shortLease = false;
const lease20 = process.argv.includes("--lease-seconds=20");
const leaseOverride = shortLease || lease20;
assert.ok(!(shortLease && lease20), "Choose one lease override");
const leaseSeconds = shortLease ? 2 : lease20 ? 20 : 860;
assert.ok(
  process.argv.slice(2).every((arg) => ["--lease-seconds=20"].includes(arg)),
  "Only --short-lease or --lease-seconds=20 is accepted",
);
const report = {
  config: {
    ownershipLeaseSeconds: leaseSeconds,
    override: leaseOverride,
    status:
      "Source-observed experimental setting; not a stable documented public API",
    acceptanceWindowMs: 45000,
    heldStepMs: 22000,
    originalRecoveryGateMs: 30000,
    purpose:
      "Adversarial live-step experiment; 45s watchdog does not alter the original 30s recovery gate",
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
  "spike/overlap.mjs",
  "spike/callback-proxy.mjs",
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
report.buildSnapshot = {};
async function hashBuild(dir) {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await hashBuild(relative);
    else if (entry.isFile())
      report.buildSnapshot[relative] = createHash("sha256")
        .update(await readFile(join(root, relative)))
        .digest("hex");
  }
}
await hashBuild(".output");
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
async function start(app, probe, secret, barrier, fixedPort, callbackURL) {
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
    ...(callbackURL ? { WORKFLOW_LOCAL_BASE_URL: callbackURL } : {}),
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

function summarizeIntervals(records) {
  const starts = new Map();
  const intervals = [];
  for (const item of records) {
    assert.ok(item.invocationId && Number.isInteger(item.pid));
    assert.match(String(item.monotonicNs), /^\d+$/);
    if (item.phase === "started") {
      assert.ok(
        !starts.has(item.invocationId),
        "Unique invocation IDs required",
      );
      starts.set(item.invocationId, item);
    } else if (item.phase === "completed") {
      const first = starts.get(item.invocationId);
      assert.ok(first, "Completion requires matching start");
      intervals.push({
        invocationId: item.invocationId,
        pid: item.pid,
        startNs: first.monotonicNs,
        endNs: item.monotonicNs,
      });
    }
  }
  const points = records.map((r) => ({
    t: BigInt(r.monotonicNs),
    delta: r.phase === "started" ? 1 : -1,
  }));
  points.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.delta - b.delta));
  let active = 0,
    maxConcurrency = 0;
  for (const point of points) {
    active += point.delta;
    maxConcurrency = Math.max(active, maxConcurrency);
  }
  return {
    starts: starts.size,
    completions: intervals.length,
    maxConcurrency,
    intervals,
    openInvocations: active,
  };
}
async function runLiveCase(transport = false) {
  const dir = await mkdtemp(join(tmpdir(), "arl-overlap-"));
  const app = join(dir, "app"),
    probe = join(dir, "probe");
  await mkdir(app);
  await mkdir(probe);
  for (const name of [".output", "agent", "package.json", "package-lock.json"])
    await cp(join(root, name), join(app, name), { recursive: true });
  await symlink(join(root, "node_modules"), join(app, "node_modules"), "dir");
  const secret = randomBytes(32).toString("hex");
  const row = {
    name: "live-slow-step-with-repeated-approval-requests",
    status: "FAIL",
    coverage:
      "Repeated approval API requests only; this is NOT actual runtime queue redelivery",
    hypothesis:
      "A live held step is not concurrently re-executed by repeated approval requests before/after the experimental lease",
    duplicateResponses: [],
  };
  report.cases.push(row);
  let server, proxy, captured;
  const injectedPromises = [];
  const abort = new AbortController();
  const began = performance.now();
  const stopAt = setTimeout(
    () => abort.abort(new Error("Adversarial case watchdog exceeded 45000ms")),
    45000,
  );
  try {
    const fixedPort = await port();
    if (transport)
      proxy = await createCallbackProxy(`http://127.0.0.1:${fixedPort}`);
    if (transport) {
      row.name = "live-slow-step-with-actual-callback-redelivery";
      row.hypothesis =
        "A held live runtime step remains singleflight under actual callback redelivery before and after the configured ownership lease within one process";
      row.coverage =
        "Captured actual runtime callback replay with exact body/message identity plus a fresh-message wake after lease; one process only";
    }
    server = await start(app, probe, secret, true, fixedPort, proxy?.url);
    row.lockContenderExitCode = server.lockContenderExitCode;
    const { session, response } = await server.client.sessions.create({
      message: "Run the synthetic durability probe.",
      signal: abort.signal,
    });
    assert.equal((await response.result()).status, "waiting");
    const initial = await session.snapshot({ signal: abort.signal });
    const requestId = pending(initial)[0]?.requestId;
    assert.ok(requestId);
    const turnId = initial.events.find((e) => e.type === "turn.started")?.data
      .turnId;
    assert.ok(turnId);
    row.initialEvents = events(initial);
    const resumed = await session.respond(
      [{ requestId, optionId: "approve" }],
      { signal: abort.signal },
    );
    const resultPromise = resumed.result().then(
      (r) => ({ status: r.status }),
      (e) => ({ error: e.name }),
    );
    while (!existsSync(join(probe, "barrier"))) {
      abort.signal.throwIfAborted();
      await sleep(30);
    }
    const heldSince = performance.now();
    const duplicates = async (label) => {
      const results = await Promise.all(
        [0, 1, 2].map(async () => {
          try {
            const stream = await session.respond(
              [{ requestId, optionId: "approve" }],
              { signal: abort.signal },
            );
            // Draining does not gate the held step; settle each response after release.
            const result = stream.result().then(
              (r) => ({ status: r.status }),
              (e) => ({ error: e.name }),
            );
            return { accepted: true, result };
          } catch (e) {
            return { accepted: false, error: e.name };
          }
        }),
      );
      for (const r of results) {
        const { result, ...safe } = r;
        row.duplicateResponses.push({ label, ...safe });
        if (result) pendingResults.push({ label, result });
      }
    };
    const pendingResults = [];
    if (transport) {
      const eventDir = join(
        app,
        ".eve/.workflow-data/events",
        session.state.sessionId,
      );
      const stored = [];
      for (const file of await readdir(eventDir)) {
        if (file.endsWith(".json"))
          stored.push(JSON.parse(await readFile(join(eventDir, file), "utf8")));
      }
      const ownerEvent = stored
        .filter(
          (e) =>
            e.eventType === "step_started" &&
            e.eventData?.stepName?.endsWith("//turnStep") &&
            e.eventData?.ownerMessageId,
        )
        .sort((a, b) => a.eventId.localeCompare(b.eventId))
        .at(-1);
      assert.ok(ownerEvent, "Source-backed owner event required");
      captured = proxy.records.find(
        (r) =>
          !r.injected &&
          r.parsed?.runId === session.state.sessionId &&
          r.headers["x-vqs-message-id"] === ownerEvent.eventData.ownerMessageId,
      );
      assert.ok(
        captured,
        "Captured callback must match genuine held-step ownerMessageId",
      );
      row.callbackOwnerMatched = true;
      row.callbackOwnerMessageIdSha256 = createHash("sha256")
        .update(ownerEvent.eventData.ownerMessageId)
        .digest("hex");
      row.callbackOwnerEventSha256 = createHash("sha256")
        .update(JSON.stringify(ownerEvent))
        .digest("hex");
      injectedPromises.push(
        proxy.duplicate(captured).then(
          (r) => ({ label: "before-lease", status: r.status }),
          (e) => ({ label: "before-lease", error: e.name }),
        ),
      );
    } else await duplicates("before-lease");
    while (performance.now() - heldSince < 21000) {
      abort.signal.throwIfAborted();
      await sleep(100);
    }
    assert.equal(
      server.child.exitCode,
      null,
      "Original launcher remains alive",
    );
    assert.equal(server.child.signalCode, null);
    row.originalProcessAliveAfterLease = true;
    if (transport) {
      injectedPromises.push(
        proxy.duplicate(captured).then(
          (r) => ({
            label: leaseOverride
              ? "after-20s-lease"
              : "after-21s-within-default-lease",
            status: r.status,
          }),
          (e) => ({
            label: leaseOverride
              ? "after-20s-lease"
              : "after-21s-within-default-lease",
            error: e.name,
          }),
        ),
      );
      injectedPromises.push(
        proxy.duplicate(captured, { freshMessageId: true }).then(
          (r) => ({
            label: leaseOverride
              ? "after-20s-lease-fresh-wake"
              : "after-21s-within-default-lease-fresh-wake",
            status: r.status,
          }),
          (e) => ({
            label: leaseOverride
              ? "after-20s-lease-fresh-wake"
              : "after-21s-within-default-lease-fresh-wake",
            error: e.name,
          }),
        ),
      );
    } else
      await duplicates(
        leaseOverride ? "after-20s-lease" : "after-21s-not-default-lease",
      );
    const held = await session.snapshot({ signal: abort.signal });
    row.heldEvents = events(held);
    assert.ok(
      !held.events.some(
        (e) => e.type === "turn.completed" && e.data.turnId === turnId,
      ),
      "Held turn must not complete prematurely",
    );
    row.heldIntervalSummary = summarizeIntervals(await attempts(probe));
    while (performance.now() - heldSince < 22000) {
      abort.signal.throwIfAborted();
      await sleep(30);
    }
    row.releaseAfterMs = Math.round(performance.now() - heldSince);
    await writeFile(join(probe, "release"), "release\n");
    while (true) {
      abort.signal.throwIfAborted();
      const final = await session.snapshot({ signal: abort.signal });
      row.events = events(final);
      row.finalPendingRequests = pending(final).length;
      if (
        final.events.some(
          (e) => e.type === "turn.completed" && e.data.turnId === turnId,
        )
      )
        break;
      if (
        final.events.some((e) =>
          ["turn.failed", "session.failed"].includes(e.type),
        )
      )
        throw Error("Terminal failure");
      await sleep(50);
    }
    row.initialApprovalResult = await bounded(
      resultPromise,
      2000,
      "approval result",
    );
    for (const item of pendingResults)
      row.duplicateResponses.push({
        label: item.label,
        settled: await bounded(item.result, 2000, "duplicate response result"),
      });
    row.intervalSummary = summarizeIntervals(await attempts(probe));
    assert.equal(row.intervalSummary.starts, 1);
    assert.equal(row.intervalSummary.completions, 1);
    assert.equal(row.intervalSummary.maxConcurrency, 1);
    if (transport) {
      row.injectedCallbackResults = await bounded(
        Promise.all(injectedPromises),
        3000,
        "callback completions",
      );
      assert.ok(
        row.injectedCallbackResults.every((r) => r.status === 200),
        "Every injected callback must complete successfully",
      );
      row.callbackTransports = proxy.summary();
      row.singleflightLogObserved = server
        .logs()
        .includes(
          "Step execution already in flight in this process; awaiting its settlement instead of executing again",
        );
    }
    await sleep(1000);
    const settled = await session.snapshot({ signal: abort.signal });
    row.extraTurnsObserved = settled.events.filter(
      (e) => e.type === "turn.started" && e.data.turnId !== turnId,
    ).length;
    assert.equal(row.finalPendingRequests, 0, "No approval may remain pending");
    if (transport)
      assert.equal(
        row.extraTurnsObserved,
        0,
        "Callback replay must not create a new turn",
      );
    row.sameTurnCompleted = true;
    row.status = "PASS";
  } catch (error) {
    row.reason = String(error.message)
      .replaceAll(secret, "[redacted]")
      .replaceAll(dir, "[temp]")
      .slice(0, 2000);
  } finally {
    if (proxy) row.callbackTransports = proxy.summary();
    clearTimeout(stopAt);
    abort.abort();
    await kill(server?.child);
    if (proxy) await proxy.close();
    row.attempts = await attempts(probe);
    row.durationMs = Math.round(performance.now() - began);
    if (server)
      row.sanitizedRuntimeLogSha256 = createHash("sha256")
        .update(server.logs())
        .digest("hex");
    await rm(dir, { recursive: true, force: true });
  }
}
try {
  assert.match(process.version, /^v24\./, "Run spike with Node 24");
  await runLiveCase();
  await runLiveCase(true);
} catch (error) {
  report.error = String(error.message);
} finally {
  for (const child of children) await kill(child);
  report.outcome =
    !report.error &&
    report.cases.length === 2 &&
    report.cases.every((c) => c.status === "PASS")
      ? "LIVE_OVERLAP_CASES_PASS"
      : "NO_GO";
  report.limitations = [
    "Case1 repeats approval requests; case2 replays captured callbacks in one process",
    "Default 860s lease is not crossed by the 22s hold",
    "No external side effects or paid model calls",
  ];
  await mkdir(join(root, "spike-results"), { recursive: true });
  const output = JSON.stringify(report, null, 2) + "\n";
  await writeFile(
    join(
      root,
      "spike-results",
      leaseOverride ? "overlap-lease20.json" : "overlap-default.json",
    ),
    output,
  );
  console.log(output);
  process.exitCode = report.outcome === "NO_GO" ? 1 : 0;
}
