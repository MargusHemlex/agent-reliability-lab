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
| Claude Code (Anthropic) | Intended external source review | Pending repo-specific owner consent |
| Kimi K3 | Intended external source review | Pending repo-specific owner consent |

Both Codex reviewers independently identified and checked limitations. Earlier findings were fixed: completion is checked for the original turn with no outstanding input; lock-contender processes are tracked for cleanup. Historical observations have distinct provenance as explained in `evidence/README.md`.

Automatic approval review rejected external transfer of this private repository's source because earlier source-sharing approvals applied to other repositories. No external source review is claimed. A repo-specific consent question was issued; the external transfer was not retried.

## Local checks

TypeScript typecheck, formatting check, three fixture-adapter tests and fresh eve build passed. Installed dependency audit reported zero known advisories for the npm dependency graph; vendored framework components are not an exhaustive separate advisory assessment. Common credential-pattern scan of selected current source/docs/evidence returned no matching files. Dependency archive hosts are registry.npmjs.org.

The probe uses explicit child-environment allowlisting, temporary operator credentials and loopback processes. It does not use real providers or products. The OS lock is POSIX single-host ownership; sandbox fencing, transactional approval/idempotency, report-schema enforcement and the full application are not implemented.

No runtime adoption, production performance, full application acceptance or public-release approval is established. The repository remains private and no existing product/deployment was changed.

Final freshly rebuilt/ formatted run: CONDITIONAL_GO; approval-survives-process-restart PASS 3202 ms, interrupted-tool-recovery PASS 21677 ms. See `evidence/lease-20-final-observation.json`.
