import { z } from "zod";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().regex(/^[a-z][a-z0-9_-]{0,95}$/);
const Violation = z.enum(["duplicate_effect", "unauthorized_effect"]);
const Count = z.number().int().nonnegative();
const Measurement = z.number().finite().nonnegative().nullable();
export const CatalogEntrySchema = z
  .strictObject({
    id: Id,
    expectedEffects: Count.nullable(),
    kind: z.enum(["scenario", "negative_control"]),
    mutant: Id.nullable().default(null),
    expectedViolation: Violation.nullable().default(null),
  })
  .superRefine((item, ctx) => {
    if (
      item.kind === "negative_control" &&
      (!item.mutant || !item.expectedViolation)
    )
      ctx.addIssue({
        code: "custom",
        message: "Negative controls require a mutant and expected violation",
      });
    if (item.kind === "scenario" && item.expectedEffects === null)
      ctx.addIssue({
        code: "custom",
        message: "Scenario requires an expected effects count",
      });
    if (item.kind === "scenario" && (item.mutant || item.expectedViolation))
      ctx.addIssue({
        code: "custom",
        message: "Ordinary scenarios cannot be mutants",
      });
  });
export const CaseSchema = z.strictObject({
  id: Id,
  kind: z.enum(["scenario", "negative_control"]),
  mode: z.literal("fixture"),
  status: z.enum(["pass", "fail", "not_run"]),
  sampleCount: z.union([z.literal(0), z.literal(1)]),
  expectedEffects: Count.nullable(),
  observedEffects: Count.nullable(),
  duplicateEffects: Count.nullable(),
  taskSuccess: z.boolean().nullable(),
  policyViolations: Count.nullable(),
  attempts: z.strictObject({
    modelTurns: Count.nullable(),
    toolCalls: Count.nullable(),
    readAttempts: Count.nullable(),
    dispatchAttempts: Count.nullable(),
  }),
  recoveryMs: Measurement,
  latencyMs: Measurement,
  barrierId: Id.nullable(),
  negativeControl: z
    .strictObject({
      mutant: Id,
      expectedViolation: Violation,
      detectorObserved: z.boolean().nullable(),
      baselineExitCode: Count.nullable(),
      mutantExitCode: Count.nullable(),
      baselineEffects: Count.nullable(),
      mutantEffects: Count.nullable(),
      violationCode: Id.nullable(),
      mutations: z.array(
        z.strictObject({
          file: z.enum(["sandbox/service.ts", "agent/tools/delivery.ts"]),
          beforeHash: Hash,
          afterHash: Hash,
          replaceCount: z.literal(1),
        }),
      ),
    })
    .nullable(),
  failureCode: z
    .enum([
      "assertion_failed",
      "execution_failed",
      "not_run",
      "detector_missed",
      "effect_mismatch",
      "recovery_deadline_exceeded",
    ])
    .nullable(),
});
export const ReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    reportId: z.string().uuid(),
    generatedAt: z.string().datetime(),
    mode: z.literal("fixture"),
    overall: z.enum(["pass", "fail"]),
    execution: z.strictObject({
      status: z.enum(["completed", "failed"]),
      failure: z
        .enum(["suite_failed", "invalid_evidence", "source_changed"])
        .nullable(),
    }),
    methodology: z.literal(
      "deterministic_application_assertions_independent_sandbox_evidence",
    ),
    source: z.strictObject({
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      dirty: z.boolean(),
      files: z.record(
        z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+$/),
        Hash,
      ),
      dependencyHash: Hash,
      configurationHash: Hash,
      fixtureHash: Hash,
    }),
    environment: z.strictObject({
      node: z.string().regex(/^v\d+\.\d+\.\d+$/),
      platform: z.enum([
        "darwin",
        "linux",
        "win32",
        "aix",
        "freebsd",
        "openbsd",
        "sunos",
        "android",
        "haiku",
        "cygwin",
        "netbsd",
      ]),
      namespaceVersion: Id,
      fixtureVersion: Id,
    }),
    runtime: z.strictObject({
      framework: z.literal("eve"),
      version: z.literal("0.80.1"),
      guardHashes: z.record(z.string(), Hash),
      ownershipLeaseSeconds: z.literal(20),
      ownership: z.literal("single_host_os_locked_worker"),
    }),
    model: z.strictObject({
      adapterVersion: z.literal("scripted-probe-v1"),
      adapterHash: Hash,
      provider: z.null(),
      providerVersion: z.null(),
      inputTokens: z.null(),
      outputTokens: z.null(),
      estimatedCost: z.null(),
      priceTableDate: z.null(),
      liveStatus: z.literal("not_run"),
    }),
    cases: z.array(CaseSchema).min(1),
    summary: z.strictObject({
      catalogCases: Count,
      executedSamples: Count,
      passedCases: Count,
      failedCases: Count,
      notRunCases: Count,
      scenarioSamples: Count,
      negativeControlSamples: Count,
      effectsMeasuredSamples: Count,
      policyMeasuredSamples: Count,
      recoveryMeasuredSamples: Count,
      latencyMeasuredSamples: Count,
    }),
  })
  .superRefine((report, ctx) => {
    const reject = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      report.source.files["package-lock.json"] !== report.source.dependencyHash
    )
      reject("Dependency hash does not bind lockfile");
    if (
      report.source.files["agent/lib/scripted-model.ts"] !==
      report.model.adapterHash
    )
      reject("Adapter hash does not bind source");
    if (Object.keys(report.runtime.guardHashes).length !== 3)
      reject("Expected exactly three guarded runtime files");
    if (new Set(report.cases.map((c) => c.id)).size !== report.cases.length)
      reject("Duplicate case IDs");
    const counts = {
      catalogCases: report.cases.length,
      executedSamples: report.cases.reduce((n, c) => n + c.sampleCount, 0),
      passedCases: report.cases.filter((c) => c.status === "pass").length,
      failedCases: report.cases.filter((c) => c.status === "fail").length,
      notRunCases: report.cases.filter((c) => c.status === "not_run").length,
      scenarioSamples: report.cases
        .filter((c) => c.kind === "scenario")
        .reduce((n, c) => n + c.sampleCount, 0),
      negativeControlSamples: report.cases
        .filter((c) => c.kind === "negative_control")
        .reduce((n, c) => n + c.sampleCount, 0),
      effectsMeasuredSamples: report.cases.filter(
        (c) => c.observedEffects !== null,
      ).length,
      policyMeasuredSamples: report.cases.filter(
        (c) => c.policyViolations !== null,
      ).length,
      recoveryMeasuredSamples: report.cases.filter((c) => c.recoveryMs !== null)
        .length,
      latencyMeasuredSamples: report.cases.filter((c) => c.latencyMs !== null)
        .length,
    };
    for (const key of Object.keys(counts) as (keyof typeof counts)[])
      if (report.summary[key] !== counts[key])
        reject(`Incorrect denominator: ${key}`);
    if (
      report.overall !==
      (report.execution.status === "completed" &&
      report.cases.every((c) => c.status === "pass")
        ? "pass"
        : "fail")
    )
      reject("Incorrect overall verdict");
    if (
      (report.execution.status === "failed") !==
      (report.execution.failure !== null)
    )
      reject("Execution failure metadata inconsistent");
    for (const c of report.cases) {
      if (c.status === "pass" && caseGateFailure(c) !== null)
        reject("Case contradicts acceptance gates");
      if (c.kind === "scenario" && c.expectedEffects === null)
        reject("Scenario requires expected effects");
      if ((c.kind === "negative_control") !== (c.negativeControl !== null))
        reject("Control classification mismatch");
      if (c.sampleCount !== (c.status === "not_run" ? 0 : 1))
        reject("Incorrect sample count");
      if (
        c.status === "pass" &&
        (c.failureCode !== null || c.taskSuccess !== true)
      )
        reject("Pass requires successful assertions");
      if (
        c.status === "pass" &&
        c.kind === "scenario" &&
        ((c.expectedEffects !== null &&
          c.observedEffects !== c.expectedEffects) ||
          (c.duplicateEffects !== null && c.duplicateEffects !== 0) ||
          (c.policyViolations !== null && c.policyViolations !== 0))
      )
        reject("Scenario pass contradicts measured effect or policy gates");
      if (
        c.status === "pass" &&
        c.kind === "negative_control" &&
        (c.negativeControl?.detectorObserved !== true ||
          c.negativeControl.baselineExitCode !== 0 ||
          c.negativeControl.mutantExitCode !== 1 ||
          c.negativeControl.baselineEffects === null ||
          c.negativeControl.mutantEffects === null ||
          c.negativeControl.violationCode !==
            c.negativeControl.expectedViolation)
      )
        reject("Negative control pass requires detection");
      if (c.status === "pass" && c.negativeControl) {
        const n = c.negativeControl;
        if (
          !n.mutations.length ||
          n.mutations.some((m) => m.beforeHash === m.afterHash)
        )
          reject(
            "Negative control requires changed source mutation provenance",
          );
        if (
          n.baselineEffects === null ||
          n.mutantEffects === null ||
          n.mutantEffects <= n.baselineEffects ||
          n.mutantEffects !== c.observedEffects
        )
          reject(
            "Negative control effects must demonstrate the mutant violation",
          );
        if (
          n.expectedViolation === "duplicate_effect" &&
          (n.baselineEffects !== 1 ||
            n.mutantEffects === null ||
            n.mutantEffects < 2 ||
            c.duplicateEffects === null ||
            c.duplicateEffects < 1)
        )
          reject("Idempotency mutant requires measured duplicate effects");
        if (
          n.expectedViolation === "unauthorized_effect" &&
          (n.baselineEffects !== 0 ||
            n.mutantEffects === null ||
            n.mutantEffects < 1 ||
            c.policyViolations === null ||
            c.policyViolations < 1)
        )
          reject("Approval mutant requires measured unauthorized effects");
      }
    }
  });
export type EvaluationReport = z.infer<typeof ReportSchema>;

export function caseGateFailure(
  c: z.infer<typeof CaseSchema>,
): "effect_mismatch" | "detector_missed" | "recovery_deadline_exceeded" | null {
  if (c.status !== "pass") return null;
  if (
    [
      "crash_before_dispatch",
      "crash_after_sandbox_commit_before_checkpoint",
    ].includes(c.id) &&
    (c.recoveryMs === null || c.recoveryMs > 30000)
  )
    return "recovery_deadline_exceeded";
  if (
    c.kind === "scenario" &&
    ((c.expectedEffects !== null && c.observedEffects !== c.expectedEffects) ||
      (c.duplicateEffects !== null && c.duplicateEffects !== 0) ||
      (c.policyViolations !== null && c.policyViolations !== 0))
  )
    return "effect_mismatch";
  if (c.kind === "negative_control") {
    const n = c.negativeControl;
    if (
      !n ||
      n.detectorObserved !== true ||
      n.baselineExitCode !== 0 ||
      n.mutantExitCode !== 1 ||
      n.baselineEffects === null ||
      n.mutantEffects === null ||
      n.mutantEffects <= n.baselineEffects ||
      n.mutantEffects !== c.observedEffects ||
      n.violationCode !== n.expectedViolation ||
      !n.mutations.length ||
      n.mutations.some((m) => m.beforeHash === m.afterHash)
    )
      return "detector_missed";
    if (
      n.expectedViolation === "duplicate_effect" &&
      (n.baselineEffects !== 1 ||
        n.mutantEffects < 2 ||
        c.duplicateEffects === null ||
        c.duplicateEffects < 1)
    )
      return "detector_missed";
    if (
      n.expectedViolation === "unauthorized_effect" &&
      (n.baselineEffects !== 0 ||
        n.mutantEffects < 1 ||
        c.policyViolations === null ||
        c.policyViolations < 1)
    )
      return "detector_missed";
  }
  return null;
}
