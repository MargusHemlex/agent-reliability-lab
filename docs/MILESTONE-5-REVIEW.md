# Milestone 5 review and validation boundary

The owner elected to verify this stage without a model API. The implementation includes a real Gateway adapter, but genuine service connectivity, model behavior and billing remain **not run**. The compiled offline transport test is explicitly simulation, not a successful live smoke.

## Four-agent participation

- The Codex adapter agent implemented the model boundary and mocked installed-SDK transport test. Its independent integration review found the fixture-only launcher, worker-entry and tool-registration guards; these were corrected. Final scoped source review passed, subject to executable regression gates.
- The Codex reporting agent implemented separate strict live reports and tests, then cross-reviewed persistent budgets, smoke handling and schema alignment. It found a bootstrap-failure evidence mismatch and the missing predispatch-deadline outcome enum; both were corrected with focused tests.
- Claude Code reviewed the design and a corrected focused implementation snapshot. Its scoped static verdict passed. Follow-up improvements corrected predispatch zero-usage accounting, specific skipped-test reasons, persisted cost-exhaustion reason and metadata consensus. The first broad implementation review timed out; the focused retry completed.
- Kimi K3 reviewed the design and implementation snapshot with a scoped static pass. Its bootstrap-failure observation was fixed. A later corrected-snapshot request failed with service rate/balance limits, so no final-snapshot Kimi revalidation is claimed. The corrected paths received Codex review and executable checks.

Only authorized synthetic project source was supplied to external reviewers. Credentials, local databases, provider sessions and raw application logs were excluded. Static review is not independent execution, a security audit or evidence of genuine live behavior.

## Executable verification

The installed SDK wire test uses an injected fetch implementation and verifies request endpoint/model/output cap while removing sensitive response metadata. The compiled process test blocks model networking, verifies three model turns with reported synthetic usage, requires exact approval and independently observes one sandbox effect. The normal CLI cannot select that test preload.

Unit and HTTP tests cover missing credentials/opt-in, malformed or truncated responses, forbidden/cross-run tools, abort, buffered emission, persistent reservations, restart/replay, unknown usage, cumulative estimates and strict reports. The existing 33-case fixture evaluation remains a separate regression gate. Exact-code Linux CI passed: 79 unit/HTTP tests, the compiled offline workflow, all 33 fixture cases, both report-schema freshness gates, build and all four runtime regression stages. [CI run](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39121690705) tested commit `227f8b78e73333ff6fd4fa05fd6319cd45d9c20f`. Downloaded reports passed canonical schema, semantic and current-source freshness validation before this documentation commit. Historical validation omits `--fresh` after HEAD changes.

- [Offline compiled workflow observation](evidence/milestone-5-offline-workflow.json)
- [Linux fixture JSON](evidence/milestone-5-linux-fixture.json) and [Markdown](evidence/milestone-5-linux-fixture.md)
- [Linux live-not-run JSON](evidence/milestone-5-linux-live-not-run.json) and [Markdown](evidence/milestone-5-linux-live-not-run.md)

The live report records zero executed and zero passed samples, with all usage/effect measurements unknown. Offline acceptance is complete; genuine provider validation is deferred by owner choice.

A not-run report may show the priced default model candidate when no model was selected; it is not an observed provider identity. Per-call ledger identifiers are authoritative observations; summary identifiers are null if mixed or unavailable. Known zero usage is permitted only when local dispatch provably never occurred, not when an external call's usage is unknown.

## Accepted limits

The dated base-price table and byte/framing reservation are estimates, not a tokenizer-backed bound, account-wide budget or invoice. Provider-internal routing/retries and post-abort billing are not established. Unknown usage permanently halts the affected run; there is no automatic reconciliation/unlock. A new run starts a new budget and does not resolve the old incident.

Single-host UTC accounting, experimental eve lease, source-freeze precondition and the prior browser reset/mobile limitations remain. Public release and genuine live-provider validation require separate explicit work. Repository visibility remains PRIVATE; original products and deployments are unchanged.
