import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LiveReportSchema,
  renderLiveReport,
  exportLiveReport,
  liveSourceSnapshot,
} from "../evaluation/live-report.ts";

function report() {
  return {
    schemaVersion: 1,
    mode: "live",
    reportId: "41112de8-7fc8-4e28-a766-a2194adfc501",
    createdAt: "2026-10-18T00:00:00.000Z",
    overall: "pass",
    execution: { status: "completed", failure: null },
    source: {
      commit: "a".repeat(40),
      dirty: false,
      files: { "agent/agent.ts": "a".repeat(64) },
      dependencyHash: "b".repeat(64),
      configurationHash: createHash("sha256")
        .update(
          JSON.stringify({
            modelTurns: 5,
            requestedTokens: 8000,
            maxEstimatedCostUsd: 0.1,
            timeoutMs: 10000,
          }),
        )
        .digest("hex"),
      fixtureHash: "d".repeat(64),
    },
    model: {
      requestedModelId: "openai/gpt-4o-mini",
      provider: "openai",
      returnedModelId: "gpt-4o-mini",
      providerVersion: null,
    },
    priceTable: {
      datedAt: "2026-10-18",
      source: "https://vercel.com/ai-gateway/models/gpt-4o-mini",
      modelId: "openai/gpt-4o-mini",
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.6,
    },
    configuration: {
      modelTurns: 5,
      requestedTokens: 8000,
      maxEstimatedCostUsd: 0.1,
      timeoutMs: 10000,
    },
    summary: {
      samples: 1,
      executedSamples: 1,
      passedSamples: 1,
      usageMeasuredSamples: 1,
      effectsMeasuredSamples: 1,
    },
    runs: [
      {
        id: "live-001",
        status: "pass",
        expectedEffects: 1,
        observedEffects: 1,
        attempts: {
          modelTurns: 1,
          toolCalls: 3,
          readAttempts: 2,
          dispatchAttempts: null,
        },
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.000045,
        unknownUsage: false,
        ledger: [
          {
            id: "e".repeat(64),
            outcome: "completed",
            reservedCostMicrousd: 5000,
            estimatedCostMicrousd: 45,
            inputTokens: 100,
            outputTokens: 50,
            provider: "openai",
            returnedModelId: "gpt-4o-mini",
            providerVersion: null,
          },
        ],
        latencyMs: 1000,
        policyViolations: 0,
        duplicateEffects: 0,
      },
    ],
  };
}
test("live report validates measured tokens, explicit dated estimates and honest versions", () => {
  const r = LiveReportSchema.parse(report());
  assert.equal(r.model.providerVersion, null);
  assert.match(renderLiveReport(r), /usage measured: 1\/1/);
  assert.ok(
    renderLiveReport(r).startsWith("# Agent Reliability Lab live smoke\n\n"),
  );
  assert.equal(renderLiveReport(r).includes("\\n"), false);
  assert.match(renderLiveReport(r), /not invoices/);
});
test("live report rejects invented usage/cost, extra raw fields and denominator tampering", () => {
  for (const mutate of [
    (r) => (r.runs[0].unknownUsage = true),
    (r) => (r.runs[0].estimatedCostUsd = 0),
    (r) => (r.priceTable = null),
    (r) => (r.summary.samples = 2),
    (r) => (r.model.rawHeaders = { authorization: "redacted" }),
    (r) => (r.runs[0].inputTokens = null),
    (r) => (r.runs[0].observedEffects = 0),
    (r) => (r.runs[0].attempts.modelTurns = 0),
    (r) => (r.runs[0].policyViolations = null),
    (r) => (r.priceTable.modelId = "another/model"),
    (r) => (r.runs[0].ledger[0].estimatedCostMicrousd = 0),
    (r) => r.runs[0].ledger.push({ ...r.runs[0].ledger[0] }),
    (r) => (r.configuration.maxEstimatedCostUsd = 0.2),
  ]) {
    const r = report();
    mutate(r);
    assert.equal(LiveReportSchema.safeParse(r).success, false);
  }
});
test("not-run live report contains no fabricated zero usage or successful samples", () => {
  const r = report();
  r.overall = "not_run";
  r.execution = { status: "not_run", failure: "missing_credentials" };
  r.summary = {
    samples: 1,
    executedSamples: 0,
    passedSamples: 0,
    usageMeasuredSamples: 0,
    effectsMeasuredSamples: 0,
  };
  Object.assign(r.runs[0], {
    status: "not_run",
    observedEffects: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    unknownUsage: true,
    ledger: [],
    latencyMs: null,
    policyViolations: null,
    duplicateEffects: null,
    attempts: {
      modelTurns: null,
      toolCalls: null,
      readAttempts: null,
      dispatchAttempts: null,
    },
  });
  assert.ok(LiveReportSchema.parse(r));
  r.runs[0].inputTokens = 0;
  assert.equal(LiveReportSchema.safeParse(r).success, false);
});
test("infrastructure failure prevents an otherwise passing live report", () => {
  const r = report();
  r.execution = { status: "failed", failure: "source_changed" };
  assert.equal(LiveReportSchema.safeParse(r).success, false);
  r.overall = "fail";
  assert.ok(LiveReportSchema.parse(r));
});
test("known tokens do not invent an estimate without a dated price table", () => {
  const r = report();
  r.priceTable = null;
  r.runs[0].estimatedCostUsd = null;
  r.runs[0].ledger[0].estimatedCostMicrousd = null;
  assert.ok(LiveReportSchema.parse(r));
  r.runs[0].estimatedCostUsd = 0;
  assert.equal(LiveReportSchema.safeParse(r).success, false);
});

test("live export writes immutable UUID artifacts and stale sources fail closed", async () => {
  const root = new URL("../", import.meta.url).pathname;
  const outputDir = await mkdtemp(join(tmpdir(), "arl-live-report-"));
  try {
    const r = report();
    const input = {
      root,
      outputDir,
      configuration: r.configuration,
      execution: r.execution,
      model: r.model,
      runs: r.runs,
      priceTable: r.priceTable,
    };
    const first = await exportLiveReport(input);
    assert.equal(first.report.overall, "pass");
    assert.deepEqual(
      JSON.parse(await readFile(first.jsonPath, "utf8")),
      first.report,
    );
    assert.equal(
      await readFile(first.markdownPath, "utf8"),
      renderLiveReport(first.report),
    );
    const source = await liveSourceSnapshot(root);
    source.files["agent/nonexistent.ts"] = "e".repeat(64);
    const second = await exportLiveReport({ ...input, source });
    assert.notEqual(first.jsonPath, second.jsonPath);
    assert.equal(second.report.overall, "fail");
    assert.equal(second.report.execution.failure, "source_changed");
    assert.equal(
      JSON.parse(await readFile(first.jsonPath, "utf8")).overall,
      "pass",
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("bootstrap failure exports a failed artifact with unknown attempts and empty ledger", async () => {
  const root = new URL("../", import.meta.url).pathname;
  const outputDir = await mkdtemp(join(tmpdir(), "arl-live-bootstrap-"));
  try {
    const r = report();
    r.execution = { status: "failed", failure: "suite_failed" };
    r.overall = "fail";
    r.summary = {
      samples: 1,
      executedSamples: 1,
      passedSamples: 0,
      usageMeasuredSamples: 0,
      effectsMeasuredSamples: 0,
    };
    Object.assign(r.runs[0], {
      status: "fail",
      observedEffects: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      unknownUsage: true,
      ledger: [],
      latencyMs: 100,
      policyViolations: null,
      duplicateEffects: null,
      attempts: {
        modelTurns: null,
        toolCalls: null,
        readAttempts: null,
        dispatchAttempts: null,
      },
    });
    assert.ok(LiveReportSchema.parse(r));
    const result = await exportLiveReport({
      root,
      outputDir,
      configuration: r.configuration,
      execution: r.execution,
      model: r.model,
      runs: r.runs,
      priceTable: r.priceTable,
    });
    assert.equal(result.report.overall, "fail");
    assert.equal(result.report.runs[0].attempts.modelTurns, null);
    assert.ok(
      LiveReportSchema.parse(
        JSON.parse(await readFile(result.jsonPath, "utf8")),
      ),
    );
    r.runs[0].status = "pass";
    assert.equal(LiveReportSchema.safeParse(r).success, false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("pre-dispatch deadline failure exports known zero usage without a paid call", async () => {
  const root = new URL("../", import.meta.url).pathname;
  const outputDir = await mkdtemp(join(tmpdir(), "arl-live-no-dispatch-"));
  try {
    const r = report();
    r.execution = { status: "failed", failure: "suite_failed" };
    r.overall = "fail";
    r.summary.passedSamples = 0;
    Object.assign(r.runs[0], {
      status: "fail",
      observedEffects: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    });
    Object.assign(r.runs[0].ledger[0], {
      outcome: "live_not_dispatched_deadline",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicrousd: 0,
      provider: null,
      returnedModelId: null,
      providerVersion: null,
    });
    assert.ok(LiveReportSchema.parse(r));
    const result = await exportLiveReport({
      root,
      outputDir,
      configuration: r.configuration,
      execution: r.execution,
      model: { ...r.model, provider: null, returnedModelId: null },
      runs: r.runs,
      priceTable: r.priceTable,
    });
    assert.equal(result.report.overall, "fail");
    assert.equal(
      result.report.runs[0].ledger[0].outcome,
      "live_not_dispatched_deadline",
    );
    assert.equal(result.report.runs[0].estimatedCostUsd, 0);
    r.execution = { status: "completed", failure: null };
    r.overall = "pass";
    r.runs[0].status = "pass";
    r.runs[0].observedEffects = 1;
    r.summary.passedSamples = 1;
    assert.equal(LiveReportSchema.safeParse(r).success, false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
