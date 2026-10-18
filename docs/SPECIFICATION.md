# Agent Reliability Lab — implementation specification

Status: proposed implementation contract, 18 October 2026. Public-by-design; repository must remain private until an explicit owner decision after final publication review. This specification does not claim implementation or achieved measurements.

## Purpose and audience

Demonstrate agent/developer platform engineering through one executable, observable, failure-tested workflow. A reviewer should reproduce a crash, restart the worker, inspect approval enforcement and verify the resulting sandbox effect. This is an engineering laboratory using synthetic delivery-support data, not a production support service or a generic agent framework.

## One workflow, three tools

Given a seeded delayed delivery, the agent reads its status with `get_delivery`, retrieves versioned permitted resolutions with `get_resolution_policy`, and proposes one schema-validated action. After a human approves that exact proposal, `record_resolution` writes a synthetic support resolution to an independently persisted local sandbox service. No email, refund, payment or real customer action occurs.

Use one agent and explicit deterministic orchestration. The model proposes; trusted application code authorizes. Tools accept typed, size-bounded inputs. Run and delivery IDs are scoped server-side. Unknown tools, arbitrary URLs, shell commands and filesystem access are unavailable. Retrieved text is untrusted data and cannot change permissions.

## Architecture and implementation gate

Use TypeScript, Node.js 24, eve for the agent runtime and optional live model adapter, SQLite for local application state, a separate sandbox HTTP service/database, and a minimal loopback operator UI. AI Gateway is the default live provider route; no account or credential is required for deterministic tests. Pin exact resolved dependencies and commit the lockfile. Read installed versioned eve documentation before implementing its APIs.

Milestone zero is a small executable spike proving a deterministic model substitute, persisted pause/resume, controlled worker termination, restart and inspection of tool attempts. Record the exact eve version and an ADR explaining which layer owns each guarantee. If the required runtime behavior is unsupported, stop the affected implementation and record a concrete replacement proposal; do not silently emulate durability with fabricated traces. The application owns approval validation and sandbox effect idempotency regardless of runtime choice. Do not add a second scheduler if eve already owns execution leases/retries.

Application records include runs, immutable proposals, approval decisions, tool attempts and append-only diagnostic events. Persist workflow state before acknowledging transitions. A documented state machine includes queued, running, awaiting_approval, executing, succeeded, failed and cancelled. A separate typed retry/unknown-outcome condition prevents blind retries of ambiguous writes. Use database transactions and unique constraints, not only in-memory flags. SQLite implies one host and bounded worker concurrency; this release makes no multi-host HA claim.

The sandbox service must survive worker crashes and atomically bind an idempotency key, canonical action payload digest and result to its effect transaction. A duplicate key with identical payload returns the original result; a changed payload conflicts. Persist the key before dispatch and reuse it after timeouts/restarts. Expose a read-only reconciliation lookup: retrieve an already committed result before considering a new write, even if its approval has since expired. An absent result does not authorize a write. Every new effect requires a still-valid dispatch authorization carrying approval expiry, checked by the sandbox at commit; expired authorization requires fresh approval. The sandbox checks an existing key/result first so committed effects remain discoverable after expiry. At-least-once attempts are expected. No claim of universal exactly-once delivery is permitted; external integrations without this contract require reconciliation and are out of scope.

## Approval and operator controls

Approval binds run ID, immutable proposal digest, delivery revision, policy version, expiry and proposed action. Recheck all bindings immediately before dispatch. The sandbox owns authoritative delivery revisions and policy versions; record_resolution atomically compares both expected versions and the action digest with its effect transaction, returning a stale-context conflict with zero effect on mismatch. The worker transaction that validates approval and durably records dispatch intent is the approval/cancellation linearization point; later cancellation cannot revoke that accepted intent. Approval validity at that point is required, and version checks at effect commit remain mandatory. Changed context invalidates approval and requires a new proposal/approval. Approval cannot be supplied by a model/tool. Rejection, cancellation and expiry block new dispatch. A request already accepted by the sandbox may complete; cancellation does not imply rollback. Define and test transaction ordering and this race explicitly.

The operator UI lists runs, source mode, state, proposal, approval controls, attempts and trace timeline. Commands/API provide start, inspect, approve/reject, cancel and reset. Bind servers to loopback by default, reject unexpected Host/Origin, require a local operator secret/session and CSRF-safe mutations; this is local access control, not enterprise identity. Never put approval secrets in model context, URLs or traces. No public deployment in scope.

## Execution, failures and budgets

Default `fixture` mode uses a deterministic scripted model adapter; it is labelled simulation of model decisions, while worker, database, HTTP calls and recovery are real. `live` mode requires explicit opt-in and configured credentials. Both use the same schemas, tools, authorization boundary and effect path. A live planning call must actually execute before a run is labelled live; missing credentials fail closed, never silently fall back.

Persist step/tool attempt IDs and enforce bounded timeouts, at most three attempts for retryable reads, and no blind retry of non-idempotent writes. Classify transient, permanent, denied, exhausted and unknown outcomes. Persist retry deadlines; tests use an injected clock instead of long sleeps. Initial limits: 5 model turns, 8 tool calls, 16 KiB per tool input/output, 10-second tool timeout, 120-second active execution budget, 15-minute approval TTL, and 8,000 requested model tokens per run. Approval waiting does not consume active execution time. The runtime ADR must pin these defaults and accounting rules; deterministic recovery tests have a 30-second per-case deadline. Set these limits before a run. Token budgets are preventive where provider limits support them; monetary budgets are estimates and may overrun by one in-flight call. Stop further calls on exhaustion. Persist usage already incurred across restarts.

## Evaluation and acceptance

Commit synthetic fixtures with known allowed actions and versions, with at least twelve named cases: happy path; rejected approval; expired approval; stale proposal/context; changed policy; prompt injection in delivery text; disallowed tool; read timeout then recovery; exhausted retry budget; worker crash before dispatch; crash after sandbox commit before response/state checkpoint; duplicate/concurrent dispatch. Also test cancellation racing with dispatch and budget exhaustion. Expected outcomes are application assertions, not an LLM judge's opinion.

Each crash test launches separate processes, injects a named barrier, terminates the worker, restarts it against persisted state and independently queries the sandbox effects table. In the after-commit case the sandbox remains alive. Exercise two workers competing for the same run, or prove and enforce exclusive single-worker ownership with startup fencing. Reject stale worker commits. Test restart during approval wait and replay of an old approval.

Release gates: every deterministic policy/approval invariant passes; one approved effect and zero duplicate effects in each specified success/crash case; zero effects in denied cases; recovery reaches its expected terminal/waiting state within a test timeout; all exported reports validate against a committed schema. Tests must fail when idempotency or approval validation is deliberately disabled in a focused negative-control test. These are controlled-case results, not production reliability claims.

Produce machine-readable and human-readable reports with commit, dependency/config/fixture hashes, case IDs, mode, model/provider version if available, attempts, task success, policy violations, observed duplicate effects, recovery elapsed time and latency. Show denominators and sample counts. Separate fixture/live results. Record actual provider-reported input/output tokens and estimated cost using a dated explicit price table; unknown usage/cost stays unknown, never zero. Describe retries and judge methodology. Live smoke results are recorded only when actually run; lack of a live result is visible and blocks claiming live validation, not offline CI.

## Deliverables and staged acceptance

1. Runtime spike and ADR; documented responsibility split and dependency compatibility.
2. One full fixture workflow, real persisted sandbox service and CLI; typed contracts and state transitions.
3. Approval UI, bounded permissions, cancellation and budgets.
4. Crash/restart and adverse-case harness; schema-validated generated reports.
5. Optional live adapter smoke run with opt-in credentials; honest mode/usage reporting.
6. English README, architecture diagram, quickstart, five-minute walkthrough, threat model, testing guide, limitations, SECURITY.md, CONTRIBUTING.md, license and CI. Explain what the author designed and what eve provides.

README must have a key-free quickstart and exact commands for start, failure injection, restart, approval and evidence inspection. CI performs clean locked install, typecheck, lint, tests, build and generated-example/schema freshness. No paid or network model calls in CI. Live integration is separately opt-in. Report failing checks honestly.

## Public and private boundary

Public candidates: independently authored runtime glue, tool schemas, sandbox service, synthetic fixtures, deterministic tests, sanitized generated examples, minimal operator UI, architecture/ADRs and limitations. All repository documentation is English. Credentials are environment-injected and excluded from Git; `.env.example` contains placeholders only. Logs use an allowlist and omit raw headers, tokens, machine paths and unrestricted prompts. Ignored local databases, sessions and raw live traces must not enter exports.

Keep private: all original products/repositories and existing orchestrator implementations, production prompts/contracts, real customers, business policies, private URLs and infrastructure identifiers, deployment credentials and provider sessions. No source is copied from these projects. Public-by-design does not authorize visibility changes. Before publication review current tree and full Git history, tracked artifacts, dependency sources, licenses, CI configuration and installed-package outputs; scan for secrets/private identifiers and inspect results manually. Any suspected real key requires separate remediation; deleting a string is not key rotation.

No real integrations, multi-tenant SaaS, billing, public hosting, autonomous shell execution, broad multi-agent framework, cross-host HA or production compliance certification in version one.

## Five-minute reviewer path

Start the key-free scenario; inspect the proposed action; approve it; inject the after-sandbox-commit crash; restart; inspect the single persisted effect and multiple attempts; open the measured report and a denied-action case. Show fixture/live labels prominently. A reproducible test is the evidence, not a screenshot claiming success.

## Reference

Runtime starting point: https://eve.dev/docs/getting-started (checked 18 October 2026). Installed versioned documentation and the runtime spike determine actual supported behavior.

## Required implementation details from specification review

Milestone zero is a hard gate: demonstrate persisted approval pause across process kill, resumed execution, inspectable attempts, actual retry/lease ownership, and the deterministic adapter using a pinned eve release. Commit a dated go/no-go ADR before milestone 2 or later implementation. A replacement proposal requires resolving the identified incompatibility before proceeding.

For the initial single-host release, enforce exclusive worker ownership with an OS-held advisory lock released on process exit. On each startup, acquire a monotonically increasing sandbox fencing epoch before processing runs; sandbox activation invalidates older epochs atomically. Every new effect must validate the current epoch in its effect transaction. Application transitions compare the current ownership generation too. An in-flight effect committed before new epoch activation remains a legitimate existing effect and is recovered by idempotency lookup. Test an old delayed request arriving after new epoch activation and verify zero new effect. This is single-host fencing, not a distributed lease claim; the milestone-zero ADR must ensure compatibility with eve's execution ownership rather than layering conflicting schedulers.

Write dispatch intent, the stable idempotency key, approved proposal digest, attempt record and transition to executing in one application transaction. Recovery reuses that identity. Sandbox payload-digest conflict is a permanent failure: stop the run, emit a bounded diagnostic event and never retry with a new key. Include a direct conflict test.

A shared injected clock contract drives approval-expiry validation in worker and sandbox tests; normal operation uses UTC time and documents the local-host clock assumption. Commit the numerical limits above as configuration. The optional live route is Vercel AI Gateway, configured with AI_GATEWAY_API_KEY and an explicitly selected AGENT_MODEL gateway model identifier. Missing model selection fails closed. Never commit populated environment files. Reports record the requested gateway model identifier, returned provider/model identifiers and version where supplied; unavailable underlying versions are explicitly unknown. A dated price table is required before publishing cost estimates.

Consume approval exactly once in the dispatch-intent transaction, with compare-and-swap on run revision and all approval bindings validated there. Replaying the approval cannot create a second intent. Retries of that existing intent reuse its key and require unexpired authorization for any new effect; expiry requires a new approval of the same unchanged action, while reconciliation remains read-only. Preserve the action's stable key across reapproval so a late original request cannot create a duplicate effect.

Cancellation before the dispatch-intent transaction yields cancelled and zero effects. Cancellation after that point records cancellation_requested; reconcile the accepted intent. A committed effect ends succeeded with cancellation_requested=true; confirmed no-effect termination may end cancelled. An unknown outcome remains nonterminal and visible until reconciled; it must never be presented as safely cancelled. Zero-effect denied-case gates apply to rejection, expiry before any accepted effect, and pre-intent cancellation. Include race-specific assertions separately.

Crash barriers are versioned test hooks gated by explicit test mode and named configuration; normal live operation rejects fault-injection configuration. Reports include the scripted adapter version/hash and injected barrier ID. Milestone-zero ADR must name the definitive owner of execution claiming/retries and how application authorization transactions and sandbox fencing interact with it.

### Final state and test clarifications

Add `awaiting_reapproval` to the state machine: executing → awaiting_reapproval on a persisted sandbox `authorization_expired` denial with confirmed no effect; a fresh approval issues a new authorization on the existing intent (same action/key), then returns to executing. Never overwrite approval history. Permit at most two reapprovals and a 60-minute wall-clock run deadline. Exhaustion/deadline prevents new dispatch and terminates failed only when no unresolved effect remains; an unknown outcome remains visible and nonterminal for reconciliation even after the deadline. If sandbox recovery lookup is unreachable, persist unknown outcome, bounded backoff and an operator-visible reconciliation requirement; never infer failure/no effect from timeout.

Split expiry tests into `expired_before_intent_zero_effect`, `expired_at_commit_awaits_reapproval`, and `reapproval_same_key_one_effect`. A sandbox stale-context conflict is permanent for this run: persist the attempt, finish failed with zero effect and require a new run/proposal/approval for changed context. Its dedicated test checks that result. A digest conflict likewise fails permanently.

The runs table stores an integer revision, incremented by each successful state transition using database CAS. Worker ownership generation equals its activated sandbox epoch and is stored in the application ownership row; transitions require that generation to remain current. The sandbox epoch counter and activation are persisted in one SQLite transaction and never regress on service restart. New effect commits compare the supplied epoch atomically against the active one. Initial concurrency is exclusively one OS-locked worker: a second process must fail to claim execution; the mandatory stale-request test activates a newer epoch and rejects an old delayed effect. This replaces the earlier choice between concurrency modes.

The sandbox clock is authoritative for expiry at effect commit. Tests launch both processes with the same test-only clock file and clock generation, advanced atomically by the harness at synchronized barriers; normal mode rejects any clock override. The worker may deny early, but cannot override sandbox expiry. The real 30-second harness deadline remains a wall-clock watchdog, separate from simulated run time.

`reset` seeds a fresh isolated dataset/database namespace; it does not truncate an existing run or its events. Explicit destruction of a local namespace is a separately named command with confirmation and is unnecessary for the five-minute walkthrough. Exported reports identify namespace/configuration/fixture versions and are immutable files. Startup fails if fault-injection or clock-override configuration is supplied outside explicit test mode, including environment variables. The commit deadline, bounded retries and run deadline never authorize a new side effect after expiry; reconciliation of already committed results remains allowed.
