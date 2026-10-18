# Slow-step and duplicate-delivery investigation

Date: 18 October 2026. Status: final exact-code results/reviews pending. This document reports a bounded framework experiment, not a full application or publication review.

## Candidate decision

Continue with pinned eve for a single-host, single-actual-worker synthetic laboratory only if final exact-code tests and reviews pass. See ADR 0002. The default 860-second configuration remains unsuitable for the specified 30-second recovery target. The twenty-second configuration remains experimental and must be guarded, explicit and regression-tested.

## Coverage

The new harness distinguishes repeated human approval HTTP requests from actual workflow callback duplication. Callback identity is bound to the genuine persisted held-step owner; injected callbacks must return HTTP 200. Invocations have independent IDs, PIDs and monotonic times. Maximum live invocation count is computed from those records.

The earlier supervisor-lock defect and its correction belong to our launcher. The before-fix experiment observed concurrent workers after killing only the supervisor; the corrected launcher holds the lock in the actual built worker. No assertion of distributed fencing or receiver-side effect safety follows.

A repeated approval API request may create an extra turn. It did not create a second fixture probe in the bounded test, but future business approval endpoints still require application-level idempotency and authorization.

## Review status

- Codex runtime/architecture reviewer: supports GO only after the final bounded tests pass, with single-worker, version/hash and application-effect safeguards.
- Codex quality reviewer: bounded overlap evidence and actual-worker launcher correction PASS; exact callback identity/status assertions and no-pending checks are required and present.
- Claude Code: pending current overlap snapshot review.
- Kimi K3: pending current overlap snapshot review.

External source review uses the owner's repository-specific consent. Only newly authored synthetic test source and sanitized observations are in scope; original products, credentials and raw logs are excluded.

## Final local observations

- Guarded original crash recovery: approval persistence PASS; interrupted tool PASS in 22,420 ms.
- Guarded twenty-second overlap experiment: both cases PASS; each holds the live step beyond twenty-two seconds with one invocation, one completion and maximum concurrency one. Three actual callback injections return HTTP 200 and single-flight handling is observed. No callback-created extra turn or pending request remains.
- Actual-worker lock/death/replacement regression: PASS. Actual worker PID equals launched PID; the old worker is dead before replacement; one replacement completes and the terminated original does not.

Reports: evidence/overlap-lease20-final.json, evidence/ownership-worker-lock-final.json and evidence/recovery-worker-lock-final.json. The pre-fix evidence/ownership-launcher-baseline.json has different historical source hashes and demonstrates our corrected wrapper flaw. It is not a test of the final wrapper and must not be attributed to an eve defect.

Both Codex final reviewers support constrained GO pending exact-code Linux CI and remaining reviews. No application effect service or full business workflow is claimed implemented.
