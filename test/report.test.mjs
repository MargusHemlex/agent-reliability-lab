import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createReportBuilder,
  writeReport,
  assertSourceFreshness,
} from "../evaluation/reporting.ts";
import { ReportSchema } from "../evaluation/schemas/report.ts";
const root = resolve(import.meta.dirname, "..");
const options = {
  root,
  catalog: [
    { id: "happy_path", expectedEffects: 1, kind: "scenario" },
    {
      id: "approval_negative",
      expectedEffects: 1,
      kind: "negative_control",
      mutant: "approval_bypass",
      expectedViolation: "unauthorized_effect",
    },
  ],
  configuration: { leaseSeconds: 20 },
  namespaceVersion: "namespace-v1",
  fixtureVersion: "fixture-v1",
};
test("validated immutable reports preserve unknown usage, distinguish controls and reject false gates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    const b = await createReportBuilder(options);
    assert.throws(() => b.startCase("unknown"));
    b.startCase("happy_path");
    b.endCase("happy_path", {
      status: "pass",
      effects: { observed: 1, duplicates: 0 },
      policyViolations: 0,
    });
    assert.throws(() => b.startCase("happy_path"));
    b.startCase("approval_negative");
    b.endCase("approval_negative", {
      status: "pass",
      effects: { observed: 1, duplicates: 0 },
      policyViolations: 1,
      detector: {
        observed: true,
        baselineExitCode: 0,
        mutantExitCode: 1,
        baselineEffects: 0,
        mutantEffects: 1,
        violationCode: "unauthorized_effect",
        mutations: [
          {
            file: "agent/tools/delivery.ts",
            beforeHash: "a".repeat(64),
            afterHash: "b".repeat(64),
            replaceCount: 1,
          },
        ],
      },
    });
    const result = await b.finish({ outputDir: dir });
    assert.equal(result.report.overall, "pass");
    await assert.rejects(assertSourceFreshness(root, result.report));
    const injected = structuredClone(result.report);
    injected.token = "forbidden";
    assert.equal(ReportSchema.safeParse(injected).success, false);
    delete injected.token;
    injected.source.files["agent/lib/scripted-model.ts"] = "0".repeat(64);
    assert.equal(ReportSchema.safeParse(injected).success, false);
    const stale = structuredClone(result.report);
    stale.source.files["agent/agent.ts"] = "0".repeat(64);
    await assert.rejects(assertSourceFreshness(root, stale));
    assert.equal(result.report.model.inputTokens, null);
    assert.equal(result.report.cases[0].attempts.toolCalls, null);
    assert.equal(result.report.summary.negativeControlSamples, 1);
    assert.match(
      await readFile(result.markdownPath, "utf8"),
      /Live: \*\*not run\*\*/,
    );
    await assert.rejects(writeReport(result.report, dir), { code: "EEXIST" });
    for (const mutate of [
      (r) => {
        r.cases[1].negativeControl.mutations = [];
      },
      (r) => {
        r.cases[1].negativeControl.mutations[0].afterHash =
          r.cases[1].negativeControl.mutations[0].beforeHash;
      },
      (r) => {
        r.cases[1].negativeControl.mutations[0].file = "../private.ts";
      },
      (r) => {
        r.cases[1].negativeControl.mutantExitCode = 2;
      },
      (r) => {
        r.cases[1].negativeControl.mutantEffects = 0;
      },
      (r) => {
        r.cases[1].policyViolations = 0;
      },
      (r) => {
        r.cases[1].negativeControl.violationCode = "duplicate_effect";
      },
    ]) {
      const bad = structuredClone(result.report);
      mutate(bad);
      assert.equal(ReportSchema.safeParse(bad).success, false);
    }
    const changed = structuredClone(result.report);
    changed.cases[0].observedEffects = 2;
    assert.equal(ReportSchema.safeParse(changed).success, false);
    changed.cases[0].observedEffects = 1;
    changed.summary.executedSamples = 9;
    assert.equal(ReportSchema.safeParse(changed).success, false);
    changed.summary.executedSamples = 2;
    changed.model.inputTokens = 0;
    assert.equal(ReportSchema.safeParse(changed).success, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("partial report has honest missing cases and overall failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    const b = await createReportBuilder(options);
    b.startCase("happy_path");
    b.endCase("happy_path", {
      status: "fail",
      failureCode: "execution_failed",
    });
    const { report } = await b.finish({ outputDir: dir });
    assert.equal(report.overall, "fail");
    assert.equal(report.summary.notRunCases, 1);
    assert.equal(report.summary.executedSamples, 1);
    assert.equal(report.cases[1].observedEffects, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freshness binds case identities and expected counts to the committed catalog", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    const catalog = JSON.parse(
      await readFile(join(root, "fixtures/evaluation-catalog.json"), "utf8"),
    ).cases;
    const b = await createReportBuilder({ ...options, catalog });
    const { report } = await b.finish({ outputDir: dir });
    await assertSourceFreshness(root, report);
    const changed = structuredClone(report);
    changed.cases[0].expectedEffects = 99;
    assert.equal(ReportSchema.safeParse(changed).success, true);
    await assert.rejects(assertSourceFreshness(root, changed));
    const renamed = structuredClone(report);
    renamed.cases[0].id = "renamed_case";
    await assert.rejects(assertSourceFreshness(root, renamed));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("infrastructure failure cannot export an overall pass despite passing cases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    const b = await createReportBuilder({
      ...options,
      catalog: [options.catalog[0]],
    });
    b.startCase("happy_path");
    b.endCase("happy_path", {
      status: "pass",
      effects: { observed: 1, duplicates: 0 },
      policyViolations: 0,
    });
    const { report } = await b.finish({
      outputDir: dir,
      infrastructureFailure: "suite_failed",
    });
    assert.equal(report.overall, "fail");
    assert.equal(report.summary.passedCases, 1);
    assert.equal(report.execution.failure, "suite_failed");
    assert.equal(ReportSchema.safeParse(report).success, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("invalid and contradictory case evidence exports valid failed partial reports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    const b = await createReportBuilder(options);
    b.startCase("happy_path");
    b.endCase("happy_path", {
      status: "pass",
      effects: { observed: 2, duplicates: 1 },
    });
    b.startCase("approval_negative");
    b.endCase("approval_negative", {
      status: "pass",
      detector: {
        observed: true,
        mutations: [
          {
            file: "/private/token",
            beforeHash: "bad",
            afterHash: "bad",
            replaceCount: 9,
          },
        ],
      },
    });
    const { report } = await b.finish({ outputDir: dir });
    assert.equal(report.overall, "fail");
    assert.equal(report.cases[0].failureCode, "effect_mismatch");
    assert.equal(report.cases[1].failureCode, "execution_failed");
    assert.equal(report.cases[1].observedEffects, null);
    assert.equal(ReportSchema.safeParse(report).success, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("crash recovery deadline is an enforced semantic gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    for (const recoveryMs of [null, 30001, 30000]) {
      const b = await createReportBuilder({
        ...options,
        catalog: [
          { id: "crash_before_dispatch", kind: "scenario", expectedEffects: 1 },
        ],
      });
      b.startCase("crash_before_dispatch");
      b.endCase("crash_before_dispatch", {
        status: "pass",
        effects: { observed: 1, duplicates: 0 },
        policyViolations: 0,
        recoveryMs,
      });
      const { report } = await b.finish({ outputDir: dir });
      assert.equal(report.overall, recoveryMs === 30000 ? "pass" : "fail");
      if (recoveryMs !== 30000)
        assert.equal(report.cases[0].failureCode, "recovery_deadline_exceeded");
      const tampered = structuredClone(report);
      tampered.cases[0].status = "pass";
      tampered.cases[0].taskSuccess = true;
      tampered.cases[0].failureCode = null;
      tampered.cases[0].recoveryMs = 30001;
      tampered.overall = "pass";
      tampered.summary.passedCases = 1;
      tampered.summary.failedCases = 0;
      assert.equal(ReportSchema.safeParse(tampered).success, false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normal scenario pass requires independently observed effect count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    const b = await createReportBuilder({
      ...options,
      catalog: [options.catalog[0]],
    });
    b.startCase("happy_path");
    b.endCase("happy_path", { status: "pass" });
    const { report } = await b.finish({ outputDir: dir });
    assert.equal(report.overall, "fail");
    assert.equal(report.cases[0].observedEffects, null);
    assert.equal(report.cases[0].failureCode, "effect_mismatch");
    const fake = structuredClone(report);
    fake.cases[0].status = "pass";
    fake.cases[0].taskSuccess = true;
    fake.cases[0].failureCode = null;
    fake.overall = "pass";
    fake.summary.passedCases = 1;
    fake.summary.failedCases = 0;
    assert.equal(ReportSchema.safeParse(fake).success, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freshness preflight exports a failed report before any passing artifact exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arl-report-"));
  try {
    const b = await createReportBuilder({
      ...options,
      catalog: [options.catalog[0]],
    });
    b.startCase("happy_path");
    b.endCase("happy_path", {
      status: "pass",
      effects: { observed: 1, duplicates: 0 },
      policyViolations: 0,
    });
    const { report, jsonPath } = await b.finish({
      outputDir: dir,
      validateFresh: true,
    });
    assert.equal(report.summary.passedCases, 1);
    assert.equal(report.overall, "fail");
    assert.deepEqual(report.execution, {
      status: "failed",
      failure: "source_changed",
    });
    assert.equal(JSON.parse(await readFile(jsonPath, "utf8")).overall, "fail");
    assert.equal(ReportSchema.safeParse(report).success, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
