# Milestone 3 validation

Scope: operator browser UI, immutable preventive fixture budgets, durable retry/accounting and isolated synthetic dataset reset. This is private milestone acceptance, not public release, live-provider validation or production approval.

Executable-source candidate: `e77beeb0a9bc0632a260fbacc229765d9f4e41ab`. Documentation ratification may follow without changing executable sources.

## Four reviewers

| Reviewer | Contribution and review | Result |
| --- | --- | --- |
| Codex budget/state agent | Implemented durable ledger and focused unit tests; cross-reviewed model/tool integration and ran process suites | PASS for constrained fixture milestone |
| Codex operator/service agent | Implemented browser session/UI and namespace receiver changes; cross-reviewed runtime integration and performs actual browser walkthrough | PASS for source/core browser flow; native reset confirmation unverified |
| Claude Code | Independent full-source review of UI, budgets, receiver and tests | PASS for the reviewed scope; core browser and exact-code Linux CI conditions met, native reset UI branch unverified |
| Kimi K3 | Independent full-source review of UI, budgets, receiver and tests | PASS for the reviewed scope; core browser and exact-code Linux CI conditions met, native reset UI branch unverified |

The Codex agents contributed code and cross-reviewed other layers; their own implementations are not described as independent third-party audits. Claude Code and Kimi K3 received only this repository's new synthetic source/test snapshot under owner authorization. Local secrets, databases, provider sessions, private products and raw logs were excluded. Review-source hashes match the process-tested source.

## Local evidence

- 47 unit/HTTP tests pass, including separate input/output bounds, all named numerical defaults, replay conflicts, epoch fencing, approval-wait exclusion, conservative crash accounting, active authorization expiry, browser cookie/CSRF/origin controls and namespace preservation.
- [Eleven existing workflow cases](evidence/milestone-3-workflow-local.json) pass. Before-dispatch recovery took 20,415 ms and after-commit recovery 20,411 ms; both retained one effect and the same key.
- [Eleven additional process cases](evidence/milestone-3-budgets-local.json) pass: model limit, token reservation limit, approved-write tool limit, twenty-minute simulated approval waiting excluded, crash exhaustion with no dispatch, committed receipt after exhaustion, third-read success, fourth-read prevention, actual timeout then recovery, namespace preservation, and browser-session/API approval.
- [Three focused exhausted-read repetitions](evidence/milestone-3-retry-repeats.json) each retained exactly three read attempts, one model reservation and zero effects.

Every accepted/recovered case checks its effect count through the receiver database, separately from the agent response. Denied cases have zero effects. Tests use real HTTP, separate processes and SQLite; model decisions are scripted. Reports are single controlled observations and source snapshots, not cryptographic build attestations or production reliability estimates.

## Findings addressed during implementation

1. Read retries initially grouped by model-issued call IDs could receive a new allowance on a changed model step. The group is now run/tool/input-semantic, shared across model calls and worker epochs. Completed physical attempts cannot execute again. A fresh sequential build/run and three focused repeats verified the bound after an earlier inconsistent parallel-run observation.
2. A timeout could compute a retry timestamp before the current time and fail to persist the outcome. Timeout completion now persists explicitly; three-second GET attempts can recover inside the ten-second physical-tool deadline.
3. Independent schema failures now complete the tool with an invalid-output reason instead of leaving it apparently running.
4. The real browser initially encountered a denied login shell from cross-site top-level navigation metadata. Only the public, data-free shell permits that navigation; authenticated APIs and mutations retain strict boundary checks. Host validation also supports the server's internal Request URL normalization.
5. Unknown limit names inherited from the object prototype are rejected with own-property checks.
6. Late budget settlement preserves authoritative terminal outcomes. Dispatch authorization is capped by remaining active time at the receiver, rather than relying on caller cancellation alone.

## Reviewed tradeoffs and remaining scope

Cancellation after accepted intent is a request, not revocation. Retrying the same accepted identity while its authorization remains valid follows the specification's linearization boundary; the UI makes no rollback promise. Read-only reconciliation always precedes an additional write attempt.

SQLite application transitions run in `BEGIN IMMEDIATE` transactions; revision CAS is within that serialized transaction, not an unlocked read/write pair. Operator reads may settle an open interval or deadline before returning the committed snapshot. Unexpected database contention can still surface a retryable local API error.

Accounting may conservatively retain an accepted intent as unknown at exhaustion, including earlier no-effect denial states; it never invents rollback. Reconciliation remains available. Unfinished physical tool records after a crash are retained evidence, not proof a tool is still running. Operator-driven reconciliation records append durably, so long-running local use may grow the database.

The session cookie intentionally lacks Secure on plain loopback HTTP. Internet/TLS/proxy deployment is unsupported. Login throttling and browser sessions are process-local and reset on restart; re-login is required. This is local operator control, not enterprise identity or protection against a compromised local service secret.

Actual provider input/output usage and monetary cost remain unknown. The 8,000-token limit is requested completion capacity, with an explicit 1,600 output cap per fixture decision, not measured total provider token usage. Live provider support, full adverse-case/negative-control evaluation exports and publication review remain later milestones.

## Linux and browser ratification

[Exact-code Linux CI](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39117575165) passed on Node 24.21.0/Linux: 47 unit/HTTP tests, both eleven-case process suites, typecheck, formatting, build, the expected default-lease limitation, tuned recovery, live callback overlap and actual-worker locking. [Workflow Linux observations](evidence/milestone-3-workflow-ci.json) and [budget/operator Linux observations](evidence/milestone-3-budgets-ci.json) match all 26 executable-source/config hashes. Linux crash recovery measured 20,171 ms before dispatch and 20,242 ms after commit, with one effect each. The deliberately reproduced default NO_GO remains a known limitation.

[Actual Chrome evidence](evidence/milestone-3-browser.json) and the [credential-free desktop screenshot](evidence/milestone-3-operator-desktop.jpg) record sign-in, explicit-digest approval/receipt, rejection and lowered-budget exhaustion. Independent application/receiver SQLite inspection confirms three expected run outcomes and exactly one effect. The native reset confirmation opened, but browser automation could not accept it; that UI completion remains unverified. Reset API/isolation/retention passed process tests on both hosts. No mobile browser check is claimed. This limitation is retained rather than described as a fully green browser matrix. Isolated browser-test worker/service processes were stopped and their ports confirmed closed.

Repository visibility is PRIVATE. No original product or deployment was modified.
