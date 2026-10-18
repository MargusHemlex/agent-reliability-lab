import { spawn } from "node:child_process";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReportBuilder } from "../evaluation/reporting.ts";
import { DEFAULT_LIMITS } from "../agent/lib/lab/limits.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  await readFile(join(root, "fixtures/evaluation-catalog.json"), "utf8"),
);
const builder = await createReportBuilder({
  root,
  catalog: catalog.cases,
  configuration: { ...DEFAULT_LIMITS, leaseSeconds: 20, mode: "fixture" },
  namespaceVersion: "isolated-dataset-v1",
  fixtureVersion: catalog.fixtureVersion,
});
let infrastructureFailure = null;
const seen = new Set();
async function command(file) {
  const child = spawn(process.execPath, [file], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  return await new Promise((r, j) => {
    child.once("error", j);
    child.once("exit", (code) => r(code));
  });
}
try {
  for (const [script, output] of [
    ["test/workflow.mjs", "workflow"],
    ["test/milestone3.mjs", "milestone3"],
    ["test/evaluation.mjs", "evaluation"],
    ["test/negative-controls.mjs", "negative-controls"],
  ]) {
    const path = join(root, `reports/${output}.json`);
    await rm(path, { force: true }); // A failed subprocess cannot reuse an older passing result.
    let exitCode;
    try {
      exitCode = await command(script);
    } catch {
      exitCode = 2;
    }
    let data;
    try {
      data = JSON.parse(await readFile(path, "utf8"));
    } catch {
      infrastructureFailure = "suite_failed";
      break;
    }
    if (!data.sourceSnapshot || !Object.keys(data.sourceSnapshot).length)
      throw Error("missing_evidence_snapshot");
    for (const [file, expected] of Object.entries(data.sourceSnapshot)) {
      if (
        !/^[A-Za-z0-9_./-]+$/.test(file) ||
        file.split("/").includes("..") ||
        file.startsWith("/")
      )
        throw Error("invalid_evidence_path");
      const actual = createHash("sha256")
        .update(await readFile(join(root, file)))
        .digest("hex");
      if (actual !== expected) throw Error("stale_evidence");
    }
    if (!Array.isArray(data.cases)) throw Error("invalid_evidence");
    for (const row of data.cases) {
      if (seen.has(row.name) || !catalog.cases.some((c) => c.id === row.name))
        throw Error("unexpected_evidence_case");
      seen.add(row.name);
      builder.startCase(row.name);
      const expected = catalog.cases.find((c) => c.id === row.name);
      const mismatch =
        expected.kind === "scenario" &&
        row.effects != null &&
        row.effects !== expected.expectedEffects;
      builder.endCase(row.name, {
        status: row.status === "pass" && !mismatch ? "pass" : "fail",
        effects: {
          observed: row.effects ?? null,
          duplicates: row.duplicateEffects ?? null,
        },
        attempts: row.attempts ?? { toolCalls: row.toolCalls ?? null },
        policyViolations: row.policyViolations ?? null,
        recoveryMs: row.recoveryMs ?? null,
        latencyMs: row.elapsedMs ?? null,
        barrierId: row.name.includes("before_dispatch")
          ? "before-dispatch-v1"
          : row.name.includes("after_sandbox_commit")
            ? "after-sandbox-commit-v1"
            : null,
        detector: row.detector
          ? { ...row.detector, mutations: row.mutations }
          : undefined,
        failureCode: mismatch
          ? "effect_mismatch"
          : (row.failureCode ?? "assertion_failed"),
      });
    }
    if (exitCode !== 0) {
      infrastructureFailure = "suite_failed";
      break;
    }
  }
} catch {
  infrastructureFailure = "invalid_evidence";
} finally {
  const result = await builder.finish({
    outputDir: join(root, "reports/evaluation"),
    infrastructureFailure,
    validateFresh: true,
  });
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(
    join(root, "reports/evaluation-latest.json"),
    JSON.stringify({
      reportId: result.report.reportId,
      json: relative(root, result.jsonPath),
      markdown: relative(root, result.markdownPath),
    }) + "\n",
  );
  console.log(
    JSON.stringify({
      overall: result.report.overall,
      summary: result.report.summary,
      json: relative(root, result.jsonPath),
      markdown: relative(root, result.markdownPath),
    }),
  );
  if (infrastructureFailure || result.report.overall !== "pass")
    process.exitCode = 1;
}
