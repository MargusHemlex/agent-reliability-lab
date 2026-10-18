# Slow-step and duplicate-delivery investigation

Date: 18 October 2026. Status: complete; constrained GO accepted after four-agent review and exact-code Linux CI. This document reports a bounded framework experiment, not a full application or publication review.

## Accepted decision

Continue with pinned eve for a single-host, single-actual-worker synthetic laboratory. Final exact-code tests and all four reviews passed. See ADR 0002. The default 860-second configuration remains unsuitable for the specified 30-second recovery target. The twenty-second configuration remains experimental and must be guarded, explicit and regression-tested.

## Coverage

The new harness distinguishes repeated human approval HTTP requests from actual workflow callback duplication. Callback identity is bound to the genuine persisted held-step owner; injected callbacks must return HTTP 200. Invocations have independent IDs, PIDs and monotonic times. Maximum live invocation count is computed from those records.

The earlier supervisor-lock defect and its correction belong to our launcher. The before-fix experiment observed concurrent workers after killing only the supervisor; the corrected launcher holds the lock in the actual built worker. No assertion of distributed fencing or receiver-side effect safety follows.

A repeated approval API request may create an extra turn. It did not create a second fixture probe in the bounded test, but future business approval endpoints still require application-level idempotency and authorization.

## Review status

- Codex runtime/architecture reviewer: supports GO only after the final bounded tests pass, with single-worker, version/hash and application-effect safeguards.
- Codex quality reviewer: bounded overlap evidence and actual-worker launcher correction PASS; exact callback identity/status assertions and no-pending checks are required and present.
- Claude Code: evidence PASS; GO for the constrained milestone, conditional on Linux CI (now passed).
- Kimi K3: evidence PASS; GO for the constrained milestone, conditional on Linux CI (now passed).

External source review uses the owner's repository-specific consent. Only newly authored synthetic test source and sanitized observations are in scope; original products, credentials and raw logs are excluded.

## Final local observations

- Guarded original crash recovery: approval persistence PASS; interrupted tool PASS in 22,420 ms.
- Guarded twenty-second overlap experiment: both cases PASS; each holds the live step beyond twenty-two seconds with one invocation, one completion and maximum concurrency one. Three actual callback injections return HTTP 200 and single-flight handling is observed. No callback-created extra turn or pending request remains.
- Actual-worker lock/death/replacement regression: PASS. Actual worker PID equals launched PID; the old worker is dead before replacement; one replacement completes and the terminated original does not.

Reports: evidence/overlap-lease20-final.json, evidence/ownership-worker-lock-final.json and evidence/recovery-worker-lock-final.json. The pre-fix evidence/ownership-launcher-baseline.json has different historical source hashes and demonstrates our corrected wrapper flaw. It is not a test of the final wrapper and must not be attributed to an eve defect.

Both Codex final reviewers support constrained GO pending exact-code Linux CI and remaining reviews. No application effect service or full business workflow is claimed implemented.

## Final decision and Linux evidence

**GO for the next local single-worker milestone; keep eve 0.80.1.** No framework switch is required for this scope. All four reviewers approve this bounded decision. This is not full-application acceptance or approval to publish.

[Exact-code Linux CI](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39113383786) passed for commit 19ed1d16c5c6492a49b9a6850fd083c5d0b42dd3. The downloaded reports were inspected independently of the green job status:

| Check | Linux observation |
| --- | --- |
| Default interrupted recovery | NO_GO against original watchdog, as expected |
| Explicit twenty-second interrupted recovery | PASS, 21,744 ms |
| Slow step with repeated approval API requests | PASS, one invocation/completion, maximum concurrency one; one extra queued turn remains an application-level concern |
| Genuine callback replays plus fresh wake | PASS, three HTTP 200 responses, owner identity matched, single-flight observed, one invocation/completion, maximum concurrency one |
| Actual-worker lock lifetime and replacement | PASS; original worker dead before replacement, exactly one replacement completion |

Current CI observations are evidence/overlap-ci-default-recovery.json, overlap-ci-tuned-recovery.json, overlap-ci-live-callbacks.json and overlap-ci-worker-ownership.json. Their recorded source hashes match the executable candidate. Both macOS arm64 and Linux x64 were exercised; no wider portability or timing SLO is inferred.

External review findings carried forward: repeated approval requests require an application-level single-consumption regression; single observations do not establish reliability percentiles; the lease setting remains undocumented publicly; a replacement invocation completing after the original process died demonstrates recovery, not simultaneous overlap. Historical default controls that hold for twenty-two seconds do not exercise the 860-second lease boundary.

No original product/deployment was touched. The repository remains private. This ratification changes documentation/evidence only; executable-source CI remains tied to the commit above.
