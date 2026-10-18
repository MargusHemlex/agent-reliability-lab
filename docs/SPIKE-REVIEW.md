# Milestone-zero review

Date: 18 October 2026. Scope: newly authored framework probe, process harness, sanitized local observations and ADR 0001. This is not a repository-wide security certification or a final publication review.

## Decision

Investigation complete. **HOLD / NO_GO before milestone two.** Default configuration misses the 30-second recovery watchdog. Explicit source-observed twenty-second tuning demonstrates recovery, but the configuration is undocumented in public eve guides and safe slow-step/duplicate-delivery ownership remains unproven.

The passing experimental report's CONDITIONAL_GO describes those two cases only. It does not override this gate.

## Agent reviews

| Reviewer | Scope | Verdict |
| --- | --- | --- |
| Codex architecture reviewer | Installed runtime docs/source, lease explanation, evidence and ADR | PASS for limited investigation and HOLD |
| Codex quality reviewer | Harness credibility, process cleanup, attempt inspection and reporting limits | PASS for limited investigation and HOLD |
| Claude Code (Anthropic) | Synthetic source, sanitized observations and HOLD decision | PASS for limited investigation and HOLD |
| Kimi K3 | Synthetic source, sanitized observations and HOLD decision | PASS for limited investigation and HOLD |

Both Codex reviewers independently identified and checked limitations. Earlier findings were fixed: completion is checked for the original turn with no outstanding input; lock-contender processes are tracked for cleanup. Historical observations have distinct provenance as explained in `evidence/README.md`.

The owner explicitly authorized sharing this repository's synthetic spike source and sanitized observations with both Anthropic/Claude Code and Kimi K3. Both external reviews completed after that authorization. Original product source, credentials and local raw logs were excluded. All four verdicts approve the limited investigation and its HOLD decision, not runtime adoption or publication.

## Local checks

TypeScript typecheck, formatting check, three fixture-adapter tests and fresh eve build passed. Installed dependency audit reported zero known advisories for the npm dependency graph; vendored framework components are not an exhaustive separate advisory assessment. Common credential-pattern scan of selected current source/docs/evidence returned no matching files. Dependency archive hosts are registry.npmjs.org.

The probe uses explicit child-environment allowlisting, temporary operator credentials and loopback processes. It does not use real providers or products. The OS lock is POSIX single-host ownership; sandbox fencing, transactional approval/idempotency, report-schema enforcement and the full application are not implemented.

No runtime adoption, production performance, full application acceptance or public-release approval is established. The repository remains private and no existing product/deployment was changed.

Final freshly rebuilt/ formatted run: CONDITIONAL_GO; approval-survives-process-restart PASS 3202 ms, interrupted-tool-recovery PASS 21677 ms. See `evidence/lease-20-final-observation.json`.

## External review observations

Claude and Kimi found no blocking defect in the limited evidence/decision. They emphasized the undocumented lease setting, limited timing samples, absence of slow-alive/duplicate-delivery testing, and the difference between a successful experiment and permission to proceed. These remain open adoption requirements, not completed implementation guarantees.

The historical local default report has no source hash block; its limitation remains disclosed. Fresh exact-code Linux CI reports are now included separately and carry their own source hashes. No retrospective provenance was added to the older report.

The replayed stream contains repeated approval.settled/input.resolved events. Their presence is recorded and requires application-level authorization analysis before further implementation; event replay alone does not prove two independent human approvals or duplicate external effects. The independent probe observation establishes two executor starts and one completion only.

A tuned experiment exits zero on its own two-case success. A green CI job therefore means expected default failure was reproduced and the explicit tuned experiment passed; it does not change the architecture HOLD or authorize milestone two. Individual timings are observations, not percentiles or a reliability estimate.

## Exact-code Linux CI

[Run 39085904262](https://github.com/MargusHemlex/agent-reliability-lab-private-history-backup-20261018/actions/runs/39085904262) passed for executable-source commit a5714c76eeea22b37b877566ddaa4faaf4b791df: locked install, typecheck, fixture tests, build, default-limit reproduction and explicit twenty-second experiment. Linux default interrupted recovery failed the watchdog; tuned interrupted recovery completed in 23,058 ms. Downloaded sanitized reports are in evidence/ci-default-observation.json and evidence/ci-lease-20-observation.json. Subsequent changes in this review are documentation/evidence only.

## Subsequent gate resolution

The initial HOLD above records the first investigation. It is superseded for the constrained single-worker configuration by ADR 0002 and OVERLAP-REVIEW.md after four-agent review and exact-code Linux overlap/ownership/recovery tests. No default-configuration or production guarantee was added.
