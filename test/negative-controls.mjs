import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  symlink,
  readFile,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const report = {
  schemaVersion: 1,
  mode: "fixture",
  cases: [],
  sourceSnapshot: {},
};
for (const p of [
  "test/negative-controls.mjs",
  "test/negative-probe.mjs",
  "test/workflow-fixture.mjs",
  "sandbox/service.ts",
  "agent/tools/delivery.ts",
  "package.json",
  "package-lock.json",
])
  report.sourceSnapshot[p] = hash(await readFile(join(root, p)));
const directories = [];
async function copy() {
  const dir = await mkdtemp(join(tmpdir(), "arl-negative-"));
  directories.push(dir);
  for (const p of [
    ".output",
    "agent",
    "sandbox",
    "lab",
    "spike",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  ])
    await cp(join(root, p), join(dir, p), { recursive: true });
  await symlink(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  await mkdir(join(dir, "home"));
  return dir;
}
async function command(cwd, args, timeout = 90000) {
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(cwd, "home"),
    TMPDIR: cwd,
    NODE_ENV: "production",
    CI: "1",
    EVE_TELEMETRY_DISABLED: "1",
  };
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  let force;
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    force = setTimeout(() => child.kill("SIGKILL"), 5000);
  }, timeout);
  try {
    return await new Promise((r, j) => {
      child.once("error", j);
      child.once("exit", (code, signal) => r({ code, signal, pid: child.pid }));
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
  }
}
async function probe(kind, sourceRoot) {
  const output = join(sourceRoot, `observation-${kind}.json`);
  const result = await command(sourceRoot, [
    join(root, "test/negative-probe.mjs"),
    kind,
    sourceRoot,
    output,
  ]);
  // SIGKILL cannot execute child cleanup: sweep only process groups recorded by
  // this exact probe in its private, parent-created temporary directory.
  if (result.signal === "SIGKILL") {
    const manifest = JSON.parse(await readFile(output + ".pids", "utf8"));
    assert.equal(manifest.ownerPid, result.pid, "probe_owner_mismatch");
    for (const pid of manifest.pids) {
      assert.ok(
        Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid,
        "invalid_probe_pid",
      );
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  return { ...result, observation: JSON.parse(await readFile(output, "utf8")) };
}
async function replace(dir, file, from, to) {
  const source = await readFile(join(dir, file), "utf8");
  assert.equal(source.split(from).length - 1, 1, "mutation_anchor_mismatch");
  const next = source.replace(from, to);
  await writeFile(join(dir, file), next);
  return {
    file,
    beforeHash: hash(source),
    afterHash: hash(next),
    replaceCount: 1,
  };
}
let activeKind, activeStarted;
try {
  for (const kind of ["idempotency", "approval"]) {
    activeKind = kind;
    activeStarted = Date.now();
    const started = Date.now(),
      baseline = await copy(),
      mutant = await copy();
    const mutations = [];
    if (kind === "idempotency") {
      mutations.push(
        await replace(
          mutant,
          "sandbox/service.ts",
          "key TEXT NOT NULL UNIQUE",
          "key TEXT NOT NULL",
        ),
      );
      mutations.push(
        await replace(
          mutant,
          "sandbox/service.ts",
          "if (existing) {",
          "if (existing && false) {",
        ),
      );
    } else {
      const from =
        'const run = store().getRun(toolInput.runId);\n                return run.intent && run.state !== "awaiting_reapproval"\n                  ? "not-applicable"\n                  : "user-approval";';
      const to =
        'const run = store().getRun(toolInput.runId);\n                if (!run.approval) store().approve(toolInput.runId, {proposalDigest:run.proposal!.digest,now:Date.now()});\n                return "not-applicable";';
      mutations.push(
        await replace(mutant, "agent/tools/delivery.ts", from, to),
      );
      const built = await command(mutant, [
        join(mutant, "node_modules/eve/bin/eve.js"),
        "build",
        "--skip-sandbox-prewarm",
      ]);
      assert.equal(built.code, 0, "mutant_build_infrastructure_failed");
    }
    const base = await probe(kind, baseline),
      changed = await probe(kind, mutant);
    const violation =
      kind === "idempotency" ? "duplicate_effect" : "unauthorized_effect";
    assert.equal(base.code, 0, "baseline_probe_failed");
    assert.equal(base.observation.status, "pass");
    assert.equal(
      changed.code,
      1,
      "mutant_detector_missed_or_infrastructure_failed",
    );
    assert.equal(changed.observation.status, "invariant_violation");
    assert.equal(changed.observation.violationCode, violation);
    assert.ok(changed.observation.effects > base.observation.effects);
    report.cases.push({
      name: `negative_${kind}_mutant_detected`,
      status: "pass",
      elapsedMs: Date.now() - started,
      effects: changed.observation.effects,
      duplicateEffects: changed.observation.duplicates,
      policyViolations: changed.observation.policyViolations,
      mutations,
      detector: {
        observed: true,
        baselineExitCode: base.code,
        mutantExitCode: changed.code,
        baselineEffects: base.observation.effects,
        mutantEffects: changed.observation.effects,
        violationCode: violation,
      },
    });
    console.log(`${kind}: baseline accepted, mutant rejected for ${violation}`);
  }
} catch (error) {
  if (
    activeKind &&
    !report.cases.some(
      (c) => c.name === `negative_${activeKind}_mutant_detected`,
    )
  )
    report.cases.push({
      name: `negative_${activeKind}_mutant_detected`,
      status: "fail",
      elapsedMs: Date.now() - activeStarted,
      failureCode: "execution_failed",
    });
  console.error(
    "negative control failed",
    activeKind,
    /^[a-z_]+$/.test(error.message) ? error.message : "infrastructure_failure",
  );
  report.failureCode = "negative_control_failed";
  process.exitCode = 1;
} finally {
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(
    join(root, "reports/negative-controls.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  for (const dir of directories)
    await rm(dir, { recursive: true, force: true });
}
