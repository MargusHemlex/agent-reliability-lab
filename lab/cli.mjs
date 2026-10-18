import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const state = join(root, ".local/lab");
const file = join(state, "config.json");
const [command, ...args] = process.argv.slice(2);
assert.match(process.version, /^v24\./, "Node 24 is required");
const print = (value) => console.log(JSON.stringify(value, null, 2));
async function readConfig() {
  const value = JSON.parse(await readFile(file, "utf8"));
  if (
    ![value.operatorSecret, value.serviceSecret].every(
      (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s),
    ) ||
    ![value.workerPort, value.servicePort].every(
      (p) => Number.isInteger(p) && p >= 1024 && p <= 65535,
    ) ||
    value.workerPort === value.servicePort
  )
    throw new Error("Invalid local configuration");
  return value;
}
async function api(cfg, path, body) {
  const r = await fetch(`http://127.0.0.1:${cfg.workerPort}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${cfg.operatorSecret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(
      `Lab request rejected (${r.status}): ${result.error ?? "request_failed"}`,
    );
  return result;
}
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error("A valid run ID is required");
  return value;
}
async function serve(cfg) {
  if (!existsSync(join(root, ".output/server/index.mjs")))
    throw new Error("Build first: npm run build");
  await mkdir(join(state, "home"), { recursive: true, mode: 0o700 });
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(state, "home"),
    TMPDIR: state,
    NODE_ENV: "production",
    EVE_TELEMETRY_DISABLED: "1",
    ARL_LAB_MODE: "fixture",
    ARL_LAB_DB: join(state, "application.sqlite"),
    ARL_SANDBOX_DB: join(state, "sandbox.sqlite"),
    ARL_SANDBOX_PORT: String(cfg.servicePort),
    ARL_SERVICE_URL: `http://127.0.0.1:${cfg.servicePort}`,
    ARL_SERVICE_SECRET: cfg.serviceSecret,
    ARL_OPERATOR_SECRET: cfg.operatorSecret,
    WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS: "20",
  };
  const children = [];
  let stopping = false;
  function start(binary, arguments_) {
    const child = spawn(binary, arguments_, {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    children.push(child);
    return child;
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const child of children)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const service = start(process.execPath, ["sandbox/server.ts"]);
    const deadline = Date.now() + 10000;
    while (true) {
      if (service.exitCode !== null)
        throw new Error("Sandbox exited before readiness");
      try {
        const r = await fetch(
          `${env.ARL_SERVICE_URL}/deliveries/delivery-001`,
          {
            headers: { authorization: `Bearer ${cfg.serviceSecret}` },
            signal: AbortSignal.timeout(500),
          },
        );
        if (r.ok) break;
      } catch {}
      if (Date.now() > deadline) throw new Error("Sandbox startup timeout");
      await new Promise((r) => setTimeout(r, 100));
    }
    const worker = start("/usr/bin/python3", [
      "spike/locked-start.py",
      process.execPath,
      String(cfg.workerPort),
    ]);
    print({
      event: "fixture_lab_starting",
      mode: "fixture",
      worker: `http://127.0.0.1:${cfg.workerPort}`,
      operator: `http://127.0.0.1:${cfg.workerPort}/operator`,
      service: `http://127.0.0.1:${cfg.servicePort}`,
      credentials: "local ignored configuration; never printed",
    });
    await Promise.race(
      children.map(
        (child) =>
          new Promise((r, j) => {
            child.once("error", j);
            child.once("exit", (code, signal) =>
              stopping
                ? r()
                : j(new Error(`Lab child exited (${code ?? signal})`)),
            );
          }),
      ),
    );
  } finally {
    stop();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
try {
  if (command === "init") {
    if (args.length) throw new Error("init takes no arguments");
    await mkdir(state, { recursive: true, mode: 0o700 });
    await chmod(state, 0o700);
    if (!existsSync(file)) {
      await writeFile(
        file,
        JSON.stringify(
          {
            operatorSecret: randomBytes(32).toString("hex"),
            serviceSecret: randomBytes(32).toString("hex"),
            workerPort: 4318,
            servicePort: 4319,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600, flag: "wx" },
      );
    }
    await readConfig();
    await chmod(file, 0o600);
    print({
      status: "initialized",
      mode: "fixture",
      secrets: "stored locally and excluded from Git",
    });
  } else if (command === "operator-secret") {
    if (args.length) throw new Error("operator-secret takes no arguments");
    console.log((await readConfig()).operatorSecret);
  } else if (command === "reset") {
    if (args.length) throw new Error("reset takes no arguments");
    print(await api(await readConfig(), "/lab/namespaces/reset", {}));
  } else if (command === "serve") {
    if (args.length) throw new Error("serve takes no arguments");
    await serve(await readConfig());
  } else if (command === "run") {
    if (args.length) throw new Error("run takes no arguments");
    print(
      await api(await readConfig(), "/lab/runs", {
        deliveryId: "delivery-001",
      }),
    );
  } else if (command === "list") {
    print(await api(await readConfig(), "/lab/runs"));
  } else if (command === "inspect") {
    print(await api(await readConfig(), `/lab/runs/${id(args[0])}`));
  } else if (command === "approve") {
    if (!/^[a-f0-9]{64}$/.test(args[1] ?? ""))
      throw new Error("Explicit inspected proposal digest is required");
    print(
      await api(await readConfig(), `/lab/runs/${id(args[0])}/approve`, {
        proposalDigest: args[1],
      }),
    );
  } else if (["reject", "cancel", "resume"].includes(command)) {
    print(
      await api(await readConfig(), `/lab/runs/${id(args[0])}/${command}`, {}),
    );
  } else
    print({
      usage: [
        "init",
        "operator-secret",
        "reset",
        "serve",
        "run",
        "list",
        "inspect RUN_ID",
        "approve RUN_ID PROPOSAL_DIGEST",
        "reject RUN_ID",
        "cancel RUN_ID",
        "resume RUN_ID",
      ],
      mode: "fixture",
      liveMode: "not implemented",
    });
} catch (error) {
  console.error(
    JSON.stringify({
      error:
        error.code === "ENOENT"
          ? "Initialize first: npm run lab -- init"
          : error.message,
    }),
  );
  process.exitCode = 1;
}
