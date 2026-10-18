# Milestone 2 review

Scope: the synthetic fixture workflow, exactly three tools, independent sandbox process/database and operator CLI. This is a private implementation milestone, not publication or production approval.

Implementation candidate: `bf1cfb27bb83142b5ecb86317e2b100846170cca`. Documentation ratification may follow without changing executable sources.

## Review responsibilities

| Reviewer | Contribution and review scope | Final result |
| --- | --- | --- |
| Codex service/architecture agent | Implemented independent receiver and its tests; cross-reviewed application access, session binding, approval, reconciliation and worker fencing; added process regressions | PASS for constrained milestone |
| Codex state/testing agent | Implemented transactional application store and initial process harness; cross-reviewed corrected receipt and retry paths | PASS for constrained milestone |
| Claude Code | Independent source review; found two material liveness defects; corrected snapshot re-review | PASS; exact-code Linux CI condition satisfied |
| Kimi K3 | Independent source review; required narrowed receipt catch and noted per-side size limits; corrected snapshot re-review | PASS; exact-code Linux CI condition satisfied |

The two Codex reviewers contributed code and cross-reviewed other layers; they are not described as independent reviewers of their own implementations. External services received only this new synthetic project's source snapshot under owner authorization. Local credentials, databases, provider sessions and raw process logs were excluded.

## Findings addressed

1. Approval persisted before an eve response could strand a paused run. The operator route now retries the pending response without recording another approval decision.
2. Reapproval after an ended tool turn needed a new authenticated turn on the same bound session. A process case verifies the same effect key and retained approval history.
3. A receipt lookup catch also swallowed binding and persistence failures. Lookup failures are now separated; receipt key/run/payload mismatches record a distinct unresolved integrity reason and cause no new write. Fencing/store errors propagate.
4. An unknown write outcome with a successful absent lookup could never resume. Only the existing intent/key is retried; its original expiry remains unchanged, and the receiver checks current epoch, context and expiry for any new effect. Unreachable reconciliation remains unknown.
5. Cancellation after confirmed commit-time expiry could remain stranded awaiting reapproval. That confirmed-zero-effect state can now terminate cancelled; executing and unresolved outcomes retain accepted-intent truth.
6. Payload accounting originally combined input and output. Each side now has its own 16 KiB bound, tested with individually valid inputs/outputs whose combined size exceeds that bound.

## Acceptance boundary

Twenty-four unit/service tests pass locally. All eleven process cases pass locally. Before-dispatch recovery measured 20,593 ms and after-commit recovery 20,548 ms. Unknown-outcome same-key retry produced one effect; cancellation after confirmed expiry produced zero. See [source-bound local evidence](evidence/milestone-2-local.json). [Exact-code Linux CI](https://github.com/MargusHemlex/agent-reliability-lab-private-history-backup-20261018/actions/runs/39115927464) passed on Node 24.21.0/Linux, including all eleven process cases, 24 unit/service tests, type checking, formatting, build, expected default-runtime limitation, tuned recovery, genuine callback overlap and actual-worker lock ownership. [Linux process evidence](evidence/milestone-2-ci.json) matches the reviewed source hashes. Recovery was 20,102 ms before dispatch and 21,053 ms after commit; each accepted case produced one effect, and denied cases zero. The default lease remains a deliberately reproduced NO_GO; CI success does not erase that limitation.

The fixture adapter, HTTP calls, databases and crash tests are distinguished explicitly: model decisions are scripted; persistence, authorization and process recovery execute for real. Measurements are controlled samples, not production reliability statistics or a universal exactly-once guarantee.

Deferred: UI, live provider adapter, full model/active-time/token budgets, automated read retry accounting, the complete adverse-case matrix, deliberate negative controls, final report schema and publication review. Run creation can leave an orphan queued record if the cross-database session handoff fails. Service credentials are trusted to activate epochs. Supported startup exclusively uses the guarded CLI launcher on one POSIX host with one worker, pinned eve 0.80.1 and the experimental twenty-second lease/hash guard.

Repository visibility remains PRIVATE. Existing products and deployments are unchanged.
