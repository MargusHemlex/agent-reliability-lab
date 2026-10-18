import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fixture, cleanup, until } from "./workflow-fixture.mjs";
import { liveSourceSnapshot } from "../evaluation/live-report.ts";
// Focused teaching evidence, not the complete 33-case evaluation schema.
const root = resolve(import.meta.dirname, "..");
const source = await liveSourceSnapshot(root);
const count = z.number().int().nonnegative();
const Case = z
  .object({
    id: z.enum(["rejected_approval", "after_commit_recovery"]),
    status: z.enum(["pass", "fail", "not_run"]),
    expectedEffects: count,
    observedEffects: count.nullable(),
    recoveryMs: z.number().nonnegative().nullable(),
    keyPreserved: z.boolean().nullable(),
  })
  .strict();
const Report = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("guided_fixture_walkthrough"),
    mode: z.literal("fixture"),
    modelDecisions: z.literal("scripted"),
    reportId: z.uuid(),
    source: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        dirty: z.boolean(),
        files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
        dependencyHash: z.string(),
        fixtureHash: z.string(),
      })
      .strict(),
    overall: z.enum(["pass", "fail"]),
    failure: z.enum(["scenario_failed", "source_changed"]).nullable(),
    cases: z.array(Case).length(2),
  })
  .strict()
  .superRefine((r, c) => {
    const passed =
      r.failure === null &&
      r.cases.every(
        (v) => v.status === "pass" && v.observedEffects === v.expectedEffects,
      ) &&
      r.cases[0].id === "rejected_approval" &&
      r.cases[0].expectedEffects === 0 &&
      r.cases[1].id === "after_commit_recovery" &&
      r.cases[1].expectedEffects === 1 &&
      r.cases[1].keyPreserved === true &&
      r.cases[1].recoveryMs !== null &&
      r.cases[1].recoveryMs <= 30000;
    if ((r.overall === "pass") !== passed)
      c.addIssue({ code: "custom", message: "Walkthrough verdict mismatch" });
  });
const checkpoint = (event, data = {}) =>
  console.log(JSON.stringify({ event, ...data }));
const cases = [
  {
    id: "rejected_approval",
    status: "not_run",
    expectedEffects: 0,
    observedEffects: null,
    recoveryMs: null,
    keyPreserved: null,
  },
  {
    id: "after_commit_recovery",
    status: "not_run",
    expectedEffects: 1,
    observedEffects: null,
    recoveryMs: null,
    keyPreserved: null,
  },
];
let failure = null,
  index = 0;
try {
  checkpoint("fixture_only", { actualProviderCalls: 0 });
  let f = await fixture();
  try {
    const id = await f.create();
    await f.waiting(id);
    assert.equal(f.effectCount(), 0);
    assert.equal((await f.api(`/lab/runs/${id}/reject`, {})).status, 200);
    assert.equal((await f.inspect(id)).run.intent, null);
    assert.equal(f.effectCount(), 0);
    cases[0].observedEffects = 0;
    cases[0].status = "pass";
    checkpoint("approval_rejected", { effects: 0 });
  } finally {
    await f.stop();
  }
  index = 1;
  f = await fixture({ after: true });
  try {
    const id = await f.create();
    await f.waiting(id);
    assert.equal(f.effectCount(), 0);
    checkpoint("proposal_awaiting_approval", { effects: 0 });
    await f.approve(id);
    await until(
      () => existsSync(join(f.app, "service-barrier", "committed")),
      "sandbox commit barrier",
    );
    const pending = (await f.inspect(id)).run;
    assert.equal(pending.receipt, null);
    assert.equal(pending.state, "executing");
    assert.equal(f.effectCount(), 1);
    checkpoint("sandbox_committed_before_worker_checkpoint", {
      effects: 1,
      workerReceipt: null,
    });
    await f.killWorker();
    await writeFile(join(f.app, "service-barrier", "release"), "release");
    const started = Date.now();
    checkpoint("worker_killed_restarting");
    await f.restart();
    const done = await until(
      async () => {
        const { run } = await f.inspect(id);
        return run.state === "succeeded" && run;
      },
      "receipt recovery",
      30000,
    );
    const recoveryMs = Date.now() - started;
    assert.ok(recoveryMs <= 30000);
    assert.equal(done.intent.key, pending.intent.key);
    assert.ok(done.receipt);
    assert.equal(f.effectCount(), 1);
    Object.assign(cases[1], {
      status: "pass",
      observedEffects: 1,
      recoveryMs,
      keyPreserved: true,
    });
    checkpoint("reconciled_one_effect", {
      effects: 1,
      recoveryMs,
      keyPreserved: true,
    });
  } finally {
    await f.stop();
  }
} catch {
  failure = "scenario_failed";
  cases[index].status = "fail";
} finally {
  try {
    await cleanup();
  } catch {
    failure = "scenario_failed";
  }
}
if (JSON.stringify(source) !== JSON.stringify(await liveSourceSnapshot(root)))
  failure = "source_changed";
const report = Report.parse({
  schemaVersion: 1,
  kind: "guided_fixture_walkthrough",
  mode: "fixture",
  modelDecisions: "scripted",
  reportId: randomUUID(),
  source,
  overall: failure ? "fail" : "pass",
  failure,
  cases,
});
const dir = join(root, "reports/walkthrough");
await mkdir(dir, { recursive: true });
const base = join(dir, report.reportId);
await writeFile(base + ".json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
await writeFile(
  base + ".md",
  `# Guided fixture walkthrough\n\nOverall: **${report.overall}**. Scripted model; no provider calls. Source: ${source.commit}; dirty: ${source.dirty}.\n\n| Case | Result | Observed / expected effects | Recovery ms |\n|---|---|---|---|\n${cases.map((c) => `| ${c.id} | ${c.status} | ${c.observedEffects ?? "unknown"} / ${c.expectedEffects} | ${c.recoveryMs ?? "unknown"} |`).join("\n")}\n\nTwo focused samples; this is not the full evaluation suite or a production reliability estimate.\n`,
  { flag: "wx" },
);
checkpoint("walkthrough_complete", {
  overall: report.overall,
  json: `reports/walkthrough/${report.reportId}.json`,
  markdown: `reports/walkthrough/${report.reportId}.md`,
});
if (report.overall !== "pass") process.exitCode = 1;
