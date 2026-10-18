import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const count = z.number().int().nonnegative().safe();
const measured = count.nullable();
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/);
export const LivePriceTableSchema = z
  .object({
    datedAt: z.iso.date(),
    source: z
      .string()
      .url()
      .refine((v) => new URL(v).protocol === "https:"),
    modelId: identifier,
    inputUsdPerMillion: z.number().nonnegative().finite(),
    outputUsdPerMillion: z.number().nonnegative().finite(),
  })
  .strict();
export const LiveCallSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: z
      .enum([
        "completed",
        "live_failed",
        "live_timeout_or_abort",
        "live_not_dispatched_deadline",
      ])
      .nullable(),
    reservedCostMicrousd: count,
    estimatedCostMicrousd: measured,
    inputTokens: measured,
    outputTokens: measured,
    provider: identifier.nullable(),
    returnedModelId: identifier.nullable(),
    providerVersion: identifier.nullable(),
  })
  .strict();
export const LiveRunSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    status: z.enum(["pass", "fail", "not_run"]),
    expectedEffects: count,
    observedEffects: measured,
    attempts: z
      .object({
        modelTurns: measured,
        toolCalls: measured,
        readAttempts: measured,
        dispatchAttempts: measured,
      })
      .strict(),
    inputTokens: measured,
    outputTokens: measured,
    estimatedCostUsd: z.number().nonnegative().finite().nullable(),
    unknownUsage: z.boolean(),
    ledger: z.array(LiveCallSchema).max(5),
    latencyMs: z.number().nonnegative().finite().nullable(),
    policyViolations: measured,
    duplicateEffects: measured,
  })
  .strict();
export const LiveReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("live"),
    reportId: z.uuid(),
    createdAt: z.iso.datetime(),
    overall: z.enum(["pass", "fail", "not_run"]),
    execution: z
      .object({
        status: z.enum(["completed", "failed", "not_run"]),
        failure: z
          .enum([
            "missing_credentials",
            "missing_opt_in",
            "missing_model",
            "missing_smoke_approval",
            "invalid_configuration",
            "suite_failed",
            "invalid_evidence",
            "source_changed",
          ])
          .nullable(),
      })
      .strict(),
    source: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        dirty: z.boolean(),
        files: z.record(
          z
            .string()
            .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/),
          z.string().regex(/^[a-f0-9]{64}$/),
        ),
        dependencyHash: z.string().regex(/^[a-f0-9]{64}$/),
        configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
        fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    model: z
      .object({
        requestedModelId: identifier,
        provider: identifier.nullable(),
        returnedModelId: identifier.nullable(),
        providerVersion: identifier.nullable(),
      })
      .strict(),
    priceTable: LivePriceTableSchema.nullable(),
    configuration: z
      .object({
        modelTurns: count.min(1).max(5),
        requestedTokens: count.min(1).max(8000),
        maxEstimatedCostUsd: z.number().positive().max(0.1).finite(),
        timeoutMs: count.min(1).max(30000),
      })
      .strict(),
    summary: z
      .object({
        samples: count,
        executedSamples: count,
        passedSamples: count,
        usageMeasuredSamples: count,
        effectsMeasuredSamples: count,
      })
      .strict(),
    runs: z.array(LiveRunSchema).min(1).max(10),
  })
  .strict()
  .superRefine((r, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const completed = r.execution.status === "completed";
    if (r.source.configurationHash !== hash(JSON.stringify(r.configuration)))
      fail("Configuration hash mismatch");
    if (
      (completed && r.execution.failure !== null) ||
      (r.execution.status === "failed" && r.execution.failure === null)
    )
      fail("Execution status/failure mismatch");
    if (
      r.execution.status === "not_run" &&
      r.runs.some((v) => v.status !== "not_run")
    )
      fail("Unexecuted report contains executed samples");
    if (r.priceTable && r.priceTable.modelId !== r.model.requestedModelId)
      fail("Price table model mismatch");
    for (const run of r.runs) {
      if (
        run.unknownUsage !==
        (run.inputTokens === null || run.outputTokens === null)
      )
        fail("Unknown usage mismatch");
      if (new Set(run.ledger.map((v) => v.id)).size !== run.ledger.length)
        fail("Duplicate ledger call identity");
      if (
        run.status !== "not_run" &&
        !(
          run.status === "fail" &&
          run.attempts.modelTurns === null &&
          run.ledger.length === 0
        ) &&
        run.attempts.modelTurns !== run.ledger.length
      )
        fail("Ledger model-turn mismatch");
      const known =
        run.ledger.length > 0 &&
        run.ledger.every(
          (v) => v.inputTokens !== null && v.outputTokens !== null,
        );
      const sum = (
        key: "inputTokens" | "outputTokens" | "estimatedCostMicrousd",
      ) => run.ledger.reduce((n, v) => n + (v[key] ?? 0), 0);
      if (
        run.inputTokens !== (known ? sum("inputTokens") : null) ||
        run.outputTokens !== (known ? sum("outputTokens") : null)
      )
        fail("Ledger usage aggregate mismatch");
      for (const call of run.ledger) {
        const expected =
          r.priceTable &&
          call.inputTokens !== null &&
          call.outputTokens !== null
            ? Math.ceil(
                call.inputTokens * r.priceTable.inputUsdPerMillion +
                  call.outputTokens * r.priceTable.outputUsdPerMillion,
              )
            : null;
        if (call.estimatedCostMicrousd !== expected)
          fail("Call estimate requires dated price table and known usage");
      }
      const expected =
        r.priceTable && known ? sum("estimatedCostMicrousd") / 1e6 : null;
      if (run.estimatedCostUsd !== expected)
        fail("Ledger cost aggregate mismatch");
      if (
        run.status === "pass" &&
        (run.observedEffects !== run.expectedEffects ||
          run.unknownUsage ||
          !run.attempts.modelTurns ||
          run.policyViolations !== 0 ||
          run.duplicateEffects !== 0 ||
          run.latencyMs === null ||
          run.ledger.some((v) => v.outcome !== "completed"))
      )
        fail(
          "Passing smoke requires executed model, measured usage and application assertions",
        );
      if (
        run.status === "not_run" &&
        (run.inputTokens !== null ||
          run.outputTokens !== null ||
          run.observedEffects !== null ||
          Object.values(run.attempts).some((v) => v !== null) ||
          run.policyViolations !== null ||
          run.duplicateEffects !== null ||
          run.latencyMs !== null ||
          run.ledger.length !== 0)
      )
        fail("Unexecuted sample fabricates measurements");
    }
    const expectedSummary = {
      samples: r.runs.length,
      executedSamples: r.runs.filter((v) => v.status !== "not_run").length,
      passedSamples: r.runs.filter((v) => v.status === "pass").length,
      usageMeasuredSamples: r.runs.filter((v) => !v.unknownUsage).length,
      effectsMeasuredSamples: r.runs.filter((v) => v.observedEffects !== null)
        .length,
    };
    if (JSON.stringify(r.summary) !== JSON.stringify(expectedSummary))
      fail("Summary denominators mismatch");
    const expectedOverall =
      r.execution.status === "not_run"
        ? "not_run"
        : completed && r.runs.every((v) => v.status === "pass")
          ? "pass"
          : "fail";
    if (r.overall !== expectedOverall) fail("Overall verdict mismatch");
  });
export type LiveReport = z.infer<typeof LiveReportSchema>;
export async function liveSourceSnapshot(root: string) {
  const files: Record<string, string> = {};
  async function walk(path: string) {
    for (const entry of await readdir(join(root, path), {
      withFileTypes: true,
    })) {
      const relative = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile())
        files[relative] = hash(await readFile(join(root, relative)));
    }
  }
  for (const dir of [
    "agent",
    "sandbox",
    "lab",
    "evaluation",
    "test",
    "spike",
    "fixtures",
    ".github/workflows",
  ])
    await walk(dir);
  for (const file of ["package.json", "package-lock.json"])
    files[file] = hash(await readFile(join(root, file)));
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    dirty:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim().length > 0,
    files: Object.fromEntries(Object.entries(files).sort()),
    dependencyHash: files["package-lock.json"],
    fixtureHash: files["fixtures/evaluation-catalog.json"],
  };
}
export function renderLiveReport(value: unknown) {
  const r = LiveReportSchema.parse(value);
  const show = (v: unknown) => (v === null ? "unknown" : String(v));
  return `# Agent Reliability Lab live smoke\n\nMode: **live**. Overall: **${r.overall}**. Execution: ${r.execution.status}; failure: ${r.execution.failure ?? "none"}.\n\nCommit: \`${r.source.commit}\`; dirty: ${r.source.dirty}. Requested gateway model: \`${r.model.requestedModelId}\`. Returned provider: ${show(r.model.provider)}; model: ${show(r.model.returnedModelId)}; version: ${show(r.model.providerVersion)}.\n\n| Run | Verdict | Effects / expected | Model turns | Input tokens | Output tokens | Estimated USD |\n|---|---|---|---|---|---|---|\n${r.runs.map((v) => `| ${v.id} | ${v.status} | ${show(v.observedEffects)} / ${v.expectedEffects} | ${show(v.attempts.modelTurns)} | ${show(v.inputTokens)} | ${show(v.outputTokens)} | ${show(v.estimatedCostUsd)} |`).join("\n")}\n\nExecuted samples: ${r.summary.executedSamples}/${r.summary.samples}; passed: ${r.summary.passedSamples}/${r.summary.samples}; usage measured: ${r.summary.usageMeasuredSamples}/${r.summary.samples}. ${r.priceTable ? `Estimated prices dated ${r.priceTable.datedAt}: input ${r.priceTable.inputUsdPerMillion}, output ${r.priceTable.outputUsdPerMillion} USD per million tokens; source: ${r.priceTable.source}.` : "No dated price table supplied; monetary cost is unknown."} Estimates are not invoices. No provider retries or LLM judge are used. This bounded synthetic smoke does not establish production reliability.\n`;
}
export async function exportLiveReport(input: {
  root: string;
  outputDir: string;
  configuration: LiveReport["configuration"];
  execution: LiveReport["execution"];
  model: LiveReport["model"];
  runs: LiveReport["runs"];
  priceTable: LiveReport["priceTable"];
  source?: Awaited<ReturnType<typeof liveSourceSnapshot>>;
}) {
  const source = input.source ?? (await liveSourceSnapshot(input.root));
  const fresh = await liveSourceSnapshot(input.root);
  const execution =
    JSON.stringify(source) !== JSON.stringify(fresh)
      ? { status: "failed" as const, failure: "source_changed" as const }
      : input.execution;
  const report = LiveReportSchema.parse({
    schemaVersion: 1,
    mode: "live",
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    overall:
      execution.status === "not_run"
        ? "not_run"
        : execution.status === "completed" &&
            input.runs.every((v) => v.status === "pass")
          ? "pass"
          : "fail",
    execution,
    source: {
      ...source,
      configurationHash: hash(JSON.stringify(input.configuration)),
    },
    model: input.model,
    priceTable: input.priceTable,
    configuration: input.configuration,
    summary: {
      samples: input.runs.length,
      executedSamples: input.runs.filter((v) => v.status !== "not_run").length,
      passedSamples: input.runs.filter((v) => v.status === "pass").length,
      usageMeasuredSamples: input.runs.filter((v) => !v.unknownUsage).length,
      effectsMeasuredSamples: input.runs.filter(
        (v) => v.observedEffects !== null,
      ).length,
    },
    runs: input.runs,
  });
  await mkdir(input.outputDir, { recursive: true });
  const jsonPath = join(input.outputDir, `${report.reportId}.json`),
    markdownPath = join(input.outputDir, `${report.reportId}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  await writeFile(markdownPath, renderLiveReport(report), { flag: "wx" });
  return { report, jsonPath, markdownPath };
}
