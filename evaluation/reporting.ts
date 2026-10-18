import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
// @ts-expect-error Versioned JavaScript runtime guard has no declaration file.
import { assertRuntimeCompatibility } from "../spike/runtime-compatibility.mjs";
import {
  CatalogEntrySchema,
  CaseSchema,
  caseGateFailure,
  ReportSchema,
  type EvaluationReport,
} from "./schemas/report.ts";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const unknownAttempts = () => ({
  modelTurns: null,
  toolCalls: null,
  readAttempts: null,
  dispatchAttempts: null,
});
export function renderReport(input: unknown) {
  const r = ReportSchema.parse(input);
  const shown = (v: unknown) => (v === null ? "unknown" : String(v));
  return `# Agent Reliability Lab evaluation\n\nFixture mode: deterministic model decisions; real worker, HTTP and persisted sandbox. Live: **not run**.\n\nOverall: **${r.overall}**. Evaluation execution: ${r.execution.status}; failure: ${r.execution.failure ?? "none"}. Commit: \`${r.source.commit}\`; dirty: ${r.source.dirty}.\n\nExecuted samples: ${r.summary.executedSamples}/${r.summary.catalogCases}; passed cases: ${r.summary.passedCases}/${r.summary.catalogCases}. Negative controls: ${r.summary.negativeControlSamples}; their pass means the deliberately introduced violation was detected.\n\n| Case | Kind | Verdict | Effects observed / expected | Duplicates | Policy violations | Recovery ms | Latency ms |\n|---|---|---|---|---|---|---|---|\n${r.cases.map((c) => `| ${c.id} | ${c.kind} | ${c.status} | ${shown(c.observedEffects)} / ${c.expectedEffects} | ${shown(c.duplicateEffects)} | ${shown(c.policyViolations)} | ${shown(c.recoveryMs)} | ${shown(c.latencyMs)} |`).join("\n")}\n\nEffect samples: ${r.summary.effectsMeasuredSamples}; policy samples: ${r.summary.policyMeasuredSamples}; recovery samples: ${r.summary.recoveryMeasuredSamples}; latency samples: ${r.summary.latencyMeasuredSamples}. Missing measurements remain unknown. Provider tokens and monetary cost are unknown; fixture requested-token reservations are not provider usage. No LLM judge is used. Controlled cases do not estimate production reliability.\n`;
}
async function sourceFiles(root: string) {
  const files: Record<string, string> = {};
  async function walk(relative: string) {
    for (const entry of await readdir(join(root, relative), {
      withFileTypes: true,
    })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        files[path] = hash(await readFile(join(root, path)));
    }
  }
  for (const directory of [
    "agent",
    "sandbox",
    "lab",
    "evaluation",
    "test",
    "spike",
    "fixtures",
    ".github/workflows",
  ])
    await walk(directory);
  for (const name of ["package.json", "package-lock.json"])
    files[name] = hash(await readFile(join(root, name)));
  return Object.fromEntries(Object.entries(files).sort());
}
export async function assertSourceFreshness(root: string, input: unknown) {
  const report = ReportSchema.parse(input);
  const fixtureCatalog = JSON.parse(
    await readFile(join(root, "fixtures/evaluation-catalog.json"), "utf8"),
  );
  const expectedCases = fixtureCatalog.cases.map((entry: unknown) =>
    CatalogEntrySchema.parse(entry),
  );
  const projection = (c: any) => ({
    id: c.id,
    kind: c.kind,
    expectedEffects: c.expectedEffects,
    mutant: c.negativeControl?.mutant ?? c.mutant ?? null,
    expectedViolation:
      c.negativeControl?.expectedViolation ?? c.expectedViolation ?? null,
  });
  if (
    JSON.stringify(report.cases.map(projection)) !==
    JSON.stringify(expectedCases.map(projection))
  )
    throw new Error("Report case metadata does not match committed catalog");
  const actualFiles = await sourceFiles(root);
  if (
    JSON.stringify(actualFiles) !==
    JSON.stringify(
      Object.fromEntries(Object.entries(report.source.files).sort()),
    )
  )
    throw new Error("Report source inventory is stale");
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (gitCommit !== report.source.commit)
    throw new Error("Report commit is stale");
  for (const [relative, expected] of Object.entries(report.source.files)) {
    if (relative.startsWith("/") || relative.split("/").includes(".."))
      throw new Error("Invalid source path");
    if (hash(await readFile(join(root, relative))) !== expected)
      throw new Error("Report source snapshot is stale");
  }
  if (report.source.dependencyHash !== report.source.files["package-lock.json"])
    throw new Error("Dependency hash mismatch");
  const guard = await assertRuntimeCompatibility(root);
  if (
    JSON.stringify(guard.hashes) !== JSON.stringify(report.runtime.guardHashes)
  )
    throw new Error("Runtime guard mismatch");
  return true;
}
export async function writeReport(input: unknown, outputDir: string) {
  const report = ReportSchema.parse(input);
  await mkdir(outputDir, { recursive: true });
  const stem = join(outputDir, report.reportId);
  // Exclusive creation makes report files immutable to this exporter.
  await writeFile(`${stem}.json`, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  await writeFile(`${stem}.md`, renderReport(report), { flag: "wx" });
  return { report, jsonPath: `${stem}.json`, markdownPath: `${stem}.md` };
}
export async function createReportBuilder(options: {
  root: string;
  catalog: unknown[];
  configuration: Record<string, string | number | boolean>;
  namespaceVersion: string;
  fixtureVersion: string;
}) {
  const catalog = options.catalog.map((c) => CatalogEntrySchema.parse(c));
  if (
    !catalog.length ||
    new Set(catalog.map((c) => c.id)).size !== catalog.length
  )
    throw new Error("Invalid evaluation catalog");
  const files = await sourceFiles(options.root);
  const guard = await assertRuntimeCompatibility(options.root);
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: options.root, encoding: "utf8" }).trim();
  const source = {
    commit: git(["rev-parse", "HEAD"]),
    dirty: git(["status", "--porcelain"]).length > 0,
    files,
    dependencyHash: files["package-lock.json"],
    configurationHash: hash(
      JSON.stringify(
        Object.fromEntries(Object.entries(options.configuration).sort()),
      ),
    ),
    fixtureHash: hash(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(files)
            .filter(
              ([name]) => name.includes("fixture") || name.includes("catalog"),
            )
            .sort(),
        ),
      ),
    ),
  };
  const rows = new Map<string, any>();
  const started = new Map<string, number>();
  return {
    startCase(id: string) {
      if (!catalog.some((c) => c.id === id) || started.has(id) || rows.has(id))
        throw new Error("Unexpected or repeated evaluation case");
      started.set(id, performance.now());
      return id;
    },
    endCase(
      id: string,
      evidence: {
        status: "pass" | "fail";
        effects?: { observed: number | null; duplicates: number | null };
        attempts?: Partial<{
          modelTurns: number | null;
          toolCalls: number | null;
          readAttempts: number | null;
          dispatchAttempts: number | null;
        }>;
        policyViolations?: number | null;
        recoveryMs?: number | null;
        latencyMs?: number | null;
        barrierId?: string | null;
        detector?: {
          observed: boolean | null;
          baselineExitCode?: number | null;
          mutantExitCode?: number | null;
          baselineEffects?: number | null;
          mutantEffects?: number | null;
          violationCode?: string | null;
          mutations?: {
            file: "sandbox/service.ts" | "agent/tools/delivery.ts";
            beforeHash: string;
            afterHash: string;
            replaceCount: 1;
          }[];
        };
        failureCode?:
          | "assertion_failed"
          | "execution_failed"
          | "detector_missed"
          | "effect_mismatch";
      },
    ) {
      const entry = catalog.find((c) => c.id === id);
      if (!entry || !started.has(id) || rows.has(id))
        throw new Error("Unexpected or repeated case result");
      if (!evidence || typeof evidence !== "object")
        evidence = { status: "fail", failureCode: "execution_failed" };
      const row: any = {
        id,
        kind: entry.kind,
        mode: "fixture",
        status: evidence.status,
        sampleCount: 1,
        expectedEffects: entry.expectedEffects,
        observedEffects: evidence.effects?.observed ?? null,
        duplicateEffects: evidence.effects?.duplicates ?? null,
        taskSuccess: evidence.status === "pass",
        policyViolations: evidence.policyViolations ?? null,
        attempts: { ...unknownAttempts(), ...evidence.attempts },
        recoveryMs: evidence.recoveryMs ?? null,
        latencyMs:
          evidence.latencyMs ??
          Math.round(performance.now() - started.get(id)!),
        barrierId: evidence.barrierId ?? null,
        negativeControl:
          entry.kind === "negative_control"
            ? {
                mutant: entry.mutant,
                expectedViolation: entry.expectedViolation,
                detectorObserved: evidence.detector?.observed ?? null,
                baselineExitCode: evidence.detector?.baselineExitCode ?? null,
                mutantExitCode: evidence.detector?.mutantExitCode ?? null,
                baselineEffects: evidence.detector?.baselineEffects ?? null,
                mutantEffects: evidence.detector?.mutantEffects ?? null,
                violationCode: evidence.detector?.violationCode ?? null,
                mutations: evidence.detector?.mutations ?? [],
              }
            : null,
        failureCode:
          evidence.status === "pass"
            ? null
            : (evidence.failureCode ?? "assertion_failed"),
      };
      const parsed = CaseSchema.safeParse(row);
      if (!parsed.success) {
        row.status = "fail";
        row.taskSuccess = false;
        row.failureCode = "execution_failed";
        row.observedEffects = null;
        row.duplicateEffects = null;
        row.policyViolations = null;
        row.attempts = unknownAttempts();
        row.recoveryMs = null;
        row.latencyMs = null;
        row.barrierId = null;
        if (row.negativeControl)
          row.negativeControl = {
            mutant: entry.mutant,
            expectedViolation: entry.expectedViolation,
            detectorObserved: null,
            baselineExitCode: null,
            mutantExitCode: null,
            baselineEffects: null,
            mutantEffects: null,
            violationCode: null,
            mutations: [],
          };
      } else {
        const failure = caseGateFailure(parsed.data);
        if (failure) {
          row.status = "fail";
          row.taskSuccess = false;
          row.failureCode = failure;
        }
      }
      rows.set(id, CaseSchema.parse(row));
    },
    async finish({
      outputDir,
      infrastructureFailure,
      validateFresh = false,
    }: {
      outputDir: string;
      validateFresh?: boolean;
      infrastructureFailure?:
        "suite_failed" | "invalid_evidence" | "source_changed";
    }) {
      const cases = catalog.map(
        (entry) =>
          rows.get(entry.id) ?? {
            id: entry.id,
            kind: entry.kind,
            mode: "fixture",
            status: "not_run",
            sampleCount: 0,
            expectedEffects: entry.expectedEffects,
            observedEffects: null,
            duplicateEffects: null,
            taskSuccess: null,
            policyViolations: null,
            attempts: unknownAttempts(),
            recoveryMs: null,
            latencyMs: null,
            barrierId: null,
            negativeControl:
              entry.kind === "negative_control"
                ? {
                    mutant: entry.mutant,
                    expectedViolation: entry.expectedViolation,
                    detectorObserved: null,
                    baselineExitCode: null,
                    mutantExitCode: null,
                    baselineEffects: null,
                    mutantEffects: null,
                    violationCode: null,
                    mutations: [],
                  }
                : null,
            failureCode: "not_run",
          },
      );
      const count = (predicate: (c: any) => boolean) =>
        cases.filter(predicate).length;
      const report = {
        schemaVersion: 1,
        reportId: randomUUID(),
        generatedAt: new Date().toISOString(),
        mode: "fixture",
        overall:
          !infrastructureFailure && cases.every((c) => c.status === "pass")
            ? "pass"
            : "fail",
        execution: {
          status: infrastructureFailure ? "failed" : "completed",
          failure: infrastructureFailure ?? null,
        },
        methodology:
          "deterministic_application_assertions_independent_sandbox_evidence",
        source,
        environment: {
          node: process.version,
          platform: process.platform,
          namespaceVersion: options.namespaceVersion,
          fixtureVersion: options.fixtureVersion,
        },
        runtime: {
          framework: "eve",
          version: guard.version,
          guardHashes: guard.hashes,
          ownershipLeaseSeconds: 20,
          ownership: "single_host_os_locked_worker",
        },
        model: {
          adapterVersion: "scripted-probe-v1",
          adapterHash: files["agent/lib/scripted-model.ts"],
          provider: null,
          providerVersion: null,
          inputTokens: null,
          outputTokens: null,
          estimatedCost: null,
          priceTableDate: null,
          liveStatus: "not_run",
        },
        cases,
        summary: {
          catalogCases: cases.length,
          executedSamples: cases.reduce((n, c) => n + c.sampleCount, 0),
          passedCases: count((c) => c.status === "pass"),
          failedCases: count((c) => c.status === "fail"),
          notRunCases: count((c) => c.status === "not_run"),
          scenarioSamples: count(
            (c) => c.kind === "scenario" && c.sampleCount === 1,
          ),
          negativeControlSamples: count(
            (c) => c.kind === "negative_control" && c.sampleCount === 1,
          ),
          effectsMeasuredSamples: count((c) => c.observedEffects !== null),
          policyMeasuredSamples: count((c) => c.policyViolations !== null),
          recoveryMeasuredSamples: count((c) => c.recoveryMs !== null),
          latencyMeasuredSamples: count((c) => c.latencyMs !== null),
        },
      };
      if (validateFresh) {
        try {
          await assertSourceFreshness(options.root, report);
        } catch {
          report.execution = { status: "failed", failure: "source_changed" };
          report.overall = "fail";
        }
      }
      return writeReport(report, outputDir);
    },
  };
}
