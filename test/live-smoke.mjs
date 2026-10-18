import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { liveConfiguration, LIVE_PRICE } from "../agent/lib/live-model.ts";
import {
  exportLiveReport,
  liveSourceSnapshot,
} from "../evaluation/live-report.ts";
import { fixture, cleanup, until } from "./workflow-fixture.mjs";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await liveSourceSnapshot(root);
const configuration = {
  modelTurns: 5,
  requestedTokens: 8000,
  maxEstimatedCostUsd: 0.1,
  timeoutMs: 30000,
};
const priceTable = {
  datedAt: LIVE_PRICE.priceTableDate,
  source: "https://ai-gateway.vercel.sh/v1/models",
  modelId: LIVE_PRICE.modelId,
  inputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
};
let execution = { status: "not_run", failure: "missing_opt_in" };
let requestedModelId = LIVE_PRICE.modelId;
let runs = [
  {
    id: "live-smoke",
    status: "not_run",
    expectedEffects: 1,
    observedEffects: null,
    attempts: {
      modelTurns: null,
      toolCalls: null,
      readAttempts: null,
      dispatchAttempts: null,
    },
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    unknownUsage: true,
    latencyMs: null,
    policyViolations: null,
    duplicateEffects: null,
    ledger: [],
  },
];
let cfg;
try {
  cfg = liveConfiguration();
} catch (error) {
  execution.failure =
    error.message === "live_opt_in_required"
      ? "missing_opt_in"
      : error.message === "live_model_required"
        ? "missing_model"
        : error.message === "live_gateway_key_required"
          ? "missing_credentials"
          : "invalid_configuration";
}
if (cfg && process.env.ARL_LIVE_SMOKE_APPROVE !== "1")
  execution.failure = "missing_smoke_approval";
// An explicit second gate permits approval only for this synthetic smoke's exact
// allowed action. Normal live operation always uses the operator approval UI.
if (cfg && process.env.ARL_LIVE_SMOKE_APPROVE === "1") {
  requestedModelId = cfg.modelId;
  configuration.maxEstimatedCostUsd = cfg.maxCostMicrousd / 1e6;
  let f,
    id,
    run,
    observedEffects = null,
    approved = false;
  const start = Date.now();
  execution = { status: "completed", failure: null };
  try {
    f = await fixture({ liveConfig: cfg });
    id = await f.create();
    run = await until(
      async () => {
        const { run } = await f.inspect(id);
        if (["failed", "budget_exceeded", "cancelled"].includes(run.state))
          throw new Error("run_failed");
        return run.state === "awaiting_approval" && run;
      },
      "live proposal",
      120000,
    );
    const action = run.proposal?.action;
    if (
      action?.deliveryId !== "delivery-001" ||
      action.kind !== "request_update" ||
      action.note !== "Please provide a delivery update."
    )
      throw new Error("unexpected_action");
    if (f.effectCount() !== 0) throw new Error("preapproval_effect");
    await f.approve(id);
    approved = true;
    run = await until(
      async () => {
        const { run } = await f.inspect(id);
        return (
          [
            "succeeded",
            "failed",
            "budget_exceeded",
            "cancelled",
            "unknown_outcome",
          ].includes(run.state) && run
        );
      },
      "live terminal",
      120000,
    );
    observedEffects = f.effectCount();
  } catch {
    execution = { status: "failed", failure: "suite_failed" };
  } finally {
    if (f && id)
      try {
        run = (await f.inspect(id)).run;
        observedEffects = f.effectCount();
      } catch {}
    try {
      if (f) await f.stop();
    } catch {
      execution = { status: "failed", failure: "suite_failed" };
    } finally {
      try {
        await cleanup();
      } catch {
        execution = { status: "failed", failure: "suite_failed" };
      }
    }
  }
  const ledger = Object.values(run?.budget.models ?? {}).map((v) => ({
    id: v.id,
    outcome: v.outcome,
    reservedCostMicrousd: v.reservedCostMicrousd ?? null,
    estimatedCostMicrousd: v.estimatedCostMicrousd ?? null,
    inputTokens: v.inputTokens ?? null,
    outputTokens: v.outputTokens ?? null,
    provider: v.provider ?? null,
    returnedModelId: v.returnedModelId ?? null,
    providerVersion: v.providerVersion ?? null,
  }));
  const sum = (key) =>
    ledger.length && ledger.every((v) => v[key] !== null)
      ? ledger.reduce((s, v) => s + v[key], 0)
      : null;
  const completeUsage =
    ledger.length > 0 &&
    ledger.every((v) => v.inputTokens !== null && v.outputTokens !== null);
  const inputTokens = completeUsage ? sum("inputTokens") : null,
    outputTokens = completeUsage ? sum("outputTokens") : null,
    micros = sum("estimatedCostMicrousd");
  const known = inputTokens !== null && outputTokens !== null;
  const passed =
    execution.status === "completed" &&
    approved &&
    run?.state === "succeeded" &&
    observedEffects === 1 &&
    known &&
    ledger.every((v) => v.outcome === "completed");
  runs = [
    {
      id: id ?? "live-smoke",
      status: passed ? "pass" : "fail",
      expectedEffects: 1,
      observedEffects,
      attempts: {
        modelTurns: run?.budget.modelTurns ?? null,
        toolCalls: run?.toolCalls ?? null,
        readAttempts: run ? Object.keys(run.budget.reads).length : null,
        dispatchAttempts: null,
      },
      inputTokens,
      outputTokens,
      estimatedCostUsd: micros === null ? null : micros / 1e6,
      unknownUsage: !known,
      latencyMs: Date.now() - start,
      policyViolations: passed ? 0 : null,
      duplicateEffects:
        observedEffects === null ? null : Math.max(0, observedEffects - 1),
      ledger,
    },
  ];
}
const ledger = runs.flatMap((v) => v.ledger);
const consensus = (key) => {
  const values = ledger.map((v) => v[key]);
  return values.length &&
    values[0] !== null &&
    values.every((v) => v === values[0])
    ? values[0]
    : null;
};
const result = await exportLiveReport({
  root,
  outputDir: resolve(root, "reports/live"),
  source,
  configuration,
  execution,
  model: {
    requestedModelId,
    provider: consensus("provider"),
    returnedModelId: consensus("returnedModelId"),
    providerVersion: null,
  },
  priceTable,
  runs,
});
console.log(
  JSON.stringify({
    reportId: result.report.reportId,
    overall: result.report.overall,
    execution: result.report.execution,
    artifacts: "reports/live/",
  }),
);
if (result.report.overall === "fail") process.exitCode = 1;
